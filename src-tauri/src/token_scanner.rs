//! 本地只读隐私安全 Token 扫描器
//!
//! 隐私红线保证：
//! 1. 仅使用最小化 Serde 结构体反序列化时间戳、模型标识符与数值型 Token 计数字段；
//!    所有对话正文（`content`/`thinking`/`prompt`/`tool_calls`）、工作目录路径与敏感字段均在反序列化阶段直接跳过（`IgnoredAny`），绝不读入业务结构或持久化。
//! 2. 内存缓存仅保存路径哈希、`mtime`、文件字节大小与按平台聚合后的整数计数，不保留任何路径字符串或会话内容。
//! 3. 向前端返回的 `TokenSnapshot` 仅包含本地日期、总 Token 数、各平台分类整数、更新时间戳与布尔标记。

use chrono::{DateTime, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 与前端 `src/game/types.ts` 严格对齐的当日 Token 快照结构
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenSnapshot {
    pub date: String,
    pub total_tokens: u64,
    pub by_provider: BTreeMap<String, u64>,
    pub updated_at: u64,
    pub is_live_local: bool,
}

#[derive(Debug, Clone)]
struct CachedFileUsage {
    mtime_ns: u128,
    size: u64,
    by_provider: BTreeMap<String, u64>,
}

const SNAPSHOT_CACHE_TTL: Duration = Duration::from_secs(20);
const MAX_SCAN_DEPTH: usize = 6;
const SKIP_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "cache",
    "blobs",
    "shell_snapshots",
    "tmp",
    "log",
];

#[derive(Debug, Default)]
struct ScannerCache {
    date: Option<NaiveDate>,
    files: HashMap<u64, CachedFileUsage>,
    last_snapshot: Option<(Instant, TokenSnapshot)>,
}

static GLOBAL_SCANNER_CACHE: OnceLock<Mutex<ScannerCache>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FlexibleTimestamp {
    Text(String),
    Epoch(i64),
}

#[derive(Debug, Default, Deserialize)]
struct UsageFields {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cached_input_tokens: u64,
    #[serde(default)]
    cache_write_input_tokens: u64,
    #[serde(default)]
    cache_read_tokens: u64,
    #[serde(default)]
    total_tokens: u64,
}

impl UsageFields {
    /// Claude / 通用分项求和（含缓存创建与缓存命中 Token）
    fn sum_claude_style(&self) -> u64 {
        let parts = self
            .input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_creation_input_tokens)
            .saturating_add(self.cache_read_input_tokens)
            .saturating_add(self.cache_read_tokens);
        if parts > 0 {
            parts
        } else {
            self.total_tokens
        }
    }

    /// Codex / OpenAI 优先取 `total_tokens`，缺失时退回 `input_tokens + output_tokens`
    fn sum_codex_style(&self) -> u64 {
        if self.total_tokens > 0 {
            self.total_tokens
        } else {
            self.input_tokens
                .saturating_add(self.output_tokens)
                .saturating_add(self.cached_input_tokens)
                .saturating_add(self.cache_write_input_tokens)
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct MinimalClaudeMessage {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    usage: Option<UsageFields>,
}

#[derive(Debug, Default, Deserialize)]
struct MinimalClaudeLine {
    #[serde(default)]
    timestamp: Option<FlexibleTimestamp>,
    #[serde(default, rename = "requestId")]
    request_id: Option<String>,
    #[serde(default)]
    message: Option<MinimalClaudeMessage>,
}

#[derive(Debug, Default, Deserialize)]
struct MinimalCodexInfo {
    #[serde(default)]
    total_token_usage: Option<UsageFields>,
    #[serde(default)]
    last_token_usage: Option<UsageFields>,
}

#[derive(Debug, Default, Deserialize)]
struct MinimalCodexPayload {
    #[serde(default, rename = "type")]
    payload_type: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    usage: Option<UsageFields>,
    #[serde(default)]
    info: Option<MinimalCodexInfo>,
}

#[derive(Debug, Default, Deserialize)]
struct MinimalCodexLine {
    #[serde(default)]
    timestamp: Option<FlexibleTimestamp>,
    #[serde(default, rename = "type")]
    record_type: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    total_tokens: Option<u64>,
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
    #[serde(default)]
    usage: Option<UsageFields>,
    #[serde(default)]
    payload: Option<MinimalCodexPayload>,
}

#[derive(Debug, Default, Deserialize)]
struct MinimalAgyLine {
    #[serde(default)]
    created_at: Option<FlexibleTimestamp>,
    #[serde(default)]
    timestamp: Option<FlexibleTimestamp>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
    #[serde(default)]
    cache_read_tokens: Option<u64>,
    #[serde(default)]
    cache_creation_input_tokens: Option<u64>,
    #[serde(default)]
    total_tokens: Option<u64>,
    #[serde(default)]
    usage: Option<UsageFields>,
}

/// 跨平台解析用户主目录（兼容 macOS `HOME` 与 Windows `USERPROFILE` / `HOMEDRIVE`+`HOMEPATH`）
pub fn resolve_home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let trimmed = profile.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    if let (Ok(drive), Ok(path)) = (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH")) {
        let combined = format!("{}{}", drive.trim(), path.trim());
        if !combined.is_empty() {
            return Some(PathBuf::from(combined));
        }
    }
    None
}

/// 获取本机实时 Token 快照（强制刷新并更新 20 秒快照缓存，兼容原有外部调用与单测）
pub fn get_live_token_snapshot() -> TokenSnapshot {
    get_live_token_snapshot_cached(true)
}

/// 获取本机实时 Token 快照（`force = false` 时 20 秒内直接 `O(1)` 返回当日缓存快照）
pub fn get_live_token_snapshot_cached(force: bool) -> TokenSnapshot {
    let now = Local::now();
    let today = now.date_naive();
    let updated_at = now_epoch_millis();

    let Some(home) = resolve_home_dir() else {
        return TokenSnapshot {
            date: today.format("%Y-%m-%d").to_string(),
            total_tokens: 0,
            by_provider: BTreeMap::new(),
            updated_at,
            is_live_local: true,
        };
    };

    let cache_mutex = GLOBAL_SCANNER_CACHE.get_or_init(|| Mutex::new(ScannerCache::default()));
    let mut cache = match cache_mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    get_snapshot_from_cache(&home, today, &mut cache, force, updated_at, Instant::now())
}

fn get_snapshot_from_cache(
    home: &Path,
    today: NaiveDate,
    cache: &mut ScannerCache,
    force: bool,
    updated_at: u64,
    now_instant: Instant,
) -> TokenSnapshot {
    if cache.date != Some(today) {
        cache.date = Some(today);
        cache.files.clear();
        cache.last_snapshot = None;
    }

    if !force {
        let today_str = today.format("%Y-%m-%d").to_string();
        if let Some((captured_at, ref cached_snap)) = cache.last_snapshot {
            if cached_snap.date == today_str
                && now_instant.saturating_duration_since(captured_at) < SNAPSHOT_CACHE_TTL
            {
                return cached_snap.clone();
            }
        }
    }

    let snap = scan_home_with_cache(home, today, cache, updated_at);
    cache.last_snapshot = Some((now_instant, snap.clone()));
    snap
}

fn scan_home_with_cache(
    home: &Path,
    today: NaiveDate,
    cache: &mut ScannerCache,
    updated_at: u64,
) -> TokenSnapshot {
    if cache.date != Some(today) {
        cache.date = Some(today);
        cache.files.clear();
        cache.last_snapshot = None;
    }

    let today_start = local_midnight_system_time(today);
    let mut aggregated: BTreeMap<String, u64> = BTreeMap::new();

    // 1. ~/.claude/projects/**/*.jsonl
    let claude_root = home.join(".claude").join("projects");
    let mut claude_files = Vec::new();
    collect_today_files(
        &claude_root,
        today_start,
        0,
        MAX_SCAN_DEPTH,
        &mut |p| p.extension().and_then(|e| e.to_str()) == Some("jsonl"),
        &mut claude_files,
    );
    for (path, mtime_ns, size) in claude_files {
        let file_map = get_or_parse_file(&path, mtime_ns, size, cache, |p| {
            parse_claude_jsonl_file(p, today)
        });
        merge_provider_counts(&mut aggregated, &file_map);
    }

    // 2. ~/.codex/sessions/**/*.jsonl 及 ~/.codex/**/*.jsonl（统一递归去重扫描 ~/.codex）
    let codex_root = home.join(".codex");
    let mut codex_files = Vec::new();
    collect_today_files(
        &codex_root,
        today_start,
        0,
        MAX_SCAN_DEPTH,
        &mut |p| p.extension().and_then(|e| e.to_str()) == Some("jsonl"),
        &mut codex_files,
    );
    for (path, mtime_ns, size) in codex_files {
        let file_map = get_or_parse_file(&path, mtime_ns, size, cache, |p| {
            parse_codex_jsonl_file(p, today)
        });
        merge_provider_counts(&mut aggregated, &file_map);
    }

    // 3. ~/.gemini/antigravity-cli/brain/<conv>/.system_generated/logs/transcript.jsonl
    //    仅单层遍历 brain 一级会话目录并直达固定日志路径，禁止递归遍历海量 .system_generated/steps/*
    let agy_root = home.join(".gemini").join("antigravity-cli").join("brain");
    if let Ok(entries) = fs::read_dir(&agy_root) {
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if !ft.is_dir() && !ft.is_symlink() {
                continue;
            }
            let transcript_path = entry
                .path()
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");
            let Ok(meta) = fs::metadata(&transcript_path) else {
                continue;
            };
            if !meta.is_file() || meta.len() == 0 {
                continue;
            }
            let Ok(modified) = meta.modified() else {
                continue;
            };
            if modified < today_start {
                continue;
            }
            let mtime_ns = modified
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let file_map = get_or_parse_file(&transcript_path, mtime_ns, meta.len(), cache, |p| {
                parse_antigravity_transcript_file(p, today)
            });
            merge_provider_counts(&mut aggregated, &file_map);
        }
    }

    aggregated.retain(|_, &mut v| v > 0);
    let total_tokens: u64 = aggregated.values().copied().sum();

    TokenSnapshot {
        date: today.format("%Y-%m-%d").to_string(),
        total_tokens,
        by_provider: aggregated,
        updated_at,
        is_live_local: true,
    }
}

