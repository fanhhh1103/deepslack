import {
  BOSS_STAGES,
  BUG_IDS,
  CHARACTER_IDS,
  STARTER_DECK_IDS,
  SYMBOL_LIST,
  SYMBOLS,
  WORLD_BUFFS,
  getBossTemplate,
  getSymbolDef,
  isBugId,
  isCharacterId,
} from './symbols.ts';
import { evaluateGridSynergies, getNeighbors8 } from './synergies.ts';
import { generateRunSummary, TITLE_DEFINITIONS } from './titles.ts';
import type {
  BossState,
  ComboEvent,
  IconId,
  ProviderId,
  RunStats,
  RunSummary,
  SlotActionCosts,
  SlotGameState,
  SpinResult,
  SymbolDef,
  SymbolInstance,
  TokenSnapshot,
  TokenSyncResult,
  WorldBuff,
} from './types.ts';

export {
  SYMBOLS,
  SYMBOL_LIST,
  WORLD_BUFFS,
  BOSS_STAGES,
  CHARACTER_IDS,
  BUG_IDS,
  STARTER_DECK_IDS,
  TITLE_DEFINITIONS,
  getSymbolDef,
  getBossTemplate,
  getNeighbors8,
};

export * from './types.ts';

/** 每日开局默认赠送 12 枚「豆包免费低保币」 */
export const DAILY_DOUBAO_RELIEF_COINS = 12;

/** 默认每局 15 抽（约 60 秒爽局） */
export const DEFAULT_MAX_SPINS = 15;

/** 每次加班续命增加抽数 */
export const OVERTIME_BONUS_SPINS = 5;

/** 无脑花币三爽点定价 */
export const ACTION_COSTS: SlotActionCosts = {
  rerollDraft: 2,
  luckyBoost: 3,
  overtimeSpins: 5,
};

export interface SlotGameOptions {
  rng?: () => number;
  initialDate?: string;
}

interface SerializedPayloadV1 {
  version: 1;
  uidCounter: number;
  pendingBossSpillover: number;
  state: SlotGameState;
}

/** 获取本地时区 YYYY-MM-DD */
export function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 真实本地 Token 分段对数曲线兑换 `Token 币`：
 * - 0 Token：0 曲线币（另有每日 12 枚豆包免费低保币兜底）
 * - 0 ~ 50k Token：快速给满 15 币
 * - 50k ~ 500k Token：再给满 25 币（累计 40 币）
 * - 500k ~ 5M Token：再给满 35 币（累计 75 币）
 * - 5M 以上：每百万稳定掉 4 币（30M 以上平滑转入对数缓升，永不数值崩盘）
 */
export function tokensToCurveCoins(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    return 0;
  }
  const t = Math.max(0, totalTokens);

  let raw = 0;
  if (t <= 50_000) {
    raw = (15 * Math.log1p(t / 10_000)) / Math.log1p(5);
  } else if (t <= 500_000) {
    raw = 15 + 25 * Math.log10(t / 50_000);
  } else if (t <= 5_000_000) {
    raw = 40 + 35 * Math.log10(t / 500_000);
  } else {
    const extraMillions = (t - 5_000_000) / 1_000_000;
    if (extraMillions <= 25) {
      raw = 75 + 4 * extraMillions;
    } else {
      raw = 75 + 100 + 30 * Math.log1p((extraMillions - 25) / 10);
    }
  }

  return Math.max(0, Math.floor(raw + 1e-9));
}

/**
 * 根据今日各平台 Token 消耗占比自动判定【今日世界 Buff】
 * 若无任何消耗（0 Token），默认激活【豆包免费救济】
 */
