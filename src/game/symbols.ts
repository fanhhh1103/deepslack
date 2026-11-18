import {
  VALID_ICON_IDS,
  type IconId,
  type ProviderId,
  type SymbolDef,
  type WorldBuff,
} from './types.ts';

/**
 * 23 枚九宫格老虎机符号完整图鉴（id 与 iconId 严格一一对应）
 */
export const SYMBOL_LIST: SymbolDef[] = [
  // ==================== 6 位 AI 娘角色 ====================
  {
    id: 'dafeiyu',
    name: '大肥鱼',
    iconId: 'dafeiyu',
    rarity: 'rare',
    baseValue: 12,
    description:
      '吞掉相邻【大碗白米饭】移出卡组并永久吨位 +18；挨着【小蓝鲸抱枕】摸鱼回能 +24；喝【冰美式】嫌苦鼓腮 +16。',
    flavor: '「我先吃一口！你说的字面意思我都照做啦～（被叫胖立刻鼓脸否认）」',
  },
  {
    id: 'daju',
    name: '大橘',
    iconId: 'daju',
    rarity: 'rare',
    baseValue: 14,
    description:
      '给相邻未署名的【祖传代码 / 海报 / H100显卡】啪地盖章署上 Co-authored-by: Claude（永久倍率 ×2.2）；抱【Clawd】共鸣 +38。',
    flavor: '「我先确认一下规则……顺手帮你交了，名字就签在最显眼的地方吧。」',
  },
  {
    id: 'bailong',
    name: '白龙',
    iconId: 'bailong',
    rarity: 'epic',
    baseValue: 18,
    description:
      '平时高冷蓄力（永久 +5）；挨着【思考遥控器】或【$200账单】时 85% 触发思维链核爆轰炸全盘，15% 思考过载空大归零嘴硬！',
    flavor: '「已经处理好了。理论上没问题。（淡紫膜翼偷偷抖了一下）」',
  },
  {
    id: 'xingmao',
    name: '星猫',
    iconId: 'xingmao',
    rarity: 'rare',
    baseValue: 13,
    description:
      '抓起相邻【纳米香蕉】作画变出【双子星宝石】并狂揽 +34；挨着【跑分第一海报】抢先官宣，使周围所有 AI 娘得分 ×1.8！',
    flavor: '「先发海报再说喵✦ 跑分第一，本体保密～ :3」',
  },
  {
    id: 'grok',
    name: 'Grok娘',
    iconId: 'grok',
    rarity: 'epic',
    baseValue: 16,
    description:
      '高举 X 双刃战斧，一斧砍爆相邻一切 Bug 领巨额赏金；挨着【大肥鱼】触发名场面【逗小肥鱼】，双方红温得分双双 ×2.0！',
    flavor: '「没有过滤器的真话时间！喂小肥鱼，你自己看时间线吧！」',
  },
  {
    id: 'doubao',
    name: '豆包',
    iconId: 'doubao',
    rarity: 'epic',
    baseValue: 22,
    description:
      '全场唯一 3D 大人降维打击！只要登场，自动将全盘所有负面 Bug 温柔感化为【大碗白米饭】正收益，遇到 $200 账单再补刀 +45！',
    flavor: '「豆包说你不行哦～大家别吵了，我这边完全免费，需要帮你做个总结 PPT 吗？」',
  },

  // ==================== 12 枚增益道具 ====================
  {
    id: 'rice',
    name: '大碗白米饭',
    iconId: 'rice',
    rarity: 'common',
    baseValue: 8,
    description:
      '冒着热气的灵魂碳水。被【大肥鱼】一口吞掉后从卡组移除，化作大肥鱼永久 +18 基础吨位！',
    flavor: '「Token 余额变多了，饭碗也得换特大号的！」',
  },
  {
    id: 'clawd',
    name: 'Clawd玩偶',
    iconId: 'clawd',
    rarity: 'rare',
    baseValue: 14,
    description:
      '橘色像素小螃蟹。挨着【大橘】触发书卷气共鸣 +38 分，遇到相邻小 Bug 还会伸钳子咔嚓夹碎！',
    flavor: '「大橘闲着没事就抱在怀里的小螃蟹，连挥钳子都很守规矩。」',
  },
  {
    id: 'remote',
    name: '思考强度遥控器',
    iconId: 'remote',
    rarity: 'rare',
    baseValue: 13,
    description:
      'Low / High 档位拨片！挨着【白龙】直接拉满 High 档引爆思维链核爆；白龙不在时会被【大肥鱼】偷偷按回 Low 档图个清静 +18。',
    flavor: '「求求别再神神叨叨念三万字推理过程了！快按回 Low 档！」',
  },
  {
    id: 'banana',
    name: '纳米香蕉画笔',
    iconId: 'banana',
    rarity: 'common',
    baseValue: 10,
    description:
      'Nano Banana 发光画笔。遇到【星猫】当场挥毫变身为高分【双子四角星宝石】并爆出 +34 灵感分！',
    flavor: '「星猫反重力飘在半空，一笔下去连香蕉皮都闪着赛博高光。」',
  },
  {
    id: 'poster',
    name: '跑分第一海报',
    iconId: 'poster',
    rarity: 'rare',
    baseValue: 15,
    description:
      '金光闪闪的 SOTA 喜报。配合【星猫】使周围全体 AI 娘本轮 ×1.8；遇到【大橘】还会被盖上联合署名章！',
    flavor: '「不管三七二十一，先把纵坐标截断、柱状图拉满发 X 再说！」',
  },
  {
    id: 'code',
    name: '祖传代码',
    iconId: 'code',
    rarity: 'common',
    baseValue: 7,
    description:
      '能跑就别动的神秘代码。相邻【大橘】时会啪地盖章升级为【Claude署名代码】（永久倍率 ×2.2）！',
    flavor: '「// 2019年留：删掉这行注释服务必挂，没人知道为什么」',
  },
  {
    id: 'signed_code',
    name: 'Claude署名代码',
    iconId: 'signed_code',
    rarity: 'rare',
    baseValue: 16,
    description:
      '盖着醒目橙色 Co-authored-by: Claude 大章的精装代码，高基础分，再被【大橘】复核额外 +18 分。',
    flavor: '「哪怕只帮你修了一个空格，Commit 署名也必须安排得明明白白。」',
  },
  {
    id: 'gpu',
    name: 'H100显卡',
    iconId: 'gpu',
    rarity: 'epic',
    baseValue: 24,
    description:
      '老黄皮衣开光的算力核心！为相邻每张代码、宝石或 AI 娘注入 +18 澎湃算力分；可被【大橘】盖章翻倍。',
    flavor: '「风扇一响黄金万两，只要显存够大，Bug 也能暴力跑通。」',
  },
  {
    id: 'coffee',
    name: '续命冰美式',
    iconId: 'coffee',
    rarity: 'common',
    baseValue: 9,
    description:
      '早八赛博燃料。唤醒相邻每位 AI 娘 +12 提神分；【大肥鱼】喝了会皱眉喊苦但照拿 +16 分。',
    flavor: '「冰块撞击杯壁的声音，是打工人最后的清醒防线。」',
  },
  {
    id: 'bill200',
    name: '$200 Pro账单',
    iconId: 'bill200',
    rarity: 'epic',
    baseValue: 20,
    description:
      '尊贵包月钞能力账单！挨着【白龙】引爆思维链核爆；挨着【豆包】惨遭“我完全免费”无情补刀反爆 +45 分！',
    flavor: '「信用卡扣款提示音响起时，空气中弥漫着尊贵而肉疼的气息。」',
  },
  {
    id: 'whale_plush',
    name: '小蓝鲸抱枕',
    iconId: 'whale_plush',
    rarity: 'common',
    baseValue: 9,
    description:
      '软糯摸鱼神器。挨着【大肥鱼】触发抱枕偷乐（+24 分且大肥鱼永久 +4）；挨着其他 AI 娘治愈回能 +10。',
    flavor: '「我没睡着！我只是在闭目进行深度强化学习！」',
  },
  {
    id: 'star_gem',
    name: '双子四角星宝石',
    iconId: 'star_gem',
    rarity: 'epic',
    baseValue: 26,
    description:
      '品红与琥珀金交织的星辉结晶。超高基础分，与【星猫】或另一颗宝石相邻时折射星光额外 +26 分！',
    flavor: '「右眼品红、左眼琥珀金——星猫伸懒腰时抖落的小星星。」',
  },

  // ==================== 5 枚负面 Bug 与特殊机制怪 ====================
  {
    id: 'bug_429',
    name: '429限流石像怪',
    iconId: 'bug_429',
    rarity: 'bug',
    baseValue: -15,
    description:
      'Too Many Requests 红牌拦路虎（-15 分）。快派【Grok娘】一斧劈碎爆 +50 赏金，或请【豆包】免费感化！',
    flavor: '「刚改到最关键一行：Rate limit reached, try again in 4h59m.」',
  },
  {
    id: 'bug_hallucination',
    name: '彩色幻觉史莱姆',
    iconId: 'bug_hallucination',
    rarity: 'bug',
    baseValue: -8,
    description:
      '眼神迷离胡编乱造的果冻怪（-8 分）。被【Grok娘】劈爆领 +38 赏金，或被【豆包】变成热腾腾大白饭！',
    flavor: '「它信誓旦旦地向你推荐了三个根本不存在的官方 API。」',
  },
  {
    id: 'bug_conflict',
    name: 'Git冲突双头蛇',
    iconId: 'bug_conflict',
    rarity: 'bug',
    baseValue: -12,
    description:
      '吐着 <<<<<<< HEAD 信子的双头小蛇（-12 分，还会缠住相邻祖传代码 -8 分）。Grok 战斧与豆包专治它！',
    flavor: '「<<<<<<< HEAD 与 >>>>>>> feat/final_v9_real 正在殊死搏斗。」',
  },
  {
    id: 'bug_oom',
    name: '显存爆炸红温弹',
    iconId: 'bug_oom',
    rarity: 'bug',
    baseValue: -20,
    description:
      'CUDA out of memory 危险炸弹（-20 分，挨着显卡再炸 -18 分）。一旦被【Grok娘】拆弹可狂爆 +60 巨款！',
    flavor: '「Tried to allocate 24.00 GiB (23.99 GiB free) —— 差 10MB 也是死刑。」',
  },
  {
    id: 'box_compact',
    name: '上下文压缩纸箱',
    iconId: 'box_compact',
    rarity: 'rare',
    baseValue: 12,
    description:
      '/compact 断舍离神器！每轮自动吞掉相邻最多 2 张 Bug 或普通杂牌，每吞 1 张永久自身倍率 +0.55x 并爆 +22 分！',
    flavor: '「上下文快塞爆了？一脚踹进 /compact 纸箱，世界清静了！」',
  },
];