fn hash_file_identity(path: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    hasher.finish()
}

fn get_or_parse_file<F>(
    path: &Path,
    mtime_ns: u128,
    size: u64,
    cache: &mut ScannerCache,
    parser: F,
) -> BTreeMap<String, u64>
where
    F: FnOnce(&Path) -> BTreeMap<String, u64>,
{
    let key = hash_file_identity(path);
    if let Some(hit) = cache.files.get(&key) {
        if hit.mtime_ns == mtime_ns && hit.size == size {
            return hit.by_provider.clone();
        }
    }

    let parsed = parser(path);
    cache.files.insert(
        key,
        CachedFileUsage {
            mtime_ns,
            size,
            by_provider: parsed.clone(),
        },
    );
    parsed
}

fn should_skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    SKIP_DIR_NAMES
        .iter()
        .any(|&skip| name.eq_ignore_ascii_case(skip))
}

fn collect_today_files<P>(
    dir: &Path,
    today_start: SystemTime,
    depth: usize,
    max_depth: usize,
    predicate: &mut P,
    out: &mut Vec<(PathBuf, u128, u64)>,
) where
    P: FnMut(&Path) -> bool,
{
    let effective_max_depth = max_depth.min(MAX_SCAN_DEPTH);
    if depth > effective_max_depth {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(ft) = entry.file_type() {
            if ft.is_dir() && should_skip_dir(&path) {
                continue;
            }
        }
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            if !should_skip_dir(&path) {
                collect_today_files(
                    &path,
                    today_start,
                    depth + 1,
                    effective_max_depth,
                    predicate,
                    out,
                );
            }
        } else if meta.is_file() && predicate(&path) {
            let Ok(modified) = meta.modified() else {
                continue;
            };
            if modified >= today_start {
                let mtime_ns = modified
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                out.push((path, mtime_ns, meta.len()));
            }
        }
    }
}

fn classify_model(model: Option<&str>, default_provider: &str) -> &'static str {
    let Some(raw) = model else {
        return match default_provider {
            "claude" => "claude",
            "openai" => "openai",
            "deepseek" => "deepseek",
            "gemini" => "gemini",
            "grok" => "grok",
            "antigravity" => "antigravity",
            _ => "other",
        };
    };

    let lower = raw.to_ascii_lowercase();
    if lower.contains("deepseek") {
        "deepseek"
    } else if lower.contains("grok") {
        "grok"
    } else if lower.contains("antigravity") || lower.ends_with("-agy") {
        "antigravity"
    } else if lower.contains("gemini") {
        "gemini"
    } else if lower.contains("claude") || lower.contains("sonnet") || lower.contains("opus") || lower.contains("haiku") {
        "claude"
    } else if lower.contains("gpt")
        || lower.contains("openai")
        || lower.contains("codex")
        || lower.starts_with("o1")
        || lower.starts_with("o3")
        || lower.starts_with("o4")
    {
        "openai"
    } else {
        match default_provider {
            "claude" => "claude",
            "openai" => "openai",
            "deepseek" => "deepseek",
            "gemini" => "gemini",
            "grok" => "grok",
            "antigravity" => "antigravity",
            _ => "other",
        }
    }
}

fn parse_timestamp_local_date(ts: &FlexibleTimestamp) -> Option<NaiveDate> {
    match ts {
        FlexibleTimestamp::Text(s) => {
            let trimmed = s.trim();
            if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
                return Some(dt.with_timezone(&Local).date_naive());
            }
            if let Some(prefix) = trimmed.get(..10) {
                if let Ok(d) = NaiveDate::parse_from_str(prefix, "%Y-%m-%d") {
                    return Some(d);
                }
            }
            None
        }
        FlexibleTimestamp::Epoch(val) => {
            let secs = if *val > 10_000_000_000 {
                *val / 1000
            } else {
                *val
            };
            Local
                .timestamp_opt(secs, 0)
                .single()
                .map(|dt| dt.date_naive())
        }
    }
}

fn is_line_on_date(ts: Option<&FlexibleTimestamp>, today: NaiveDate) -> bool {
    match ts {
        Some(t) => parse_timestamp_local_date(t) == Some(today),
        None => true,
    }
}

