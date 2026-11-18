pub mod token_scanner;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, PhysicalPosition, Position, WebviewWindow, Wry,
};
use token_scanner::{TokenRate, TokenSnapshot};

pub struct AppTrayState {
    pub always_on_top: AtomicBool,
    pub top_check_item: Mutex<Option<CheckMenuItem<Wry>>>,
    pub walk_enabled: AtomicBool,
    pub walk_check_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

impl Default for AppTrayState {
    fn default() -> Self {
        Self {
            always_on_top: AtomicBool::new(true),
            top_check_item: Mutex::new(None),
            walk_enabled: AtomicBool::new(true),
            walk_check_item: Mutex::new(None),
        }
    }
}

/// 溜达边界（逻辑像素）
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkBounds {
    pub min_x: f64,
    pub max_x: f64,
    pub y: f64,
    pub win_x: f64,
    pub scale: f64,
}

/// move_window_to 高频调用时复用的水平边界缓存（显示器信息 2s 内不重复查询）
#[derive(Default)]
pub struct WalkState {
    cached: Mutex<Option<(Instant, f64, f64)>>,
}

const WALK_BOUNDS_TTL: Duration = Duration::from_secs(2);

#[cfg(target_os = "macos")]
fn platform_safe_margins_logical() -> (f64, f64) {
    // 预留右侧与底部 macOS Dock 安全边距
    (24.0, 92.0)
}

#[cfg(not(target_os = "macos"))]
fn platform_safe_margins_logical() -> (f64, f64) {
    // Windows / Linux 任务栏安全边距
    (20.0, 72.0)
}

/// 将桌宠窗口精准定位到主显示器右下角安全区域（兼容 Retina 与 Windows 高分屏缩放）
pub fn position_window_bottom_right(window: &WebviewWindow) {
    let monitor_opt = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());

    let Some(monitor) = monitor_opt else {
        return;
    };

    let scale = monitor.scale_factor().max(1.0);
    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let (win_w_phys, win_h_phys) = match window.outer_size() {
        Ok(sz) if sz.width > 0 && sz.height > 0 => (sz.width as i32, sz.height as i32),
        _ => ((310.0 * scale).round() as i32, (340.0 * scale).round() as i32),
    };

    let (margin_right_logical, margin_bottom_logical) = platform_safe_margins_logical();
    let margin_right = (margin_right_logical * scale).round() as i32;
    let margin_bottom = (margin_bottom_logical * scale).round() as i32;

    let target_x = (mon_pos.x + (mon_size.width as i32) - win_w_phys - margin_right).max(mon_pos.x);
    let target_y =
        (mon_pos.y + (mon_size.height as i32) - win_h_phys - margin_bottom).max(mon_pos.y);

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(
        target_x, target_y,
    )));
}

fn dispatch_tray_action(window: &WebviewWindow, action: &str) {
    let js = format!(
        "window.dispatchEvent(new CustomEvent('cyber-pet:tray-action', {{ detail: '{}' }}));",
        action
    );
    let _ = window.eval(&js);
    let _ = window.emit("tray-action", action);
}

#[tauri::command]
async fn get_token_snapshot(force: Option<bool>) -> Result<TokenSnapshot, String> {
    let force_scan = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        token_scanner::get_live_token_snapshot_cached(force_scan)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn set_always_on_top(
    window: WebviewWindow,
    state: tauri::State<'_, AppTrayState>,
    on_top: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(on_top)
        .map_err(|e| e.to_string())?;
    state.always_on_top.store(on_top, Ordering::SeqCst);
    if let Ok(guard) = state.top_check_item.lock() {
        if let Some(ref item) = *guard {
            let _ = item.set_checked(on_top);
        }
    }
    Ok(())
}

#[tauri::command]
fn reset_window_position(window: WebviewWindow) -> Result<(), String> {
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.set_visible_on_all_workspaces(true);
    position_window_bottom_right(&window);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// 实时 Token 速率（增量读取活跃会话文件，spawn_blocking 不阻塞主线程）
#[tauri::command]
async fn get_token_rate() -> Result<TokenRate, String> {
    tauri::async_runtime::spawn_blocking(token_scanner::get_live_token_rate)
        .await
        .map_err(|e| e.to_string())
}

/// 计算当前显示器上可溜达的水平范围（逻辑像素），返回 (minX, maxX, scale)
fn compute_walk_range(window: &WebviewWindow) -> Result<(f64, f64, f64), String> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "no monitor".to_string())?;
    let scale = monitor.scale_factor().max(0.5);

    let wa = monitor.work_area();
    let (left, right) = if wa.size.width > 0 {
        let l = wa.position.x as f64 / scale;
        (l, l + wa.size.width as f64 / scale)
    } else {
        // 回退：整屏减去 Dock / 任务栏安全边距
        let (margin_right, _) = platform_safe_margins_logical();
        let l = monitor.position().x as f64 / scale;
        (l, l + monitor.size().width as f64 / scale - margin_right)
    };

    let win_w = match window.outer_size() {
        Ok(sz) if sz.width > 0 => sz.width as f64 / scale,
        _ => 310.0,
    };
    let min_x = left - win_w * 0.45;
    let max_x = (right - win_w * 0.55).max(min_x);
    Ok((min_x, max_x, scale))
}