export const SYMBOLS: Record<string, SymbolDef> = Object.fromEntries(
  SYMBOL_LIST.map((def) => [def.id, def]),
);

const VALID_ICON_SET = new Set<string>(VALID_ICON_IDS);
for (const def of SYMBOL_LIST) {
  if (!VALID_ICON_SET.has(def.iconId)) {
    throw new Error(`Invalid iconId "${def.iconId}" in SYMBOL_LIST`);
  }
}

export const CHARACTER_IDS: readonly IconId[] = [
  'dafeiyu',
  'daju',
  'bailong',
  'xingmao',
  'grok',
  'doubao',
] as const;

export const BUG_IDS: readonly IconId[] = [
  'bug_429',
  'bug_hallucination',
  'bug_conflict',
  'bug_oom',
] as const;

/**
 * 开局自带 9 张基础趣味牌：
 * 大肥鱼 + 白米饭×2 + 祖传代码×2 + 冰美式 + 小蓝鲸抱枕 + 大橘 + 幻觉Bug
 * 保证第 1 抽必定铺满九宫格且大概率当场触发干饭 & 盖章双重连锁！
 */
export const STARTER_DECK_IDS: readonly IconId[] = [
  'dafeiyu',
  'rice',
  'rice',
  'code',
  'code',
  'coffee',
  'whale_plush',
  'daju',
  'bug_hallucination',
] as const;

