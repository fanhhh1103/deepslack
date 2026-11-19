// MIT License - 大肥鱼摸鱼小女仆的程序化小道具（青花碗、冰美式、小 Bug、彩虹键盘光、瀑布泪）
// 全部为纯路径绘制：零 getImageData、零渐变对象、零每帧数组分配

/** 预计算 24 段彩虹色，避免每帧拼接 HSL 字符串 */
export const RAINBOW_COLORS: readonly string[] = Array.from(
  { length: 24 },
  (_, i) => `hsla(${Math.round((i / 24) * 360)}, 95%, 62%, 1)`,
);

/** 空青花碗（侧视）：中心底部为 (x, y) */
export function drawBlueWhiteBowl(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  rot = 0,
  withRice = false,
): void {
  const h = w * 0.36;
  ctx.save();
  ctx.translate(x, y);
  if (rot !== 0) ctx.rotate(rot);

  if (withRice) {
    ctx.beginPath();
    ctx.ellipse(0, -h, w * 0.44, h * 0.7, 0, Math.PI, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = '#94a3b8';
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(i * w * 0.12, -h - h * 0.32 + Math.abs(i) * h * 0.12, 1.4, 0.9, 0.4 * i, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 碗身
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h);
  ctx.quadraticCurveTo(-w * 0.46, -h * 0.05, -w * 0.18, 0);
  ctx.lineTo(w * 0.18, 0);
  ctx.quadraticCurveTo(w * 0.46, -h * 0.05, w * 0.5, -h);
  ctx.closePath();
  ctx.fillStyle = '#fbfdff';
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = '#1e3a8a';
  ctx.stroke();

  // 青花缠枝纹
  ctx.beginPath();
  ctx.moveTo(-w * 0.36, -h * 0.55);
  ctx.quadraticCurveTo(-w * 0.18, -h * 0.85, 0, -h * 0.55);
  ctx.quadraticCurveTo(w * 0.18, -h * 0.25, w * 0.36, -h * 0.55);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#2563eb';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-w * 0.18, -h * 0.62, w * 0.045, 0, Math.PI * 2);
  ctx.arc(w * 0.18, -h * 0.48, w * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = '#1d4ed8';
  ctx.fill();

  // 碗口描边 + 圈足
  ctx.beginPath();
  ctx.ellipse(0, -h, w * 0.5, h * 0.2, 0, 0, Math.PI * 2);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = '#1e3a8a';
  ctx.stroke();
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(-w * 0.16, -1.6, w * 0.32, 1.8);
  ctx.restore();
}

/** 冰美式（透明杯 + 冰块 + 吸管） */
export function drawIcedCoffee(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  if (rot !== 0) ctx.rotate(rot);
  const w = s * 0.62;
  const h = s;
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.5);
  ctx.lineTo(w * 0.5, -h * 0.5);
  ctx.lineTo(w * 0.38, h * 0.5);
  ctx.lineTo(-w * 0.38, h * 0.5);
  ctx.closePath();
  ctx.fillStyle = 'rgba(224, 242, 254, 0.9)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-w * 0.44, -h * 0.22);
  ctx.lineTo(w * 0.44, -h * 0.22);
  ctx.lineTo(w * 0.38, h * 0.5);
  ctx.lineTo(-w * 0.38, h * 0.5);
  ctx.closePath();
  ctx.fillStyle = '#7c4a2d';
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fillRect(-w * 0.26, -h * 0.16, w * 0.22, w * 0.22);
  ctx.fillRect(w * 0.02, -h * 0.04, w * 0.22, w * 0.22);
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.5);
  ctx.lineTo(w * 0.5, -h * 0.5);
  ctx.lineTo(w * 0.38, h * 0.5);
  ctx.lineTo(-w * 0.38, h * 0.5);
  ctx.closePath();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w * 0.1, -h * 0.4);
  ctx.lineTo(w * 0.3, -h * 0.82);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = '#16a34a';
  ctx.stroke();
  ctx.restore();
}