export function resolveWorldBuff(
  byProvider: Partial<Record<ProviderId, number>> | undefined,
  totalTokens: number,
): WorldBuff {
  if (!byProvider || totalTokens <= 0) {
    return { ...WORLD_BUFFS.doubao };
  }

  const order: ProviderId[] = [
    'claude',
    'antigravity',
    'deepseek',
    'openai',
    'gemini',
    'grok',
    'other',
  ];

  let bestProvider: ProviderId | null = null;
  let bestAmount = 0;

  for (const p of order) {
    const val = byProvider[p] ?? 0;
    if (val > bestAmount) {
      bestAmount = val;
      bestProvider = p;
    }
  }

  if (!bestProvider || bestAmount <= 0) {
    return { ...WORLD_BUFFS.other };
  }

  return { ...WORLD_BUFFS[bestProvider] };
}

function createEmptyStats(): RunStats {
  return {
    riceEaten: 0,
    claudeStamps: 0,
    bailongNukes: 0,
    bailongWhiffs: 0,
    bugsPurified: 0,
    grokTeases: 0,
    doubaoSaves: 0,
  };
}

function createBossState(stage: number): BossState {
  const tpl = getBossTemplate(stage);
  return {
    stage: tpl.stage,
    name: tpl.name,
    hp: tpl.maxHp,
    maxHp: tpl.maxHp,
    defeated: false,
    iconId: tpl.iconId,
  };
}

const SYNERGY_PARTNER_MAP: Record<string, IconId[]> = {
  dafeiyu: ['rice', 'whale_plush', 'coffee'],
  daju: ['code', 'clawd', 'poster'],
  bailong: ['remote', 'bill200'],
  xingmao: ['poster', 'banana', 'star_gem'],
  grok: ['dafeiyu', 'bug_429', 'bug_hallucination'],
  doubao: ['bill200', 'bug_hallucination'],
};

const DRAFT_POOL_DEFS: SymbolDef[] = SYMBOL_LIST.filter(
  (def) => def.rarity !== 'bug' && def.id !== 'signed_code',
);

const PROVIDER_FAVORED_IDS: Record<ProviderId | 'doubao', Set<string>> = {
  claude: new Set(['daju', 'clawd', 'code', 'box_compact']),
  antigravity: new Set(['xingmao', 'daju', 'banana', 'poster', 'star_gem']),
  deepseek: new Set(['dafeiyu', 'rice', 'whale_plush', 'coffee']),
  openai: new Set(['bailong', 'remote', 'bill200', 'gpu']),
  gemini: new Set(['xingmao', 'banana', 'poster', 'star_gem']),
  grok: new Set(['grok', 'dafeiyu', 'gpu']),
  other: new Set(['gpu', 'coffee', 'box_compact']),
  doubao: new Set(['doubao', 'rice', 'dafeiyu']),
};

export class SlotGame {
  private rng: () => number;
  private uidCounter = 0;
  private pendingBossSpillover = 0;
  private state: SlotGameState;

  constructor(options?: SlotGameOptions) {
    this.rng = options?.rng ?? Math.random;
    const today = options?.initialDate ?? getLocalDateString();

    this.state = {
      tokenCoins: DAILY_DOUBAO_RELIEF_COINS,
      todayTokens: 0,
      byProvider: {},
      currentDate: today,
      redeemedCurveCoinsToday: 0,
      dailyReliefClaimed: true,
      worldBuff: { ...WORLD_BUFFS.doubao },
      spinNumber: 0,
      maxSpins: DEFAULT_MAX_SPINS,
      totalRunScore: 0,
      lastSpinScore: 0,
      deck: [],
      grid: new Array<SymbolInstance | null>(9).fill(null),
      cellScores: new Array<number>(9).fill(0),
      lastCombos: [],
      currentBoss: createBossState(1),
      bossStageCleared: 0,
      highestBossName: '尚未破防',
      pendingDraft: null,
      draftRerollLevel: 0,
      luckyBoostActive: false,
      overtimeCount: 0,
      isRunOver: false,
      runSummary: null,
      stats: createEmptyStats(),
      symbolContributions: {},
      runsPlayedToday: 0,
      bestScoreToday: 0,
      costs: { ...ACTION_COSTS },
    };

    this.state.deck = STARTER_DECK_IDS.map((id) => this.createInstance(id));
  }

