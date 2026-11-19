import { ENABLE_SLOT_MACHINE } from '../config';
import { BOWL_TOKENS, buildSparkline, RATE_TIERS, type RateTier } from '../pet/fishBrain';
import type {
  ComboEvent,
  ProviderId,
  SlotGameState,
  SymbolDef,
  SymbolInstance,
} from '../game/types';
import {
  escapeHtml,
  formatCompactNumber,
  formatRate,
  getIconUrl,
  getSymbolShortHint,
  PET_ROSTER,
  type SwitchablePetId,
} from './formatters';

const SPARK_WIDTH = 20;

/**
 * 构建 3×3 九宫格单元格 HTML（第 0 抽未开摇时展示 3 步傻瓜引导卡，开摇后展示清爽九宫格）
 */
export function buildReelsGridHtml(
  state: SlotGameState,
  symbolsMap: Record<string, SymbolDef>,
  spinningCols: Set<number> = new Set(),
  justStoppedCols: Set<number> = new Set()
): string {
  const isSpinZero =
    state.spinNumber === 0 && state.grid.every((cell) => cell === null);

  if (isSpinZero) {
    return `
      <div class="beginner-guide-card">
        <div class="beginner-guide-title">🎮 3秒上手 · 无脑摇大奖</div>
        <div class="beginner-guide-steps">
          <div class="beginner-guide-step">① 狂点下方黄色【摇一把】（免费连摇 15 次，支持空格键）</div>
          <div class="beginner-guide-step">② 相同阵营或【肥鱼+米饭 / 大橘+代码】挨着自动暴涨分数</div>
          <div class="beginner-guide-step">③ 你日常用 AI 烧掉的 Token 会自动换成 🪙 买暴击！</div>
        </div>
      </div>
    `;
  }

  const cells: string[] = [];
  for (let i = 0; i < 9; i++) {
    const col = i % 3;
    const inst: SymbolInstance | null = state.grid[i] ?? null;

    if (!inst) {
      cells.push(`<div class="reel-cell" data-cell="${i}"></div>`);
      continue;
    }

    const def = symbolsMap[inst.defId] || {
      id: inst.defId,
      name: inst.defId,
      iconId: inst.defId,
      rarity: 'common' as const,
      baseValue: 0,
      description: '',
      flavor: '',
    };

    const cellScore = state.cellScores[i] ?? def.baseValue;
    const scoreSign = cellScore >= 0 ? `+${cellScore}` : `${cellScore}`;
    const isSpinning = spinningCols.has(col);
    const isStopped = justStoppedCols.has(col);

    // 仅保留大橘盖章的「✦章」小标，其余次级角标全部精简移除
    const topLeftBadge = inst.stampedByClaude
      ? `<span class="cell-Buff-mini">✦章</span>`
      : '';

    const cls = [
      'reel-cell',
      `rarity-${def.rarity}`,
      isSpinning ? 'is-spinning' : '',
      isStopped ? 'just-stopped' : '',
    ]
      .filter(Boolean)
      .join(' ');

    cells.push(`
      <div class="${cls}" data-cell="${i}" title="${escapeHtml(def.name)}：${escapeHtml(getSymbolShortHint(def.id))}">
        ${topLeftBadge}
        ${
          !isSpinning
            ? `<span class="cell-score-badge ${cellScore < 0 ? 'is-neg' : ''}">${escapeHtml(scoreSign)}</span>`
            : ''
        }
        <img src="${escapeHtml(getIconUrl(def.iconId))}" alt="${escapeHtml(def.name)}" class="cell-icon-img" />
        <span class="cell-name">${escapeHtml(def.name)}</span>
      </div>
    `);
  }

  return cells.join('');
}

/**
 * 计算九宫格中心百分比坐标，用于绘制 Combo 发光连线与飘分定位
 */
export function getCellCenterPercent(cellIdx: number): { xPct: number; yPct: number } {
  const safe = Math.max(0, Math.min(8, Math.floor(cellIdx)));
  const col = safe % 3;
  const row = Math.floor(safe / 3);
  return {
    xPct: (col + 0.5) * (100 / 3),
    yPct: (row + 0.5) * (100 / 3),
  };
}

/**
 * 在九宫格上播放单步 Combo 发光连线与飘分标签
 */