/// 解析 `~/.claude/projects/**/*.jsonl`
/// 按 `message.id`（或 `requestId`）对同一 API 响应的多流式块自动去重，避免重复累加
fn parse_claude_jsonl_file(path: &Path, today: NaiveDate) -> BTreeMap<String, u64> {
    let mut out = BTreeMap::new();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let reader = BufReader::new(file);

    // msg_key -> (provider, max_tokens_for_msg)
    let mut dedup_messages: HashMap<String, (&'static str, u64)> = HashMap::new();
    let mut unkeyed_totals: BTreeMap<&'static str, u64> = BTreeMap::new();

    for line_res in reader.lines() {
        let Ok(line) = line_res else {
            continue;
        };
        if !line.contains("usage") {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<MinimalClaudeLine>(&line) else {
            continue;
        };
        if !is_line_on_date(parsed.timestamp.as_ref(), today) {
            continue;
        }
        let Some(msg) = parsed.message else {
            continue;
        };
        let Some(usage) = msg.usage else {
            continue;
        };
        let tokens = usage.sum_claude_style();
        if tokens == 0 {
            continue;
        }

        let provider = classify_model(msg.model.as_deref(), "claude");
        if let Some(key) = msg.id.or(parsed.request_id) {
            let entry = dedup_messages.entry(key).or_insert((provider, 0));
            if tokens > entry.1 {
                entry.0 = provider;
                entry.1 = tokens;
            }
        } else {
            *unkeyed_totals.entry(provider).or_insert(0) += tokens;
        }
    }

    for (_, (provider, tokens)) in dedup_messages {
        *out.entry(provider.to_string()).or_insert(0) += tokens;
    }
    for (provider, tokens) in unkeyed_totals {
        *out.entry(provider.to_string()).or_insert(0) += tokens;
    }
    out
}

/// 解析 `~/.codex/**/*.jsonl`
/// 智能兼容累计 `total_token_usage`、`token_usage_record` 与单步 `last_token_usage`，严防翻倍累加
fn parse_codex_jsonl_file(path: &Path, today: NaiveDate) -> BTreeMap<String, u64> {
    let mut out = BTreeMap::new();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let reader = BufReader::new(file);

    let mut active_provider: &'static str = "openai";
    let mut max_cum_before_today: u64 = 0;
    let mut max_cum_today: u64 = 0;
    let mut sum_usage_records_today: u64 = 0;
    let mut sum_last_usage_today: u64 = 0;
    let mut sum_direct_steps_today: u64 = 0;

    for line_res in reader.lines() {
        let Ok(line) = line_res else {
            continue;
        };
        if !line.contains("token") && !line.contains("usage") && !line.contains("model") {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<MinimalCodexLine>(&line) else {
            continue;
        };

        if let Some(ref m) = parsed.model {
            active_provider = classify_model(Some(m.as_str()), "openai");
        }
        if let Some(ref payload) = parsed.payload {
            if let Some(ref m) = payload.model {
                active_provider = classify_model(Some(m.as_str()), "openai");
            }
        }

        let line_date = parsed
            .timestamp
            .as_ref()
            .and_then(parse_timestamp_local_date);
        let is_today = match line_date {
            Some(d) => d == today,
            None => true,
        };
        let is_before_today = matches!(line_date, Some(d) if d < today);

        if let Some(payload) = parsed.payload {
            let mut handled_info = false;
            if let Some(info) = payload.info {
                if let Some(cum) = info.total_token_usage {
                    let cum_val = cum.sum_codex_style();
                    if cum_val > 0 {
                        handled_info = true;
                        if is_before_today {
                            max_cum_before_today = max_cum_before_today.max(cum_val);
                        } else if is_today {
                            max_cum_today = max_cum_today.max(cum_val);
                        }
                    }
                }
                if is_today {
                    if let Some(last) = info.last_token_usage {
                        let last_val = last.sum_codex_style();
                        if last_val > 0 {
                            handled_info = true;
                            sum_last_usage_today = sum_last_usage_today.saturating_add(last_val);
                        }
                    }
                }
            }

            if !handled_info && is_today {
                if let Some(u) = payload.usage {
                    let val = u.sum_codex_style();
                    if val > 0 {
                        if parsed.record_type.as_deref() == Some("token_usage_record")
                            || payload.payload_type.as_deref() == Some("token_usage_record")
                        {
                            sum_usage_records_today = sum_usage_records_today.saturating_add(val);
                        } else {
                            sum_direct_steps_today = sum_direct_steps_today.saturating_add(val);
                        }
                        continue;
                    }
                }
            }
            if handled_info {
                continue;
            }
        }

        if is_today {
            if let Some(u) = parsed.usage {
                let val = u.sum_codex_style();
                if val > 0 {
                    sum_direct_steps_today = sum_direct_steps_today.saturating_add(val);
                    continue;
                }
            }
            let top_val = if let Some(total) = parsed.total_tokens {
                total
            } else {
                parsed
                    .input_tokens
                    .unwrap_or(0)
                    .saturating_add(parsed.output_tokens.unwrap_or(0))
            };
            if top_val > 0 {
                sum_direct_steps_today = sum_direct_steps_today.saturating_add(top_val);
            }
        }
    }

    let final_tokens = if max_cum_today > 0 {
        max_cum_today.saturating_sub(max_cum_before_today)
    } else if sum_usage_records_today > 0 {
        sum_usage_records_today
    } else if sum_last_usage_today > 0 {
        sum_last_usage_today
    } else {
        sum_direct_steps_today
    };

    if final_tokens > 0 {
        out.insert(active_provider.to_string(), final_tokens);
    }
    out
}

/// 解析 `~/.gemini/antigravity-cli/brain/**/.system_generated/logs/transcript.jsonl`
/// 有精确 token 字段时精确读取；尚未落盘 token 字段的新增 step（或无 token 字段版本）按字节数 `/ 4` 温和估算归入 `antigravity`
fn parse_antigravity_transcript_file(path: &Path, today: NaiveDate) -> BTreeMap<String, u64> {
    let mut out = BTreeMap::new();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let reader = BufReader::new(file);

    let mut exact_tokens_today: u64 = 0;
    let mut trailing_unmetered_bytes: u64 = 0;

    for line_res in reader.lines() {
        let Ok(line) = line_res else {
            continue;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<MinimalAgyLine>(trimmed) else {
            continue;
        };

        let ts_ref = parsed.created_at.as_ref().or(parsed.timestamp.as_ref());
        if !is_line_on_date(ts_ref, today) {
            continue;
        }

        let _ = parsed.model; // 保留模型字段兼容但统一归入 antigravity

        let direct_sum = parsed
            .input_tokens
            .unwrap_or(0)
            .saturating_add(parsed.output_tokens.unwrap_or(0))
            .saturating_add(parsed.cache_read_tokens.unwrap_or(0))
            .saturating_add(parsed.cache_creation_input_tokens.unwrap_or(0));

        let step_exact = if direct_sum > 0 {
            direct_sum
        } else if let Some(total) = parsed.total_tokens.filter(|&v| v > 0) {
            total
        } else if let Some(u) = parsed.usage {
            u.sum_claude_style()
        } else {
            0
        };

        if step_exact > 0 {
            exact_tokens_today = exact_tokens_today.saturating_add(step_exact);
            trailing_unmetered_bytes = 0;
        } else {
            trailing_unmetered_bytes = trailing_unmetered_bytes.saturating_add(trimmed.len() as u64);
        }
    }

    let estimated_tail = trailing_unmetered_bytes / 4;
    let total = exact_tokens_today.saturating_add(estimated_tail);
    if total > 0 {
        out.insert("antigravity".to_string(), total);
    }
    out
}

fn merge_provider_counts(target: &mut BTreeMap<String, u64>, delta: &BTreeMap<String, u64>) {
    for (k, &v) in delta {
        if v > 0 {
            let entry = target.entry(k.clone()).or_insert(0);
            *entry = entry.saturating_add(v);
        }
    }
}

fn local_midnight_system_time(today: NaiveDate) -> SystemTime {
    let naive_midnight = today
        .and_hms_opt(0, 0, 0)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap());

    if let Some(local_dt) = Local.from_local_datetime(&naive_midnight).earliest() {
        let secs = local_dt.timestamp();
        if secs >= 0 {
            return UNIX_EPOCH + Duration::from_secs(secs as u64);
        }
    }
    UNIX_EPOCH
}

fn now_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ============================================================================
// 实时增量 Token 速率追踪器（独立于上方 20s 全量快照缓存）
//
// 隐私：活跃文件路径仅保存在进程内存，绝不返回前端、绝不落盘；
//       每行只反序列化 token 计数字段，正文一律 IgnoredAny 跳过。
// ============================================================================

/// 速率滑动窗口（秒）
pub const RATE_WINDOW_SECS: u64 = 12;
const RATE_WINDOW: Duration = Duration::from_secs(RATE_WINDOW_SECS);
/// 仅追踪最近 5 分钟内有写入的会话文件
const RATE_ACTIVE_WINDOW: Duration = Duration::from_secs(300);
/// 活跃文件列表刷新间隔
const RATE_REFRESH_INTERVAL: Duration = Duration::from_secs(10);
/// 每 N 轮刷新做一次 ~/.codex 全量递归（其余轮次只扫 ~/.codex/sessions）
const RATE_CODEX_FULL_EVERY: u32 = 6;
const RATE_MAX_TRACKED_FILES: usize = 2048;
const RATE_MAX_CLAUDE_IDS: usize = 4096;
/// 单文件单次最多读取的新字节，超出部分留到下次
const RATE_MAX_READ_PER_CALL: u64 = 8 * 1024 * 1024;

/// 返回前端的实时速率（camelCase）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenRate {
    pub tokens_per_sec: f64,
    pub fresh_tokens_per_sec: f64,
    pub window_sec: u64,
    pub today_tokens: u64,
    pub updated_at: u64,
    pub is_live: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RateSource {
    Claude,
    Codex,
    Antigravity,
}

#[derive(Debug)]
struct RateFileState {
    source: RateSource,
    offset: u64,
    active: bool,
    last_mtime: SystemTime,
    /// Codex 会话累计 (total, cached_input) 上次读数，用于差分
    codex_last_cum: Option<(u64, u64)>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct DeltaTokens {
    total: u64,
    cache_read: u64,
}

impl DeltaTokens {
    fn add(&mut self, other: DeltaTokens) {
        self.total = self.total.saturating_add(other.total);
        self.cache_read = self.cache_read.saturating_add(other.cache_read);
    }
}

#[derive(Debug, Clone)]
struct TodayBase {
    date: String,
    captured_at: Instant,
    snapshot_total: u64,
    cum_at_capture: u64,
}

#[derive(Debug, Default)]
pub struct RateTracker {
    files: HashMap<PathBuf, RateFileState>,
    claude_ids: HashMap<String, (u64, u64)>,
    claude_id_order: VecDeque<String>,
    /// (时间, 全部新增, 其中 cache_read)
    events: VecDeque<(Instant, u64, u64)>,
    last_refresh: Option<Instant>,
    last_refresh_wall: Option<SystemTime>,
    cumulative_total: u64,
    today_base: Option<TodayBase>,
    refresh_count: u32,
    refresh_in_flight: bool,
}

static GLOBAL_RATE_TRACKER: OnceLock<Mutex<RateTracker>> = OnceLock::new();

impl RateTracker {
    /// 同步刷新（单测用）：收集 + 应用
    #[cfg(test)]
    fn refresh_active(&mut self, home: &Path, wall_now: SystemTime) {
        let full = self.refresh_count % RATE_CODEX_FULL_EVERY == 0;
        let batch = collect_rate_candidates(home, wall_now, full);
        self.apply_candidates(batch);
    }

    fn refresh_due(&self, now: Instant) -> bool {
        match self.last_refresh {
            None => true,
            Some(t) => now.saturating_duration_since(t) >= RATE_REFRESH_INTERVAL,
        }
    }

    /// 应用一次目录收集结果：标记活跃、为新文件确定起始 offset、裁剪上限
    fn apply_candidates(&mut self, batch: RateCandidates) {
        let RateCandidates {
            items: candidates,
            wall_now,
            codex_full,
            codex_sessions_root,
        } = batch;
        self.refresh_count = self.refresh_count.wrapping_add(1);

        let initial = self.last_refresh_wall.is_none();
        let prev_refresh_wall = self.last_refresh_wall;
        for (path, st) in self.files.iter_mut() {
            // 轻量轮次只扫了 ~/.codex/sessions：其余 Codex 文件维持原状态，等下次全量轮次再判定
            if st.source == RateSource::Codex && !codex_full && !path.starts_with(&codex_sessions_root) {
                continue;
            }
            st.active = false;
        }
        for (path, source, mtime, size) in candidates {
            if let Some(st) = self.files.get_mut(&path) {
                st.active = true;
                st.last_mtime = mtime;
                continue;
            }
            // 首次刷新：历史内容不计入速率，从文件末尾开始；
            // 之后新出现的文件：若创建于上次刷新之后则整份都是新内容，从 0 开始读。
            let offset = if initial {
                size
            } else {
                let created_recently = match (fs::metadata(&path).and_then(|m| m.created()), prev_refresh_wall) {
                    (Ok(created), Some(prev)) => {
                        created >= prev.checked_sub(Duration::from_secs(2)).unwrap_or(UNIX_EPOCH)
                    }
                    _ => false,
                };
                if created_recently {
                    0
                } else {
                    size
                }
            };
            self.files.insert(
                path,
                RateFileState {
                    source,
                    offset,
                    active: true,
                    last_mtime: mtime,
                    codex_last_cum: None,
                },
            );
        }

        if self.files.len() > RATE_MAX_TRACKED_FILES {
            let mut inactive: Vec<(PathBuf, SystemTime)> = self
                .files
                .iter()
                .filter(|(_, s)| !s.active)
                .map(|(p, s)| (p.clone(), s.last_mtime))
                .collect();
            inactive.sort_by_key(|(_, t)| *t);
            let excess = self.files.len() - RATE_MAX_TRACKED_FILES;
            for (p, _) in inactive.into_iter().take(excess) {
                self.files.remove(&p);
            }
        }

        self.last_refresh_wall = Some(wall_now);
    }

    /// 读取所有活跃文件 offset 之后新增的完整行
    fn read_new(&mut self) -> DeltaTokens {
        let mut delta = DeltaTokens::default();
        let claude_ids = &mut self.claude_ids;
        let claude_order = &mut self.claude_id_order;
        for (path, st) in self.files.iter_mut() {
            if !st.active {
                continue;
            }
            let Ok(meta) = fs::metadata(path) else { continue };
            let size = meta.len();
            if size == st.offset {
                continue;
            }
            if size < st.offset {
                // 文件被截断/重写：跳到末尾，不回溯历史
                st.offset = size;
                st.codex_last_cum = None;
                continue;
            }
            let Ok(mut file) = File::open(path) else { continue };
            if file.seek(SeekFrom::Start(st.offset)).is_err() {
                continue;
            }
            let to_read = (size - st.offset).min(RATE_MAX_READ_PER_CALL);
            let mut buf = Vec::with_capacity(to_read as usize);
            if (&mut file).take(to_read).read_to_end(&mut buf).is_err() {
                continue;
            }
            let Some(last_nl) = buf.iter().rposition(|&b| b == b'\n') else {
                if to_read == RATE_MAX_READ_PER_CALL {
                    // 超长单行：放弃该行剩余部分以免永远卡住
                    st.offset += to_read;
                }
                continue; // 半行留到下次
            };
            let complete = &buf[..=last_nl];
            st.offset += complete.len() as u64;
            for raw_line in complete.split(|&b| b == b'\n') {
                if raw_line.is_empty() {
                    continue;
                }
                let Ok(line) = std::str::from_utf8(raw_line) else { continue };
                let d = match st.source {
                    RateSource::Claude => claude_line_delta(line, claude_ids, claude_order),
                    RateSource::Codex => codex_line_delta(line, &mut st.codex_last_cum),
                    RateSource::Antigravity => agy_line_delta(line),
                };
                delta.add(d);
            }
        }
        delta
    }

    /// 采样一次：必要时刷新活跃列表 → 读增量 → 记入环形队列 → 返回 (全部/秒, 不含 cache_read/秒)
    #[cfg(test)]
    fn sample(&mut self, home: &Path, now: Instant, wall_now: SystemTime) -> (f64, f64) {
        if self.refresh_due(now) {
            self.refresh_active(home, wall_now);
            self.last_refresh = Some(now);
        }
        self.sample_no_refresh(now)
    }

    /// 只读增量（不扫目录），主路径用；目录刷新由后台线程完成
    fn sample_no_refresh(&mut self, now: Instant) -> (f64, f64) {
        let delta = self.read_new();
        if delta.total > 0 {
            self.cumulative_total = self.cumulative_total.saturating_add(delta.total);
            self.events.push_back((now, delta.total, delta.cache_read.min(delta.total)));
        }
        self.rate_at(now)
    }

    fn rate_at(&mut self, now: Instant) -> (f64, f64) {
        while let Some(&(t, _, _)) = self.events.front() {
            if now.saturating_duration_since(t) >= RATE_WINDOW {
                self.events.pop_front();
            } else {
                break;
            }
        }
        let (mut total, mut cache) = (0u64, 0u64);
        for &(_, t, c) in &self.events {
            total = total.saturating_add(t);
            cache = cache.saturating_add(c);
        }
        let secs = RATE_WINDOW_SECS as f64;
        (total as f64 / secs, total.saturating_sub(cache) as f64 / secs)
    }
}

struct RateCandidates {
    items: Vec<(PathBuf, RateSource, SystemTime, u64)>,
    wall_now: SystemTime,
    codex_full: bool,
    codex_sessions_root: PathBuf,
}

/// 用现有三处目录规则收集「最近 5 分钟有写入」的会话文件（不持锁，可在后台线程执行）。
/// ~/.codex 全量递归较重（本机约 0.4s），仅每 RATE_CODEX_FULL_EVERY 轮做一次；其余轮次只扫 ~/.codex/sessions。
fn collect_rate_candidates(home: &Path, wall_now: SystemTime, codex_full: bool) -> RateCandidates {
    let cutoff = wall_now
        .checked_sub(RATE_ACTIVE_WINDOW)
        .unwrap_or(UNIX_EPOCH);
    let mut candidates: Vec<(PathBuf, RateSource, SystemTime, u64)> = Vec::new();
    let codex_root = home.join(".codex");
    let codex_sessions_root = codex_root.join("sessions");

    let is_jsonl = |p: &Path| p.extension().and_then(|e| e.to_str()) == Some("jsonl");
    for (root, source, depth) in [
        (home.join(".claude").join("projects"), RateSource::Claude, 0usize),
        if codex_full {
            (codex_root.clone(), RateSource::Codex, 0usize)
        } else {
            (codex_sessions_root.clone(), RateSource::Codex, 1usize)
        },
    ] {
        let mut found = Vec::new();
        collect_today_files(&root, cutoff, depth, MAX_SCAN_DEPTH, &mut |p| is_jsonl(p), &mut found);
        for (path, mtime_ns, size) in found {
            let mtime = UNIX_EPOCH + Duration::from_nanos(mtime_ns.min(u64::MAX as u128) as u64);
            candidates.push((path, source, mtime, size));
        }
    }

        let agy_root = home.join(".gemini").join("antigravity-cli").join("brain");
        if let Ok(entries) = fs::read_dir(&agy_root) {
            for entry in entries.flatten() {
                let Ok(ft) = entry.file_type() else { continue };
                if !ft.is_dir() && !ft.is_symlink() {
                    continue;
                }
                let p = entry
                    .path()
                    .join(".system_generated")
                    .join("logs")
                    .join("transcript.jsonl");
                let Ok(meta) = fs::metadata(&p) else { continue };
                if !meta.is_file() {
                    continue;
                }
                let Ok(modified) = meta.modified() else { continue };
                if modified >= cutoff {
                    candidates.push((p, RateSource::Antigravity, modified, meta.len()));
                }
            }
        }

    RateCandidates {
        items: candidates,
        wall_now,
        codex_full,
        codex_sessions_root,
    }
}

fn remember_claude_id(
    key: String,
    tokens: (u64, u64),
    ids: &mut HashMap<String, (u64, u64)>,
    order: &mut VecDeque<String>,
) -> DeltaTokens {
    if let Some(prev) = ids.get_mut(&key) {
        let d = DeltaTokens {
            total: tokens.0.saturating_sub(prev.0),
            cache_read: tokens.1.saturating_sub(prev.1),
        };
        prev.0 = prev.0.max(tokens.0);
        prev.1 = prev.1.max(tokens.1);
        return d;
    }
    ids.insert(key.clone(), tokens);
    order.push_back(key);
    while order.len() > RATE_MAX_CLAUDE_IDS {
        if let Some(old) = order.pop_front() {
            ids.remove(&old);
        }
    }
    DeltaTokens {
        total: tokens.0,
        cache_read: tokens.1,
    }
}

/// Claude：按 message.id（或 requestId）去重，同一 id 只计增长部分
fn claude_line_delta(
    line: &str,
    ids: &mut HashMap<String, (u64, u64)>,
    order: &mut VecDeque<String>,
) -> DeltaTokens {
    if !line.contains("usage") {
        return DeltaTokens::default();
    }
    let Ok(parsed) = serde_json::from_str::<MinimalClaudeLine>(line) else {
        return DeltaTokens::default();
    };
    let Some(msg) = parsed.message else {
        return DeltaTokens::default();
    };
    let Some(usage) = msg.usage else {
        return DeltaTokens::default();
    };
    let total = usage.sum_claude_style();
    if total == 0 {
        return DeltaTokens::default();
    }
    let cache = usage
        .cache_read_input_tokens
        .saturating_add(usage.cache_read_tokens)
        .min(total);
    match msg.id.or(parsed.request_id) {
        Some(key) => remember_claude_id(key, (total, cache), ids, order),
        None => DeltaTokens {
            total,
            cache_read: cache,
        },
    }
}

fn codex_usage_delta(u: &UsageFields) -> DeltaTokens {
    let total = u.sum_codex_style();
    DeltaTokens {
        total,
        cache_read: u.cached_input_tokens.min(total),
    }
}

/// Codex：优先用会话累计 total_token_usage 做差分，首次/重置时退回 last_token_usage
fn codex_line_delta(line: &str, last_cum: &mut Option<(u64, u64)>) -> DeltaTokens {
    if !line.contains("token") && !line.contains("usage") {
        return DeltaTokens::default();
    }
    let Ok(parsed) = serde_json::from_str::<MinimalCodexLine>(line) else {
        return DeltaTokens::default();
    };
    if let Some(payload) = parsed.payload {
        if let Some(info) = payload.info {
            let last = info.last_token_usage.as_ref().map(codex_usage_delta);
            if let Some(cum) = info.total_token_usage {
                let cum_total = cum.sum_codex_style();
                if cum_total > 0 {
                    let cum_pair = (cum_total, cum.cached_input_tokens);
                    let d = match *last_cum {
                        Some(prev) if cum_total >= prev.0 => DeltaTokens {
                            total: cum_total - prev.0,
                            cache_read: cum_pair.1.saturating_sub(prev.1).min(cum_total - prev.0),
                        },
                        _ => last.unwrap_or_default(),
                    };
                    *last_cum = Some(cum_pair);
                    return d;
                }
            }
            if let Some(d) = last {
                if d.total > 0 {
                    return d;
                }
            }
        }
        if let Some(u) = payload.usage {
            let d = codex_usage_delta(&u);
            if d.total > 0 {
                return d;
            }
        }
    }
    if let Some(u) = parsed.usage {
        let d = codex_usage_delta(&u);
        if d.total > 0 {
            return d;
        }
    }
    let top = parsed.total_tokens.unwrap_or_else(|| {
        parsed
            .input_tokens
            .unwrap_or(0)
            .saturating_add(parsed.output_tokens.unwrap_or(0))
    });
    DeltaTokens {
        total: top,
        cache_read: 0,
    }
}

/// Antigravity：只计精确 token 字段（速率不做字节估算）
fn agy_line_delta(line: &str) -> DeltaTokens {
    if !line.contains("tokens") {
        return DeltaTokens::default();
    }
    let Ok(parsed) = serde_json::from_str::<MinimalAgyLine>(line.trim()) else {
        return DeltaTokens::default();
    };
    let cache_direct = parsed.cache_read_tokens.unwrap_or(0);
    let direct_sum = parsed
        .input_tokens
        .unwrap_or(0)
        .saturating_add(parsed.output_tokens.unwrap_or(0))
        .saturating_add(cache_direct)
        .saturating_add(parsed.cache_creation_input_tokens.unwrap_or(0));
    if direct_sum > 0 {
        return DeltaTokens {
            total: direct_sum,
            cache_read: cache_direct.min(direct_sum),
        };
    }
    if let Some(total) = parsed.total_tokens.filter(|&v| v > 0) {
        return DeltaTokens {
            total,
            cache_read: 0,
        };
    }
    if let Some(u) = parsed.usage {
        let total = u.sum_claude_style();
        return DeltaTokens {
            total,
            cache_read: u
                .cache_read_input_tokens
                .saturating_add(u.cache_read_tokens)
                .min(total),
        };
    }
    DeltaTokens::default()
}

/// 非阻塞窥视 20s 快照缓存（被占用或尚无快照时返回 None）
fn peek_cached_snapshot() -> Option<(Instant, u64, String)> {
    let m = GLOBAL_SCANNER_CACHE.get()?;
    let guard = m.try_lock().ok()?;
    guard
        .last_snapshot
        .as_ref()
        .map(|(t, s)| (*t, s.total_tokens, s.date.clone()))
}

/// 获取实时 Token 速率（无新字节时为微秒~1ms 级）
pub fn get_live_token_rate() -> TokenRate {
    let now_local = Local::now();
    let today_str = now_local.date_naive().format("%Y-%m-%d").to_string();
    let updated_at = now_epoch_millis();

    let Some(home) = resolve_home_dir() else {
        return TokenRate {
            tokens_per_sec: 0.0,
            fresh_tokens_per_sec: 0.0,
            window_sec: RATE_WINDOW_SECS,
            today_tokens: 0,
            updated_at,
            is_live: false,
        };
    };

    let tracker_mutex = GLOBAL_RATE_TRACKER.get_or_init(|| Mutex::new(RateTracker::default()));

    // todayTokens 基线：优先窥视已有缓存快照；当天尚无基线时才同步做一次（带缓存）全量扫描
    let mut peek = peek_cached_snapshot().filter(|(_, _, d)| *d == today_str);
    if peek.is_none() {
        let has_base = match tracker_mutex.lock() {
            Ok(g) => g.today_base.as_ref().map(|b| b.date == today_str).unwrap_or(false),
            Err(p) => p.into_inner().today_base.as_ref().map(|b| b.date == today_str).unwrap_or(false),
        };
        if !has_base {
            let snap = get_live_token_snapshot_cached(false);
            peek = peek_cached_snapshot()
                .filter(|(_, _, d)| *d == today_str)
                .or(Some((Instant::now(), snap.total_tokens, snap.date)));
        }
    }

    let mut tracker = match tracker_mutex.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let now = Instant::now();
    if tracker.refresh_due(now) && !tracker.refresh_in_flight {
        // 目录刷新放到后台线程，本次调用只读增量，保证每次返回都在 ~1ms 级
        tracker.refresh_in_flight = true;
        tracker.last_refresh = Some(now);
        let full = tracker.refresh_count % RATE_CODEX_FULL_EVERY == 0;
        let home_bg = home.clone();
        let spawned = std::thread::Builder::new()
            .name("token-rate-refresh".into())
            .spawn(move || {
                let batch = collect_rate_candidates(&home_bg, SystemTime::now(), full);
                if let Some(m) = GLOBAL_RATE_TRACKER.get() {
                    let mut t = match m.lock() {
                        Ok(g) => g,
                        Err(p) => p.into_inner(),
                    };
                    t.apply_candidates(batch);
                    t.refresh_in_flight = false;
                }
            });
        if spawned.is_err() {
            tracker.refresh_in_flight = false;
        }
    }
    let (tps, fresh) = tracker.sample_no_refresh(now);

    if let Some((captured_at, total, date)) = peek {
        let stale = match tracker.today_base {
            Some(ref b) => b.date != date || b.captured_at != captured_at,
            None => true,
        };
        if stale {
            tracker.today_base = Some(TodayBase {
                date,
                captured_at,
                snapshot_total: total,
                cum_at_capture: tracker.cumulative_total,
            });
        }
    }
    let today_tokens = match tracker.today_base {
        Some(ref b) if b.date == today_str => b
            .snapshot_total
            .saturating_add(tracker.cumulative_total.saturating_sub(b.cum_at_capture)),
        _ => 0,
    };

    TokenRate {
        tokens_per_sec: tps,
        fresh_tokens_per_sec: fresh,
        window_sec: RATE_WINDOW_SECS,
        today_tokens,
        updated_at,
        is_live: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_synthetic_privacy_safe_multi_provider_scan_and_cache() {
        let now = Local::now();
        let today = now.date_naive();
        let today_rfc3339 = now.to_rfc3339();
        let yesterday_rfc3339 = (now - chrono::Duration::days(1)).to_rfc3339();

        let tmp_root = std::env::temp_dir().join(format!(
            "cyber_pet_token_scanner_test_{}_{}",
            std::process::id(),
            now_epoch_millis()
        ));
        let _ = fs::remove_dir_all(&tmp_root);

        // 1. Claude fixture: 包含多流式块重复 message.id、deepseek 模型路由、以及昨日旧记录过滤
        let claude_dir = tmp_root.join(".claude").join("projects").join("demo");
        fs::create_dir_all(&claude_dir).unwrap();
        let claude_file = claude_dir.join("session1.jsonl");
        let claude_lines = [
            serde_json::json!({
                "timestamp": yesterday_rfc3339,
                "message": {
                    "id": "msg_old",
                    "model": "claude-opus-4-6",
                    "content": "SUPER_SECRET_YESTERDAY_PROMPT",
                    "usage": { "input_tokens": 99999, "output_tokens": 1 }
                }
            }),
            serde_json::json!({
                "timestamp": today_rfc3339,
                "apiBlockIndex": 0,
                "message": {
                    "id": "msg_dup_1",
                    "model": "claude-sonnet-4-6",
                    "content": "PRIVATE_USER_SECRET_KEY_sk-123456",
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_creation_input_tokens": 200,
                        "cache_read_input_tokens": 650
                    }
                }
            }),
            serde_json::json!({
                "timestamp": today_rfc3339,
                "apiBlockIndex": 1,
                "message": {
                    "id": "msg_dup_1",
                    "model": "claude-sonnet-4-6",
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_creation_input_tokens": 200,
                        "cache_read_input_tokens": 650
                    }
                }
            }),
            serde_json::json!({
                "timestamp": today_rfc3339,
                "message": {
                    "id": "msg_ds_1",
                    "model": "deepseek-chat-v3",
                    "usage": { "input_tokens": 300, "output_tokens": 200 }
                }
            }),
        ];
        {
            let mut f = File::create(&claude_file).unwrap();
            for item in &claude_lines {
                writeln!(f, "{}", item).unwrap();
            }
        }

        // 2. Codex fixture: 同时包含 token_usage_record 与 token_count(total_token_usage + last_token_usage)，测试不重复翻倍
        let codex_dir = tmp_root.join(".codex").join("sessions").join("2026");
        fs::create_dir_all(&codex_dir).unwrap();
        let codex_file = codex_dir.join("rollout-1.jsonl");
        let codex_lines = [
            serde_json::json!({
                "timestamp": today_rfc3339,
                "type": "turn_context",
                "payload": { "model": "gpt-5-codex" }
            }),
            serde_json::json!({
                "timestamp": today_rfc3339,
                "type": "token_usage_record",
                "payload": { "usage": { "input_tokens": 1200, "output_tokens": 300, "total_tokens": 1500 } }
            }),
            serde_json::json!({
                "timestamp": today_rfc3339,
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": { "total_tokens": 1500 },
                        "last_token_usage": { "total_tokens": 1500 }
                    }
                }
            }),
            serde_json::json!({
                "timestamp": today_rfc3339,
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": { "total_tokens": 2400 },
                        "last_token_usage": { "total_tokens": 900 }
                    }
                }
            }),
        ];
        {
            let mut f = File::create(&codex_file).unwrap();
            for item in &codex_lines {
                writeln!(f, "{}", item).unwrap();
            }
        }

        // 3. Antigravity fixture A (精确字段) + fixture B (无 token 字段按字节 / 4 估算)
        let agy_dir_a = tmp_root
            .join(".gemini")
            .join("antigravity-cli")
            .join("brain")
            .join("conv-a")
            .join(".system_generated")
            .join("logs");
        fs::create_dir_all(&agy_dir_a).unwrap();
        {
            let mut f = File::create(agy_dir_a.join("transcript.jsonl")).unwrap();
            writeln!(
                f,
                "{}",
                serde_json::json!({
                    "step_index": 1,
                    "type": "PLANNER_RESPONSE",
                    "created_at": today_rfc3339,
                    "input_tokens": 700,
                    "cache_read_tokens": 200,
                    "output_tokens": 100,
                    "content": "DO_NOT_LEAK_ME"
                })
            )
            .unwrap();
        }

        let agy_dir_b = tmp_root
            .join(".gemini")
            .join("antigravity-cli")
            .join("brain")
            .join("conv-b")
            .join(".system_generated")
            .join("logs");
        fs::create_dir_all(&agy_dir_b).unwrap();
        let raw_step_line = serde_json::json!({
            "step_index": 0,
            "type": "USER_INPUT",
            "created_at": today_rfc3339,
            "content": "a".repeat(400)
        })
        .to_string();
        let expected_est = (raw_step_line.len() as u64) / 4;
        {
            let mut f = File::create(agy_dir_b.join("transcript.jsonl")).unwrap();
            writeln!(f, "{}", raw_step_line).unwrap();
        }

        let mut cache = ScannerCache::default();
        let snap1 = scan_home_with_cache(&tmp_root, today, &mut cache, 123456789);

        assert_eq!(snap1.by_provider.get("claude").copied(), Some(1000));
        assert_eq!(snap1.by_provider.get("deepseek").copied(), Some(500));
        assert_eq!(snap1.by_provider.get("openai").copied(), Some(2400));
        assert_eq!(
            snap1.by_provider.get("antigravity").copied(),
            Some(1000 + expected_est)
        );
        assert_eq!(snap1.total_tokens, 1000 + 500 + 2400 + 1000 + expected_est);
        assert!(snap1.is_live_local);
        assert_eq!(cache.files.len(), 4);

        // 验证序列化结果绝不包含任何敏感文本或路径
        let json_out = serde_json::to_string(&snap1).unwrap();
        assert!(!json_out.contains("PRIVATE_USER_SECRET"));
        assert!(!json_out.contains("DO_NOT_LEAK_ME"));
        assert!(!json_out.contains("session1.jsonl"));

        // 二次扫描命中缓存，结果完全一致
        let snap2 = scan_home_with_cache(&tmp_root, today, &mut cache, 123456799);
        assert_eq!(snap2.total_tokens, snap1.total_tokens);

        let _ = fs::remove_dir_all(&tmp_root);
    }

    #[test]
    fn test_real_machine_live_token_snapshot_runs_cleanly() {
        let snap = get_live_token_snapshot();
        assert_eq!(snap.date.len(), 10);
        assert!(snap.is_live_local);
        let sum: u64 = snap.by_provider.values().copied().sum();
        assert_eq!(snap.total_tokens, sum);

        // 当前正在运行 Antigravity，本机今日 Token 必然 >= 0 且序列化严格只有公开计数字段
        let serialized = serde_json::to_value(&snap).unwrap();
        let obj = serialized.as_object().unwrap();
        assert_eq!(obj.len(), 5);
        assert!(obj.contains_key("date"));
        assert!(obj.contains_key("totalTokens"));
        assert!(obj.contains_key("byProvider"));
        assert!(obj.contains_key("updatedAt"));
        assert!(obj.contains_key("isLiveLocal"));

        println!(
            "[token_scanner live check] date={}, totalTokens={}, providers={:?}",
            snap.date, snap.total_tokens, snap.by_provider
        );

        let cached_snap = get_live_token_snapshot_cached(false);
        assert_eq!(cached_snap.date, snap.date);
        assert!(cached_snap.is_live_local);
    }

    #[test]
    fn test_snapshot_20s_cache_direct_agy_and_skip_dirs() {
        let now = Local::now();
        let today = now.date_naive();
        let today_rfc3339 = now.to_rfc3339();

        let tmp_root = std::env::temp_dir().join(format!(
            "cyber_pet_cache_skip_test_{}_{}",
            std::process::id(),
            now_epoch_millis()
        ));
        let _ = fs::remove_dir_all(&tmp_root);

        // 1. Direct agy logs/transcript.jsonl vs ignored steps/* and 0-byte logs/transcript.jsonl
        let agy_logs = tmp_root
            .join(".gemini")
            .join("antigravity-cli")
            .join("brain")
            .join("conv-ok")
            .join(".system_generated")
            .join("logs");
        fs::create_dir_all(&agy_logs).unwrap();
        {
            let mut f = File::create(agy_logs.join("transcript.jsonl")).unwrap();
            writeln!(
                f,
                "{}",
                serde_json::json!({
                    "created_at": today_rfc3339,
                    "input_tokens": 120,
                    "output_tokens": 80
                })
            )
            .unwrap();
        }

        let agy_steps = tmp_root
            .join(".gemini")
            .join("antigravity-cli")
            .join("brain")
            .join("conv-ok")
            .join(".system_generated")
            .join("steps")
            .join("step-1");
        fs::create_dir_all(&agy_steps).unwrap();
        {
            let mut f = File::create(agy_steps.join("transcript.jsonl")).unwrap();
            writeln!(
                f,
                "{}",
                serde_json::json!({
                    "created_at": today_rfc3339,
                    "input_tokens": 99999
                })
            )
            .unwrap();
        }

        let agy_empty_logs = tmp_root
            .join(".gemini")
            .join("antigravity-cli")
            .join("brain")
            .join("conv-empty")
            .join(".system_generated")
            .join("logs");
        fs::create_dir_all(&agy_empty_logs).unwrap();
        File::create(agy_empty_logs.join("transcript.jsonl")).unwrap();

        // 2. Ignored dirs + depth > 6 inside .codex
        for skip_dir in [
            "node_modules",
            ".git",
            "cache",
            "blobs",
            "shell_snapshots",
            "tmp",
            "log",
        ] {
            let dir = tmp_root.join(".codex").join(skip_dir);
            fs::create_dir_all(&dir).unwrap();
            let mut f = File::create(dir.join("ignored.jsonl")).unwrap();
            writeln!(
                f,
                "{}",
                serde_json::json!({
                    "timestamp": today_rfc3339,
                    "total_tokens": 88888
                })
            )
            .unwrap();
        }
        let deep_dir = tmp_root
            .join(".codex")
            .join("d1")
            .join("d2")
            .join("d3")
            .join("d4")
            .join("d5")
            .join("d6")
            .join("d7");
        fs::create_dir_all(&deep_dir).unwrap();
        {
            let mut f = File::create(deep_dir.join("too_deep.jsonl")).unwrap();
            writeln!(
                f,
                "{}",
                serde_json::json!({
                    "timestamp": today_rfc3339,
                    "total_tokens": 77777
                })
            )
            .unwrap();
        }

        let mut cache = ScannerCache::default();
        let t0 = Instant::now();
        let snap1 = get_snapshot_from_cache(&tmp_root, today, &mut cache, false, 1000, t0);
        assert_eq!(snap1.total_tokens, 200);
        assert_eq!(snap1.by_provider.get("antigravity").copied(), Some(200));
        assert_eq!(cache.files.len(), 1);

        // Add a valid claude file after initial scan
        let claude_dir = tmp_root.join(".claude").join("projects").join("p1");
        fs::create_dir_all(&claude_dir).unwrap();
        {
            let mut f = File::create(claude_dir.join("s1.jsonl")).unwrap();
            writeln!(
                f,
                "{}",
                serde_json::json!({
                    "timestamp": today_rfc3339,
                    "message": {
                        "id": "m1",
                        "model": "claude-sonnet-4-6",
                        "usage": { "input_tokens": 300, "output_tokens": 50 }
                    }
                })
            )
            .unwrap();
        }

        // Within 20s and force=false: O(1) cache hit returns snap1 verbatim
        let snap_cached = get_snapshot_from_cache(
            &tmp_root,
            today,
            &mut cache,
            false,
            1010,
            t0 + Duration::from_secs(10),
        );
        assert_eq!(snap_cached.updated_at, 1000);
        assert_eq!(snap_cached.total_tokens, 200);

        // force=true bypasses 20s cache and sees new file
        let snap_forced = get_snapshot_from_cache(
            &tmp_root,
            today,
            &mut cache,
            true,
            1015,
            t0 + Duration::from_secs(12),
        );
        assert_eq!(snap_forced.updated_at, 1015);
        assert_eq!(snap_forced.total_tokens, 550);

        // Date rollover clears last_snapshot and files
        let tomorrow = today.succ_opt().unwrap();
        let snap_next_day = get_snapshot_from_cache(
            &tmp_root,
            tomorrow,
            &mut cache,
            false,
            2000,
            t0 + Duration::from_secs(15),
        );
        assert_eq!(snap_next_day.updated_at, 2000);
        assert_eq!(snap_next_day.total_tokens, 0);

        // After >= 20s TTL expires on today, rescans automatically even with force=false
        let _ = get_snapshot_from_cache(
            &tmp_root,
            today,
            &mut cache,
            false,
            3000,
            t0 + Duration::from_secs(16),
        );
        let snap_expired = get_snapshot_from_cache(
            &tmp_root,
            today,
            &mut cache,
            false,
            4000,
            t0 + Duration::from_secs(37),
        );
        assert_eq!(snap_expired.updated_at, 4000);
        assert_eq!(snap_expired.total_tokens, 550);

        let _ = fs::remove_dir_all(&tmp_root);
    }
}

