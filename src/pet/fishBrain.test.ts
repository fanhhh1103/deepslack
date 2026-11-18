import { describe, expect, it } from 'vitest';
import {
  BOWL_DROP_INTERVAL_MS,
  BOWL_STORAGE_KEY,
  BOWL_TOKENS,
  BowlLedger,
  buildSparkline,
  CATCH_COOLDOWN_MS,
  CATCH_MS,
  FAKE_TYPING_MS,
  FishBrain,
  MAX_PENDING_BOWLS,
  MAX_TOWER_LAYERS,
  PEEK_MS,
  RATE_TIERS,
  RateSmoother,
  rateOf,
  SLACK_AFTER_MS,
  TierTracker,
  tierForRate,
  WALK_ACCEL_MS,
  WALK_DECEL_MS,
  WALK_GAP_MAX_MS,
  WALK_GAP_MIN_MS,
  WALK_LOOK_PAUSE_MS,
  WALK_MIN_MS,
  WALK_SCURRY_MUL,
  WALK_SPEED_PX,
  WalkPlanner,
  type BrainEvent,
  type KVStore,
} from '../pet/fishBrain';
import { FishDirector } from '../pet/fishDirector';
import type { PetController, PetEvent, PetMood } from '../pet/petRenderer';

function memStore(): KVStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

const T1 = RATE_TIERS[1].enter;
const T2 = RATE_TIERS[2].enter;
const T3 = RATE_TIERS[3].enter;

describe('rate tiers & smoothing', () => {
  it('keeps tier thresholds ascending with hysteresis exits below enters', () => {
    expect(RATE_TIERS.map((t) => t.tier)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < RATE_TIERS.length; i++) {
      expect(RATE_TIERS[i].enter).toBeGreaterThan(RATE_TIERS[i - 1].enter);
      expect(RATE_TIERS[i].exit).toBeLessThan(RATE_TIERS[i].enter);
    }
    expect(tierForRate(0)).toBe(0);
    expect(tierForRate(T1)).toBe(1);
    expect(tierForRate(T2 + 1)).toBe(2);
    expect(tierForRate(T3 * 2)).toBe(3);
    expect(rateOf({ tokensPerSec: 9000, freshTokensPerSec: 420 })).toBe(420);
    expect(rateOf({ tokensPerSec: 900 })).toBe(900);
    expect(rateOf({ tokensPerSec: Number.NaN, freshTokensPerSec: -1 })).toBe(0);
  });

  it('EMA clips single 50k spikes, tolerates sparse zero windows, and snaps down after a zero streak', () => {
    const s = new RateSmoother();
    s.push(400);
    s.push(400);
    const before = s.value;
    s.push(50_000);
    expect(s.value).toBeLessThan(T3); // 单跳尖峰不会直接红温
    s.reset();
    for (let i = 0; i < 6; i++) s.push(400);
    const steady = s.value;
    s.push(0); // 一次空窗：小幅回落
    expect(s.value).toBeGreaterThan(steady * 0.7);
    s.push(0);
    s.push(0);
    s.push(0);
    s.push(0);
    s.push(0);
    expect(s.value).toBeLessThan(RATE_TIERS[1].exit);
    expect(before).toBeGreaterThan(0);
  });

  it('upgrades immediately but only downgrades after the hold time (no jitter)', () => {
    const tr = new TierTracker();
    expect(tr.update(T2 + 10, 0)).toEqual({ from: 0, to: 2 });
    expect(tr.update(RATE_TIERS[2].exit + 1, 1000)).toBeNull();
    expect(tr.update(RATE_TIERS[2].exit - 1, 2000)).toBeNull();
    expect(tr.update(RATE_TIERS[2].exit - 1, 4000)).toBeNull();
    expect(tr.update(RATE_TIERS[2].exit - 1, 5600)).toEqual({ from: 2, to: 1 });
    expect(tr.update(T3 + 1, 6000)).toEqual({ from: 1, to: 3 });
    expect(tr.update(0, 7000)).toBeNull();
    expect(tr.update(0, 8600)).toEqual({ from: 3, to: 0 });
  });
});