export function renderComboStepVisual(
  gridEl: HTMLElement,
  svgEl: SVGSVGElement,
  floatLayerEl: HTMLElement,
  combo: ComboEvent
): void {
  gridEl.querySelectorAll('.reel-cell').forEach((el) => {
    el.classList.remove('combo-source', 'combo-target');
  });

  const srcEl = gridEl.querySelector(`.reel-cell[data-cell="${combo.sourceCell}"]`);
  if (srcEl) srcEl.classList.add('combo-source');

  const tgtIdx = combo.targetCell ?? combo.transformedCell?.cell ?? combo.removedCell;
  if (typeof tgtIdx === 'number' && tgtIdx !== combo.sourceCell) {
    const tgtEl = gridEl.querySelector(`.reel-cell[data-cell="${tgtIdx}"]`);
    if (tgtEl) tgtEl.classList.add('combo-target');

    const a = getCellCenterPercent(combo.sourceCell);
    const b = getCellCenterPercent(tgtIdx);
    svgEl.innerHTML = `<line class="combo-beam-line" x1="${a.xPct}%" y1="${a.yPct}%" x2="${b.xPct}%" y2="${b.yPct}%" />`;
  } else {
    svgEl.innerHTML = '';
  }

  const anchorCell = typeof tgtIdx === 'number' ? tgtIdx : combo.sourceCell;
  const pos = getCellCenterPercent(anchorCell);
  const pop = document.createElement('div');
  pop.className = 'combo-pop-tag';
  pop.style.left = `${pos.xPct}%`;
  pop.style.top = `${pos.yPct}%`;
  const sign = combo.deltaScore >= 0 ? `+${combo.deltaScore}` : `${combo.deltaScore}`;
  pop.textContent = combo.deltaScore !== 0 ? `${combo.title} ${sign}` : combo.title;
  floatLayerEl.appendChild(pop);

  globalThis.setTimeout(() => {
    pop.remove();
  }, 660);
}

/**
 * 构建 5 位驻场桌宠切换按钮条（仅展示清爽角色 Emoji，悬停显示全名与品牌）
 */
export function buildCharSwitcherHtml(activeChar: SwitchablePetId): string {
  return PET_ROSTER.map(
    (item) => `
      <button
        type="button"
        class="char-switch-btn ${item.id === activeChar ? 'is-active' : ''}"
        data-pet-char="${item.id}"
        title="切换驻场桌宠：${escapeHtml(item.name)} (${escapeHtml(item.brand)})"
      >
        <span>${item.emoji}</span>
      </button>
    `
  ).join('');
}

const PROVIDER_DISPLAY_NAMES: Record<ProviderId, string> = {
  claude: 'Claude',
  openai: 'ChatGPT',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  grok: 'Grok',
  antigravity: 'Antigravity',
  other: 'Other',
};

export interface PureFootCapsuleOptions {
  todayTokens: number;
  byProvider?: Partial<Record<ProviderId, number>>;
  muted?: boolean;
  /** 实时速率（tok/s，fresh 口径） */
  rate?: number;
  /** 全部速率（含 cache_read） */
  totalRate?: number;
  /** 最近采样（火花线） */
  rateSamples?: readonly number[];
  tier?: RateTier;
  bowls?: number;
}

