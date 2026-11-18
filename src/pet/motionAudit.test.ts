import { describe, expect, it } from 'vitest';
import { mountPet, type PetController, type PetMotionTelemetry } from './petRenderer';
import { analyzeMotionTrack, type MotionAuditRules } from './motionAudit';

function createAuditCanvasHarness() {
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const noop = () => {};
  const makeCtx = () =>
    ({
      save: noop,
      restore: noop,
      clearRect: noop,
      beginPath: noop,
      closePath: noop,
      ellipse: noop,
      arc: noop,
      moveTo: noop,
      lineTo: noop,
      quadraticCurveTo: noop,
      bezierCurveTo: noop,
      arcTo: noop,
      fill: noop,
      stroke: noop,
      clip: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      fillRect: noop,
      strokeRect: noop,
      drawImage: noop,
      setTransform: noop,
      measureText: (t: string) => ({ width: t.length * 7 }),
      fillText: noop,
      strokeText: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    }) as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 256,
    height: 234,
    clientWidth: 256,
    clientHeight: 234,
    getContext: () => makeCtx(),
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener: (type: string, cb: (ev: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((fn) => fn !== cb);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 234, right: 256, bottom: 234 }),
  } as unknown as HTMLCanvasElement;

  const origDocument = globalThis.document;
  const origRaf = globalThis.requestAnimationFrame;
  const origCancelRaf = globalThis.cancelAnimationFrame;
  const origImage = globalThis.Image;
  const origPerfNow = performance.now.bind(performance);

  let simNow = 20_000;
  let rafCb: FrameRequestCallback | null = null;
  performance.now = () => simNow;

  class SizedAuditImage {
    private _src = '';
    naturalWidth = 400;
    naturalHeight = 712;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    get src(): string {
      return this._src;
    }
    set src(val: string) {
      this._src = val;
      if (val.endsWith('_sleep.png')) {
        this.naturalWidth = 520;
        this.naturalHeight = 356;
      }
      queueMicrotask(() => this.onload?.());
    }
  }

  globalThis.document = {
    hidden: false,
    createElement: () => ({ width: 256, height: 234, getContext: () => makeCtx() }),
    querySelector: () => null,
  } as unknown as Document;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = noop as typeof cancelAnimationFrame;
  globalThis.Image = SizedAuditImage as unknown as typeof Image;

  const stepFrame = (dtMs = 1000 / 60): void => {
    simNow += dtMs;
    rafCb?.(simNow);
  };

  const sampleFor = (
    pet: PetController,
    totalMs: number,
    onFrame?: (elapsedMs: number, frameIdx: number) => void,
    dtMs = 1000 / 60,
  ): PetMotionTelemetry[] => {
    const out: PetMotionTelemetry[] = [];
    const frames = Math.round(totalMs / dtMs);
    for (let i = 0; i < frames; i++) {
      onFrame?.(i * dtMs, i);
      stepFrame(dtMs);
      out.push(pet.getMotionSnapshot());
    }
    return out;
  };

  const restore = () => {
    performance.now = origPerfNow;
    globalThis.document = origDocument;
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancelRaf;
    globalThis.Image = origImage;
  };

  return { canvas, listeners, stepFrame, sampleFor, restore, getNow: () => simNow };
}

function assertTrackPasses(
  name: string,
  samples: PetMotionTelemetry[],
  rules: Partial<MotionAuditRules> = {},
): void {
  const report = analyzeMotionTrack(name, samples, rules);
  expect(report.violations, `${name} violations: ${report.violations.join('; ')}`).toEqual([]);
  expect(report.passed).toBe(true);
}

