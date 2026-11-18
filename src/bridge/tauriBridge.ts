import type { ProviderId, TokenSnapshot } from '../game/types';

/**
 * 托盘菜单触发的前端动作标识：
 * - `'toggle-slot'`    : 打开/收起九宫格老虎机面板
 * - `'refresh-tokens'` : 立即刷新本地 Token 快照
 * - `'restore-panel'`  : 取消鼠标穿透并恢复面板可交互状态
 * - `'toggle-top'`     : 切换窗口置顶状态
 * - `'reset-position'` : 重置窗口回屏幕右下角安全位置
 * - `'toggle-walk'`    : 切换「自由溜达」（前端负责记忆开关，可用 `setWalkMenuChecked` 回写托盘勾选）
 */
export type TrayAction =
  | 'toggle-slot'
  | 'refresh-tokens'
  | 'restore-panel'
  | 'toggle-top'
  | 'reset-position'
  | 'toggle-walk'
  | (string & {});

interface TauriInternalsLike {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

interface GlobalWindowWithTauri {
  __TAURI_INTERNALS__?: TauriInternalsLike;
  __TAURI__?: {
    core?: {
      invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
}

interface SimulatedStoreData {
  date: string;
  byProvider: Partial<Record<ProviderId, number>>;
}

const SIM_STORAGE_KEY = 'cyber_pet_sim_tokens_v1';
const TRAY_DOM_EVENT = 'cyber-pet:tray-action';

const VALID_PROVIDERS: readonly ProviderId[] = [
  'claude',
  'openai',
  'deepseek',
  'gemini',
  'grok',
  'antigravity',
  'other',
];

let memorySimFallback: SimulatedStoreData | null = null;
let lastClickThroughState: boolean | null = null;
let lastLiveSnapshot: TokenSnapshot | null = null;
const pollingSubscribers = new Set<(snap: TokenSnapshot) => void>();

/** 获取本地时区 YYYY-MM-DD 日期字符串 */
function getLocalDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTauriInvoke(): (<T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as GlobalWindowWithTauri;
  if (w.__TAURI_INTERNALS__ && typeof w.__TAURI_INTERNALS__.invoke === 'function') {
    return w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
  }
  if (w.__TAURI__?.core && typeof w.__TAURI__.core.invoke === 'function') {
    return w.__TAURI__.core.invoke.bind(w.__TAURI__.core);
  }
  return null;
}

/**
 * 检测当前是否运行在原生 Tauri v2 桌面容器内
 */
export function isTauriDesktop(): boolean {
  return getTauriInvoke() !== null;
}

function loadSimData(): SimulatedStoreData {
  const today = getLocalDateKey();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(SIM_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SimulatedStoreData>;
        if (parsed && parsed.date === today && parsed.byProvider && typeof parsed.byProvider === 'object') {
          const sanitized: Partial<Record<ProviderId, number>> = {};
          for (const key of VALID_PROVIDERS) {
            const val = parsed.byProvider[key];
            if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
              sanitized[key] = Math.floor(val);
            }
          }
          const result: SimulatedStoreData = { date: today, byProvider: sanitized };
          memorySimFallback = result;
          return result;
        }
      }
    }
  } catch {
    // 忽略无痕窗口或沙盒下 localStorage 读取异常
  }

  if (memorySimFallback && memorySimFallback.date === today) {
    return {
      date: today,
      byProvider: { ...memorySimFallback.byProvider },
    };
  }

  const fresh: SimulatedStoreData = { date: today, byProvider: {} };
  memorySimFallback = fresh;
  return fresh;
}

function saveSimData(data: SimulatedStoreData): void {
  memorySimFallback = {
    date: data.date,
    byProvider: { ...data.byProvider },
  };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(memorySimFallback));
    }
  } catch {
    // 忽略写入异常
  }
}

function mergeSnapshots(base: TokenSnapshot | null, sim: SimulatedStoreData, isLive: boolean): TokenSnapshot {
  const date = base?.date || sim.date || getLocalDateKey();
  const mergedByProvider: Partial<Record<ProviderId, number>> = {};

  for (const key of VALID_PROVIDERS) {
    const liveVal = base && base.date === date ? (base.byProvider[key] ?? 0) : 0;
    const simVal = sim.date === date ? (sim.byProvider[key] ?? 0) : 0;
    const sum = Math.max(0, Math.floor(liveVal) + Math.floor(simVal));
    if (sum > 0) {
      mergedByProvider[key] = sum;
    }
  }

  let totalTokens = 0;
  for (const key of VALID_PROVIDERS) {
    totalTokens += mergedByProvider[key] ?? 0;
  }

  return {
    date,
    totalTokens,
    byProvider: mergedByProvider,
    updatedAt: Date.now(),
    isLiveLocal: isLive,
  };
}