  private createInstance(defId: string): SymbolInstance {
    this.uidCounter += 1;
    return {
      uid: `sym_${this.uidCounter}`,
      defId,
      bonusValue: 0,
      multiplier: 1,
    };
  }

  /**
   * 同步本地真实/模拟 Token 快照：
   * - 跨天自动重置今日计数并再送 12 枚「豆包免费低保币」
   * - 同日按分段对数曲线只补发新增差额币，绝不重复发币
   * - 根据最高占比平台实时刷新【今日世界 Buff】
   */
  public syncTokenSnapshot(snapshot: TokenSnapshot): TokenSyncResult {
    let coinsAdded = 0;
    let isNewDay = false;

    if (snapshot.date && snapshot.date !== this.state.currentDate) {
      isNewDay = true;
      this.state.currentDate = snapshot.date;
      this.state.todayTokens = 0;
      this.state.byProvider = {};
      this.state.redeemedCurveCoinsToday = 0;
      this.state.dailyReliefClaimed = true;
      this.state.runsPlayedToday = 0;
      this.state.bestScoreToday = 0;
      this.state.tokenCoins += DAILY_DOUBAO_RELIEF_COINS;
      coinsAdded += DAILY_DOUBAO_RELIEF_COINS;
    } else if (!this.state.dailyReliefClaimed) {
      this.state.dailyReliefClaimed = true;
      this.state.tokenCoins += DAILY_DOUBAO_RELIEF_COINS;
      coinsAdded += DAILY_DOUBAO_RELIEF_COINS;
    }

    const mergedByProvider: Partial<Record<ProviderId, number>> = {
      ...snapshot.byProvider,
    };
    let providerSum = 0;
    for (const val of Object.values(mergedByProvider)) {
      if (typeof val === 'number' && val > 0) {
        providerSum += val;
      }
    }

    const safeTotal =
      typeof snapshot.totalTokens === 'number' && Number.isFinite(snapshot.totalTokens)
        ? snapshot.totalTokens
        : 0;
    const effectiveTotal = Math.max(
      0,
      safeTotal,
      providerSum,
    );

    this.state.byProvider = mergedByProvider;
    this.state.todayTokens = effectiveTotal;

    const targetCurveCoins = tokensToCurveCoins(effectiveTotal);
    const deltaCurveCoins = Math.max(
      0,
      targetCurveCoins - this.state.redeemedCurveCoinsToday,
    );

    if (deltaCurveCoins > 0) {
      this.state.tokenCoins += deltaCurveCoins;
      this.state.redeemedCurveCoinsToday += deltaCurveCoins;
      coinsAdded += deltaCurveCoins;
    }

    this.state.worldBuff = resolveWorldBuff(mergedByProvider, effectiveTotal);

    if (this.state.runSummary) {
      this.state.runSummary.tokensBurnedToday = this.state.todayTokens;
    }

    return {
      coinsAdded,
      tokenCoins: this.state.tokenCoins,
      todayTokens: this.state.todayTokens,
      worldBuff: { ...this.state.worldBuff },
      isNewDay,
    };
  }

  /** 获取当前完整只读状态快照 */
  public getState(): SlotGameState {
    return {
      ...this.state,
      byProvider: { ...this.state.byProvider },
      worldBuff: { ...this.state.worldBuff },
      deck: this.state.deck.map((inst) => ({ ...inst })),
      grid: this.state.grid.map((inst) => (inst ? { ...inst } : null)),
      cellScores: [...this.state.cellScores],
      lastCombos: this.state.lastCombos.map((c) => ({
        ...c,
        transformedCell: c.transformedCell ? { ...c.transformedCell } : undefined,
      })),
      currentBoss: { ...this.state.currentBoss },
      pendingDraft: this.state.pendingDraft
        ? this.state.pendingDraft.map((d) => ({ ...d }))
        : null,
      runSummary: this.state.runSummary
        ? {
            ...this.state.runSummary,
            highlights: [...this.state.runSummary.highlights],
            stats: { ...this.state.runSummary.stats },
          }
        : null,
      stats: { ...this.state.stats },
      symbolContributions: { ...this.state.symbolContributions },
      costs: { ...this.state.costs },
    };
  }

