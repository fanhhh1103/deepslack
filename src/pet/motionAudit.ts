// MIT License - 桌宠运动学 60FPS 平滑度自审门禁分析器（无 DOM 依赖）

import type { PetMotionTelemetry } from './petRenderer';

export interface MotionAuditRules {
  /** 相邻帧中心 X 最大允许位移（px/frame，默认 4.5） */
  maxCenterStepPx: number;
  /** 相邻帧底部基准 Y 最大允许位移（px/frame，默认 4.5；自由落体开启 allowGravityDrop 后放宽到 16） */
  maxFootStepPx: number;
  /** 是否允许碰撞落地级别的重力竖直位移 */
  allowGravityDrop: boolean;
  /** 相邻帧体积缩放增量上限（max(|ΔscaleX|, |ΔscaleY|)，默认 0.038） */
  maxScaleStep: number;
  /** 相邻帧倾角增量上限（deg/frame，默认 2.2；狂摇拖拽可放宽到 8.5） */
  maxTiltStepDeg: number;
  /** 允许的最大贴图切换速率（次/秒，默认 7.5） */
  maxSpriteSwapsPerSec: number;
  /** 竖直弹跳 / 呼吸缩放振荡频率上限（Hz，可选） */
  maxOscillationHz?: number;
  /** 单贴图最短持续时间（ms，低于则判为过快闪切；默认 45ms） */
  minPoseHoldMs: number;
}

export interface MotionAuditMetrics {
  sampleCount: number;
  drawnFrames: number;
  durationSec: number;
  maxCenterStepPx: number;
  maxFootStepPx: number;
  maxScaleStep: number;
  maxTiltStepDeg: number;
  spriteSwaps: number;
  spriteSwapsPerSec: number;
  unblendedSwaps: number;
  minPoseHoldMsObserved: number;
  oscillationHz: number;
  hopOscillationHz: number;
  scaleOscillationHz: number;
}

export interface MotionAuditReport {
  name: string;
  passed: boolean;
  rules: MotionAuditRules;
  metrics: MotionAuditMetrics;
  violations: string[];
}

const DEFAULT_RULES: MotionAuditRules = {
  maxCenterStepPx: 4.5,
  maxFootStepPx: 4.5,
  allowGravityDrop: false,
  maxScaleStep: 0.038,
  maxTiltStepDeg: 2.2,
  maxSpriteSwapsPerSec: 7.5,
  minPoseHoldMs: 45,
};

function computeCrossingHz(values: number[], durationSec: number, minRange: number): number {
  if (values.length < 4 || durationSec <= 0.05) return 0;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const v of values) {
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    sum += v;
  }
  const range = maxV - minV;
  if (range < minRange) return 0;

  const mean = sum / values.length;
  const eps = range * 0.08;
  let state: -1 | 0 | 1 = 0;
  let risingCrossings = 0;

  for (const v of values) {
    const centered = v - mean;
    if (centered > eps) {
      if (state === -1) risingCrossings++;
      state = 1;
    } else if (centered < -eps) {
      state = -1;
    }
  }

  // Fallback for fast single-sided oscillations where upward strokes never drop below -eps cleanly
  if (risingCrossings === 0) {
    let prevSign = 0;
    let flips = 0;
    for (const v of values) {
      const c = v - mean;
      const sign = c > eps ? 1 : c < -eps ? -1 : prevSign;
      if (prevSign !== 0 && sign !== prevSign) flips++;
      if (sign !== 0) prevSign = sign;
    }
    return (flips * 0.5) / durationSec;
  }

  return risingCrossings / durationSec;
}