describe('Motion Self-Audit Level 1 (60FPS deterministic kinematics & blend continuity)', () => {
  it('passes all 10 motion sequences with zero unblended hard cuts, zero teleports, and smooth frequencies', async () => {
    const h = createAuditCanvasHarness();
    const origRandom = Math.random;
    Math.random = () => 0.72; // 固定随机偏移确保跨机器确定性

    try {
      const pet = await mountPet(h.canvas, './assets');
      await new Promise<void>((r) => globalThis.setTimeout(r, 0));

      // 首帧稳定建立基线
      for (let i = 0; i < 6; i++) h.stepFrame();

      // 1. 待机呼吸 + 自然眨眼
      const s1 = h.sampleFor(pet, 4200);
      assertTrackPasses('01_idle_breath_blink', s1, {
        maxOscillationHz: 0.75,
        maxSpriteSwapsPerSec: 1.5,
      });

      // 2. 站姿经 PostureBridge 入睡 + 慢呼吸
      pet.triggerAction('sleep');
      const s2 = h.sampleFor(pet, 2800);
      assertTrackPasses('02_sleep_transition_and_breath', s2, {
        maxOscillationHz: 0.45,
        maxSpriteSwapsPerSec: 1.6,
      });

      // 3. 点击唤醒 850ms 伸懒腰回待机
      h.listeners.click?.forEach((fn) => fn({ clientX: 128, clientY: 175 }));
      const s3 = h.sampleFor(pet, 2200);
      assertTrackPasses('03_wake_stretch_to_idle', s3, {
        maxSpriteSwapsPerSec: 2.5,
      });

      // 4. 走路 + 2.5D 转身 + 边缘探头
      pet.setLocomotion(-1, false, 1);
      const s4 = h.sampleFor(pet, 3000, (elapsedMs) => {
        if (Math.abs(elapsedMs - 1100) < 9) pet.setLocomotion(1, false, 1);
        if (Math.abs(elapsedMs - 2100) < 9) pet.setLocomotion(1, true, 0);
        if (Math.abs(elapsedMs - 2800) < 9) pet.setLocomotion(0);
      });
      assertTrackPasses('04_walk_turn_and_peek', s4, {
        maxSpriteSwapsPerSec: 4.5,
        maxTiltStepDeg: 2.5,
      });

      // 先稳定几个帧回 idle
      h.sampleFor(pet, 700);

      // 5. 空投米饭 -> scootSpring 横移接住 -> 干饭咀嚼
      expect(pet.dropItem('rice', 'toy')).toBe(true);
      const s5 = h.sampleFor(pet, 3400);
      assertTrackPasses('05_rice_scoot_catch_eat', s5, {
        maxSpriteSwapsPerSec: 3.5,
        maxOscillationHz: 1.65,
      });

      h.sampleFor(pet, 800);

      // 6. 空投冰美式 -> 1.38x 加速期内走路 + 听歌仍保平滑不抽搐
      expect(pet.dropItem('coffee', 'toy')).toBe(true);
      const s6 = h.sampleFor(pet, 3400, (elapsedMs) => {
        if (Math.abs(elapsedMs - 2450) < 9) pet.triggerAction('music');
      });
      assertTrackPasses('06_coffee_boost_smoothness', s6, {
        maxSpriteSwapsPerSec: 3.5,
        maxOscillationHz: 2.35,
      });
      pet.setMood('idle');
      h.sampleFor(pet, 800);

      // 7. 空投 Bug -> 受惊 -> 冲刺接近 -> 蓄力举锤 -> 暴砸击飞
      expect(pet.dropItem('bug', 'toy')).toBe(true);
      const s7 = h.sampleFor(pet, 3800);
      assertTrackPasses('07_bug_scared_approach_bonk', s7, {
        maxSpriteSwapsPerSec: 4.2,
      });
      h.sampleFor(pet, 600);

      // 8. 戴鲸鱼耳机慢摇听歌
      pet.triggerAction('music');
      const s8 = h.sampleFor(pet, 2600);
      assertTrackPasses('08_music_sway', s8, {
        maxOscillationHz: 1.65,
        maxSpriteSwapsPerSec: 2.6,
      });
      pet.setMood('idle');
      h.sampleFor(pet, 600);

      // 9. 头部抚摸 + 鼠标指针移动跟随
      const s9 = h.sampleFor(pet, 2200, (elapsedMs) => {
        const sweepX = 110 + Math.sin(elapsedMs * 0.005) * 28;
        h.listeners.pointermove?.forEach((fn) =>
          fn({ clientX: sweepX, clientY: 96, buttons: 0 }),
        );
      });
      assertTrackPasses('09_pat_hand_follow', s9, {
        maxOscillationHz: 1.65,
        maxSpriteSwapsPerSec: 2.5,
        maxTiltStepDeg: 2.2,
      });
      h.listeners.pointerleave?.forEach((fn) => fn({}));
      h.sampleFor(pet, 600);

      // 10. 领子拎起狂摇 -> 松手重力下落 -> 眩晕
      pet.startDrag();
      const s10 = h.sampleFor(pet, 3000, (elapsedMs) => {
        const idx = Math.round(elapsedMs / (1000 / 60));
        if (idx >= 3 && idx <= 24 && idx % 3 === 0) {
          pet.feedDragDelta(idx % 6 === 0 ? 15 : -15, 0);
        }
        if (idx === 28) pet.endDrag();
      });
      assertTrackPasses('10_drag_shake_drop_dizzy', s10, {
        allowGravityDrop: true,
        maxTiltStepDeg: 8.5,
        maxSpriteSwapsPerSec: 3.0,
      });

      pet.destroy();
    } finally {
      Math.random = origRandom;
      h.restore();
    }
  });
});