  /** 开启新一局 15 抽（保留今日已攒的 Token 币、今日消耗与世界 Buff） */
  public startNewRun(): SlotGameState {
    this.pendingBossSpillover = 0;
    this.state.spinNumber = 0;
    this.state.maxSpins = DEFAULT_MAX_SPINS;
    this.state.totalRunScore = 0;
    this.state.lastSpinScore = 0;
    this.state.deck = STARTER_DECK_IDS.map((id) => this.createInstance(id));
    this.state.grid = new Array<SymbolInstance | null>(9).fill(null);
    this.state.cellScores = new Array<number>(9).fill(0);
    this.state.lastCombos = [];
    this.state.currentBoss = createBossState(1);
    this.state.bossStageCleared = 0;
    this.state.highestBossName = '尚未破防';
    this.state.pendingDraft = null;
    this.state.draftRerollLevel = 0;
    this.state.luckyBoostActive = false;
    this.state.overtimeCount = 0;
    this.state.isRunOver = false;
    this.state.runSummary = null;
    this.state.stats = createEmptyStats();
    this.state.symbolContributions = {};
    return this.getState();
  }

  public canRerollDraft(): boolean {
    return (
      !this.state.isRunOver &&
      this.state.pendingDraft !== null &&
      this.state.tokenCoins >= ACTION_COSTS.rerollDraft
    );
  }

  public canBuyLuckyBoost(): boolean {
    return (
      !this.state.isRunOver &&
      !this.state.luckyBoostActive &&
      this.state.tokenCoins >= ACTION_COSTS.luckyBoost
    );
  }

  public canBuyOvertimeSpins(): boolean {
    return this.state.tokenCoins >= ACTION_COSTS.overtimeSpins;
  }

  /**
   * 花 2 枚 Token 币刷新三选一卡池（大幅提高稀有/史诗权重，且必出至少 1 张 Epic！）
   */
  public rerollDraft(): boolean {
    if (!this.canRerollDraft()) {
      return false;
    }
    const prevIds = new Set((this.state.pendingDraft ?? []).map((d) => d.id));
    this.state.tokenCoins -= ACTION_COSTS.rerollDraft;
    this.state.draftRerollLevel += 1;
    this.state.pendingDraft = this.rollDraftChoices(3, prevIds);
    return true;
  }

  /**
   * 花 3 枚 Token 币为下一抽注入「⚡算力暴走」：
   * 全盘正向倍率 ×1.5，且必排布出至少 2 组角色化学反应连携！
   */
  public buyLuckyBoost(): boolean {
    if (!this.canBuyLuckyBoost()) {
      return false;
    }
    this.state.tokenCoins -= ACTION_COSTS.luckyBoost;
    this.state.luckyBoostActive = true;
    return true;
  }

  /**
   * 花 5 枚 Token 币「加班续命 +5 抽」继续冲击更高阶段 Boss！
   * 15 抽结束时或局中均可购买。
   */
  public buyOvertimeSpins(): boolean {
    if (!this.canBuyOvertimeSpins()) {
      return false;
    }
    this.state.tokenCoins -= ACTION_COSTS.overtimeSpins;
    this.state.maxSpins += OVERTIME_BONUS_SPINS;
    this.state.overtimeCount += 1;

    if (this.state.isRunOver) {
      this.state.isRunOver = false;
      this.state.runSummary = null;
      this.state.runsPlayedToday = Math.max(0, this.state.runsPlayedToday - 1);
    }

    this.advanceDefeatedBossIfNeeded();
    return true;
  }

  /**
   * 从三选一浮层挑选 1 张新梗卡塞进当前牌库
   * 支持传下标 `0 | 1 | 2` 或直接传 `defId` 字符串
   */
  public pickDraft(choice: number | string): boolean {
    const draft = this.state.pendingDraft;
    if (!draft || draft.length === 0) {
      return false;
    }

    let picked: SymbolDef | undefined;
    if (typeof choice === 'number') {
      picked = draft[choice];
    } else {
      picked = draft.find((d) => d.id === choice || d.iconId === choice);
    }

    if (!picked) {
      return false;
    }

    this.state.deck.push(this.createInstance(picked.id));
    this.state.pendingDraft = null;
    this.state.draftRerollLevel = 0;
    this.advanceDefeatedBossIfNeeded();
    return true;
  }