fn walk_range_cached(
    window: &WebviewWindow,
    walk: &WalkState,
    force: bool,
) -> Result<(f64, f64, f64), String> {
    if !force {
        if let Ok(guard) = walk.cached.lock() {
            if let Some((at, min_x, max_x)) = *guard {
                if at.elapsed() < WALK_BOUNDS_TTL {
                    let scale = window.scale_factor().unwrap_or(1.0).max(0.5);
                    return Ok((min_x, max_x, scale));
                }
            }
        }
    }
    let (min_x, max_x, scale) = compute_walk_range(window)?;
    if let Ok(mut guard) = walk.cached.lock() {
        *guard = Some((Instant::now(), min_x, max_x));
    }
    Ok((min_x, max_x, scale))
}

/// 溜达边界：minX/maxX 允许半个身子探出屏幕边缘；y 为窗口当前 y（用户拖到哪就在哪溜达）
#[tauri::command]
async fn get_walk_bounds(
    window: WebviewWindow,
    walk: tauri::State<'_, WalkState>,
) -> Result<WalkBounds, String> {
    let (min_x, max_x, scale) = walk_range_cached(&window, &walk, true)?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok(WalkBounds {
        min_x,
        max_x,
        y: pos.y as f64 / scale,
        win_x: pos.x as f64 / scale,
        scale,
    })
}

/// 只改窗口 x（逻辑像素，夹在溜达边界内），y 保持当前值；可承受 30 次/秒
#[tauri::command]
async fn move_window_to(
    window: WebviewWindow,
    walk: tauri::State<'_, WalkState>,
    x: f64,
) -> Result<(), String> {
    if !x.is_finite() {
        return Err("invalid x".into());
    }
    let (min_x, max_x, scale) = walk_range_cached(&window, &walk, false)?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let y = pos.y as f64 / scale;
    let cx = x.clamp(min_x, max_x);
    window
        .set_position(Position::Logical(LogicalPosition::new(cx, y)))
        .map_err(|e| e.to_string())
}

/// 前端恢复记忆的溜达开关后，同步托盘勾选状态
#[tauri::command]
fn set_walk_menu_checked(state: tauri::State<'_, AppTrayState>, checked: bool) -> Result<(), String> {
    state.walk_enabled.store(checked, Ordering::SeqCst);
    if let Ok(guard) = state.walk_check_item.lock() {
        if let Some(ref item) = *guard {
            let _ = item.set_checked(checked);
        }
    }
    Ok(())
}

