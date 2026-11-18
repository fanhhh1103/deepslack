import { describe, expect, it } from 'vitest';
import {
  moodToPosture,
  organicBreath,
  POSTURE_BRIDGE_MS,
  POSTURE_CROUCH_MS,
  POSTURE_HOP_MS,
  PostureBridge,
  SecondOrderSpring,
  ShakeDetector,
  SPRITE_BLEND_MS,
  SpriteBlender,
  StrideClock,
  volumePreservingScale,
} from './petMotion';

describe('SecondOrderSpring', () => {
  it('converges smoothly, exhibits underdamped overshoot and negative-r anticipation, and stays stable under large dt', () => {
    const spring = new SecondOrderSpring(2.6, 0.36, -0.45, 0);
    // 细步长 (dt = 4ms < |k3|) 下可清晰观察 r = -0.45 的反向预备蓄力，以及 z = 0.36 欠阻尼过冲
    let peak = Number.NEGATIVE_INFINITY;
    let minVal = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 400; i++) {
      const val = spring.update(0.004, 10);
      peak = Math.max(peak, val);
      minVal = Math.min(minVal, val);
    }
    expect(minVal).toBeLessThan(0); // r = -0.45 反向蓄力
    expect(peak).toBeGreaterThan(10); // z = 0.36 欠阻尼回弹过冲
    expect(spring.isSettled(0.05, 0.2)).toBe(true);

    // impulse & snap
    spring.impulse(5);
    expect(spring.isSettled(0.01, 0.01)).toBe(false);
    spring.snap(3);
    expect(spring.y).toBe(3);
    expect(spring.yd).toBe(0);
    expect(spring.isSettled()).toBe(true);

    // 大 dt (100ms) 下 k2Stable 钳制不能发散爆炸
    const highFreq = new SecondOrderSpring(5.2, 0.68, 0.4, 1);
    for (let i = 0; i < 40; i++) {
      const v = highFreq.update(0.1, -1);
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(5);
    }
    expect(Math.abs(highFreq.y - -1)).toBeLessThan(0.01);
  });
});

describe('volumePreservingScale & organicBreath', () => {
  it('preserves volume in normal range and clamps extreme squash values', () => {
    const neutral = volumePreservingScale(0, 0);
    expect(neutral.scaleX).toBeCloseTo(1, 5);
    expect(neutral.scaleY).toBeCloseTo(1, 5);

    const squashed = volumePreservingScale(0.18, 0);
    expect(squashed.scaleY).toBeCloseTo(0.82, 5);
    expect(squashed.scaleX).toBeCloseTo(1 / Math.sqrt(0.82), 5);
    expect(squashed.scaleX * squashed.scaleX * squashed.scaleY).toBeCloseTo(1, 4);

    const minClamp = volumePreservingScale(1.5, 0);
    expect(minClamp.scaleY).toBe(0.7);
    expect(minClamp.scaleX).toBeCloseTo(1 / Math.sqrt(0.7), 5);

    const maxClamp = volumePreservingScale(-1.5, 0);
    expect(maxClamp.scaleY).toBe(1.32);
    expect(maxClamp.scaleX).toBeCloseTo(1 / Math.sqrt(1.32), 5);
  });

  it('produces asymmetric dual-harmonic breathing curve within [-1, 1]', () => {
    const samples: number[] = [];
    for (let i = 0; i < 64; i++) {
      const p = (i / 64) * Math.PI * 2;
      const v = organicBreath(p);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      samples.push(v);
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.7);
    expect(Math.min(...samples)).toBeLessThan(-0.7);
    expect(organicBreath(0)).toBeCloseTo(0.22 * Math.sin(-0.55), 5);
  });
});