#[cfg(test)]
mod rate_tests {
    use super::*;
    use std::io::Write;

    fn tmp_home(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "cyber_pet_rate_{}_{}_{}",
            tag,
            std::process::id(),
            now_epoch_millis()
        ));
        let _ = fs::remove_dir_all(&p);
        p
    }

    fn append(path: &Path, s: &str) {
        let mut f = fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
        f.write_all(s.as_bytes()).unwrap();
        f.flush().unwrap();
    }

    fn claude_line(id: &str, input: u64, output: u64, cache_read: u64) -> String {
        format!(
            "{}\n",
            serde_json::json!({
                "timestamp": Local::now().to_rfc3339(),
                "message": {
                    "id": id,
                    "model": "claude-sonnet-4-6",
                    "content": "SECRET_BODY",
                    "usage": {
                        "input_tokens": input,
                        "output_tokens": output,
                        "cache_read_input_tokens": cache_read
                    }
                }
            })
        )
    }

    #[test]
    fn test_rate_incremental_half_line_dedup_and_decay() {
        let home = tmp_home("inc");
        let dir = home.join(".claude").join("projects").join("p");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        // 历史内容：不应计入速率
        append(&file, &claude_line("hist", 50_000, 1, 0));

        let mut tr = RateTracker::default();
        let t0 = Instant::now();
        let (r, f) = tr.sample(&home, t0, SystemTime::now());
        assert_eq!((r, f), (0.0, 0.0));
        assert_eq!(tr.files.len(), 1);

        // 1. 增量：1000 total，其中 cache_read 850
        append(&file, &claude_line("m1", 100, 50, 850));
        let (r, f) = tr.sample(&home, t0 + Duration::from_secs(1), SystemTime::now());
        assert!((r - 1000.0 / 12.0).abs() < 1e-9, "r={r}");
        assert!((f - 150.0 / 12.0).abs() < 1e-9, "f={f}");

        // 2. 去重：同一 message.id 重复流式块不重复计
        append(&file, &claude_line("m1", 100, 50, 850));
        let (r, _) = tr.sample(&home, t0 + Duration::from_secs(2), SystemTime::now());
        assert!((r - 1000.0 / 12.0).abs() < 1e-9);
        // 同 id 增长只计差值
        append(&file, &claude_line("m1", 100, 250, 850));
        let (r, f) = tr.sample(&home, t0 + Duration::from_secs(2), SystemTime::now());
        assert!((r - 1200.0 / 12.0).abs() < 1e-9);
        assert!((f - 350.0 / 12.0).abs() < 1e-9);

        // 3. 半行：先写前半，不计；补齐后计入
        let line = claude_line("m2", 300, 0, 0);
        let (a, b) = line.split_at(line.len() / 2);
        append(&file, a);
        let (r, _) = tr.sample(&home, t0 + Duration::from_secs(3), SystemTime::now());
        assert!((r - 1200.0 / 12.0).abs() < 1e-9);
        append(&file, b);
        let (r, _) = tr.sample(&home, t0 + Duration::from_secs(4), SystemTime::now());
        assert!((r - 1500.0 / 12.0).abs() < 1e-9);
        assert_eq!(tr.cumulative_total, 1500);

        // 4. 窗口衰减：t=13s 时 1s 的事件已滑出，t=17s 全部滑出
        let (r, _) = tr.sample(&home, t0 + Duration::from_secs(13), SystemTime::now());
        assert!((r - 500.0 / 12.0).abs() < 1e-9, "r={r}");
        let (r, f) = tr.sample(&home, t0 + Duration::from_secs(17), SystemTime::now());
        assert_eq!((r, f), (0.0, 0.0));

        // 5. 刷新后新出现的文件整份计入；Codex 累计差分；Antigravity 精确字段
        let file2 = dir.join("new.jsonl");
        append(&file2, &claude_line("n1", 40, 60, 0));
        let codex_dir = home.join(".codex").join("sessions");
        fs::create_dir_all(&codex_dir).unwrap();
        let cfile = codex_dir.join("r.jsonl");
        let tc = |tot: u64, cached: u64, last: u64, last_cached: u64| {
            format!(
                "{}\n",
                serde_json::json!({"type":"event_msg","payload":{"type":"token_count","info":{
                    "total_token_usage":{"input_tokens":tot,"cached_input_tokens":cached,"total_tokens":tot},
                    "last_token_usage":{"total_tokens":last,"cached_input_tokens":last_cached}}}})
            )
        };
        append(&cfile, &tc(1000, 600, 1000, 600));
        let agy = home
            .join(".gemini/antigravity-cli/brain/c1/.system_generated/logs");
        fs::create_dir_all(&agy).unwrap();
        append(
            &agy.join("transcript.jsonl"),
            &format!(
                "{}\n{}\n",
                serde_json::json!({"type":"USER_INPUT","content":"x".repeat(4000)}),
                serde_json::json!({"type":"PLANNER_RESPONSE","input_tokens":700,"cache_read_tokens":200,"output_tokens":100})
            ),
        );
        let t1 = t0 + Duration::from_secs(30); // 触发刷新
        let (r, f) = tr.sample(&home, t1, SystemTime::now());
        // 100 (claude new) + 1000 (codex last) + 1000 (agy)
        assert!((r - 2100.0 / 12.0).abs() < 1e-9, "r={r}");
        assert!((f - (2100.0 - 600.0 - 200.0) / 12.0).abs() < 1e-9, "f={f}");
        // Codex 后续用累计差分（重复事件不计）
        append(&cfile, &tc(1000, 600, 1000, 600));
        append(&cfile, &tc(1500, 900, 500, 300));
        let (r, _) = tr.sample(&home, t1 + Duration::from_secs(1), SystemTime::now());
        assert!((r - 2600.0 / 12.0).abs() < 1e-9, "r={r}");

        // 6. 隐私：序列化结果不含路径或正文
        let json = serde_json::to_string(&TokenRate {
            tokens_per_sec: r,
            fresh_tokens_per_sec: 0.0,
            window_sec: RATE_WINDOW_SECS,
            today_tokens: 0,
            updated_at: 0,
            is_live: true,
        })
        .unwrap();
        assert!(!json.contains("jsonl") && !json.contains("SECRET"));
        assert!(json.contains("tokensPerSec") && json.contains("freshTokensPerSec") && json.contains("isLive"));

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn test_rate_idle_call_is_fast_and_id_set_bounded() {
        let home = tmp_home("fast");
        let dir = home.join(".claude").join("projects").join("p");
        fs::create_dir_all(&dir).unwrap();
        for i in 0..8 {
            append(&dir.join(format!("s{i}.jsonl")), &claude_line("h", 1, 1, 0));
        }
        let mut tr = RateTracker::default();
        let t0 = Instant::now();
        tr.sample(&home, t0, SystemTime::now());
        let start = Instant::now();
        for i in 0..100 {
            tr.sample(&home, t0 + Duration::from_millis(i), SystemTime::now());
        }
        let per_call = start.elapsed() / 100;
        assert!(per_call < Duration::from_millis(2), "idle sample took {per_call:?}");

        let mut ids = HashMap::new();
        let mut order = VecDeque::new();
        for i in 0..(RATE_MAX_CLAUDE_IDS + 500) {
            remember_claude_id(format!("id{i}"), (1, 0), &mut ids, &mut order);
        }
        assert_eq!(ids.len(), RATE_MAX_CLAUDE_IDS);
        assert_eq!(order.len(), RATE_MAX_CLAUDE_IDS);
        let _ = fs::remove_dir_all(&home);
    }

    /// 真机标定：`cargo test --lib calibrate_real_rate -- --ignored --nocapture`
    /// 环境变量 RATE_CALIB_SECS 可改采样时长（默认 120）
    #[test]
    #[ignore]
    fn calibrate_real_rate() {
        let secs: u64 = std::env::var("RATE_CALIB_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(120);
        let t_first = Instant::now();
        let first = get_live_token_rate();
        println!("first call (incl. baseline) {:?}, today={}", t_first.elapsed(), first.today_tokens);
        let mut all = Vec::new();
        let mut fresh = Vec::new();
        let mut max_call = Duration::ZERO;
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(secs) {
            std::thread::sleep(Duration::from_millis(1500));
            let t = Instant::now();
            let r = get_live_token_rate();
            let dt = t.elapsed();
            max_call = max_call.max(dt);
            all.push(r.tokens_per_sec);
            fresh.push(r.fresh_tokens_per_sec);
            println!(
                "t={:>5.1}s all={:>9.1}/s fresh={:>8.1}/s today={} call={:?}",
                start.elapsed().as_secs_f64(),
                r.tokens_per_sec,
                r.fresh_tokens_per_sec,
                r.today_tokens,
                dt
            );
        }
        let stats = |v: &mut Vec<f64>| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let n = v.len().max(1);
            let pct = |p: f64| v.get(((n as f64 - 1.0) * p).round() as usize).copied().unwrap_or(0.0);
            let mean = v.iter().sum::<f64>() / n as f64;
            (pct(0.1), pct(0.5), pct(0.9), v.last().copied().unwrap_or(0.0), mean)
        };
        let tracker = GLOBAL_RATE_TRACKER.get().unwrap().lock().unwrap();
        let active = tracker.files.values().filter(|s| s.active).count();
        drop(tracker);
        println!("active files={active} max_call={max_call:?}");
        println!("ALL   p10/p50/p90/max/mean = {:?}", stats(&mut all));
        println!("FRESH p10/p50/p90/max/mean = {:?}", stats(&mut fresh));
    }
}