function sanitizeNativeSnapshot(raw: unknown): TokenSnapshot {
  const today = getLocalDateKey();
  if (!raw || typeof raw !== 'object') {
    return {
      date: today,
      totalTokens: 0,
      byProvider: {},
      updatedAt: Date.now(),
      isLiveLocal: true,
    };
  }
  const obj = raw as Record<string, unknown>;
  const date = typeof obj.date === 'string' && obj.date.length >= 8 ? obj.date : today;
  const byProvider: Partial<Record<ProviderId, number>> = {};
  const rawMap =
    obj.byProvider && typeof obj.byProvider === 'object'
      ? (obj.byProvider as Record<string, unknown>)
      : {};

  let computedSum = 0;
  for (const key of VALID_PROVIDERS) {
    const val = rawMap[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      const clean = Math.floor(val);
      byProvider[key] = clean;
      computedSum += clean;
    }
  }

  const totalTokens =
    typeof obj.totalTokens === 'number' && Number.isFinite(obj.totalTokens) && obj.totalTokens >= computedSum
      ? Math.floor(obj.totalTokens)
      : computedSum;

  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) && obj.updatedAt > 0
      ? Math.floor(obj.updatedAt)
      : Date.now();

  return {
    date,
    totalTokens,
    byProvider,
    updatedAt,
    isLiveLocal: obj.isLiveLocal !== false,
  };
}

function notifySubscribers(snap: TokenSnapshot): void {
  for (const cb of pollingSubscribers) {
    try {
      cb(snap);
    } catch {
      // 隔离单个监听器异常
    }
  }
}

/**
 * 获取当日 Token 消耗快照：
 * - Tauri 桌面模式下调用 Rust `get_token_snapshot` 扫描本地只读会话统计（并与调试投喂增量合并）
 * - 纯浏览器模式下读取本地 `localStorage` 模拟快照
 */
export async function fetchTokenSnapshot(force: boolean = false): Promise<TokenSnapshot> {
  const sim = loadSimData();
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const raw = await invoke<TokenSnapshot>('get_token_snapshot', { force });
      const live = sanitizeNativeSnapshot(raw);
      lastLiveSnapshot = live;
      return mergeSnapshots(live, sim, true);
    } catch {
      if (lastLiveSnapshot && lastLiveSnapshot.date === getLocalDateKey()) {
        return mergeSnapshots(lastLiveSnapshot, sim, true);
      }
    }
  }
  return mergeSnapshots(null, sim, false);
}

/**
 * 动态设置桌面透明窗口是否鼠标穿透（ignore = true 时点击穿透到底层桌面窗口）
 * 内置状态去重，避免 mousemove 高频重复触发原生 IPC
 */
export async function setClickThrough(ignore: boolean): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    lastClickThroughState = ignore;
    return;
  }
  if (lastClickThroughState === ignore) {
    return;
  }
  lastClickThroughState = ignore;
  try {
    await invoke('set_click_through', { ignore });
  } catch {
    lastClickThroughState = null;
  }
}

/**
 * 动态设置窗口置顶开关（供面板或托盘联动使用）
 */
export async function setAlwaysOnTop(onTop: boolean): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    return;
  }
  try {
    await invoke('set_always_on_top', { onTop, on_top: onTop });
  } catch {
    // 忽略非桌面环境异常
  }
}

/**
 * 将桌宠窗口一键归位至主显示器右下角安全区域，并自动解除鼠标穿透
 */
export async function resetWindowPosition(): Promise<void> {
  lastClickThroughState = false;
  const invoke = getTauriInvoke();
  if (!invoke) {
    return;
  }
  try {
    await invoke('reset_window_position');
  } catch {
    // 忽略异常
  }
}

/**
 * 网页试玩/调试专用：模拟指定平台消耗一定数量的 Token，立即更新本地快照并广播给轮询订阅者
 */
export function simulateBurnTokens(provider: ProviderId, tokens: number): TokenSnapshot {
  const delta = Number.isFinite(tokens) ? Math.max(0, Math.floor(tokens)) : 0;
  const sim = loadSimData();
  const safeProvider: ProviderId = VALID_PROVIDERS.includes(provider) ? provider : 'other';

  if (delta > 0) {
    sim.byProvider[safeProvider] = (sim.byProvider[safeProvider] ?? 0) + delta;
    saveSimData(sim);
  }

  const snap = mergeSnapshots(isTauriDesktop() ? lastLiveSnapshot : null, sim, isTauriDesktop());
  notifySubscribers(snap);
  return snap;
}

