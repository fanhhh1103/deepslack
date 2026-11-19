// MIT License - 大肥鱼导演：把速率大脑、饭碗账本、溜达调度与渲染器串起来（无 DOM 依赖）

import {
  BowlLedger,
  FishBrain,
  rateOf,
  WalkPlanner,
  type BrainEvent,
  type KVStore,
  type RateSampleLike,
  type RateTier,
  type WalkRange,
  type WalkStep,
} from './fishBrain';
import type { DropKind, PetBaseMood, PetCharId, PetController, PetEvent } from './petRenderer';

export interface FishLines {
  overheat: string;
  tired: string;
  caught: string;
}

export const FISH_LINES = {
  overheat: '显卡要干烧啦！老板慢点摇人！！',
  tired: '呼…终于跑完了…',
  caught: '咳！我没摸鱼，刚在深度思考！',
} as const;

export const CHAR_FISH_LINES: Record<PetCharId, FishLines> = {
  dafeiyu: FISH_LINES,
  daju: {
    overheat: '上下文要溢出啦！别再往里塞文件了！！',
    tired: '呼…这段长重构终于写完啦…',
    caught: '咳！我没摸鱼，在给代码构思架构呢！',
  },
  bailong: {
    overheat: '推理链要烧穿算力池啦！！',
    tired: '呼…总算推演完毕…',
    caught: '本龙才没摸鱼，正在深度推理！',
  },
  xingmao: {
    overheat: '百万上下文快烧冒烟啦喵！！',
    tired: '呼噜…跑分跑累了喵…',
    caught: '喵哇！没摸鱼，刚在读百万上下文喵！',
  },
  grok: {
    overheat: '火力全开！显卡要干爆啦！！',
    tired: '呼…总算把这波全砍完了…',
    caught: '切，谁摸鱼了！本小姐刚在巡逻找 Bug！',
  },
};

export function getFishLines(charId?: PetCharId): FishLines {
  return (charId && CHAR_FISH_LINES[charId]) || FISH_LINES;
}

export const SPARK_SAMPLES = 20;

export interface FishDirectorOptions {
  storage: KVStore | null;
  now: number;
  rng?: () => number;
  today?: () => string;
  walkEnabled?: boolean;
  onChange?: () => void;
}

export interface FishRateSample extends RateSampleLike {
  todayTokens?: number;
}

export class FishDirector {
  readonly brain: FishBrain;
  readonly ledger: BowlLedger;
  readonly walker: WalkPlanner;
  /** 最近 20 次原始速率（火花线用，归零立刻掉底） */
  readonly samples: number[] = [];
  /** 最近一次原始速率（驱动档位的 fresh 口径） */
  displayRate = 0;
  /** 最近一次全部速率（含 cache_read） */
  totalRate = 0;
  rateTodayTokens = 0;

  private pet: PetController | null = null;
  private unsubPet: (() => void) | null = null;
  private readonly onChange: () => void;

  constructor(opts: FishDirectorOptions) {
    this.brain = new FishBrain(opts.now);
    this.ledger = new BowlLedger(opts.storage, opts.today);
    this.walker = new WalkPlanner(opts.now, opts.rng);
    this.walker.enabled = opts.walkEnabled !== false;
    this.onChange = opts.onChange ?? (() => {});
  }

  get tier(): RateTier {
    return this.brain.tier;
  }

  attachPet(pet: PetController): void {
    this.unsubPet?.();
    this.pet = pet;
    this.unsubPet = pet.onEvent((ev) => this.handlePetEvent(ev));
    pet.setBowlCount(this.ledger.towerLayers);
    pet.setRateTier(this.brain.tier, this.brain.smoothed);
    pet.setBaseMood(this.baseMood());
  }

  detach(): void {
    this.unsubPet?.();
    this.unsubPet = null;
    this.pet = null;
  }

  baseMood(): PetBaseMood {
    if (this.brain.tier > 0) return 'work';
    return this.brain.slacking ? 'slack' : 'idle';
  }

  handleRateSample(sample: FishRateSample, now: number): void {
    const raw = rateOf(sample);
    this.displayRate = raw;
    this.totalRate = Number.isFinite(sample.tokensPerSec) && sample.tokensPerSec > 0 ? sample.tokensPerSec : 0;
    this.samples.push(raw);
    if (this.samples.length > SPARK_SAMPLES) this.samples.splice(0, this.samples.length - SPARK_SAMPLES);

    const events = this.brain.pushRate(raw, now);
    this.pet?.setRateTier(this.brain.tier, this.brain.smoothed);
    this.applyEvents(events, now);

    if (typeof sample.todayTokens === 'number' && Number.isFinite(sample.todayTokens)) {
      this.rateTodayTokens = sample.todayTokens;
      this.ledger.syncTokens(sample.todayTokens);
    }
    this.onChange();
  }

