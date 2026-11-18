// MIT License - 大肥鱼「实时算力转速表 + 摸鱼小女仆」纯逻辑大脑（零 DOM 依赖，可单测）

export type RateTier = 0 | 1 | 2 | 3;

export interface RateTierDef {
  tier: RateTier;
  label: string;
  /** 平滑速率 ≥ enter 时立即升入该档（tok/s） */
  enter: number;
  /** 平滑速率 < exit 持续 TIER_DOWN_HOLD_MS 才降出该档（滞回） */
  exit: number;
  hint: string;
}

/**
 * 速率档位（唯一可调处）。速率取 `freshTokensPerSec`（扣除缓存读取的新鲜 Token），
 * 由 rate-engine 的 12s 窗口算出，再经前端 EMA 平滑。
 *
 * rate-engine 实测标定（本机 release，约 8 agent 并发）：
 * - 空闲严格 0；单 agent fresh 100–2k/s（中位≈400）；多 agent fresh p50≈250–520、p90≈1.1k–4k，偶见 50k 尖峰。
 * - 因此：单 agent 基本在「慢炖」偶尔「全力」，多 agent 常驻「全力」，持续 ≥3k 才「红温」。
 */
export const RATE_TIERS: readonly RateTierDef[] = [
  { tier: 0, label: '摸鱼', enter: 0, exit: 0, hint: '没有 Token 在烧：坐下抱鱼干看漫画' },
  { tier: 1, label: '慢炖', enter: 30, exit: 10, hint: '每秒拍 2 下键盘，飘 +N tok' },
  { tier: 2, label: '全力', enter: 800, exit: 450, hint: '每秒拍 8 下，键盘彩虹光' },
  { tier: 3, label: '红温冒烟', enter: 3000, exit: 1800, hint: '每秒拍 16 下，残影 + 冒烟 + 火星' },
];

export const TIER_DOWN_HOLD_MS = 3500;
export const TIER_DOWN_HOLD_ZERO_MS = 1500;
export const RATE_EMA_ALPHA_UP = 0.5;
export const RATE_EMA_ALPHA_DOWN = 0.22;
/** 单次采样最多把平滑值拉到 max(当前×3, 2000)，削掉 50k 级单跳尖峰 */
export const RATE_SPIKE_FLOOR = 2000;
export const RATE_SPIKE_MULT = 3;
/** 连续 ≥3 次 0 采样（12s 窗口外又空 4.5s）才视为真停工，平滑值直接归零 */
export const RATE_ZERO_STREAK_SNAP = 3;

/** 每烧掉多少 Token 掉一碗饭：todayTokens 含 cache_read；按「忙碌一小时≈2 agent≈12k/s≈43M」攒约 10 碗 */
export const BOWL_TOKENS = 4_000_000;
export const MAX_TOWER_LAYERS = 15;
export const BOWL_DROP_INTERVAL_MS = 6000;
export const MAX_PENDING_BOWLS = 6;
export const BOWL_STORAGE_KEY = 'cyber_pet_bowls_v1';

export const SLACK_AFTER_MS = 8000;
export const OVERHEAT_MS = 1200;
export const TIRED_MS = 3500;
export const TIRED_MIN_HIGH_MS = 10_000;
export const TIRED_WINDOW_MS = 15_000;
export const TIRED_COOLDOWN_MS = 45_000;
export const CATCH_MS = 1600;
export const FAKE_TYPING_MS = 2000;
export const CATCH_COOLDOWN_MS = 15_000;

export const WALK_GAP_MIN_MS = 20_000;
export const WALK_GAP_MAX_MS = 60_000;
export const WALK_MIN_MS = 3000;
export const WALK_MAX_MS = 8000;
export const WALK_SPEED_PX = 40;
export const PEEK_MS = 1500;
export const WALK_ACCEL_MS = 420;
export const WALK_DECEL_MS = 380;
export const WALK_SCURRY_MUL = 1.35;
export const WALK_LOOK_PAUSE_MS = 700;
export const WALK_STORAGE_KEY = 'cyber_pet_walk_enabled_v1';

export interface RateSampleLike {
  tokensPerSec: number;
  freshTokensPerSec?: number;
}