  /** 允许玩家主动跳过当前选牌 */
  public skipDraft(): void {
    this.state.pendingDraft = null;
    this.state.draftRerollLevel = 0;
    this.advanceDefeatedBossIfNeeded();
  }

  /**
   * 免费拉杆开摇！（一局默认 15 抽）
   */
  public spin(): SpinResult {
    if (this.state.isRunOver) {
      return this.buildSpinResultSnapshot();
    }

    // 若未手动选牌直接拉杆，自动收起选牌浮层不卡死流程
    if (this.state.pendingDraft !== null) {
      this.state.pendingDraft = null;
      this.state.draftRerollLevel = 0;
    }

    // 若上一抽刚击破某阶段 Boss，进入本抽前切换至下一尊 Boss 并结算溢出伤害
    this.advanceDefeatedBossIfNeeded();

    this.state.spinNumber += 1;

    // DeepSeek 世界 Buff：每 3 抽自动往碗里添 1 碗免费热白饭
    if (
      this.state.worldBuff.provider === 'deepseek' &&
      this.state.spinNumber % 3 === 0
    ) {
      this.state.deck.push(this.createInstance('rice'));
    }

    const useBoost = this.state.luckyBoostActive;
    this.state.luckyBoostActive = false;

    const board = useBoost
      ? this.dealLuckyBoostBoard()
      : this.dealStandardBoard();

    return this.resolveBoardSpin(board, useBoost);
  }

  /**
   * 仅供单元测试/调试：按指定 9 格符号 ID 排布并走完整结算管线
   */
  public spinWithForcedGrid(
    gridDefIds: (string | null)[],
    options?: { luckyBoost?: boolean },
  ): SpinResult {
    if (this.state.isRunOver) {
      return this.buildSpinResultSnapshot();
    }
    this.advanceDefeatedBossIfNeeded();
    this.state.spinNumber += 1;

    // 将牌库同步为给定测试阵列以便校验永久成长与移除效果
    const board: (SymbolInstance | null)[] = new Array(9).fill(null);
    const nextDeck: SymbolInstance[] = [];

    for (let i = 0; i < 9; i++) {
      const defId = gridDefIds[i] ?? null;
      if (defId && SYMBOLS[defId]) {
        const inst = this.createInstance(defId);
        board[i] = inst;
        nextDeck.push(inst);
      }
    }
    this.state.deck = nextDeck;

    const useBoost = options?.luckyBoost ?? this.state.luckyBoostActive;
    this.state.luckyBoostActive = false;

    return this.resolveBoardSpin(board, useBoost);
  }

  private resolveBoardSpin(
    board: (SymbolInstance | null)[],
    useBoost: boolean,
  ): SpinResult {
    const resolution = evaluateGridSynergies({
      board,
      worldBuff: this.state.worldBuff,
      luckyBoostActive: useBoost,
      stats: this.state.stats,
      rng: this.rng,
    });

    // 从永久牌库移除本抽被吞吃/战斧劈爆/压缩掉的卡牌
    if (resolution.removedUids.size > 0) {
      this.state.deck = this.state.deck.filter(
        (inst) => !resolution.removedUids.has(inst.uid),
      );
    }

    // 累计各符号总贡献分
    for (const [defId, val] of Object.entries(resolution.contributions)) {
      this.state.symbolContributions[defId] =
        (this.state.symbolContributions[defId] ?? 0) + val;
    }

    this.state.grid = resolution.landedGrid;
    this.state.cellScores = resolution.cellScores;
    this.state.lastCombos = resolution.combos;
    this.state.lastSpinScore = resolution.spinScore;
    this.state.totalRunScore += resolution.spinScore;

    if (this.state.totalRunScore > this.state.bestScoreToday) {
      this.state.bestScoreToday = this.state.totalRunScore;
    }

    // 对 Boss 造成伤害（支持单抽高爆发连斩多阶段 Boss！）
    this.applyDamageToBoss(resolution.spinScore);

    // 判定是否到达本局最大抽数
    if (this.state.spinNumber >= this.state.maxSpins) {
      this.state.isRunOver = true;
      this.state.pendingDraft = null;
      this.state.runsPlayedToday += 1;
      this.state.runSummary = this.buildRunSummary();
    } else if (this.state.spinNumber % 3 === 0) {
      // 每 3 抽弹出三选一塞新梗浮层（15 抽仅在第 3/6/9/12 抽触发 4 次）
      this.state.draftRerollLevel = 0;
      this.state.pendingDraft = this.rollDraftChoices(3);
    } else {
      this.state.pendingDraft = null;
    }

    return this.buildSpinResultSnapshot();
  }