  /** 浏览器试玩快捷模拟：跳过 4.5s EMA 预热，立刻切入目标档位并唤醒桌宠 */
  previewRate(tps: number, now: number): void {
    const raw = Number.isFinite(tps) && tps > 0 ? tps : 0;
    this.displayRate = raw;
    this.totalRate = raw;
    this.samples.push(raw);
    if (this.samples.length > SPARK_SAMPLES) this.samples.splice(0, this.samples.length - SPARK_SAMPLES);

    this.walker.interrupt(now);
    this.pet?.setLocomotion(0);
    if (raw <= 0) {
      this.brain.smoother.reset();
      this.brain.smoothed = 0;
      this.brain.tracker.tier = 0;
      this.brain.slacking = false;
      this.pet?.setRateTier(0, 0);
      this.pet?.setBaseMood('idle');
      this.pet?.setMood('idle');
    } else {
      // 跳过尖峰截断，让试玩按钮一按即达对应档位
      this.brain.smoother.value = raw;
      const events = this.brain.pushRate(raw, now);
      this.pet?.setRateTier(this.brain.tier, this.brain.smoothed);
      this.pet?.setBaseMood(this.baseMood());
      if (this.brain.tier >= 3) {
        this.pet?.setMood('overheat', this.currentLines().overheat, 1400);
      } else {
        this.pet?.setMood('work');
      }
      this.applyEvents(events, now);
    }
    this.onChange();
  }

  /** 摸鱼中鼠标移入桌宠 → 抓包 */
  handleHover(now: number): boolean {
    if (!this.pet || this.pet.isBusy() || !this.brain.tryCatch(now)) return false;
    this.walker.interrupt(now);
    this.pet.setLocomotion(0);
    this.pet.setMood('caught', this.currentLines().caught, 1600);
    return true;
  }

  noteInteraction(now: number): void {
    this.walker.interrupt(now);
    this.pet?.setLocomotion(0);
  }

  throwToy(kind: DropKind, now: number): boolean {
    this.noteInteraction(now);
    return this.pet?.dropItem(kind, 'toy') ?? false;
  }

  /** 时间推进：抓包阶段、摸鱼判定、排队掉碗（约 4Hz，溜达中 30Hz） */
  tick(now: number): void {
    this.applyEvents(this.brain.tick(now), now);
    const pet = this.pet;
    if (!pet) return;
    const canDrop = !pet.isBusy() && !this.walker.isMoving;
    if (this.ledger.takeDrop(now, canDrop)) {
      if (!pet.dropItem('rice', 'auto')) this.ledger.pending++;
    }
  }

  /** 闲置条件：T0、非抓包、非忙碌、处于 idle/slack 常驻姿态 */
  canWalk(): boolean {
    const pet = this.pet;
    if (!pet || pet.isBusy()) return false;
    if (this.walker.forced) return true;
    if (this.brain.tier !== 0 || this.brain.catchPhase !== 'none') return false;
    const mood = pet.getMood();
    return mood === 'idle' || mood === 'slack';
  }

  stepWalk(now: number, dtSec: number, x: number, range: WalkRange, hardBlocked: boolean): WalkStep {
    const speedMul = (this.pet?.getBoostRemainingMs() ?? 0) > 0 ? 1.4 : 1;
    const step = this.walker.step(now, dtSec, x, range, !hardBlocked && this.canWalk(), speedMul);
    this.pet?.setLocomotion(step.phase === 'rest' ? 0 : step.dir, step.phase === 'peek', step.speedRatio);
    return step;
  }

  forceWalk(now: number, x: number, range: WalkRange): void {
    this.walker.forceWalk(now, x, range);
  }

  setWalkEnabled(on: boolean, now: number): void {
    this.walker.setEnabled(on, now);
    if (!on) this.pet?.setLocomotion(0);
  }

  private currentLines(): FishLines {
    const charId = typeof this.pet?.getCharacter === 'function' ? this.pet.getCharacter() : 'dafeiyu';
    return getFishLines(charId);
  }

  private applyEvents(events: BrainEvent[], _now: number): void {
    const pet = this.pet;
    if (!pet || events.length === 0) return;
    const lines = this.currentLines();
    for (const ev of events) {
      switch (ev.type) {
        case 'tier':
        case 'slack':
          pet.setBaseMood(this.baseMood());
          break;
        case 'overheat':
          pet.setMood('overheat', lines.overheat, 1200);
          break;
        case 'tired':
          pet.setMood('tired', lines.tired, 3500);
          break;
        case 'catch-fake':
          pet.playFakeTyping(2000);
          break;
        case 'catch-end':
          pet.setBaseMood(this.baseMood());
          break;
        default:
          break;
      }
    }
    this.onChange();
  }

  private handlePetEvent(ev: PetEvent): void {
    if (ev.type === 'item-caught' && ev.kind === 'rice' && ev.source === 'toy') {
      this.ledger.feed();
    } else if (ev.type === 'bowl-landed') {
      this.ledger.landBowl();
      this.pet?.setBowlCount(this.ledger.towerLayers);
    } else if (ev.type === 'tower-collapse') {
      this.ledger.collapse();
    }
    this.onChange();
  }
}