describe('FishBrain state machine', () => {
  const collect = (evs: BrainEvent[], type: BrainEvent['type']) => evs.filter((e) => e.type === type);

  it('enters slacking after 8s at T0 and leaves it when tokens burn', () => {
    const b = new FishBrain(0);
    expect(b.tick(SLACK_AFTER_MS - 1)).toEqual([]);
    expect(b.tick(SLACK_AFTER_MS)).toEqual([{ type: 'slack', on: true }]);
    expect(b.slacking).toBe(true);
    const evs = b.pushRate(T2 * 2, SLACK_AFTER_MS + 500);
    expect(collect(evs, 'slack')).toEqual([{ type: 'slack', on: false }]);
    expect(b.tier).toBeGreaterThanOrEqual(1);
  });

  it('fires overheat on entering T3 and tired after ≥10s high then a crash to T0', () => {
    const b = new FishBrain(0);
    let t = 0;
    let all: BrainEvent[] = [];
    for (let i = 0; i < 14; i++) {
      t += 1500;
      all = all.concat(b.pushRate(T3 * 2, t));
    }
    expect(b.tier).toBe(3);
    expect(collect(all, 'overheat')).toHaveLength(1);
    all = [];
    for (let i = 0; i < 20 && b.tier !== 0; i++) {
      t += 1500;
      all = all.concat(b.pushRate(0, t));
    }
    expect(b.tier).toBe(0);
    expect(collect(all, 'tired')).toHaveLength(1);
  });

  it('does not get tired after a short burst', () => {
    const b = new FishBrain(0);
    let t = 0;
    let all: BrainEvent[] = [];
    for (let i = 0; i < 3; i++) all = all.concat(b.pushRate(T3 * 2, (t += 1500)));
    for (let i = 0; i < 20 && b.tier !== 0; i++) all = all.concat(b.pushRate(0, (t += 1500)));
    expect(collect(all, 'tired')).toHaveLength(0);
  });

  it('catch → fake typing → back to slacking, with cooldown', () => {
    const b = new FishBrain(0);
    expect(b.tryCatch(100)).toBe(false); // 还没摸鱼
    b.tick(SLACK_AFTER_MS);
    const t0 = SLACK_AFTER_MS + 100;
    expect(b.tryCatch(t0)).toBe(true);
    expect(b.catchPhase).toBe('caught');
    expect(b.tryCatch(t0 + 10)).toBe(false);
    expect(b.tick(t0 + CATCH_MS)).toEqual([{ type: 'catch-fake' }]);
    expect(b.tick(t0 + CATCH_MS + FAKE_TYPING_MS)).toEqual([{ type: 'catch-end' }]);
    expect(b.slacking).toBe(true);
    expect(b.tryCatch(t0 + CATCH_COOLDOWN_MS - 1)).toBe(false);
    expect(b.tryCatch(t0 + CATCH_COOLDOWN_MS)).toBe(true);
  });
});

describe('BowlLedger', () => {
  it('silently stacks existing bowls on first sync, then queues drops ≥6s apart', () => {
    const store = memStore();
    const led = new BowlLedger(store, () => '2026-11-17');
    led.syncTokens(BOWL_TOKENS * 20 + 5);
    expect(led.total).toBe(20);
    expect(led.tower).toBe(20);
    expect(led.towerLayers).toBe(MAX_TOWER_LAYERS);
    expect(led.pending).toBe(0);

    led.syncTokens(BOWL_TOKENS * 22);
    expect(led.total).toBe(22);
    expect(led.pending).toBe(2);
    expect(led.takeDrop(0, false)).toBe(false);
    expect(led.takeDrop(1000, true)).toBe(true);
    expect(led.takeDrop(1000 + BOWL_DROP_INTERVAL_MS - 1, true)).toBe(false);
    expect(led.takeDrop(1000 + BOWL_DROP_INTERVAL_MS, true)).toBe(true);
    expect(led.pending).toBe(0);

    led.landBowl();
    led.feed();
    expect(led.total).toBe(23);
    expect(led.tower).toBe(21);
    led.collapse();
    expect(led.tower).toBe(0);
    expect(led.total).toBe(23); // 倒塌不减今日总数

    // 持久化：重载后保留，且首次同步只静默补差
    const again = new BowlLedger(store, () => '2026-11-17');
    expect(again.total).toBe(23);
    expect(again.tower).toBe(0);
    again.syncTokens(BOWL_TOKENS * 23);
    expect(again.tower).toBe(1);
    expect(again.pending).toBe(0);
  });

  it('caps the live queue and resets on a new day', () => {
    const store = memStore();
    let day = '2026-11-17';
    const led = new BowlLedger(store, () => day);
    led.syncTokens(0);
    led.syncTokens(BOWL_TOKENS * 30);
    expect(led.pending).toBe(MAX_PENDING_BOWLS);
    expect(led.tower).toBe(30 - MAX_PENDING_BOWLS);
    day = '2026-11-18';
    expect(led.total).toBe(0);
    expect(led.tower).toBe(0);
    expect(led.pending).toBe(0);
    expect(JSON.parse(store.data.get(BOWL_STORAGE_KEY) ?? '{}').date).toBe('2026-11-18');
  });
});