  private applyDamageToBoss(damage: number): void {
    if (damage <= 0) return;

    let remainingDmg = damage;
    let lastSlainBoss: BossState | null = null;

    while (remainingDmg > 0) {
      if (this.state.currentBoss.defeated) {
        this.spawnNextBossStage();
      }

      const boss = this.state.currentBoss;
      if (remainingDmg >= boss.hp) {
        remainingDmg -= boss.hp;
        boss.hp = 0;
        boss.defeated = true;
        this.state.bossStageCleared = boss.stage;
        this.state.highestBossName = boss.name;
        lastSlainBoss = { ...boss };

        // 每次击败 Boss，新阶段魔王会往牌库偷偷塞 1 只对应机制怪（给 Grok 战斧和豆包提供猎物！）
        this.injectBossMinionBug(boss.stage + 1);

        if (remainingDmg > 0) {
          this.spawnNextBossStage();
        }
      } else {
        boss.hp -= remainingDmg;
        remainingDmg = 0;
      }
    }

    // 若本抽斩杀了至少一尊 Boss，且当前未顺延斩杀完下一尊，保留斩杀态在 SpinResult 上供 UI 播放击破演出，
    // 并将对下一尊已造成的溢出伤害暂存，在下一抽前无缝切入新 Boss！
    if (lastSlainBoss && !this.state.currentBoss.defeated) {
      const nextStageDamaged =
        this.state.currentBoss.maxHp - this.state.currentBoss.hp;
      this.pendingBossSpillover = nextStageDamaged;
      this.state.currentBoss = lastSlainBoss;
    } else {
      this.pendingBossSpillover = 0;
    }
  }

  private advanceDefeatedBossIfNeeded(): void {
    if (!this.state.currentBoss.defeated) return;
    const nextStage = this.state.currentBoss.stage + 1;
    const nextBoss = createBossState(nextStage);
    if (this.pendingBossSpillover > 0) {
      nextBoss.hp = Math.max(1, nextBoss.maxHp - this.pendingBossSpillover);
      this.pendingBossSpillover = 0;
    }
    this.state.currentBoss = nextBoss;
  }

  private spawnNextBossStage(): void {
    const nextStage = this.state.currentBoss.stage + 1;
    this.state.currentBoss = createBossState(nextStage);
  }

  private injectBossMinionBug(enteringStage: number): void {
    // 牌库中如果已有 3 只以上 Bug 则不再塞，保持爽感不坐牢
    const currentBugs = this.state.deck.filter((i) => isBugId(i.defId)).length;
    if (currentBugs >= 3) return;

    let bugId: IconId = 'bug_conflict';
    if (enteringStage === 2) bugId = 'bug_conflict';
    else if (enteringStage === 3) bugId = 'bug_429';
    else bugId = 'bug_oom';

    this.state.deck.push(this.createInstance(bugId));
  }

