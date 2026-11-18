/**
 * AI娘算力桌宠 · 3×3 轻肉鸽老虎机核心类型契约
 * 严格限定 23 枚图标 ID，供 slot-core / ui-app / tauri-shell 共享引用
 */

export const VALID_ICON_IDS = [
  // 6 角色头像贴纸
  'dafeiyu',
  'daju',
  'bailong',
  'xingmao',
  'grok',
  'doubao',
  // 12 增益道具
  'rice',
  'clawd',
  'remote',
  'banana',
  'poster',
  'code',
  'signed_code',
  'gpu',
  'coffee',
  'bill200',
  'whale_plush',
  'star_gem',
  // 5 负面/特殊机制怪
  'bug_429',
  'bug_hallucination',
  'bug_conflict',
  'bug_oom',
  'box_compact',
] as const;

export type IconId = (typeof VALID_ICON_IDS)[number];

export type ProviderId =
  | 'claude'
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'grok'
  | 'antigravity'
  | 'other';

export type SymbolRarity = 'common' | 'rare' | 'epic' | 'bug';

export type ComboPetMood = 'idle' | 'eat' | 'happy' | 'angry' | 'sleep' | 'spin' | 'shock';

export type ComboSfx = 'eat' | 'stamp' | 'jackpot' | 'bug' | 'doubao' | 'click';

export interface TokenSnapshot {
  date: string;
  totalTokens: number;
  byProvider: Partial<Record<ProviderId, number>>;
  updatedAt: number;
  isLiveLocal: boolean;
}

export interface WorldBuff {
  id: string;
  provider: ProviderId | 'doubao';
  name: string;
  description: string;
  iconId: string;
}

export interface SymbolDef {
  id: string;
  name: string;
  iconId: string;
  rarity: 'common' | 'rare' | 'epic' | 'bug';
  baseValue: number;
  description: string;
  flavor: string;
}

export interface SymbolInstance {
  uid: string;
  defId: string;
  bonusValue: number;
  multiplier: number;
  stampedByClaude?: boolean;
}

export interface ComboEvent {
  step: number;
  sourceCell: number; // 0..8 (3x3 row-major)
  targetCell?: number; // 0..8
  title: string;
  funnyLine: string;
  deltaScore: number;
  petMood: 'idle' | 'eat' | 'happy' | 'angry' | 'sleep' | 'spin' | 'shock';
  sfx: 'eat' | 'stamp' | 'jackpot' | 'bug' | 'doubao' | 'click';
  removedCell?: number;
  transformedCell?: { cell: number; newDefId: string; stamped?: boolean };
}

export interface RunStats {
  riceEaten: number;
  claudeStamps: number;
  bailongNukes: number;
  bailongWhiffs: number;
  bugsPurified: number;
  grokTeases: number;
  doubaoSaves: number;
}

export interface RunSummary {
  totalScore: number;
  spinsPlayed: number;
  bossStageCleared: number;
  highestBossName: string;
  titleBadge: string;
  subtitle: string;
  roastText: string;
  highlights: string[];
  mvpIconId: string;
  tokensBurnedToday: number;
  stats: {
    riceEaten: number;
    claudeStamps: number;
    bailongNukes: number;
    bailongWhiffs: number;
    bugsPurified: number;
    grokTeases: number;
    doubaoSaves: number;
  };
}

export interface BossState {
  stage: number;
  name: string;
  hp: number;
  maxHp: number;
  defeated: boolean;
  iconId: string;
}

export interface SpinResult {
  spinNumber: number;
  maxSpins: number;
  grid: (SymbolInstance | null)[]; // length 9
  cellScores: number[]; // length 9
  combos: ComboEvent[];
  spinScore: number;
  totalRunScore: number;
  currentBoss: {
    stage: number;
    name: string;
    hp: number;
    maxHp: number;
    defeated: boolean;
    iconId: string;
  };
  pendingDraft: SymbolDef[] | null; // 3选1
  isRunOver: boolean;
  runSummary: RunSummary | null;
}

export interface SlotActionCosts {
  rerollDraft: number;
  luckyBoost: number;
  overtimeSpins: number;
}

export interface TokenSyncResult {
  coinsAdded: number;
  tokenCoins: number;
  todayTokens: number;
  worldBuff: WorldBuff;
  isNewDay: boolean;
}

export interface SlotGameState {
  /** 当前可用 Token 币（含每日赠送 12 枚豆包免费低保币 + 本地 Token 兑换币） */
  tokenCoins: number;
  /** 今日累计消耗真实/模拟 Token 总数 */
  todayTokens: number;
  /** 今日按平台消耗明细 */
  byProvider: Partial<Record<ProviderId, number>>;
  /** 当前日期 YYYY-MM-DD */
  currentDate: string;
  /** 今日已从本地 Token 曲线累计领取过的兑换币数（防重复发币） */
  redeemedCurveCoinsToday: number;
  /** 今日是否已发放 12 枚豆包免费低保币 */
  dailyReliefClaimed: boolean;
  /** 当前激活的今日世界 Buff */
  worldBuff: WorldBuff;
  /** 本局已摇次数 */
  spinNumber: number;
  /** 本局最大可摇次数（默认 15，加班续命每次 +5） */
  maxSpins: number;
  /** 本局累计总分 */
  totalRunScore: number;
  /** 上一抽得分 */
  lastSpinScore: number;
  /** 当前局内牌库实例 */
  deck: SymbolInstance[];
  /** 当前 3x3 盘面（长 9） */
  grid: (SymbolInstance | null)[];
  /** 当前 3x3 单格结算得分（长 9） */
  cellScores: number[];
  /** 上一抽触发的连锁列表 */
  lastCombos: ComboEvent[];
  /** 当前讨伐中的 Boss */
  currentBoss: BossState;
  /** 本局已击破的最高 Boss 阶段数 */
  bossStageCleared: number;
  /** 本局已击破的最高 Boss 名称（未击破时为「尚未破防」） */
  highestBossName: string;
  /** 待玩家处理的 3选1 选牌候选（null 表示当前无需选牌） */
  pendingDraft: SymbolDef[] | null;
  /** 当前选牌池已重随次数（越高稀有度概率越高） */
  draftRerollLevel: number;
  /** 下一抽是否已注入「算力暴走」(3币) */
  luckyBoostActive: boolean;
  /** 本局已购买「加班续命」次数 */
  overtimeCount: number;
  /** 本局是否已结束 */
  isRunOver: boolean;
  /** 本局结束时的结算鉴定书 */
  runSummary: RunSummary | null;
  /** 本局趣味行为统计 */
  stats: RunStats;
  /** 本局各符号累计贡献分（用于计算 MVP 图标） */
  symbolContributions: Record<string, number>;
  /** 今日已完成局数 */
  runsPlayedToday: number;
  /** 今日单局最高分 */
  bestScoreToday: number;
  /** 花币操作价格表 */
  costs: SlotActionCosts;
}