/**
 * 启动本地 Token 快照定时轮询（默认 25000ms），立即执行首次拉取，返回停止轮询的清理函数
 */
export function startTokenPolling(
  onUpdate: (snap: TokenSnapshot) => void,
  intervalMs: number = 25000
): () => void {
  let active = true;
  const safeInterval = Math.max(1000, Math.floor(intervalMs));

  const wrappedSubscriber = (snap: TokenSnapshot) => {
    if (active) {
      onUpdate(snap);
    }
  };
  pollingSubscribers.add(wrappedSubscriber);

  const pollOnce = async () => {
    if (!active) return;
    const snap = await fetchTokenSnapshot(false);
    if (active) {
      onUpdate(snap);
    }
  };

  void pollOnce();
  const timer = globalThis.setInterval(() => {
    void pollOnce();
  }, safeInterval);

  return () => {
    active = false;
    pollingSubscribers.delete(wrappedSubscriber);
    globalThis.clearInterval(timer);
  };
}

/**
 * 监听原生系统托盘菜单动作（如 `'toggle-slot'` | `'refresh-tokens'` | `'restore-panel'` | `'toggle-top'` | `'reset-position'`）
 * 返回取消监听函数
 */
export function onTrayAction(handler: (action: string) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const listener = (ev: Event) => {
    const custom = ev as CustomEvent<unknown>;
    const action = typeof custom.detail === 'string' ? custom.detail : '';
    if (!action) return;

    if (action === 'restore-panel' || action === 'reset-position' || action === 'toggle-slot') {
      lastClickThroughState = false;
    }

    handler(action);
  };

  window.addEventListener(TRAY_DOM_EVENT, listener);
  return () => {
    window.removeEventListener(TRAY_DOM_EVENT, listener);
  };
}

// ============================================================================
// 实时 Token 速率 & 窗口溜达
// ============================================================================

export interface TokenRateSample {
  tokensPerSec: number;
  freshTokensPerSec: number;
  windowSec: number;
  todayTokens: number;
  updatedAt: number;
  isLive: boolean;
}

export interface WalkBounds {
  minX: number;
  maxX: number;
  y: number;
  winX: number;
  scale: number;
}

const DEFAULT_RATE_WINDOW_SEC = 12;
const SIM_RATE_PROVIDER: ProviderId = 'other';

interface SimRateState {
  tokensPerSec: number;
  until: number;
  lastAccrualAt: number;
  carry: number;
}

let simRate: SimRateState | null = null;
let lastRateSample: TokenRateSample | null = null;

function finiteNonNeg(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function sanitizeRate(raw: unknown): TokenRateSample {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    tokensPerSec: finiteNonNeg(obj.tokensPerSec),
    freshTokensPerSec: finiteNonNeg(obj.freshTokensPerSec),
    windowSec: finiteNonNeg(obj.windowSec, DEFAULT_RATE_WINDOW_SEC) || DEFAULT_RATE_WINDOW_SEC,
    todayTokens: Math.floor(finiteNonNeg(obj.todayTokens)),
    updatedAt: Math.floor(finiteNonNeg(obj.updatedAt, Date.now())) || Date.now(),
    isLive: obj.isLive !== false,
  };
}

/** 浏览器模式：把模拟速率按经过时间累加进模拟 todayTokens */
function accrueSimRate(now: number): number {
  if (!simRate) return 0;
  const end = Math.min(now, simRate.until);
  const elapsedSec = Math.max(0, end - simRate.lastAccrualAt) / 1000;
  simRate.lastAccrualAt = Math.max(simRate.lastAccrualAt, end);
  const exact = simRate.tokensPerSec * elapsedSec + simRate.carry;
  const whole = Math.floor(exact);
  simRate.carry = exact - whole;
  if (whole > 0) {
    const sim = loadSimData();
    sim.byProvider[SIM_RATE_PROVIDER] = (sim.byProvider[SIM_RATE_PROVIDER] ?? 0) + whole;
    saveSimData(sim);
  }
  const rate = now < simRate.until ? simRate.tokensPerSec : 0;
  if (now >= simRate.until) {
    simRate = null;
  }
  return rate;
}

function simTotalTokens(): number {
  const sim = loadSimData();
  let sum = 0;
  for (const key of VALID_PROVIDERS) {
    sum += sim.byProvider[key] ?? 0;
  }
  return sum;
}

