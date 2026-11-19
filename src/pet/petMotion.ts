// MIT License - 二阶弹簧动力学、体积守恒挤压、姿态过渡桥、步频时钟与狂摇检测（纯数学，零 DOM 依赖）

import type { PetMood } from './petRenderer';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * t3ssel8r 二阶弹簧系统：
 * - f：自然频率 (Hz)
 * - z：阻尼比 (<1 欠阻尼回弹，=1 临界阻尼，>1 过阻尼)
 * - r：初始响应速度 (<0 预备反向蓄力，=0 常规，>0 超前响应)
 */
export class SecondOrderSpring {
  private xp: number;
  y: number;
  yd: number;
  private readonly k1: number;
  private readonly k2: number;
  private readonly k3: number;

  constructor(f: number, z: number, r: number, initial = 0) {
    const safeF = Math.max(0.01, Number.isFinite(f) ? f : 1);
    const safeZ = Math.max(0, Number.isFinite(z) ? z : 0.5);
    const safeR = Number.isFinite(r) ? r : 0;
    const init = Number.isFinite(initial) ? initial : 0;

    this.xp = init;
    this.y = init;
    this.yd = 0;

    this.k1 = safeZ / (Math.PI * safeF);
    this.k2 = 1 / ((2 * Math.PI * safeF) ** 2);
    this.k3 = (safeR * safeZ) / (2 * Math.PI * safeF);
  }

  get value(): number {
    return this.y;
  }

  get velocity(): number {
    return this.yd;
  }

  update(dt: number, x: number, xd?: number): number {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(x)) {
      return this.y;
    }
    const estXd = xd !== undefined && Number.isFinite(xd) ? xd : (x - this.xp) / dt;
    this.xp = x;

    const k2Stable = Math.max(this.k2, dt * dt * 0.5 + dt * this.k1 * 0.5);
    this.y = this.y + dt * this.yd;
    this.yd = this.yd + (dt * (x + this.k3 * estXd - this.y - this.k1 * this.yd)) / k2Stable;
    return this.y;
  }

  impulse(dv: number): void {
    if (Number.isFinite(dv)) {
      this.yd += dv;
    }
  }

  snap(x: number): void {
    if (!Number.isFinite(x)) return;
    this.xp = x;
    this.y = x;
    this.yd = 0;
  }

  isSettled(posEps = 0.001, velEps = 0.001): boolean {
    return Math.abs(this.y - this.xp) <= posEps && Math.abs(this.yd) <= velEps;
  }
}

/** 体积守恒果冻缩放：竖向压扁时横向按平方根倒数撑宽 */
export function volumePreservingScale(
  squash: number,
  breath = 0,
): { scaleX: number; scaleY: number } {
  const s = Number.isFinite(squash) ? squash : 0;
  const b = Number.isFinite(breath) ? breath : 0;
  const scaleY = clamp(1 - s + b, 0.7, 1.32);
  const scaleX = clamp(1 / Math.sqrt(scaleY), 0.78, 1.3);
  return { scaleX, scaleY };
}

/** 二次谐波自然呼吸曲线（吸气舒展、呼气略收束） */
export function organicBreath(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  return 0.78 * Math.sin(phase) + 0.22 * Math.sin(2 * phase - 0.55);
}

export type PostureFamily = 'stand' | 'sit' | 'lie' | 'air';

export function moodToPosture(mood: PetMood): PostureFamily {
  switch (mood) {
    case 'dangle':
      return 'air';
    case 'sleep':
    case 'tired':
      return 'lie';
    case 'work':
    case 'eat':
    case 'slack':
    case 'overheat':
    case 'coffee':
    case 'dizzy':
    case 'music':
      return 'sit';
    case 'idle':
    case 'pat':
    case 'poke':
    case 'happy':
    case 'angry':
    case 'spin':
    case 'shock':
    case 'caught':
    case 'scared':
    case 'cry':
    case 'drowsy':
    case 'bonk':
    default:
      return 'stand';
  }
}

export const POSTURE_CROUCH_MS = 140;
export const POSTURE_HOP_MS = 200;
export const POSTURE_BRIDGE_MS = POSTURE_CROUCH_MS + POSTURE_HOP_MS;

export const POSTURE_GENTLE_TRANS_MS = 135;
export const POSTURE_GENTLE_SETTLE_MS = 145;
export const POSTURE_GENTLE_BRIDGE_MS = POSTURE_GENTLE_TRANS_MS + POSTURE_GENTLE_SETTLE_MS;