fn setup_system_tray(app: &AppHandle) -> tauri::Result<()> {
    let item_pet_pat =
        MenuItem::with_id(app, "pet_pat", "👋 摸摸头互动", true, None::<&str>)?;
    let item_refresh =
        MenuItem::with_id(app, "refresh_tokens", "🔄 刷新今日 Token", true, None::<&str>)?;
    let item_restore = MenuItem::with_id(
        app,
        "restore_panel",
        "🖱️ 取消穿透/恢复点击",
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let item_top = CheckMenuItem::with_id(
        app,
        "toggle_top",
        "📌 置顶开关",
        true,
        true,
        None::<&str>,
    )?;
    let item_reset_pos =
        MenuItem::with_id(app, "reset_pos", "📐 重置回右下角", true, None::<&str>)?;
    let item_walk = CheckMenuItem::with_id(
        app,
        "toggle_walk",
        "🚶 自由溜达",
        true,
        true,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let item_quit = MenuItem::with_id(app, "quit", "🚪 退出桌宠", true, None::<&str>)?;

    if let Some(state) = app.try_state::<AppTrayState>() {
        if let Ok(mut guard) = state.top_check_item.lock() {
            *guard = Some(item_top.clone());
        }
        if let Ok(mut guard) = state.walk_check_item.lock() {
            *guard = Some(item_walk.clone());
        }
    }

    let menu = Menu::with_items(
        app,
        &[
            &item_pet_pat,
            &item_refresh,
            &item_restore,
            &sep1,
            &item_top,
            &item_walk,
            &item_reset_pos,
            &sep2,
            &item_quit,
        ],
    )?;

    let tray_icon_img = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    let _tray = TrayIconBuilder::with_id("cyber-pet-tray")
        .icon(tray_icon_img)
        .tooltip("AI娘桌面陪伴宠 · 本地算力陪伴中")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            if id == "quit" {
                app_handle.exit(0);
                return;
            }

            let Some(win) = app_handle.get_webview_window("main") else {
                return;
            };

            match id {
                "pet_pat" => {
                    let _ = win.show();
                    dispatch_tray_action(&win, "pet-pat");
                }
                "refresh_tokens" => {
                    dispatch_tray_action(&win, "refresh-tokens");
                }
                "restore_panel" => {
                    let _ = win.set_ignore_cursor_events(false);
                    let _ = win.set_visible_on_all_workspaces(true);
                    let _ = win.show();
                    let _ = win.set_focus();
                    dispatch_tray_action(&win, "restore-panel");
                }
                "toggle_top" => {
                    if let Some(state) = app_handle.try_state::<AppTrayState>() {
                        let next = !state.always_on_top.load(Ordering::SeqCst);
                        state.always_on_top.store(next, Ordering::SeqCst);
                        let _ = win.set_always_on_top(next);
                        if let Ok(guard) = state.top_check_item.lock() {
                            if let Some(ref item) = *guard {
                                let _ = item.set_checked(next);
                            }
                        }
                    }
                    dispatch_tray_action(&win, "toggle-top");
                }
                "toggle_walk" => {
                    if let Some(state) = app_handle.try_state::<AppTrayState>() {
                        let next = !state.walk_enabled.load(Ordering::SeqCst);
                        state.walk_enabled.store(next, Ordering::SeqCst);
                        if let Ok(guard) = state.walk_check_item.lock() {
                            if let Some(ref item) = *guard {
                                let _ = item.set_checked(next);
                            }
                        }
                    }
                    dispatch_tray_action(&win, "toggle-walk");
                }
                "reset_pos" => {
                    let _ = win.set_ignore_cursor_events(false);
                    let _ = win.set_visible_on_all_workspaces(true);
                    position_window_bottom_right(&win);
                    let _ = win.show();
                    let _ = win.set_focus();
                    dispatch_tray_action(&win, "reset-position");
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_macos_window_extras(_window: &WebviewWindow) {
    // macOS 透明无边框置顶桌宠已通过 macOSPrivateApi + transparent + shadow:false 原生激活；
    // 此函数保留平台专属钩子，确保跨平台隔离清晰，不影响 Windows 编译出 .exe。
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppTrayState::default())
        .manage(WalkState::default())
        .setup(|app| {
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_ignore_cursor_events(false);
                let _ = main_win.set_always_on_top(true);
                let _ = main_win.set_visible_on_all_workspaces(true);
                position_window_bottom_right(&main_win);
                let _ = main_win.unminimize();
                let _ = main_win.show();
                let _ = main_win.set_focus();
                #[cfg(target_os = "macos")]
                configure_macos_window_extras(&main_win);
            }
            setup_system_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_token_snapshot,
            set_click_through,
            set_always_on_top,
            reset_window_position,
            get_token_rate,
            get_walk_bounds,
            move_window_to,
            set_walk_menu_checked,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI娘算力桌宠 tauri application");
}
