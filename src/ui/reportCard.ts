import type { RunSummary, SlotGameState, WorldBuff } from '../game/types';
import {
  escapeHtml,
  formatCompactNumber,
  getIconUrl,
  wrapTextByWidth,
} from './formatters';

const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawTopRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function loadImageSafe(src: string, timeoutMs: number = 2500): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (res: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const timer = globalThis.setTimeout(() => finish(null), timeoutMs);
    img.onload = () => {
      globalThis.clearTimeout(timer);
      finish(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      globalThis.clearTimeout(timer);
      finish(null);
    };
    img.src = src;
  });
}

function truncateLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let out = '';
  for (const ch of Array.from(text)) {
    if (ctx.measureText(out + ch + '…').width > maxWidth) {
      break;
    }
    out += ch;
  }
  return out + '…';
}

/**
 * 生成可一键复制发 X / 群聊的文字版战报摘要
 */
export function buildShareText(summary: RunSummary, worldBuff?: WorldBuff): string {
  const buffPart = worldBuff ? `｜今日Buff：${worldBuff.name}` : '';
  const highlightLines =
    summary.highlights.length > 0
      ? summary.highlights
          .slice(0, 3)
          .map((h) => `✦ ${h}`)
          .join('\n')
      : `✦ 干掉大白饭 ${summary.stats.riceEaten} 碗 · Claude 盖章 ${summary.stats.claudeStamps} 次`;

  return [
    `📜【今日赛博打工鉴定书】${summary.titleBadge}`,
    `🔥 今日消耗 Token：${formatCompactNumber(summary.tokensBurnedToday)}${buffPart}`,
    `🎰 算力总分：${summary.totalScore.toLocaleString()} 分（${summary.spinsPlayed} 抽｜讨伐至 Stage ${summary.bossStageCleared}·${summary.highestBossName}）`,
    `💬 鉴定评语：${summary.roastText}`,
    highlightLines,
    `—— 🐳 AI娘算力桌宠 · @赛博画师阿凡`,
  ].join('\n');
}

/**
 * 使用原生 Canvas 2D 绘制高清（800×1060）二次元梗图质感「今日赛博打工鉴定书」海报
 */