export type PostureTransitionStyle = 'energetic' | 'gentle';

export type SpriteBlendKind = 'instant' | 'smear' | 'blink' | 'step' | 'beat' | 'pose';

export const SPRITE_BLEND_MS: Record<SpriteBlendKind, number> = {
  instant: 0,
  smear: 50,
  blink: 65,
  step: 75,
  beat: 150,
  pose: 150,
};

export interface SpriteBlendFrame<TSprite = unknown> {
  active: boolean;
  progress: number;
  fromSprite: TSprite | null;
  toSprite: TSprite | null;
  alphaFrom: number;
  alphaTo: number;
  fromKey: string;
  key: string;
}

/**
 * 等功率正余弦跨帧混合器：
 * - 采用 smoothstep + cos/sin 等功率过渡（重叠区合成不透明度 >= 0.914，消除切帧闪烁与透底）
 * - 按切帧语义自动分级时长（smear 50ms，blink 65ms，4帧 step 75ms，pose/beat 150ms）
 */
export class SpriteBlender<TSprite = unknown> {
  private currentSprite: TSprite | null = null;
  private currentKey = '';
  private fromSprite: TSprite | null = null;
  private fromKey = '';
  private elapsedMs = 0;
  private durationMs = 0;
  private holdElapsedMs = Number.POSITIVE_INFINITY;

  get active(): boolean {
    return this.fromSprite !== null && this.durationMs > 0 && this.elapsedMs < this.durationMs;
  }

  get key(): string {
    return this.currentKey;
  }

  get previousKey(): string {
    return this.fromKey;
  }

  get holdMs(): number {
    return this.holdElapsedMs;
  }

  reset(): void {
    this.currentSprite = null;
    this.currentKey = '';
    this.fromSprite = null;
    this.fromKey = '';
    this.elapsedMs = 0;
    this.durationMs = 0;
    this.holdElapsedMs = Number.POSITIVE_INFINITY;
  }

  sync(
    nextSprite: TSprite | null,
    nextKey: string,
    kind: SpriteBlendKind = 'pose',
    minHoldMs = 0,
  ): boolean {
    if (nextSprite === null) {
      if (this.currentSprite === null) {
        this.currentKey = nextKey;
      }
      return false;
    }

    if (this.currentSprite === null || kind === 'instant') {
      this.currentSprite = nextSprite;
      this.currentKey = nextKey;
      this.fromSprite = null;
      this.fromKey = '';
      this.elapsedMs = 0;
      this.durationMs = 0;
      this.holdElapsedMs = 0;
      return true;
    }

    if (nextKey !== this.currentKey || nextSprite !== this.currentSprite) {
      if (minHoldMs > 0 && this.holdElapsedMs < minHoldMs) {
        return false;
      }
      this.fromSprite = this.currentSprite;
      this.fromKey = this.currentKey;
      this.currentSprite = nextSprite;
      this.currentKey = nextKey;
      this.durationMs = SPRITE_BLEND_MS[kind];
      this.elapsedMs = 0;
      this.holdElapsedMs = 0;
      return true;
    }

    return false;
  }

  step(dtMs: number): SpriteBlendFrame<TSprite> {
    const safeDt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    this.elapsedMs += safeDt;
    if (this.currentSprite !== null) {
      this.holdElapsedMs += safeDt;
    }

    if (!this.fromSprite || this.durationMs <= 0 || this.elapsedMs >= this.durationMs) {
      this.fromSprite = null;
      this.fromKey = '';
      this.durationMs = 0;
      this.elapsedMs = 0;
      return {
        active: false,
        progress: 1,
        fromSprite: null,
        toSprite: this.currentSprite,
        alphaFrom: 0,
        alphaTo: 1,
        fromKey: '',
        key: this.currentKey,
      };
    }

    const raw = clamp(this.elapsedMs / this.durationMs, 0, 1);
    const u = raw * raw * (3 - 2 * raw);
    const angle = u * Math.PI * 0.5;
    return {
      active: true,
      progress: u,
      fromSprite: this.fromSprite,
      toSprite: this.currentSprite,
      alphaFrom: Math.cos(angle),
      alphaTo: Math.sin(angle),
      fromKey: this.fromKey,
      key: this.currentKey,
    };
  }
}