describe('PostureBridge & moodToPosture', () => {
  it('maps moods to posture families and runs 140ms crouch + 200ms smooth hop + landing pulse', () => {
    expect(moodToPosture('idle')).toBe('stand');
    expect(moodToPosture('drowsy')).toBe('stand');
    expect(moodToPosture('bonk')).toBe('stand');
    expect(moodToPosture('work')).toBe('sit');
    expect(moodToPosture('music')).toBe('sit');
    expect(moodToPosture('dizzy')).toBe('sit');
    expect(moodToPosture('sleep')).toBe('lie');
    expect(moodToPosture('tired')).toBe('lie');
    expect(moodToPosture('dangle')).toBe('air');

    expect(POSTURE_CROUCH_MS).toBe(140);
    expect(POSTURE_HOP_MS).toBe(200);
    expect(POSTURE_BRIDGE_MS).toBe(340);

    const defaultBridge = new PostureBridge<string>();
    defaultBridge.sync('lie', 'idle_img');
    defaultBridge.step(POSTURE_CROUCH_MS + POSTURE_HOP_MS * 0.5);
    expect(defaultBridge.step(0).hopOffsetY).toBeCloseTo(-4.2, 4);

    const bridge = new PostureBridge<string>(10);
    expect(bridge.currentPosture).toBe('stand');

    // 进入空气姿态立即生效，无微蹲延迟
    expect(bridge.sync('air', 'idle_img')).toBe(false);
    expect(bridge.active).toBe(false);
    expect(bridge.currentPosture).toBe('air');

    // 落地切回 stand 触发 340ms 过渡
    expect(bridge.sync('stand', 'dangle_img')).toBe(true);
    expect(bridge.active).toBe(true);

    // 前 140ms：预备微蹲
    const f1 = bridge.step(80);
    expect(f1.active).toBe(true);
    expect(f1.useCrouch).toBe(true);
    expect(f1.hopOffsetY).toBe(0);
    expect(f1.ghostAlpha).toBe(0);
    expect(f1.justLanded).toBe(false);

    // 越过 140ms 进入 200ms 抛物线小跳（u = 0.5 时跳高 -10，残影交由 SpriteBlender 故为 0）
    const fMid = bridge.step(POSTURE_CROUCH_MS - 80 + POSTURE_HOP_MS * 0.5);
    expect(fMid.active).toBe(true);
    expect(fMid.useCrouch).toBe(false);
    expect(fMid.hopOffsetY).toBeCloseTo(-10, 4);
    expect(fMid.ghostAlpha).toBe(0);
    expect(fMid.ghostSprite).toBeNull();
    expect(fMid.justLanded).toBe(false);

    // 满 340ms 结束，触发落地脉冲
    const fEnd = bridge.step(POSTURE_BRIDGE_MS - (POSTURE_CROUCH_MS + POSTURE_HOP_MS * 0.5) + 1);
    expect(fEnd.active).toBe(false);
    expect(fEnd.useCrouch).toBe(false);
    expect(fEnd.hopOffsetY).toBe(0);
    expect(fEnd.ghostAlpha).toBe(0);
    expect(fEnd.justLanded).toBe(true);
  });
});

describe('SpriteBlender', () => {
  it('snaps on first non-null sprite, cross-fades with equal-power opacity >= 0.914, and settles cleanly', () => {
    const blender = new SpriteBlender<string>();
    blender.sync('img_idle', 'dafeiyu', 'pose');
    const initial = blender.step(16);
    expect(initial.active).toBe(false);
    expect(initial.toSprite).toBe('img_idle');
    expect(initial.alphaTo).toBe(1);

    // 切到 sleep 姿态，触发 140ms pose 混合
    blender.sync('img_sleep', 'dafeiyu_sleep', 'pose');
    expect(blender.active).toBe(true);
    const f1 = blender.step(16.67);
    expect(f1.active).toBe(true);
    expect(f1.fromSprite).toBe('img_idle');
    expect(f1.toSprite).toBe('img_sleep');
    expect(f1.alphaFrom).toBeGreaterThan(0.85);
    expect(f1.alphaTo).toBeLessThan(0.45);
    const compositeOpacity = 1 - (1 - f1.alphaFrom) * (1 - f1.alphaTo);
    expect(compositeOpacity).toBeGreaterThanOrEqual(0.914);

    // 推至中点：cos^2 + sin^2 = 1（等功率）
    const fHalf = blender.step(SPRITE_BLEND_MS.pose * 0.5 - 16.67);
    expect(fHalf.active).toBe(true);
    expect(fHalf.alphaFrom ** 2 + fHalf.alphaTo ** 2).toBeCloseTo(1, 5);
    expect(1 - (1 - fHalf.alphaFrom) * (1 - fHalf.alphaTo)).toBeGreaterThanOrEqual(0.914);

    // beat 过渡时长（160ms）
    const fEnd = blender.step(SPRITE_BLEND_MS.pose);
    expect(fEnd.active).toBe(false);
    expect(fEnd.alphaFrom).toBe(0);
    expect(fEnd.alphaTo).toBe(1);

    blender.sync('img_music_a', 'dafeiyu_music_a', 'beat');
    const beatHalf = blender.step(SPRITE_BLEND_MS.beat * 0.5);
    expect(beatHalf.active).toBe(true);
    expect(beatHalf.progress).toBeCloseTo(0.5, 4);

    blender.reset();
    expect(blender.key).toBe('');
  });
});