/** 小绿虫 Bug */
export function drawBug(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  if (rot !== 0) ctx.rotate(rot);
  const legSwing = Math.sin(t * 22) * s * 0.08;
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.2;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * s * 0.18, 0);
    ctx.lineTo(i * s * 0.26 - s * 0.36, s * 0.22 + (i === 0 ? legSwing : -legSwing));
    ctx.moveTo(i * s * 0.18, 0);
    ctx.lineTo(i * s * 0.26 + s * 0.36, s * 0.22 + (i === 0 ? -legSwing : legSwing));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.42, s * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#84cc16';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.3);
  ctx.lineTo(0, s * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s * 0.42, -s * 0.06, s * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.5, -s * 0.18);
  ctx.lineTo(s * 0.66, -s * 0.36);
  ctx.moveTo(s * 0.44, -s * 0.2);
  ctx.lineTo(s * 0.52, -s * 0.42);
  ctx.stroke();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(-s * 0.16, -s * 0.08, s * 0.06, 0, Math.PI * 2);
  ctx.arc(s * 0.14, s * 0.1, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 键盘彩虹光：在键盘区画一排轮转彩虹光条 */
export function drawKeyboardRainbow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  t: number,
  intensity: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bars = 8;
  const bw = w / bars;
  const base = Math.floor(t * 18);
  for (let i = 0; i < bars; i++) {
    const color = RAINBOW_COLORS[(base + i * 3) % RAINBOW_COLORS.length];
    const pulse = 0.5 + 0.5 * Math.sin(t * 14 + i * 0.9);
    ctx.globalAlpha = (0.12 + 0.2 * pulse) * intensity;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.5 + bw * (i + 0.5), cy, bw * 0.75, h * (0.7 + 0.3 * pulse), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 头顶小蒸汽团（红温） */
export function drawHeadSteam(ctx: CanvasRenderingContext2D, cx: number, topY: number, t: number, s: number): void {
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const phase = (t * 1.6 + i / 3) % 1;
    const x = cx + (i - 1) * s * 0.5 + Math.sin(t * 5 + i) * 3;
    const y = topY - phase * s * 1.4;
    const r = s * (0.22 + phase * 0.28);
    ctx.globalAlpha = 0.75 * (1 - phase);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.5)';
    ctx.stroke();
  }
  ctx.restore();
}

/** 瀑布泪：两道抛物线泪柱 */
export function drawWaterfallTears(
  ctx: CanvasRenderingContext2D,
  cx: number,
  eyeY: number,
  eyeGap: number,
  t: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (const side of [-1, 1] as const) {
    const ex = cx + side * eyeGap;
    ctx.beginPath();
    ctx.moveTo(ex, eyeY);
    ctx.quadraticCurveTo(ex + side * 26, eyeY - 6, ex + side * 34, eyeY + 46);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.setLineDash?.([5, 7]);
    ctx.lineDashOffset = -t * 60;
    ctx.stroke();
    ctx.setLineDash?.([]);
  }
  ctx.restore();
}

/** 肥皂泡 */
export function drawSoapBubble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(186, 230, 253, 0.28)';
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
}