  private dealStandardBoard(): (SymbolInstance | null)[] {
    const pool = this.shuffleArray([...this.state.deck]);
    const picked = pool.slice(0, 9);
    const cells = this.shuffleArray([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const board = new Array<SymbolInstance | null>(9).fill(null);

    for (let i = 0; i < picked.length; i++) {
      board[cells[i]] = picked[i];
    }
    return board;
  }

  /**
   * 算力暴走专属发牌：保证盘面至少触发 2 组角色连携！
   */
  private dealLuckyBoostBoard(): (SymbolInstance | null)[] {
    const board = new Array<SymbolInstance | null>(9).fill(null);
    const remaining = this.shuffleArray([...this.state.deck]);
    const usedUids = new Set<string>();

    const takeMatching = (
      predicate: (inst: SymbolInstance) => boolean,
    ): SymbolInstance | null => {
      const idx = remaining.findIndex(
        (inst) => !usedUids.has(inst.uid) && predicate(inst),
      );
      if (idx < 0) return null;
      const chosen = remaining[idx];
      usedUids.add(chosen.uid);
      return chosen;
    };

    // 黄金相邻位组合：(中心4, 上1) 与 (左3, 左上0)
    const pairSlots: [number, number][] = [
      [4, 1],
      [3, 0],
    ];

    const fallbackCameos: [IconId, IconId][] = [
      ['xingmao', 'poster'],
      ['grok', 'dafeiyu'],
    ];

    for (let p = 0; p < pairSlots.length; p++) {
      const [charSlot, partnerSlot] = pairSlots[p];
      let charInst = takeMatching((inst) => isCharacterId(inst.defId));
      if (!charInst) {
        // 若牌库角色不足 2 人，召唤临时外援客串本轮暴走（不污染永久牌库）
        charInst = this.createInstance(fallbackCameos[p][0]);
      }

      const partnerIds = SYNERGY_PARTNER_MAP[charInst.defId] ?? ['coffee'];
      let partnerInst = takeMatching(
        (inst) =>
          partnerIds.includes(inst.defId as IconId) ||
          (charInst!.defId === 'daju' && inst.defId === 'signed_code'),
      );
      if (!partnerInst) {
        partnerInst = this.createInstance(partnerIds[0]);
      }

      board[charSlot] = charInst;
      board[partnerSlot] = partnerInst;
    }

    // 其余空位用牌库剩余卡牌随机填满
    const emptyCells = [2, 5, 6, 7, 8];
    const shuffledEmpty = this.shuffleArray(emptyCells);
    for (const cell of shuffledEmpty) {
      const next = takeMatching(() => true);
      if (!next) break;
      board[cell] = next;
    }

    return board;
  }

  private rollDraftChoices(
    count: number = 3,
    avoidIds?: Set<string>,
  ): SymbolDef[] {
    const rerolled = this.state.draftRerollLevel > 0;
    const provider = this.state.worldBuff.provider;
    const favored = PROVIDER_FAVORED_IDS[provider] ?? new Set<string>();

    const getWeight = (def: SymbolDef): number => {
      let w = 10;
      if (rerolled) {
        if (def.rarity === 'epic') w = 44;
        else if (def.rarity === 'rare') w = 46;
        else w = 10;
      } else {
        if (def.rarity === 'common') w = 46;
        else if (def.rarity === 'rare') w = 38;
        else if (def.rarity === 'epic') {
          w = provider === 'antigravity' ? 22 : 16;
        }
      }

      if (favored.has(def.id)) {
        w *= 1.65;
      }
      if (avoidIds && avoidIds.has(def.id)) {
        w *= 0.2;
      }
      return w;
    };

    const chosen: SymbolDef[] = [];
    const chosenIds = new Set<string>();

    // 若玩家花了 2 币刷新卡池，第 1 个槽位保底必出 1 张 Epic 史诗卡！
    if (rerolled) {
      const epics = DRAFT_POOL_DEFS.filter(
        (d) => d.rarity === 'epic' && (!avoidIds || !avoidIds.has(d.id)),
      );
      const epicPool =
        epics.length > 0
          ? epics
          : DRAFT_POOL_DEFS.filter((d) => d.rarity === 'epic');
      const guaranteedEpic = this.weightedPick(epicPool, getWeight);
      if (guaranteedEpic) {
        chosen.push({ ...guaranteedEpic });
        chosenIds.add(guaranteedEpic.id);
      }
    }

    while (chosen.length < count) {
      const candidates = DRAFT_POOL_DEFS.filter((d) => !chosenIds.has(d.id));
      if (candidates.length === 0) break;
      const picked = this.weightedPick(candidates, getWeight);
      if (!picked) break;
      chosen.push({ ...picked });
      chosenIds.add(picked.id);
    }

    return chosen;
  }

  private weightedPick<T>(
    items: T[],
    weightFn: (item: T) => number,
  ): T | null {
    if (items.length === 0) return null;
    const weights = items.map((item) => Math.max(0.01, weightFn(item)));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  private shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  private buildRunSummary(): RunSummary {
    return generateRunSummary({
      totalScore: this.state.totalRunScore,
      spinsPlayed: this.state.spinNumber,
      bossStageCleared: this.state.bossStageCleared,
      highestBossName: this.state.highestBossName,
      currentBoss: { ...this.state.currentBoss },
      tokensBurnedToday: this.state.todayTokens,
      overtimeCount: this.state.overtimeCount,
      stats: { ...this.state.stats },
      deck: this.state.deck.map((i) => ({ ...i })),
      symbolContributions: { ...this.state.symbolContributions },
    });
  }

  private buildSpinResultSnapshot(): SpinResult {
    return {
      spinNumber: this.state.spinNumber,
      maxSpins: this.state.maxSpins,
      grid: this.state.grid.map((inst) => (inst ? { ...inst } : null)),
      cellScores: [...this.state.cellScores],
      combos: this.state.lastCombos.map((c) => ({
        ...c,
        transformedCell: c.transformedCell ? { ...c.transformedCell } : undefined,
      })),
      spinScore: this.state.lastSpinScore,
      totalRunScore: this.state.totalRunScore,
      currentBoss: { ...this.state.currentBoss },
      pendingDraft: this.state.pendingDraft
        ? this.state.pendingDraft.map((d) => ({ ...d }))
        : null,
      isRunOver: this.state.isRunOver,
      runSummary: this.state.runSummary
        ? {
            ...this.state.runSummary,
            highlights: [...this.state.runSummary.highlights],
            stats: { ...this.state.runSummary.stats },
          }
        : null,
    };
  }

  /** 序列化当前完整存档为 JSON 字符串 */
  public serialize(): string {
    const payload: SerializedPayloadV1 = {
      version: 1,
      uidCounter: this.uidCounter,
      pendingBossSpillover: this.pendingBossSpillover,
      state: this.getState(),
    };
    return JSON.stringify(payload);
  }

  /** 实例反序列化恢复存档（遇到损坏数据安全返回 false 不崩端） */
  public deserialize(rawJson: string): boolean {
    try {
      const parsed = JSON.parse(rawJson) as Partial<SerializedPayloadV1>;
      if (!parsed || parsed.version !== 1 || !parsed.state) {
        return false;
      }
      const s = parsed.state;
      if (
        typeof s.tokenCoins !== 'number' ||
        typeof s.spinNumber !== 'number' ||
        !Array.isArray(s.deck)
      ) {
        return false;
      }

      this.uidCounter =
        typeof parsed.uidCounter === 'number' ? parsed.uidCounter : s.deck.length + 10;
      this.pendingBossSpillover =
        typeof parsed.pendingBossSpillover === 'number'
          ? parsed.pendingBossSpillover
          : 0;

      this.state = {
        ...this.state,
        ...s,
        costs: { ...ACTION_COSTS },
      };
      return true;
    } catch {
      return false;
    }
  }

  /** 静态工厂反序列化（方便 `SlotGame.deserialize(saved)` 一行恢复实例） */
  public static deserialize(
    rawJson: string,
    options?: SlotGameOptions,
  ): SlotGame {
    const game = new SlotGame(options);
    game.deserialize(rawJson);
    return game;
  }
}