describe('WalkPlanner', () => {
  const range = { minX: 0, maxX: 100 };

  it('waits 20–60s, walks at ~40px/s, peeks 1.5s at the edge then turns around', () => {
    const w = new WalkPlanner(0, () => 0.99);
    expect(w.nextWalkAt).toBeGreaterThanOrEqual(WALK_GAP_MIN_MS);
    expect(w.nextWalkAt).toBeLessThanOrEqual(WALK_GAP_MAX_MS);
    let x = 90;
    let t = w.nextWalkAt;
    let step = w.step(t, 0.033, x, range, true);
    expect(step.phase).toBe('walk');
    expect(step.dir).toBe(1); // rng 0.99 → 28% 概率反向走向空间较小的一侧
    // 向右边缘走
    w.forceWalk(t, x, range);
    let peeked = false;
    for (let i = 0; i < 400; i++) {
      t += 33;
      step = w.step(t, 0.033, x, range, true);
      if (step.phase === 'peek') {
        peeked = true;
        break;
      }
      x = step.x;
    }
    expect(peeked).toBe(true);
    const peekDir = step.dir;
    expect(w.step(t + PEEK_MS - 10, 0.033, step.x, range, true).phase).toBe('peek');
    const after = w.step(t + PEEK_MS + 10, 0.033, step.x, range, true);
    expect(after.phase).toBe('walk');
    expect(after.dir).toBe(peekDir === 1 ? -1 : 1);
    expect(Math.abs(after.x - step.x)).toBeLessThanOrEqual(WALK_SPEED_PX * 0.034);
  });

  it('stops immediately when blocked or disabled and reschedules', () => {
    const w = new WalkPlanner(0, () => 0.5);
    w.forceWalk(0, 50, range);
    expect(w.step(10, 0.033, 50, range, true).phase).toBe('walk');
    expect(w.step(20, 0.033, 50, range, false).phase).toBe('rest');
    expect(w.isMoving).toBe(false);
    expect(w.nextWalkAt).toBeGreaterThanOrEqual(20 + WALK_GAP_MIN_MS);
    w.setEnabled(false, 30);
    expect(w.step(w.nextWalkAt + 1, 0.033, 50, range, true).phase).toBe('rest');
  });

  it('applies 0.42s ease-out accel, 0.38s decel, 1.35x scurry and 0.7s look-around pause', () => {
    const seq = (vals: number[]) => {
      let i = 0;
      return () => vals[i++ % vals.length];
    };
    const bigRange = { minX: -500, maxX: 500 };

    // 测试加减速 + 1.35x 欢快小碎步
    // rng 序列: ctor gap(0.5), forceWalk: dir(0.1), walkDur(0.5 -> 5500ms), roll(0.1 -> scurry), scurryOffset(0.0 -> 900ms)
    const wScurry = new WalkPlanner(0, seq([0.5, 0.1, 0.5, 0.1, 0.0, 0.5]));
    wScurry.forceWalk(0, 0, bigRange);
    const s0 = wScurry.step(0, 0.033, 0, bigRange, true);
    expect(s0.speedRatio).toBe(0);
    const sMidAccel = wScurry.step(WALK_ACCEL_MS * 0.5, 0.033, 0, bigRange, true);
    expect(sMidAccel.speedRatio).toBeGreaterThan(0.6);
    expect(sMidAccel.speedRatio).toBeLessThan(1);
    const sCruise = wScurry.step(600, 0.033, 0, bigRange, true);
    expect(sCruise.speedRatio).toBeCloseTo(1, 5);
    const sBurst = wScurry.step(1100, 0.033, 0, bigRange, true);
    expect(sBurst.speedRatio).toBeCloseTo(WALK_SCURRY_MUL, 5);
    const walkDur = WALK_MIN_MS + 0.5 * (8000 - WALK_MIN_MS); // 5500ms
    const sDecel = wScurry.step(walkDur - WALK_DECEL_MS * 0.5, 0.033, 0, bigRange, true);
    expect(sDecel.speedRatio).toBeGreaterThan(0.2);
    expect(sDecel.speedRatio).toBeLessThan(0.8);
    const sDone = wScurry.step(walkDur + 10, 0.033, 0, bigRange, true);
    expect(sDone.phase).toBe('rest');
    expect(sDone.speedRatio).toBe(0);

    // 测试 0.7s 驻足张望变奏
    // ctor gap(0.5), forceWalk: dir(0.1), walkDur(0.5 -> 5500ms), roll(0.45 -> lookPause), offset(0.0 -> 1100ms)
    const wPause = new WalkPlanner(0, seq([0.5, 0.1, 0.5, 0.45, 0.0, 0.5]));
    wPause.forceWalk(0, 0, bigRange);
    expect(wPause.step(600, 0.033, 0, bigRange, true).speedRatio).toBeCloseTo(1, 5);
    const paused = wPause.step(1250, 0.033, 10, bigRange, true);
    expect(paused.phase).toBe('walk');
    expect(paused.speedRatio).toBe(0);
    expect(paused.x).toBe(10);
    const resumed = wPause.step(1100 + WALK_LOOK_PAUSE_MS + 100, 0.033, 10, bigRange, true);
    expect(resumed.phase).toBe('walk');
    expect(resumed.speedRatio).toBeGreaterThan(0);
    expect(resumed.speedRatio).toBeLessThan(1);
  });
});