export interface PostureBridgeFrame<TSprite = unknown> {
  active: boolean;
  style: PostureTransitionStyle;
  useCrouch: boolean;
  useSitTrans: boolean;
  hopOffsetY: number;
  softSquash: number;
  ghostAlpha: number;
  ghostSprite: TSprite | null;
  justLanded: boolean;
}

/**
 * 双档姿态族切换与落地缓冲桥：
 * - energetic（340ms）：前 140ms 蓄力微蹲（useCrouch）+ 后 200ms 抛物线小跳 + 落地果冻脉冲
 * - gentle（280ms）：绝不闪现紧张微蹲（useCrouch 恒为 false），前 135ms 可用 sit_trans 优雅过渡 + 柔缓挤压缓冲
 */
export class PostureBridge<TSprite = unknown> {
  currentPosture: PostureFamily = 'stand';
  private transitionStyle: PostureTransitionStyle = 'energetic';
  private _active = false;
  private elapsedMs = 0;

  constructor(private readonly hopH = 4.2) {}

  get active(): boolean {
    return this._active;
  }

  get style(): PostureTransitionStyle {
    return this.transitionStyle;
  }

  reset(posture: PostureFamily = 'stand'): void {
    this.currentPosture = posture;
    this.transitionStyle = 'energetic';
    this._active = false;
    this.elapsedMs = 0;
  }

  sync(
    nextPosture: PostureFamily,
    _prevSprite: TSprite | null = null,
    force = false,
    style: PostureTransitionStyle = 'energetic',
  ): boolean {
    if (nextPosture === 'air') {
      this.reset('air');
      return false;
    }
    if (!force && nextPosture === this.currentPosture) {
      return false;
    }
    this.currentPosture = nextPosture;
    this.transitionStyle = style;
    this._active = true;
    this.elapsedMs = 0;
    return true;
  }

  step(dtMs: number): PostureBridgeFrame<TSprite> {
    if (!this._active) {
      return {
        active: false,
        style: this.transitionStyle,
        useCrouch: false,
        useSitTrans: false,
        hopOffsetY: 0,
        softSquash: 0,
        ghostAlpha: 0,
        ghostSprite: null,
        justLanded: false,
      };
    }

    const safeDt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    this.elapsedMs += safeDt;

    if (this.transitionStyle === 'gentle') {
      if (this.elapsedMs >= POSTURE_GENTLE_BRIDGE_MS) {
        this._active = false;
        this.elapsedMs = 0;
        return {
          active: false,
          style: 'gentle',
          useCrouch: false,
          useSitTrans: false,
          hopOffsetY: 0,
          softSquash: 0,
          ghostAlpha: 0,
          ghostSprite: null,
          justLanded: true,
        };
      }

      const u = clamp(this.elapsedMs / POSTURE_GENTLE_BRIDGE_MS, 0, 1);
      const softSquash = 0.055 * Math.sin(Math.PI * u);
      return {
        active: true,
        style: 'gentle',
        useCrouch: false,
        useSitTrans: this.elapsedMs < POSTURE_GENTLE_TRANS_MS,
        hopOffsetY: 0,
        softSquash,
        ghostAlpha: 0,
        ghostSprite: null,
        justLanded: false,
      };
    }

    if (this.elapsedMs >= POSTURE_BRIDGE_MS) {
      this._active = false;
      this.elapsedMs = 0;
      return {
        active: false,
        style: 'energetic',
        useCrouch: false,
        useSitTrans: false,
        hopOffsetY: 0,
        softSquash: 0,
        ghostAlpha: 0,
        ghostSprite: null,
        justLanded: true,
      };
    }

    if (this.elapsedMs < POSTURE_CROUCH_MS) {
      return {
        active: true,
        style: 'energetic',
        useCrouch: true,
        useSitTrans: false,
        hopOffsetY: 0,
        softSquash: 0,
        ghostAlpha: 0,
        ghostSprite: null,
        justLanded: false,
      };
    }

    const u = clamp((this.elapsedMs - POSTURE_CROUCH_MS) / POSTURE_HOP_MS, 0, 1);
    const hopOffsetY = -this.hopH * 4 * u * (1 - u);
    return {
      active: true,
      style: 'energetic',
      useCrouch: false,
      useSitTrans: false,
      hopOffsetY,
      softSquash: 0,
      ghostAlpha: 0,
      ghostSprite: null,
      justLanded: false,
    };
  }