export function formatProviderBreakdownTitle(
  todayTokens: number,
  byProvider?: Partial<Record<ProviderId, number>>,
): string {
  const entries = byProvider
    ? (Object.entries(byProvider) as Array<[ProviderId, number]>)
        .filter(([, val]) => typeof val === 'number' && Number.isFinite(val) && val > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  if (entries.length === 0) {
    return todayTokens > 0
      ? `今日算力总计：${formatCompactNumber(todayTokens)} Tokens`
      : '今日暂未检测到本地 Token 消耗';
  }

  const parts = entries.map(
    ([provider, val]) => `${PROVIDER_DISPLAY_NAMES[provider] ?? provider} ${formatCompactNumber(val)}`,
  );
  return `今日总量 ${formatCompactNumber(todayTokens)} Tokens：${parts.join(' · ')}`;
}

/** 转速条悬停说明：今日总量 + 当前档位 + 各档阈值 */
export function buildRateCapsuleTitle(opts: PureFootCapsuleOptions): string {
  const tier = opts.tier ?? 0;
  const lines = [
    formatProviderBreakdownTitle(opts.todayTokens, opts.byProvider),
    `实时 ${formatRate(opts.rate ?? 0)}（新鲜 Token，含缓存读取 ${formatRate(opts.totalRate ?? 0)}）· 当前档位：T${tier} ${RATE_TIERS[tier].label}`,
    ...RATE_TIERS.map(
      (def) =>
        `T${def.tier} ${def.label}${def.tier > 0 ? `（≥${formatRate(def.enter)}）` : ''}：${def.hint}`,
    ),
  ];
  return lines.join('\n');
}

export function buildBowlTitle(bowls: number): string {
  return `今日饭碗 ${bowls} 碗：每烧 ${formatCompactNumber(BOWL_TOKENS)} Tokens 掉一碗饭；点脚边碗塔会哗啦倒塌（总数不减）`;
}

/**
 * 构建纯享桌宠底部极简胶囊（拖动手柄 + 今日 Token 统计 + 轻量静音按钮）
 */
export function buildFootCapsuleStatsHtml(options: PureFootCapsuleOptions): string;
export function buildFootCapsuleStatsHtml(
  tokenCoins: number,
  todayTokens: number,
  isCollapsed: boolean,
  isTauri?: boolean,
  autoPassthrough?: boolean,
): string;
export function buildFootCapsuleStatsHtml(
  arg1: number | PureFootCapsuleOptions,
  arg2: number = 0,
  arg3: boolean = true,
  _isTauri: boolean = false,
  _autoPassthrough: boolean = false,
): string {
  if (!ENABLE_SLOT_MACHINE || typeof arg1 === 'object') {
    const opts: PureFootCapsuleOptions =
      typeof arg1 === 'object'
        ? arg1
        : {
            todayTokens: arg2,
            muted: false,
          };
    const muted = Boolean(opts.muted);
    const tier = opts.tier ?? 0;
    const bowls = Math.max(0, Math.floor(opts.bowls ?? 0));
    const spark = buildSparkline(opts.rateSamples ?? [], SPARK_WIDTH).padStart(SPARK_WIDTH, '▁');
    return `
      <span class="mini-drag-handle" data-tauri-drag-region title="按住拖动桌宠">⠿</span>
      <span class="capsule-divider"></span>
      <span class="capsule-stat rate tier-${tier}" id="stat-rate" title="${escapeHtml(buildRateCapsuleTitle(opts))}">
        ⚡ <strong id="stat-rate-val">${escapeHtml(formatRate(opts.rate ?? 0))}</strong>
        <span class="rate-spark" id="stat-spark" aria-hidden="true">${spark}</span>
      </span>
      <span class="capsule-divider"></span>
      <span class="capsule-stat bowls" id="stat-bowls" title="${escapeHtml(buildBowlTitle(bowls))}">
        🍚×<strong id="stat-bowls-val">${bowls}</strong>
      </span>
      <button
        type="button"
        class="mini-mute-btn"
        id="btn-mute"
        title="${muted ? '开启音效' : '静音音效'}"
        aria-label="${muted ? '开启音效' : '静音音效'}"
      >${muted ? '🔇' : '🔊'}</button>
    `;
  }

  const tokenCoins = arg1;
  const tokenText = formatCompactNumber(arg2);
  const coinTitle = `今日消耗 ${escapeHtml(tokenText)} Tokens（含每日12枚豆包免费币）`;

  if (arg3) {
    return `
      <span class="mini-drag-handle" data-tauri-drag-region title="按住拖动桌宠">⠿</span>
      <span class="capsule-divider"></span>
      <span class="capsule-stat coins" title="${coinTitle}">
        🪙 <strong id="stat-coins">${tokenCoins}</strong> 币
      </span>
      <button type="button" class="btn-open-slot" id="btn-expand-slot">🎰 玩一局</button>
    `;
  }

  return `
    <span class="capsule-stat coins" title="${coinTitle}">
      🪙 <strong id="stat-coins">${tokenCoins}</strong> 币
    </span>
  `;
}

export type PetToyAction = 'rice' | 'coffee' | 'bug' | 'music' | 'pat' | 'sleep';

export const PET_HOVER_TOYS: readonly {
  action: PetToyAction;
  emoji: string;
  label: string;
  labelEn: string;
  title: string;
  titleEn: string;
}[] = [
  { action: 'rice', emoji: '🍚', label: '扔饭', labelEn: 'Rice', title: '从天上空投一碗大白饭（吃完碗塔 +1）', titleEn: 'Drop a rice bowl (+1 bowl tower)' },
  { action: 'coffee', emoji: '☕', label: '美式', labelEn: 'Coffee', title: '空投冰美式：之后 10 秒元气提速 1.4 倍速', titleEn: 'Drop iced coffee (1.4x speed boost for 10s)' },
  { action: 'bug', emoji: '🐛', label: '砸Bug', labelEn: 'Bonk', title: '空投一只 Bug：吓一跳再抡起充气大锤暴砸', titleEn: 'Drop a bug to smash with toy hammer' },
  { action: 'music', emoji: '🎧', label: '听歌', labelEn: 'Music', title: '戴上小鲸鱼耳机听歌摇摆', titleEn: 'Vibe with whale headphones' },
  { action: 'pat', emoji: '🤚', label: '摸头', labelEn: 'Pat', title: '摸头杀', titleEn: 'Head pat' },
  { action: 'sleep', emoji: '💤', label: '睡觉', labelEn: 'Sleep', title: '抱枕趴睡', titleEn: 'Nap on whale pillow' },
];

export function isPetToyAction(val: string | undefined): val is PetToyAction {
  return PET_HOVER_TOYS.some((t) => t.action === val);
}

/**
 * 构建悬停空投小玩具条按钮组（平时隐藏，鼠标移入桌宠区时淡入）
 */
export function buildPetHoverToysHtml(lang: 'zh' | 'en' = 'zh'): string {
  const isEn = lang === 'en';
  return PET_HOVER_TOYS.map(
    (toy) => `
      <button
        type="button"
        class="pet-toy-btn"
        data-pet-toy="${toy.action}"
        title="${escapeHtml(isEn ? toy.titleEn : toy.title)}"
      >
        <span>${toy.emoji}${escapeHtml(isEn ? toy.labelEn : toy.label)}</span>
      </button>
    `,
  ).join('');
}