/** 圆润白手套摸头小手 */
export function drawPattingHand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  phase: number,
  scale = 1,
): void {
  const s = Math.max(0.4, scale);
  const sweepX = Math.sin(phase) * 7 * s;
  const pressY = -Math.abs(Math.cos(phase)) * 2.4 * s;

  ctx.save();
  ctx.translate(x + sweepX, y + pressY);
  ctx.rotate(Math.sin(phase) * 0.14);
  ctx.scale(s, s);

  // 手腕袖口
  ctx.beginPath();
  ctx.ellipse(0, -14, 7.5, 4.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#e0f2fe';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  // 圆润手套手掌主体
  ctx.beginPath();
  ctx.moveTo(-10, -10);
  ctx.bezierCurveTo(-13, -3, -12, 7, -5, 9.5);
  ctx.quadraticCurveTo(0, 11.5, 6.5, 9);
  ctx.bezierCurveTo(13, 6.5, 13.5, -2.5, 9.5, -10);
  ctx.quadraticCurveTo(0, -13, -10, -10);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  // 小拇指/拇指圆包
  ctx.beginPath();
  ctx.ellipse(-10.5, 1.5, 4.2, 3.3, -0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  // 掌背轻柔高光与粉色小肉球装饰
  ctx.beginPath();
  ctx.ellipse(1.5, -3.5, 4.2, 2.2, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(251, 113, 133, 0.22)';
  ctx.fill();

  ctx.restore();
}

/** 头顶环绕眩晕小星星与蚊香圈 */
export function drawDizzyOrbit(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  rx: number,
  elapsed: number,
): void {
  const ry = Math.max(5, rx * 0.28);
  ctx.save();

  // 淡淡的椭圆轨迹环
  ctx.beginPath();
  ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.42)';
  ctx.stroke();

  for (let i = 0; i < 3; i++) {
    const ang = elapsed * 4.4 + (i * Math.PI * 2) / 3;
    const ox = cx + Math.cos(ang) * rx;
    const oy = y + Math.sin(ang) * ry;
    const depth = 0.72 + 0.28 * Math.sin(ang);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(depth, depth);
    ctx.globalAlpha = 0.65 + 0.35 * ((Math.sin(ang) + 1) * 0.5);

    if (i === 1) {
      // 蚊香圈螺旋
      ctx.beginPath();
      const turns = 2.1;
      const steps = 18;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const a = u * Math.PI * 2 * turns + elapsed * 7;
        const rad = 1.2 + u * 5.2;
        const sx = Math.cos(a) * rad;
        const sy = Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#fb7185';
      ctx.stroke();
    } else {
      // 四角眩晕小星星
      ctx.rotate(elapsed * 3.5 + i);
      ctx.beginPath();
      const outer = 6.2;
      const inner = 2.4;
      for (let p = 0; p < 8; p++) {
        const rad = p % 2 === 0 ? outer : inner;
        const pa = (p * Math.PI) / 4;
        const px = Math.cos(pa) * rad;
        const py = Math.sin(pa) * rad;
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = i === 0 ? '#facc15' : '#fde047';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

/** 落地/踏步轻柔小烟尘 */
export function drawDustPuff(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number,
): void {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  if (safeAlpha <= 0.01 || r <= 0.5) return;

  ctx.save();
  ctx.globalAlpha = safeAlpha;
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.72)';
  ctx.lineWidth = 1.1;

  ctx.beginPath();
  ctx.arc(x - r * 0.45, y + r * 0.15, r * 0.55, 0, Math.PI * 2);
  ctx.arc(x + r * 0.45, y + r * 0.18, r * 0.5, 0, Math.PI * 2);
  ctx.arc(x, y - r * 0.12, r * 0.72, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y - r * 0.12, r * 0.72, Math.PI * 0.85, Math.PI * 2.15);
  ctx.stroke();
  ctx.restore();
}

/** 蓝黄充气玩具重锤（其余角色无 bonk 贴图时的程序化大锤） */
export function drawToyHammer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rot: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  // 手柄
  ctx.beginPath();
  ctx.moveTo(-size * 0.08, 0);
  ctx.lineTo(size * 0.08, 0);
  ctx.lineTo(size * 0.06, -size * 0.95);
  ctx.lineTo(-size * 0.06, -size * 0.95);
  ctx.closePath();
  ctx.fillStyle = '#fde047';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  // 充气锤头
  ctx.beginPath();
  ctx.ellipse(0, -size * 1.08, size * 0.52, size * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.stroke();

  // 锤头两侧黄色缓冲圈
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.ellipse(-size * 0.46, -size * 1.08, size * 0.1, size * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(size * 0.46, -size * 1.08, size * 0.1, size * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/** 重锤命中瞬间的径向冲击波环 + 漫画星芒 + 飞散速度线 */
export function drawBonkShockwave(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  maxRadius = 42,
  dir: 1 | -1 = 1,
): void {
  const u = Math.max(0, Math.min(1, progress));
  if (u <= 0 || u >= 1) return;

  const easeOut = 1 - (1 - u) * (1 - u) * (1 - u);
  const fade = Math.max(0, 1 - u);

  ctx.save();
  ctx.translate(x, y);

  // 1. 扩散冲击圆环（金黄外圈 + 天蓝亮内圈）
  const ringR = maxRadius * (0.24 + 0.76 * easeOut);
  ctx.globalAlpha = fade * 0.92;
  ctx.beginPath();
  ctx.arc(0, 0, ringR, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.2, (1 - u) * 4.2);
  ctx.strokeStyle = '#facc15';
  ctx.stroke();

  ctx.globalAlpha = fade * 0.75;
  ctx.beginPath();
  ctx.arc(0, 0, ringR * 0.72, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(0.8, (1 - u) * 2.4);
  ctx.strokeStyle = '#38bdf8';
  ctx.stroke();

  // 2. 瞬间爆裂八芒漫画冲击星（前 65% 生命期）
  if (u < 0.65) {
    const starU = u / 0.65;
    const starScale = starU < 0.25 ? 0.55 + (starU / 0.25) * 0.6 : 1.15 - ((starU - 0.25) / 0.75) * 0.65;
    const starAlpha = Math.max(0, 1 - starU * starU);
    const outerR = maxRadius * 0.48 * starScale;
    const innerR = outerR * 0.42;

    ctx.save();
    ctx.globalAlpha = starAlpha * 0.94;
    ctx.rotate(dir * 0.18 + u * 0.35);
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const ang = (i * Math.PI) / 8;
      const rad = i % 2 === 0 ? outerR * (i % 4 === 0 ? 1.12 : 0.86) : innerR;
      const px = Math.cos(ang) * rad;
      const py = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#fef08a';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#f59e0b';
    ctx.stroke();
    ctx.restore();
  }

  // 3. 放射状冲击速度线
  ctx.globalAlpha = fade * 0.85;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.2, (1 - u) * 2.6);
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const ang = -Math.PI * 0.92 + (i / 5) * Math.PI * 0.84 + (dir < 0 ? -0.12 : 0.12);
    const r0 = maxRadius * (0.28 + easeOut * 0.45);
    const r1 = r0 + maxRadius * (0.22 * (1 - u * 0.6));
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
    ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
    ctx.stroke();
  }

  ctx.restore();
}

/** 红温/持续 T3 高算力时的暖橘炽热氛围背光（纯椭圆叠加，零渐变分配） */
export function drawOverheatGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  t: number,
): void {
  const pulse = 0.86 + 0.14 * Math.sin(t * 7.2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  ctx.globalAlpha = 0.14 * pulse;
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * (1.08 + 0.04 * pulse), ry * (1.06 + 0.04 * pulse), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.12 * pulse;
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.08, rx * 0.78, ry * 0.76, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.09 * pulse;
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.25, rx * 0.56, ry * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