describe('StrideClock', () => {
  it('advances step phase proportionally to real speed, uses smooth cosine hop, caps cadence <= 3.8 steps/s', () => {
    const clock = new StrideClock(10, 3);
    const rest = clock.update(0.05, 0);
    expect(rest.hopY).toBe(0);
    expect(rest.footPlanted).toBe(true);
    expect(rest.justStepped).toBe(false);

    // 10px/step 下 35px/s = 3.5 steps/s（低于 3.8 封顶）：走 0.14286s ≈ 0.5 * PI（半步余弦顶点）
    const halfStepDt = 5 / 35;
    const mid = clock.update(halfStepDt, 35, 1);
    expect(mid.frameA).toBe(true);
    expect(mid.hopY).toBeCloseTo(-3, 4);
    expect(mid.leanRad).toBeGreaterThan(0);
    expect(mid.justStepped).toBe(false);

    // 再走半步 → 累计 PI，完成一脚落地并切到 frameB
    const step1 = clock.update(halfStepDt, 35, 1);
    expect(step1.justStepped).toBe(true);
    expect(step1.frameA).toBe(false);
    expect(step1.footPlanted).toBe(true);

    // 落地瞬时前一帧与后一帧跳高导数平滑接近 0（cos(2*theta) 拱形）
    const afterLand = clock.update(0.005, 35, 1);
    expect(Math.abs(afterLand.hopY - step1.hopY)).toBeLessThan(0.05);

    // 向左走 leanRad 倾角为负（先推进到正交相位测纯移动倾向）
    const leftClock = new StrideClock(22, 2.4);
    leftClock.update(0.14, 30, -1);
    const leftStep = leftClock.update(0.14, 30, -1);
    expect(leftStep.leanRad).toBeLessThan(0);

    // 高速狂飙（400 px/s）步频硬封顶在 <= 3.8 steps/s
    const fastClock = new StrideClock(22, 2.4);
    let steps = 0;
    for (let i = 0; i < 60; i++) {
      if (fastClock.update(1 / 60, 400, 1).justStepped) steps++;
    }
    expect(steps).toBeLessThanOrEqual(4); // 3.8 steps/s in 1s -> max 3 or 4 boundaries
  });
});

describe('ShakeDetector', () => {
  it('ignores tiny jitter, counts direction reversals within 1400ms window, and consumes dizzy once', () => {
    const det = new ShakeDetector(1400, 3.5, 5);
    expect(det.feed(10, 0)).toBe(false);
    expect(det.feed(-2.0, 50)).toBe(false); // 低于 3.5px 忽略
    expect(det.feed(-5, 100)).toBe(false); // #1
    expect(det.feed(6, 200)).toBe(false); // #2
    expect(det.feed(-6, 300)).toBe(false); // #3
    expect(det.feed(7, 400)).toBe(false); // #4
    expect(det.isDizzy).toBe(false);
    expect(det.feed(-8, 500)).toBe(true); // #5 命中
    expect(det.isDizzy).toBe(true);
    expect(det.consumeDizzy()).toBe(true);
    expect(det.isDizzy).toBe(false);
    expect(det.consumeDizzy()).toBe(false);

    // 超过 1400ms 滑动窗口的反转不累计
    det.feed(8, 0);
    det.feed(-8, 100); // #1
    det.feed(8, 200); // #2
    det.feed(-8, 300); // #3
    // 隔 1500ms 之后再反向 2 次，窗口内只有 2 次，不应触发眩晕
    det.feed(8, 1800);
    det.feed(-8, 1900);
    det.feed(8, 2000);
    expect(det.isDizzy).toBe(false);
    expect(det.consumeDizzy()).toBe(false);
  });
});
