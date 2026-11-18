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
import type { DropKind, PetBaseMood, PetController, PetEvent } from './petRenderer';

export const FISH_LINES = {
  overheat: '显卡要干烧啦！老板慢点摇人！！',
  tired: '呼…终于跑完了…',
  caught: '咳！我没摸鱼，刚在深度思考！',
} as const;

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

  /** 摸鱼中鼠标移入桌宠 → 抓包 */
  handleHover(now: number): boolean {
    if (!this.pet || this.pet.isBusy() || !this.brain.tryCatch(now)) return false;
    this.walker.interrupt(now);
    this.pet.setLocomotion(0);
    this.pet.setMood('caught', FISH_LINES.caught, 1600);
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

  private applyEvents(events: BrainEvent[], _now: number): void {
    const pet = this.pet;
    if (!pet || events.length === 0) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'tier':
        case 'slack':
          pet.setBaseMood(this.baseMood());
          break;
        case 'overheat':
          pet.setMood('overheat', FISH_LINES.overheat, 1200);
          break;
        case 'tired':
          pet.setMood('tired', FISH_LINES.tired, 3500);
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