export async function renderReportCardCanvas(
  summary: RunSummary,
  worldBuff?: WorldBuff,
  dateStr?: string
): Promise<HTMLCanvasElement> {
  const W = 800;
  const H = 1060;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const todayLabel =
    dateStr ||
    (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`;
    })();

  const [mvpImg, buffImg] = await Promise.all([
    loadImageSafe(getIconUrl(summary.mvpIconId || 'dafeiyu')),
    worldBuff ? loadImageSafe(getIconUrl(worldBuff.iconId)) : Promise.resolve(null),
  ]);

  // 1. 柔和赛博浅色渐变底 + 点阵背景
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#fefce8');
  bgGrad.addColorStop(0.5, '#eff6ff');
  bgGrad.addColorStop(1, '#fdf2f8');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(99, 102, 241, 0.10)';
  for (let gx = 20; gx < W; gx += 24) {
    for (let gy = 20; gy < H; gy += 24) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 装饰柔和光晕
  const glowA = ctx.createRadialGradient(130, 120, 10, 130, 120, 220);
  glowA.addColorStop(0, 'rgba(59, 130, 246, 0.16)');
  glowA.addColorStop(1, 'rgba(59, 130, 246, 0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, 400, 400);

  const glowB = ctx.createRadialGradient(680, 920, 10, 680, 920, 240);
  glowB.addColorStop(0, 'rgba(236, 72, 153, 0.15)');
  glowB.addColorStop(1, 'rgba(236, 72, 153, 0)');
  ctx.fillStyle = glowB;
  ctx.fillRect(380, 650, 420, 410);

  // 2. 主鉴定书白卡外框
  const cardX = 36;
  const cardY = 34;
  const cardW = 728;
  const cardH = 992;

  ctx.save();
  ctx.shadowColor = 'rgba(30, 41, 59, 0.14)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  drawRoundedRect(ctx, cardX + 8, cardY + 8, cardW - 16, cardH - 16, 22);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  // 3. 顶部深蓝赛博横幅
  const bannerH = 88;
  const bannerGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + bannerH);
  bannerGrad.addColorStop(0, '#1e1b4b');
  bannerGrad.addColorStop(0.55, '#312e81');
  bannerGrad.addColorStop(1, '#1d4ed8');
  drawTopRoundedRect(ctx, cardX + 2, cardY + 2, cardW - 4, bannerH, 25);
  ctx.fillStyle = bannerGrad;
  ctx.fill();

  // 金色底部分隔亮条
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(cardX + 2, cardY + bannerH - 4, cardW - 4, 4);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `900 30px ${FONT_STACK}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('📜 今日赛博打工鉴定书', cardX + 28, cardY + 45);

  // 右上角日期胶囊
  const datePillText = `${todayLabel} · 算力核发`;
  ctx.font = `700 15px ${FONT_STACK}`;
  const dateTextW = ctx.measureText(datePillText).width;
  const datePillW = dateTextW + 28;
  const datePillX = cardX + cardW - datePillW - 26;
  drawRoundedRect(ctx, datePillX, cardY + 27, datePillW, 34, 17);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#e0e7ff';
  ctx.textAlign = 'center';
  ctx.fillText(datePillText, datePillX + datePillW / 2, cardY + 44);

  // 4. Hero 区：左侧 MVP 贴纸框 + 右侧大称号 + 斜盖红章
  const heroY = 146;
  const stickerX = 64;
  const stickerSize = 172;

  const stickerGrad = ctx.createLinearGradient(
    stickerX,
    heroY,
    stickerX + stickerSize,
    heroY + stickerSize
  );
  stickerGrad.addColorStop(0, '#eff6ff');
  stickerGrad.addColorStop(1, '#fef3c7');
  drawRoundedRect(ctx, stickerX, heroY, stickerSize, stickerSize, 26);
  ctx.fillStyle = stickerGrad;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#334155';
  ctx.stroke();

  if (mvpImg) {
    ctx.drawImage(mvpImg, stickerX + 16, heroY + 10, 140, 140);
  } else {
    ctx.font = `80px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2563eb';
    ctx.fillText('🐳', stickerX + stickerSize / 2, heroY + 84);
  }

  // MVP 底部小铭牌
  drawRoundedRect(ctx, stickerX + 26, heroY + stickerSize - 26, 120, 28, 14);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.font = `800 13px ${FONT_STACK}`;
  ctx.fillStyle = '#fde68a';
  ctx.textAlign = 'center';
  ctx.fillText('★ 本局 MVP ★', stickerX + stickerSize / 2, heroY + stickerSize - 12);

  // 右侧称号信息
  const infoX = 260;
  const infoMaxW = 468;

  ctx.textAlign = 'left';
  ctx.font = `800 16px ${FONT_STACK}`;
  ctx.fillStyle = '#4f46e5';
  ctx.fillText('✦ 授予赛博荣誉称号 ✦', infoX, heroY + 18);

  const badgeStr = summary.titleBadge || '【纯种干饭王】';
  const titleMaxW = 362;
  let titleFontSize = 38;
  ctx.font = `900 ${titleFontSize}px ${FONT_STACK}`;
  while (ctx.measureText(badgeStr).width > titleMaxW && titleFontSize > 22) {
    titleFontSize -= 2;
    ctx.font = `900 ${titleFontSize}px ${FONT_STACK}`;
  }
  const badgeW = Math.min(titleMaxW, ctx.measureText(badgeStr).width + 8);
  // 荧光笔高亮底条
  drawRoundedRect(ctx, infoX - 2, heroY + 62, badgeW + 8, 16, 6);
  ctx.fillStyle = '#fde047';
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.fillText(badgeStr, infoX, heroY + 58);

  // 副标题（最多 2 行）
  ctx.font = `600 18px ${FONT_STACK}`;
  ctx.fillStyle = '#475569';
  const subLines = wrapTextByWidth(summary.subtitle || '算力燃烧殆尽，快乐刚刚开始！', infoMaxW, (s) =>
    ctx.measureText(s).width
  ).slice(0, 2);
  subLines.forEach((line, idx) => {
    ctx.fillText(line, infoX, heroY + 100 + idx * 26);
  });

  // 今日世界 Buff 胶囊条
  const buffText = worldBuff
    ? `今日世界Buff：${worldBuff.name}`
    : '今日世界Buff：豆包免费救济';
  const buffPillY = heroY + 142;
  ctx.font = `700 15px ${FONT_STACK}`;
  const buffPillW = Math.min(infoMaxW, ctx.measureText(buffText).width + (buffImg ? 52 : 32));
  drawRoundedRect(ctx, infoX, buffPillY, buffPillW, 34, 17);
  ctx.fillStyle = '#eef2ff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#a5b4fc';
  ctx.stroke();

  if (buffImg) {
    ctx.drawImage(buffImg, infoX + 10, buffPillY + 5, 24, 24);
    ctx.fillStyle = '#3730a3';
    ctx.fillText(truncateLine(ctx, buffText, infoMaxW - 48), infoX + 40, buffPillY + 17);
  } else {
    ctx.fillStyle = '#3730a3';
    ctx.fillText(truncateLine(ctx, `🌍 ${buffText}`, infoMaxW - 24), infoX + 14, buffPillY + 17);
  }

  // 右上斜盖红色双圈鉴定章
  ctx.save();
  ctx.translate(682, 186);
  ctx.rotate((-14 * Math.PI) / 180);
  ctx.strokeStyle = 'rgba(220, 38, 38, 0.82)';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 38, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(220, 38, 38, 0.85)';
  ctx.textAlign = 'center';
  ctx.font = `900 14px ${FONT_STACK}`;
  ctx.fillText('AI娘算力局', 0, -11);
  ctx.font = `900 17px ${FONT_STACK}`;
  ctx.fillText('鉴定合格', 0, 11);
  ctx.restore();

  // 5. 三大核心指标卡片行
  const statRowY = 346;
  const statCardW = 212;
  const statCardH = 110;
  const statGap = 18;
  const statStartX = 64;

  const metricCards = [
    {
      label: '🏆 本局算力总分',
      value: summary.totalScore.toLocaleString(),
      sub: `共畅摇 ${summary.spinsPlayed} 抽`,
      bg: '#fffbeb',
      border: '#fcd34d',
      valColor: '#b45309',
    },
    {
      label: '🔥 今日消耗 Token',
      value: formatCompactNumber(summary.tokensBurnedToday),
      sub: summary.tokensBurnedToday > 0 ? '真实打工算力转化' : '豆包低保快乐白嫖',
      bg: '#eff6ff',
      border: '#93c5fd',
      valColor: '#1d4ed8',
    },
    {
      label: '👾 最高讨伐战绩',
      value: summary.bossStageCleared > 0 ? `连破 ${summary.bossStageCleared} 关` : '热身刮痧中',
      sub: summary.highestBossName || '幻觉史莱姆',
      bg: '#fff1f2',
      border: '#fda4af',
      valColor: '#be123c',
    },
  ];

  metricCards.forEach((m, idx) => {
    const cx = statStartX + idx * (statCardW + statGap);
    drawRoundedRect(ctx, cx, statRowY, statCardW, statCardH, 18);
    ctx.fillStyle = m.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = m.border;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `700 15px ${FONT_STACK}`;
    ctx.fillStyle = '#475569';
    ctx.fillText(m.label, cx + statCardW / 2, statRowY + 26);

    ctx.font = `900 28px ${FONT_STACK}`;
    ctx.fillStyle = m.valColor;
    ctx.fillText(truncateLine(ctx, m.value, statCardW - 20), cx + statCardW / 2, statRowY + 60);

    ctx.font = `600 13px ${FONT_STACK}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText(truncateLine(ctx, m.sub, statCardW - 20), cx + statCardW / 2, statRowY + 90);
  });

  // 6. AI娘神吐槽评语框
  const roastX = 64;
  const roastY = 476;
  const roastW = 672;
  const roastH = 186;

  drawRoundedRect(ctx, roastX, roastY, roastW, roastH, 20);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#cbd5e1';
  ctx.stroke();

  // 顶部小角标签
  drawRoundedRect(ctx, roastX + 20, roastY - 14, 178, 28, 14);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = `800 14px ${FONT_STACK}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('💬 AI娘联合神吐槽', roastX + 20 + 89, roastY);

  ctx.textAlign = 'left';
  ctx.font = `600 20px ${FONT_STACK}`;
  ctx.fillStyle = '#1e293b';
  const roastLines = wrapTextByWidth(
    summary.roastText || '今天也是在代码山和限流红牌之间反复横跳的一天呢！',
    roastW - 52,
    (s) => ctx.measureText(s).width
  ).slice(0, 4);

  roastLines.forEach((line, idx) => {
    const text = idx === 3 && roastLines.length === 4 ? truncateLine(ctx, line, roastW - 52) : line;
    ctx.fillText(text, roastX + 26, roastY + 42 + idx * 34);
  });

  // 7. 趣味行为六维统计小徽章（3列 × 2行）
  const gridY = 682;
  const chipW = 214;
  const chipH = 42;
  const chipGapX = 15;
  const chipGapY = 12;

  const statChips = [
    `🍚 干掉白饭：${summary.stats.riceEaten} 碗`,
    `✒️ Claude署名：${summary.stats.claudeStamps} 次`,
    `💥 白龙核爆：${summary.stats.bailongNukes} 次`,
    `🪓 斩灭Bug：${summary.stats.bugsPurified} 只`,
    `💢 逗小肥鱼：${summary.stats.grokTeases} 次`,
    `👩🏻 豆包感化：${summary.stats.doubaoSaves} 次`,
  ];

  statChips.forEach((label, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 64 + col * (chipW + chipGapX);
    const y = gridY + row * (chipH + chipGapY);

    drawRoundedRect(ctx, x, y, chipW, chipH, 12);
    ctx.fillStyle = '#f1f5f9';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = `700 15px ${FONT_STACK}`;
    ctx.fillStyle = '#334155';
    ctx.fillText(truncateLine(ctx, label, chipW - 24), x + 14, y + chipH / 2);
  });

  // 8. 高光时刻记录框
  const hlX = 64;
  const hlY = 796;
  const hlW = 672;
  const hlH = 142;

  drawRoundedRect(ctx, hlX, hlY, hlW, hlH, 18);
  ctx.fillStyle = '#f5f3ff';
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = '#c4b5fd';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = `800 16px ${FONT_STACK}`;
  ctx.fillStyle = '#5b21b6';
  ctx.fillText('✨ 本局名场面高光记录', hlX + 22, hlY + 28);

  const displayHighlights =
    summary.highlights.length > 0
      ? summary.highlights.slice(0, 3)
      : [
          `本局累计打出 ${summary.totalScore.toLocaleString()} 算力总分`,
          `大肥鱼累计干掉 ${summary.stats.riceEaten} 碗热腾腾大白饭`,
          `最高迎战 Boss：${summary.highestBossName}`,
        ];

  ctx.font = `600 16px ${FONT_STACK}`;
  ctx.fillStyle = '#3b0764';
  displayHighlights.forEach((item, idx) => {
    const bullet = `✦ ${item}`;
    ctx.fillText(truncateLine(ctx, bullet, hlW - 44), hlX + 22, hlY + 62 + idx * 30);
  });

  // 9. 底部可爱品牌角标
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(64, 956);
  ctx.lineTo(736, 956);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = `800 17px ${FONT_STACK}`;
  ctx.fillStyle = '#475569';
  ctx.fillText('🐳 AI娘算力桌宠 · 九宫格轻肉鸽   |   @赛博画师阿凡', W / 2, 988);

  return canvas;
}

/**
 * 触发浏览器/Tauri 一键下载高清 PNG 战报图，并返回 DataURL 供界面预览核验
 */
export async function downloadReportCardPng(
  summary: RunSummary,
  worldBuff?: WorldBuff,
  dateStr?: string
): Promise<string> {
  const canvas = await renderReportCardCanvas(summary, worldBuff, dateStr);
  const dataUrl = canvas.toDataURL('image/png');

  (window as unknown as { __LAST_REPORT_PNG_DATA_URL__?: string }).__LAST_REPORT_PNG_DATA_URL__ =
    dataUrl;

  const cleanDate = (dateStr || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '');
  const filename = `赛博打工鉴定书-${cleanDate}.png`;

  await new Promise<void>((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) {
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          globalThis.setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);
        } else {
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
        resolve();
      }, 'image/png');
    } else {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      resolve();
    }
  });

  return dataUrl;
}

export interface ReportModalHandlers {
  onOvertime: () => void;
  onDownloadPng: () => Promise<string>;
  onCopyText: () => Promise<void>;
  onNewRun: () => void;
  onClose: () => void;
}

/**
 * 构建 400×560 面板内的「今日赛博打工鉴定书」结算弹窗 DOM
 */
export function buildReportModalHtml(state: SlotGameState): string {
  const summary = state.runSummary;
  if (!summary) return '';

  const overtimeCost = state.costs.overtimeSpins;
  const canOvertime = state.tokenCoins >= overtimeCost;
  const highlights =
    summary.highlights.length > 0
      ? summary.highlights.slice(0, 3)
      : [`累计轰出 ${summary.totalScore} 分，迎战 ${summary.highestBossName}`];

  return `
    <div class="modal-backdrop ui-interactive" id="report-modal">
      <div class="report-sheet">
        <div class="report-sheet-header">
          <div class="report-header-title">📜 今日赛博打工鉴定书</div>
          <button class="icon-close-btn" id="btn-close-report" title="先看看盘面">✕</button>
        </div>

        <div class="report-sheet-body">
          <div class="report-hero">
            <div class="report-mvp-box">
              <img src="${escapeHtml(getIconUrl(summary.mvpIconId))}" alt="MVP" class="report-mvp-img" />
              <span class="report-mvp-tag">MVP</span>
            </div>
            <div class="report-title-col">
              <div class="report-stamp-seal">鉴定合格</div>
              <div class="report-badge-name">${escapeHtml(summary.titleBadge)}</div>
              <div class="report-subtitle">${escapeHtml(summary.subtitle)}</div>
            </div>
          </div>

          <div class="report-metrics-grid">
            <div class="report-metric-pill amber">
              <span class="rm-label">本局总分</span>
              <strong class="rm-val">${summary.totalScore.toLocaleString()}</strong>
            </div>
            <div class="report-metric-pill blue">
              <span class="rm-label">今日Token</span>
              <strong class="rm-val">${escapeHtml(formatCompactNumber(summary.tokensBurnedToday))}</strong>
            </div>
            <div class="report-metric-pill rose">
              <span class="rm-label">讨伐进度</span>
              <strong class="rm-val">S${summary.bossStageCleared}</strong>
            </div>
          </div>

          <div class="report-roast-box">
            <div class="report-roast-tag">💬 AI娘神吐槽</div>
            <p class="report-roast-text">${escapeHtml(summary.roastText)}</p>
          </div>

          <div class="report-stat-tags">
            <span>🍚 干饭 ${summary.stats.riceEaten}</span>
            <span>✒️ 署名 ${summary.stats.claudeStamps}</span>
            <span>💥 核爆 ${summary.stats.bailongNukes}</span>
            <span>🪓 斩Bug ${summary.stats.bugsPurified}</span>
            <span>👩🏻 豆包 ${summary.stats.doubaoSaves}</span>
          </div>

          <ul class="report-highlights">
            ${highlights.map((h) => `<li>✦ ${escapeHtml(h)}</li>`).join('')}
          </ul>

          <div class="report-export-preview" id="report-export-preview" hidden>
            <img id="report-export-img" alt="导出战报预览" />
          </div>
        </div>

        <div class="report-sheet-footer">
          <div class="report-overtime-row">
            <button
              class="btn-overtime ${canOvertime ? '' : 'is-disabled'}"
              id="btn-report-overtime"
              ${canOvertime ? '' : 'disabled'}
              title="${canOvertime ? '继续当前卡组与分数再战5抽！' : `Token币不足（需 ${overtimeCost}🪙，当前 ${state.tokenCoins}🪙）`}"
            >
              ⏰ 加班续命 +5抽 (${overtimeCost}🪙)
            </button>
            <button class="btn-new-run" id="btn-report-new-run">
              🔄 再来一局
            </button>
          </div>
          <div class="report-share-row">
            <button class="btn-export-png" id="btn-report-png">
              📸 导出高清战报 PNG
            </button>
            <button class="btn-copy-share" id="btn-report-copy">
              📋 复制文案
            </button>
          </div>
          <div class="report-brand-foot">AI娘算力桌宠 · @赛博画师阿凡</div>
        </div>
      </div>
    </div>
  `;
}