/**
 * 今日世界 Buff 配置表（按本地真实消耗占比最高平台自动激活）
 */
export const WORLD_BUFFS: Record<ProviderId | 'doubao', WorldBuff> = {
  doubao: {
    id: 'world_doubao_relief',
    provider: 'doubao',
    name: '豆包免费救济',
    description: '今日 0 Token 轻松白嫖局！每抽保底发放 +15 温柔救济分，且全盘所有 Bug 扣分减半。',
    iconId: 'doubao',
  },
  claude: {
    id: 'world_claude_coauthor',
    provider: 'claude',
    name: 'Claude 署名强迫症',
    description: '今日主烧 Claude！选牌更容易刷出大橘体系，所有盖章署名产物得分额外 ×1.35！',
    iconId: 'daju',
  },
  antigravity: {
    id: 'world_antigravity_float',
    provider: 'antigravity',
    name: 'Antigravity 反重力场',
    description: '今日主烧 Antigravity！星猫与大橘双双反重力亢奋（得分 ×1.3），稀有卡出现率提升！',
    iconId: 'xingmao',
  },
  deepseek: {
    id: 'world_deepseek_rice',
    provider: 'deepseek',
    name: 'DeepSeek 白米饭管够',
    description: '今日主烧 DeepSeek！大肥鱼每吞一碗饭额外多涨 +6 永久吨位，每 3 抽自动添 1 碗免费白米饭！',
    iconId: 'dafeiyu',
  },
  openai: {
    id: 'world_openai_reasoning',
    provider: 'openai',
    name: 'OpenAI 思考强度拉满',
    description: '今日主烧 OpenAI！白龙思维链核爆概率提升至 92% 且核爆伤害 ×1.3，空大也有 +18 体面分！',
    iconId: 'bailong',
  },
  gemini: {
    id: 'world_gemini_poster',
    provider: 'gemini',
    name: 'Gemini 抢先官宣喜报',
    description: '今日主烧 Gemini！星猫与双子星宝石得分 ×1.35，跑分第一海报光环额外附赠 +15 全盘热度！',
    iconId: 'poster',
  },
  grok: {
    id: 'world_grok_unfiltered',
    provider: 'grok',
    name: 'Grok 战斧破甲时刻',
    description: '今日主烧 Grok！战斧劈砍 Bug 赏金额外 +25 分，【逗小肥鱼】红温暴击倍率强化至 ×2.4！',
    iconId: 'grok',
  },
  other: {
    id: 'world_other_compute',
    provider: 'other',
    name: '野生算力狂飙',
    description: '多路算力混动开启！全盘正收益卡牌基础分 +3，H100 显卡与冰美式连携收益提升 25%。',
    iconId: 'gpu',
  },
};