export function analyzeMotionTrack(
  name: string,
  samples: readonly PetMotionTelemetry[],
  overrides: Partial<MotionAuditRules> = {},
): MotionAuditReport {
  const effectiveFootCap =
    overrides.maxFootStepPx ?? (overrides.allowGravityDrop ? 16 : DEFAULT_RULES.maxFootStepPx);
  const rules: MotionAuditRules = {
    ...DEFAULT_RULES,
    ...overrides,
    maxFootStepPx: effectiveFootCap,
  };

  if (samples.length < 2) {
    return {
      name,
      passed: false,
      rules,
      metrics: {
        sampleCount: samples.length,
        drawnFrames: samples.filter((s) => s.frameDrawn).length,
        durationSec: 0,
        maxCenterStepPx: 0,
        maxFootStepPx: 0,
        maxScaleStep: 0,
        maxTiltStepDeg: 0,
        spriteSwaps: 0,
        spriteSwapsPerSec: 0,
        unblendedSwaps: 0,
        minPoseHoldMsObserved: Number.POSITIVE_INFINITY,
        oscillationHz: 0,
        hopOscillationHz: 0,
        scaleOscillationHz: 0,
      },
      violations: [`[${name}] 采样帧数不足（${samples.length} < 2）`],
    };
  }

  const durationSec = Math.max(
    0.001,
    (samples[samples.length - 1].nowMs - samples[0].nowMs) / 1000,
  );

  let maxCenterStepPx = 0;
  let maxFootStepPx = 0;
  let maxScaleStep = 0;
  let maxTiltStepDeg = 0;
  let spriteSwaps = 0;
  let unblendedSwaps = 0;
  let minPoseHoldMsObserved = Number.POSITIVE_INFINITY;
  let lastSwapAtMs = samples[0].nowMs;
  let drawnFrames = samples[0].frameDrawn ? 1 : 0;

  const hopSeries: number[] = [samples[0].hopY];
  const scaleSeries: number[] = [samples[0].scaleY];

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (curr.frameDrawn) drawnFrames++;

    const dx = Math.abs(curr.centerX - prev.centerX);
    const dy = Math.abs(curr.footY - prev.footY);
    const ds = Math.max(
      Math.abs(curr.scaleX - prev.scaleX),
      Math.abs(curr.scaleY - prev.scaleY),
    );
    const dtDeg = Math.abs(curr.tiltDeg - prev.tiltDeg);

    if (dx > maxCenterStepPx) maxCenterStepPx = dx;
    if (dy > maxFootStepPx) maxFootStepPx = dy;
    if (ds > maxScaleStep) maxScaleStep = ds;
    if (dtDeg > maxTiltStepDeg) maxTiltStepDeg = dtDeg;

    if (curr.spriteKey !== prev.spriteKey) {
      spriteSwaps++;
      const holdMs = curr.nowMs - lastSwapAtMs;
      if (spriteSwaps > 1 && holdMs < minPoseHoldMsObserved) {
        minPoseHoldMsObserved = holdMs;
      }
      lastSwapAtMs = curr.nowMs;

      const isSmoothBlend =
        curr.blendActive === true &&
        curr.blendAlphaTo < 0.45 &&
        curr.blendAlphaFrom > 0.85;
      if (!isSmoothBlend) {
        unblendedSwaps++;
      }
    }

    hopSeries.push(curr.hopY);
    scaleSeries.push(curr.scaleY);
  }

  if (spriteSwaps <= 1) {
    minPoseHoldMsObserved = durationSec * 1000;
  }

  const spriteSwapsPerSec = spriteSwaps / durationSec;
  const hopOscillationHz = computeCrossingHz(hopSeries, durationSec, 0.4);
  const scaleOscillationHz = computeCrossingHz(scaleSeries, durationSec, 0.005);
  const oscillationHz = Math.max(hopOscillationHz, scaleOscillationHz);

  const violations: string[] = [];
  if (maxCenterStepPx > rules.maxCenterStepPx) {
    violations.push(
      `centerX 单帧最大跳变 ${maxCenterStepPx.toFixed(2)}px > 上限 ${rules.maxCenterStepPx}px`,
    );
  }
  if (maxFootStepPx > rules.maxFootStepPx) {
    violations.push(
      `footY 单帧最大跳变 ${maxFootStepPx.toFixed(2)}px > 上限 ${rules.maxFootStepPx}px`,
    );
  }
  if (maxScaleStep > rules.maxScaleStep) {
    violations.push(
      `scale 单帧最大增量 ${maxScaleStep.toFixed(4)} > 上限 ${rules.maxScaleStep}`,
    );
  }
  if (maxTiltStepDeg > rules.maxTiltStepDeg) {
    violations.push(
      `tiltDeg 单帧最大跳变 ${maxTiltStepDeg.toFixed(2)}° > 上限 ${rules.maxTiltStepDeg}°`,
    );
  }
  if (unblendedSwaps > 0) {
    violations.push(`发现 ${unblendedSwaps} 次未经过等功率过渡的贴图硬切`);
  }
  if (spriteSwapsPerSec > rules.maxSpriteSwapsPerSec) {
    violations.push(
      `贴图切换过频 ${spriteSwapsPerSec.toFixed(2)}/s > 上限 ${rules.maxSpriteSwapsPerSec}/s`,
    );
  }
  if (
    rules.maxOscillationHz !== undefined &&
    oscillationHz > rules.maxOscillationHz
  ) {
    violations.push(
      `主振荡频率过快 ${oscillationHz.toFixed(2)}Hz > 上限 ${rules.maxOscillationHz}Hz`,
    );
  }
  if (spriteSwaps >= 2 && minPoseHoldMsObserved < rules.minPoseHoldMs) {
    violations.push(
      `最短单姿停留过短 ${minPoseHoldMsObserved.toFixed(1)}ms < 下限 ${rules.minPoseHoldMs}ms`,
    );
  }

  return {
    name,
    passed: violations.length === 0,
    rules,
    metrics: {
      sampleCount: samples.length,
      drawnFrames,
      durationSec,
      maxCenterStepPx,
      maxFootStepPx,
      maxScaleStep,
      maxTiltStepDeg,
      spriteSwaps,
      spriteSwapsPerSec,
      unblendedSwaps,
      minPoseHoldMsObserved,
      oscillationHz,
      hopOscillationHz,
      scaleOscillationHz,
    },
    violations,
  };
}