describe('sparkline', () => {
  it('renders 20 samples and drops to the floor when rate hits zero', () => {
    expect(buildSparkline([])).toBe('');
    expect(buildSparkline([0, 0])).toBe('▁▁');
    const s = buildSparkline([100, 400, 800, 0]);
    expect(s).toBe('▂▅█▁');
    expect(buildSparkline(Array.from({ length: 30 }, (_, i) => i + 1))).toHaveLength(20);
  });
});

describe('FishDirector wiring', () => {
  it('maps brain events, hover catch, bowl drops and pet events onto the controller', () => {
    const calls: string[] = [];
    let mood: PetMood = 'idle';
    let busy = false;
    let bowls = 0;
    let listener: ((ev: PetEvent) => void) | null = null;
    const pet = {
      setMood: (m: PetMood, text?: string) => {
        mood = m;
        calls.push(`mood:${m}:${text ?? ''}`);
      },
      getMood: () => mood,
      setRateTier: (tier: number) => calls.push(`tier:${tier}`),
      setBaseMood: (m: PetMood) => {
        mood = m;
        calls.push(`base:${m}`);
      },
      playFakeTyping: () => calls.push('fake'),
      setLocomotion: () => {},
      setBowlCount: (n: number) => {
        bowls = n;
      },
      dropItem: (kind: string, source: string) => {
        calls.push(`drop:${kind}:${source}`);
        return true;
      },
      getBoostRemainingMs: () => 0,
      isBusy: () => busy,
      onEvent: (cb: (ev: PetEvent) => void) => {
        listener = cb;
        return () => {};
      },
    } as unknown as PetController;

    const store = memStore();
    const dir = new FishDirector({ storage: store, now: 0, today: () => '2026-11-17' });
    dir.attachPet(pet);
    dir.handleRateSample({ tokensPerSec: 0, freshTokensPerSec: 0, todayTokens: BOWL_TOKENS * 3 }, 0);
    expect(dir.ledger.tower).toBe(3);
    expect(bowls).toBe(0); // attach 时还没同步

    dir.tick(SLACK_AFTER_MS);
    expect(calls).toContain('base:slack');
    expect(dir.handleHover(SLACK_AFTER_MS + 10)).toBe(true);
    expect(calls.some((c) => c.startsWith('mood:caught:'))).toBe(true);
    dir.tick(SLACK_AFTER_MS + 10 + CATCH_MS);
    expect(calls).toContain('fake');

    // 跨阈值：排队空投饭碗
    dir.handleRateSample({ tokensPerSec: 9000, freshTokensPerSec: T2 * 2, todayTokens: BOWL_TOKENS * 4 }, 20_000);
    expect(calls).toContain('base:work');
    busy = true;
    dir.tick(20_100);
    expect(calls).not.toContain('drop:rice:auto');
    busy = false;
    dir.tick(20_200);
    expect(calls).toContain('drop:rice:auto');

    listener!({ type: 'bowl-landed' });
    expect(dir.ledger.tower).toBe(4);
    expect(bowls).toBe(4);
    listener!({ type: 'item-caught', kind: 'rice', source: 'toy' });
    expect(dir.ledger.total).toBe(5);
    listener!({ type: 'tower-collapse' });
    expect(dir.ledger.tower).toBe(0);
    expect(dir.ledger.total).toBe(5);
    expect(dir.samples.length).toBe(2);
    expect(dir.throwToy('coffee', 21_000)).toBe(true);
    expect(calls).toContain('drop:coffee:toy');
  });
});