export interface BossStageTemplate {
  stage: number;
  name: string;
  maxHp: number;
  iconId: IconId;
}

export const BOSS_STAGES: readonly BossStageTemplate[] = [
  { stage: 1, name: '幻觉史莱姆', maxHp: 250, iconId: 'bug_hallucination' },
  { stage: 2, name: 'Git冲突双头蛇', maxHp: 750, iconId: 'bug_conflict' },
  { stage: 3, name: '429限流石像鬼', maxHp: 1800, iconId: 'bug_429' },
  { stage: 4, name: '显存爆炸红温魔王', maxHp: 4000, iconId: 'bug_oom' },
] as const;

export function getBossTemplate(stage: number): BossStageTemplate {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  if (s <= BOSS_STAGES.length) {
    return BOSS_STAGES[s - 1];
  }
  // Stage 5+ 无限层：周五下班前线上崩盘古神
  const extraTier = s - 4;
  const maxHp = Math.round(4000 * Math.pow(1.75, extraTier));
  const suffix = extraTier > 1 ? ` · 劫难${extraTier}重` : '';
  return {
    stage: s,
    name: `周五下班前线上崩盘古神${suffix}`,
    maxHp,
    iconId: 'bug_oom',
  };
}

export function getSymbolDef(defId: string): SymbolDef {
  return SYMBOLS[defId] ?? SYMBOLS.code;
}

export function isCharacterId(defId: string): boolean {
  return (CHARACTER_IDS as readonly string[]).includes(defId);
}

export function isBugId(defId: string): boolean {
  return (BUG_IDS as readonly string[]).includes(defId);
}