  update(
    dtMs: number,
    nextPosture: PostureFamily,
    prevSprite: TSprite | null = null,
    force = false,
    style: PostureTransitionStyle = 'energetic',
  ): PostureBridgeFrame<TSprite> {
    this.sync(nextPosture, prevSprite, force, style);
    return this.step(dtMs);
  }
}

export interface StrideOutput {
  frameA: boolean;
  frameIndex: 0 | 1 | 2 | 3;
  hopY: number;
  leanRad: number;
  footPlanted: boolean;
  justStepped: boolean;
}

/** 步频时钟：按真实移动像素速率推进 4 帧步态相位（步频封顶 <= 3.8 步/秒，余弦拱形消除落地点尖刺） */
export class StrideClock {
  private theta = 0;

  constructor(
    private readonly stridePx = 22,
    private readonly hopAmp = 2.4,
  ) {}

  reset(): void {
    this.theta = 0;
  }

  update(dtSec: number, speedPx: number, dir?: -1 | 0 | 1): StrideOutput {
    const absSpeed = Number.isFinite(speedPx) ? Math.abs(speedPx) : 0;
    const moveDir: -1 | 0 | 1 =
      dir !== undefined ? dir : absSpeed <= 0.01 ? 0 : speedPx >= 0 ? 1 : -1;
    const safeDt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;

    if (absSpeed <= 0.01 || safeDt <= 0) {
      const stepIndex = Math.floor(this.theta / Math.PI);
      const frameIndex = (((Math.floor((this.theta / Math.PI) * 2) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
      return {
        frameA: stepIndex % 2 === 0,
        frameIndex,
        hopY: 0,
        leanRad: 0,
        footPlanted: true,
        justStepped: false,
      };
    }

    const prevIndex = Math.floor(this.theta / Math.PI);
    const maxRadPerSec = 3.8 * Math.PI;
    const radPerSec = Math.min(maxRadPerSec, (absSpeed / Math.max(1, this.stridePx)) * Math.PI);
    const dTheta = radPerSec * safeDt;
    this.theta += dTheta;
    const nextIndex = Math.floor(this.theta / Math.PI);

    const justStepped = nextIndex > prevIndex;
    const frameA = nextIndex % 2 === 0;
    const frameIndex = (((Math.floor((this.theta / Math.PI) * 2) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    const hopPhase = 0.5 * (1 - Math.cos(2 * this.theta));
    const hopY = -hopPhase * this.hopAmp;
    const footPlanted = hopPhase < 0.08 || justStepped;
    const leanRad = Math.min(0.065, absSpeed * 0.00085) * moveDir + Math.cos(this.theta) * 0.01;

    return {
      frameA,
      frameIndex,
      hopY,
      leanRad,
      footPlanted,
      justStepped,
    };
  }
}

/** 狂摇检测器：1400ms 滑动窗口内统计 |dx| >= 3.5 的方向反转次数，>= 5 次触发眩晕 */
export class ShakeDetector {
  private readonly reversals: number[] = [];
  private lastDir: -1 | 0 | 1 = 0;
  private lastDirAt = Number.NEGATIVE_INFINITY;
  private dizzy = false;

  constructor(
    private readonly windowMs = 1400,
    private readonly minDx = 3.5,
    private readonly reversalThreshold = 5,
  ) {}

  get isDizzy(): boolean {
    return this.dizzy;
  }

  reset(): void {
    this.reversals.length = 0;
    this.lastDir = 0;
    this.lastDirAt = Number.NEGATIVE_INFINITY;
    this.dizzy = false;
  }

  feed(dx: number, now: number): boolean {
    if (!Number.isFinite(dx) || !Number.isFinite(now)) return this.dizzy;

    this.prune(now);

    if (Math.abs(dx) < this.minDx) {
      return this.dizzy;
    }

    const dir: 1 | -1 = dx > 0 ? 1 : -1;
    if (this.lastDir !== 0 && now - this.lastDirAt > this.windowMs) {
      this.lastDir = 0;
    }

    if (this.lastDir !== 0 && dir !== this.lastDir) {
      this.reversals.push(now);
      if (this.reversals.length >= this.reversalThreshold) {
        this.dizzy = true;
      }
    }

    this.lastDir = dir;
    this.lastDirAt = now;
    return this.dizzy;
  }

  consumeDizzy(): boolean {
    const triggered = this.dizzy;
    this.reset();
    return triggered;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.reversals.length > 0 && this.reversals[0] < cutoff) {
      this.reversals.shift();
    }
  }
}