/** 选用驱动档位的速率字段：优先新鲜 Token（不含缓存读取），缺失时回退总速率 */
export function rateOf(sample: RateSampleLike): number {
  const fresh = sample.freshTokensPerSec;
  const raw = typeof fresh === 'number' && Number.isFinite(fresh) ? fresh : sample.tokensPerSec;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function tierForRate(rate: number): RateTier {
  let t: RateTier = 0;
  for (const def of RATE_TIERS) {
    if (def.tier > 0 && rate >= def.enter) t = def.tier;
  }
  return t;
}

/** 非对称 EMA：上升快（削尖峰）、下降稍慢；连续 0 采样才急降，避免 Claude 整块落盘造成的空窗抖动 */
export class RateSmoother {
  value = 0;
  private zeroStreak = 0;

  push(raw: number): number {
    const r = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (r === 0) {
      this.zeroStreak++;
      // 连续空窗 = 12s 窗口外又空了 ≥4.5s：确认停工，直接归零让档位一次落到 T0（骤停瘫倒判定更跟手）
      this.value = this.zeroStreak >= RATE_ZERO_STREAK_SNAP ? 0 : this.value * (1 - RATE_EMA_ALPHA_DOWN);
      if (this.value < 0.5) this.value = 0;
    } else {
      this.zeroStreak = 0;
      const capped = Math.min(r, Math.max(this.value * RATE_SPIKE_MULT, RATE_SPIKE_FLOOR));
      const alpha = capped > this.value ? RATE_EMA_ALPHA_UP : RATE_EMA_ALPHA_DOWN;
      this.value += (capped - this.value) * alpha;
    }
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.zeroStreak = 0;
  }
}

/** 档位滞回：升档立即，降档需低于 exit 持续一段时间 */
export class TierTracker {
  tier: RateTier = 0;
  private belowSince: number | null = null;

  update(rate: number, now: number): { from: RateTier; to: RateTier } | null {
    const target = tierForRate(rate);
    if (target > this.tier) {
      const from = this.tier;
      this.tier = target;
      this.belowSince = null;
      return { from, to: target };
    }
    if (this.tier === 0) return null;
    const exit = RATE_TIERS[this.tier].exit;
    if (rate >= exit) {
      this.belowSince = null;
      return null;
    }
    if (this.belowSince === null) this.belowSince = now;
    const hold = rate <= 0 ? TIER_DOWN_HOLD_ZERO_MS : TIER_DOWN_HOLD_MS;
    if (now - this.belowSince < hold) return null;
    // 降到「仍然满足 exit 的最高档」，至少降一档
    let next: RateTier = 0;
    for (const def of RATE_TIERS) {
      if (def.tier > 0 && def.tier < this.tier && rate >= def.exit) next = def.tier;
    }
    const from = this.tier;
    this.tier = next;
    this.belowSince = next > 0 ? now : null;
    return { from, to: next };
  }
}

export type BrainEvent =
  | { type: 'tier'; from: RateTier; to: RateTier }
  | { type: 'overheat' }
  | { type: 'tired' }
  | { type: 'slack'; on: boolean }
  | { type: 'catch-fake' }
  | { type: 'catch-end' };

export type CatchPhase = 'none' | 'caught' | 'fake';

/** 档位 + 摸鱼 + 抓包 + 红温/瘫倒 判定状态机 */
export class FishBrain {
  readonly smoother = new RateSmoother();
  readonly tracker = new TierTracker();
  smoothed = 0;
  slacking = false;
  catchPhase: CatchPhase = 'none';

  private t0Since: number;
  private highEnteredAt: number | null = null;
  private highLeftAt: number | null = null;
  private highDurationMs = 0;
  /** 最近一次原始速率仍在「全力」以上的时刻（只算真烧，不算衰减尾巴） */
  private lastHighRawAt = 0;
  private lastTiredAt = Number.NEGATIVE_INFINITY;
  private catchPhaseAt = 0;
  private catchCooldownUntil = 0;

  constructor(now: number) {
    this.t0Since = now;
  }

  get tier(): RateTier {
    return this.tracker.tier;
  }

  /** 收到一次速率采样（约 1.5s 一次） */
  pushRate(raw: number, now: number): BrainEvent[] {
    this.smoothed = this.smoother.push(raw);
    const events: BrainEvent[] = [];
    if (this.tracker.tier >= 2 && raw >= RATE_TIERS[2].exit) this.lastHighRawAt = now;
    const change = this.tracker.update(this.smoothed, now);
    if (change) this.applyTierChange(change.from, change.to, now, events);
    this.step(now, events);
    return events;
  }

  /** 时间推进（每帧或每 ~200ms 调用）：摸鱼判定与抓包阶段推进 */
  tick(now: number): BrainEvent[] {
    const events: BrainEvent[] = [];
    this.step(now, events);
    return events;
  }

  /** 摸鱼中被鼠标抓包；返回是否成功触发（冷却中/未摸鱼返回 false） */
  tryCatch(now: number): boolean {
    if (!this.slacking || this.catchPhase !== 'none' || now < this.catchCooldownUntil) return false;
    this.catchPhase = 'caught';
    this.catchPhaseAt = now;
    this.catchCooldownUntil = now + CATCH_COOLDOWN_MS;
    return true;
  }

  private applyTierChange(from: RateTier, to: RateTier, now: number, events: BrainEvent[]): void {
    events.push({ type: 'tier', from, to });
    if (to >= 2 && from < 2) {
      this.highEnteredAt = now;
      this.lastHighRawAt = now;
    } else if (to < 2 && from >= 2) {
      this.highDurationMs =
        this.highEnteredAt !== null ? Math.max(0, this.lastHighRawAt - this.highEnteredAt) : 0;
      this.highEnteredAt = null;
      this.highLeftAt = now;
    }
    if (to === 3 && from < 3) events.push({ type: 'overheat' });

    if (to === 0) {
      this.t0Since = now;
      if (
        this.highLeftAt !== null &&
        this.highDurationMs >= TIRED_MIN_HIGH_MS &&
        now - this.highLeftAt <= TIRED_WINDOW_MS &&
        now - this.lastTiredAt >= TIRED_COOLDOWN_MS
      ) {
        this.lastTiredAt = now;
        this.highLeftAt = null;
        events.push({ type: 'tired' });
      }
    } else {
      if (this.slacking) {
        this.slacking = false;
        events.push({ type: 'slack', on: false });
      }
      if (this.catchPhase !== 'none') {
        this.catchPhase = 'none';
        events.push({ type: 'catch-end' });
      }
    }
  }

  private step(now: number, events: BrainEvent[]): void {
    if (this.tracker.tier === 0 && !this.slacking && now - this.t0Since >= SLACK_AFTER_MS) {
      this.slacking = true;
      events.push({ type: 'slack', on: true });
    }
    if (this.catchPhase === 'caught' && now - this.catchPhaseAt >= CATCH_MS) {
      this.catchPhase = 'fake';
      this.catchPhaseAt = now;
      events.push({ type: 'catch-fake' });
    } else if (this.catchPhase === 'fake' && now - this.catchPhaseAt >= FAKE_TYPING_MS) {
      this.catchPhase = 'none';
      events.push({ type: 'catch-end' });
    }
  }
}

// ==================== 饭碗账本 ====================

export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

interface BowlState {
  date: string;
  seenTokenBowls: number;
  bonus: number;
  tower: number;
}

export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 今日饭碗计数：每 BOWL_TOKENS 掉一碗；首次同步静默垒塔，之后跨阈值排队掉落（≥6s 一碗）。
 * 当日状态持久化，跨天清零。
 */
export class BowlLedger {
  pending = 0;
  private state: BowlState;
  private initialized = false;
  private lastDropAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly store: KVStore | null,
    private readonly today: () => string = () => localDateKey(),
    private readonly bowlTokens: number = BOWL_TOKENS,
  ) {
    this.state = this.load();
  }

  get total(): number {
    this.rollover();
    return this.state.seenTokenBowls + this.state.bonus;
  }

  get tower(): number {
    this.rollover();
    return this.state.tower;
  }

  get towerLayers(): number {
    return Math.min(MAX_TOWER_LAYERS, this.tower);
  }

  syncTokens(todayTokens: number): void {
    if (!Number.isFinite(todayTokens) || todayTokens < 0) return;
    this.rollover();
    const target = Math.floor(todayTokens / this.bowlTokens);
    const diff = target - this.state.seenTokenBowls;
    if (!this.initialized) {
      this.initialized = true;
      if (diff > 0) this.state.tower += diff;
      this.state.seenTokenBowls = target;
      this.save();
      return;
    }
    if (diff > 0) {
      const queued = Math.min(diff, Math.max(0, MAX_PENDING_BOWLS - this.pending));
      this.pending += queued;
      // 一次性暴涨（如扫描器补齐历史）超出队列上限的部分静默垒进碗塔
      if (diff > queued) this.state.tower += diff - queued;
      this.state.seenTokenBowls = target;
      this.save();
    } else if (diff < 0) {
      this.state.seenTokenBowls = target;
      this.save();
    }
  }

  /** 是否该掉下一碗（canDrop=false 时继续排队） */
  takeDrop(now: number, canDrop: boolean): boolean {
    if (this.pending <= 0 || !canDrop) return false;
    if (now - this.lastDropAt < BOWL_DROP_INTERVAL_MS) return false;
    this.pending--;
    this.lastDropAt = now;
    return true;
  }

  /** 手动扔饭被接住：今日碗数 +1 */
  feed(): void {
    this.rollover();
    this.state.bonus++;
    this.save();
  }

  /** 空碗落到脚边碗塔 */
  landBowl(): void {
    this.rollover();
    this.state.tower++;
    this.save();
  }

  /** 碗塔倒塌清空（今日总数不减） */
  collapse(): void {
    this.rollover();
    this.state.tower = 0;
    this.save();
  }

  private rollover(): void {
    const today = this.today();
    if (this.state.date !== today) {
      this.state = { date: today, seenTokenBowls: 0, bonus: 0, tower: 0 };
      this.pending = 0;
      this.initialized = false;
      this.save();
    }
  }

  private load(): BowlState {
    const today = this.today();
    const fresh: BowlState = { date: today, seenTokenBowls: 0, bonus: 0, tower: 0 };
    try {
      const raw = this.store?.get(BOWL_STORAGE_KEY);
      if (!raw) return fresh;
      const p = JSON.parse(raw) as Partial<BowlState>;
      if (p.date !== today) return fresh;
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
      return { date: today, seenTokenBowls: n(p.seenTokenBowls), bonus: n(p.bonus), tower: n(p.tower) };
    } catch {
      return fresh;
    }
  }

  private save(): void {
    try {
      this.store?.set(BOWL_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 忽略沙盒写入异常
    }
  }
}

// ==================== 溜达调度 ====================

export type WalkPhase = 'rest' | 'walk' | 'peek';

export interface WalkRange {
  minX: number;
  maxX: number;
}

export interface WalkStep {
  x: number;
  dir: 1 | -1;
  phase: WalkPhase;
  speedRatio: number;
}

/** 闲置溜达：每 20–60s 随机走 3–8s（含 0.42s 起步加速 / 0.38s 停步减速 / 偶发 1.35x 垫步或 0.7s 张望），到边缘探头 1.5s 再掉头 */
export class WalkPlanner {
  enabled = true;
  /** 「溜达一下」手动触发：忽略闲置条件（硬阻塞仍生效） */
  forced = false;
  phase: WalkPhase = 'rest';
  dir: 1 | -1 = 1;
  nextWalkAt: number;
  private walkSegmentStartAt = 0;
  private walkEndAt = 0;
  private peekUntil = 0;
  private scurryStartAt = 0;
  private scurryEndAt = 0;
  private lookPauseStartAt = 0;
  private lookPauseEndAt = 0;
  private blocked = false;

  constructor(
    now: number,
    private readonly rng: () => number = Math.random,
  ) {
    this.nextWalkAt = now + this.gap();
  }

  get isMoving(): boolean {
    return this.phase !== 'rest';
  }

  setEnabled(on: boolean, now: number): void {
    this.enabled = on;
    if (!on) this.stop(now);
  }

  /** 交互打断：立即停下并重新排 20–60s */
  interrupt(now: number): void {
    this.stop(now);
  }

  forceWalk(now: number, x: number, range: WalkRange): void {
    this.blocked = false;
    this.beginWalk(now, x, range);
    this.forced = true;
  }

  step(now: number, dtSec: number, x: number, range: WalkRange, canWalk: boolean, speedMul = 1): WalkStep {
    if ((!this.enabled && !this.forced) || !canWalk) {
      if (this.phase !== 'rest') this.stop(now);
      this.blocked = true;
      return { x, dir: this.dir, phase: this.phase, speedRatio: 0 };
    }
    if (this.blocked) {
      this.blocked = false;
      this.nextWalkAt = Math.max(this.nextWalkAt, now + this.gap());
    }

    if (this.phase === 'rest') {
      if (now >= this.nextWalkAt) this.beginWalk(now, x, range);
      else return { x, dir: this.dir, phase: 'rest', speedRatio: 0 };
    }

    if (this.phase === 'peek') {
      if (now < this.peekUntil) return { x, dir: this.dir, phase: 'peek', speedRatio: 0 };
      this.dir = this.dir === 1 ? -1 : 1;
      this.phase = 'walk';
      this.walkSegmentStartAt = this.peekUntil;
    }

    if (now >= this.walkEndAt) {
      this.stop(now);
      return { x, dir: this.dir, phase: 'rest', speedRatio: 0 };
    }

    if (this.lookPauseEndAt > 0 && now >= this.lookPauseStartAt) {
      if (now < this.lookPauseEndAt) {
        return { x, dir: this.dir, phase: 'walk', speedRatio: 0 };
      }
      this.walkSegmentStartAt = this.lookPauseEndAt;
      this.lookPauseStartAt = 0;
      this.lookPauseEndAt = 0;
    }

    const sinceStart = Math.max(0, now - this.walkSegmentStartAt);
    const accelRatio =
      sinceStart < WALK_ACCEL_MS ? 1 - (1 - sinceStart / WALK_ACCEL_MS) ** 2 : 1;

    const remainEnd = Math.max(0, this.walkEndAt - now);
    let decelRatio = 1;
    if (remainEnd < WALK_DECEL_MS) {
      const v = remainEnd / WALK_DECEL_MS;
      decelRatio = v * v * (3 - 2 * v);
    }
    if (this.lookPauseStartAt > 0 && now < this.lookPauseStartAt) {
      const toPause = this.lookPauseStartAt - now;
      if (toPause < 200) {
        const v = toPause / 200;
        decelRatio = Math.min(decelRatio, v * (2 - v));
      }
    }

    const gaitMul =
      this.scurryEndAt > 0 && now >= this.scurryStartAt && now < this.scurryEndAt
        ? WALK_SCURRY_MUL
        : 1;
    const speedRatio = accelRatio * decelRatio * gaitMul;

    let finalSpeedRatio = speedRatio;
    let nx = x + this.dir * WALK_SPEED_PX * speedMul * speedRatio * Math.max(0, Math.min(1, dtSec));
    if (nx <= range.minX && this.dir === -1) {
      nx = range.minX;
      this.enterPeek(now);
      finalSpeedRatio = 0;
    } else if (nx >= range.maxX && this.dir === 1) {
      nx = range.maxX;
      this.enterPeek(now);
      finalSpeedRatio = 0;
    }
    return {
      x: nx,
      dir: this.dir,
      phase: this.phase,
      speedRatio: finalSpeedRatio,
    };
  }

  private enterPeek(now: number): void {
    this.phase = 'peek';
    this.peekUntil = now + PEEK_MS;
    this.walkEndAt = Math.max(this.walkEndAt, now + PEEK_MS) + PEEK_MS;
    this.clearGaitVariation();
  }

  private clearGaitVariation(): void {
    this.scurryStartAt = 0;
    this.scurryEndAt = 0;
    this.lookPauseStartAt = 0;
    this.lookPauseEndAt = 0;
  }

  private beginWalk(now: number, x: number, range: WalkRange): void {
    const roomLeft = x - range.minX;
    const roomRight = range.maxX - x;
    const preferRight = roomRight >= roomLeft;
    this.dir = this.rng() < 0.72 ? (preferRight ? 1 : -1) : preferRight ? -1 : 1;
    if (this.dir === 1 && roomRight <= 1) this.dir = -1;
    else if (this.dir === -1 && roomLeft <= 1) this.dir = 1;
    this.phase = 'walk';
    const walkDur = WALK_MIN_MS + this.rng() * (WALK_MAX_MS - WALK_MIN_MS);
    this.walkSegmentStartAt = now;
    this.walkEndAt = now + walkDur;
    this.clearGaitVariation();

    const roll = this.rng();
    if (roll < 0.3 && walkDur >= 2200) {
      const offset = 900 + this.rng() * Math.max(200, Math.min(1800, walkDur - 1700));
      this.scurryStartAt = now + offset;
      this.scurryEndAt = Math.min(this.walkEndAt - WALK_DECEL_MS - 80, this.scurryStartAt + 950);
    } else if (roll < 0.56 && walkDur >= 2800) {
      const offset = 1100 + this.rng() * Math.max(200, Math.min(1800, walkDur - 2200));
      this.lookPauseStartAt = now + offset;
      this.lookPauseEndAt = this.lookPauseStartAt + WALK_LOOK_PAUSE_MS;
      this.walkEndAt += WALK_LOOK_PAUSE_MS;
    }
  }

  private stop(now: number): void {
    this.phase = 'rest';
    this.forced = false;
    this.clearGaitVariation();
    this.nextWalkAt = now + this.gap();
  }

  private gap(): number {
    return WALK_GAP_MIN_MS + this.rng() * (WALK_GAP_MAX_MS - WALK_GAP_MIN_MS);
  }
}

// ==================== 火花线 ====================

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** 最近采样 → ▁▃▆█ 迷你火花线（0 速率始终是最低格） */
export function buildSparkline(samples: readonly number[], width = 20): string {
  const tail = samples.slice(-width);
  let max = 0;
  for (const v of tail) if (Number.isFinite(v) && v > max) max = v;
  if (max <= 0) return tail.map(() => SPARK_CHARS[0]).join('');
  return tail
    .map((v) => {
      if (!Number.isFinite(v) || v <= 0) return SPARK_CHARS[0];
      const idx = Math.max(1, Math.min(7, Math.round((v / max) * 7)));
      return SPARK_CHARS[idx];
    })
    .join('');
}