/**
 * 获取实时 Token 速率：
 * - Tauri 模式调用 Rust `get_token_rate`（增量读活跃会话文件，最近 12 秒窗口）
 * - 浏览器模式返回 `simulateTokenRate` 注入的模拟速率
 */
export async function fetchTokenRate(): Promise<TokenRateSample> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const raw = await invoke<TokenRateSample>('get_token_rate');
      const sample = sanitizeRate(raw);
      // 合并调试投喂的模拟 Token，保持与 fetchTokenSnapshot 口径一致
      sample.todayTokens += simTotalTokens();
      lastRateSample = sample;
      return sample;
    } catch {
      if (lastRateSample) {
        return { ...lastRateSample, tokensPerSec: 0, freshTokensPerSec: 0, updatedAt: Date.now() };
      }
      return {
        tokensPerSec: 0,
        freshTokensPerSec: 0,
        windowSec: DEFAULT_RATE_WINDOW_SEC,
        todayTokens: simTotalTokens(),
        updatedAt: Date.now(),
        isLive: false,
      };
    }
  }

  const now = Date.now();
  const rate = accrueSimRate(now);
  return {
    tokensPerSec: rate,
    freshTokensPerSec: rate,
    windowSec: DEFAULT_RATE_WINDOW_SEC,
    todayTokens: simTotalTokens(),
    updatedAt: now,
    isLive: false,
  };
}

/**
 * 启动实时速率轮询（默认 1500ms），立即首拉；上一次请求未返回时跳过本轮，返回停止函数
 */
export function startRatePolling(
  cb: (s: TokenRateSample) => void,
  intervalMs: number = 1500
): () => void {
  let active = true;
  let inFlight = false;
  const safeInterval = Math.max(250, Math.floor(Number.isFinite(intervalMs) ? intervalMs : 1500));

  const pollOnce = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const s = await fetchTokenRate();
      if (active) {
        try {
          cb(s);
        } catch {
          // 隔离回调异常
        }
      }
    } finally {
      inFlight = false;
    }
  };

  void pollOnce();
  const timer = globalThis.setInterval(() => {
    void pollOnce();
  }, safeInterval);

  return () => {
    active = false;
    globalThis.clearInterval(timer);
  };
}

/**
 * 浏览器调试：让速率轮询在 durationMs 内返回 tokensPerSec，并按时间累加模拟 todayTokens；Tauri 模式 no-op
 */
export function simulateTokenRate(tokensPerSec: number, durationMs: number): void {
  if (isTauriDesktop()) return;
  const now = Date.now();
  accrueSimRate(now); // 先结算上一段模拟
  const rate = Number.isFinite(tokensPerSec) ? Math.max(0, tokensPerSec) : 0;
  const dur = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (rate <= 0 || dur <= 0) {
    simRate = null;
    return;
  }
  simRate = { tokensPerSec: rate, until: now + dur, lastAccrualAt: now, carry: 0 };
}

/** 获取溜达边界（逻辑像素）；浏览器模式返回 null */
export async function getWalkBounds(): Promise<WalkBounds | null> {
  const invoke = getTauriInvoke();
  if (!invoke) return null;
  try {
    const raw = await invoke<WalkBounds>('get_walk_bounds');
    const o = raw && typeof raw === 'object' ? (raw as unknown as Record<string, unknown>) : {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    const b: WalkBounds = {
      minX: num(o.minX),
      maxX: num(o.maxX),
      y: num(o.y),
      winX: num(o.winX),
      scale: num(o.scale),
    };
    if (Object.values(b).some((v) => Number.isNaN(v))) return null;
    return b;
  } catch {
    return null;
  }
}

let moveInFlight = false;
let pendingMoveX: number | null = null;

/**
 * 只改窗口 x（逻辑像素，Rust 端夹在边界内）；浏览器 no-op。
 * 高频调用自动合并：上一次 IPC 未完成时只保留最新 x。
 */
export async function moveWindowTo(x: number): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke || !Number.isFinite(x)) return;
  if (moveInFlight) {
    pendingMoveX = x;
    return;
  }
  moveInFlight = true;
  let next: number | null = x;
  try {
    while (next !== null) {
      const target = next;
      pendingMoveX = null;
      try {
        await invoke('move_window_to', { x: target });
      } catch {
        // 忽略单次移动失败
      }
      next = pendingMoveX;
    }
  } finally {
    moveInFlight = false;
  }
}

/** 同步托盘「🚶 自由溜达」勾选状态（前端恢复记忆开关后调用）；浏览器 no-op */
export async function setWalkMenuChecked(checked: boolean): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    await invoke('set_walk_menu_checked', { checked });
  } catch {
    // 忽略
  }
}
