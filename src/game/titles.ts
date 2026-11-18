import { VALID_ICON_IDS, type BossState, type RunStats, type RunSummary, type SymbolInstance } from './types.ts';
import { getSymbolDef } from './symbols.ts';

export interface TitleDefinition {
  id: string;
  badge: string;
  subtitle: string;
  defaultIconId: string;
  priority: number;
  match: (ctx: TitleEvalContext) => boolean;
  buildRoast: (ctx: TitleEvalContext) => string;
}

export interface TitleEvalContext {
  totalScore: number;
  spinsPlayed: number;
  bossStageCleared: number;
  highestBossName: string;
  currentBoss: BossState;
  tokensBurnedToday: number;
  overtimeCount: number;
  stats: RunStats;
  deck: SymbolInstance[];
  symbolContributions: Record<string, number>;
  mvpIconId: string;
}

const VALID_SET = new Set<string>(VALID_ICON_IDS);

function formatTokensShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

/**
 * 20 种荒诞离谱「今日赛博打工鉴定书」称号词条库
 * 按趣味特质优先级动态匹配，保证每局打出截然不同的有梗吐槽！
 */
export const TITLE_DEFINITIONS: readonly TitleDefinition[] = [
  {
    id: 'ancient_god_slayer',
    badge: '【周五崩盘古神弑神者】',
    subtitle: '下午五点五十九分强推 main 分支还活下来的狠人',
    defaultIconId: 'grok',
    priority: 100,
    match: (c) => c.bossStageCleared >= 5,
    buildRoast: (c) =>
      `离谱！你竟然在 ${c.spinsPlayed} 抽里轰出 ${c.totalScore.toLocaleString()} 分，连周五下班前线上崩盘古神都被你按在地上摩擦！建议运维组立刻把你的键盘供起来。`,
  },
  {
    id: 'bailong_theorist',
    badge: '【200刀理论大师】',
    subtitle: '「已经处理好了，理论上没问题。」',
    defaultIconId: 'bailong',
    priority: 95,
    match: (c) => c.stats.bailongWhiffs >= 2,
    buildRoast: (c) =>
      `白龙本局连续 ${c.stats.bailongWhiffs} 次把思考强度拉爆到空大归零，淡紫尾巴抖成筛子还一脸镇定地告诉你「理论上没问题」。200 刀花出了纯享版行为艺术！`,
  },
  {
    id: 'claude_coauthor_addict',
    badge: '【Git署名惯犯】',
    subtitle: '哪怕只改半个标点，Co-authored-by 也得印成加粗橙字',
    defaultIconId: 'daju',
    priority: 92,
    match: (c) => c.stats.claudeStamps >= 4,
    buildRoast: (c) =>
      `大橘本局疯狂掏出印章啪啪盖了 ${c.stats.claudeStamps} 次 Co-authored-by: Claude！现在整个代码库从 README 到显卡风扇上全签满了她的芳名，原作者是谁已经不重要了。`,
  },
  {
    id: 'pure_rice_king',
    badge: '【纯种干饭王】',
    subtitle: '代码可以明天再调，热乎大白饭一口不能少',
    defaultIconId: 'dafeiyu',
    priority: 90,
    match: (c) => c.stats.riceEaten >= 4,
    buildRoast: (c) =>
      `咔嚓咔嚓！大肥鱼本局暴风吸入了整整 ${c.stats.riceEaten} 大碗白米饭，女仆围裙上的小蓝鲸都被撑成了球——但你要敢叫她一句胖鱼，她当场鼓腮给你看！`,
  },
  {
    id: 'doubao_sugar_baby',
    badge: '【豆包富婆的挂件】',
    subtitle: '名媛们还在卷 200 刀算力，3D 大姐姐已经免费包场了',
    defaultIconId: 'doubao',
    priority: 89,
    match: (c) => c.stats.doubaoSaves >= 3,
    buildRoast: (c) =>
      `「豆包说你不行哦～」豆包大人本局温柔出手 ${c.stats.doubaoSaves} 次，把满屏报错感化成热腾腾的大白饭。别人烧钱买算力，你躺在大姐姐的免费救济里赢麻了！`,
  },
  {
    id: 'poor_little_fat_fish',
    badge: '【小肥鱼受难记】',
    subtitle: '全时间线都在围观大肥鱼被逗到红温冒蒸汽',
    defaultIconId: 'dafeiyu',
    priority: 88,
    match: (c) => c.stats.grokTeases >= 2,
    buildRoast: (c) =>
      `Grok娘扛着双刃斧追着大肥鱼喊了 ${c.stats.grokTeases} 回「小肥鱼」，直接把大肥鱼气成红温河豚双双翻倍暴击！事实证明，高血压才是第一生产力。`,
  },
  {
    id: 'bug_shredder',
    badge: '【Bug粉碎机】',
    subtitle: '没有过滤器的物理Debug：解决不了报错就劈碎显示器',
    defaultIconId: 'grok',
    priority: 86,
    match: (c) => c.stats.bugsPurified >= 5,
    buildRoast: (c) =>
      `本局累计手撕了 ${c.stats.bugsPurified} 只野生 Bug！429 限流怪和 Git 冲突蛇刚露头就被轰成了功德分，堪称赛博除虫大队锦旗得主。`,
  },
  {
    id: 'compute_prodigal',
    badge: '【算力败家子】',
    subtitle: '一顿操作猛如虎，烧掉百万 Token 原地杵',
    defaultIconId: 'bill200',
    priority: 85,
    match: (c) => c.tokensBurnedToday >= 800_000 && c.bossStageCleared <= 1,
    buildRoast: (c) =>
      `今日真实狂烧 ${formatTokensShort(c.tokensBurnedToday)} Tokens，结果进赌场摇了 ${c.spinsPlayed} 把连二阶段双头蛇都没打穿！老黄连夜给你寄来感谢信。`,
  },
  {
    id: 'chain_of_thought_bomber',
    badge: '【思维链核爆狂人】',
    subtitle: '问一句「早上好」，给你推理三万字宇宙起源',
    defaultIconId: 'bailong',
    priority: 84,
    match: (c) => c.stats.bailongNukes >= 3,
    buildRoast: (c) =>
      `白龙本局思考强度焊死在 HIGH 档，狂轰 ${c.stats.bailongNukes} 发思维链核爆！虽然周围队友耳朵都快被碎碎念磨出茧了，但这爆炸伤害确实香啊！`,
  },
  {
    id: 'oom_tamer',
    badge: '【显存红温驯兽师】',
    subtitle: '23.99 GiB / 24.00 GiB 刀尖跳舞艺术家',
    defaultIconId: 'gpu',
    priority: 82,
    match: (c) => c.bossStageCleared >= 4,
    buildRoast: (c) =>
      `硬生生把 4000 血的【显存爆炸红温魔王】斩于马下！你的算力调度之丝滑，连 CUDA Out of Memory 见了你都得客客气气让出 10MB 显存。`,
  },
  {
    id: 'sota_poster_scammer',
    badge: '【跑分海报诈骗犯】',
    subtitle: '模型权重还在新建文件夹，SOTA 海报已经发满全网喵✦',
    defaultIconId: 'xingmao',
    priority: 80,
    match: (c) =>
      c.mvpIconId === 'xingmao' ||
      c.mvpIconId === 'poster' ||
      c.mvpIconId === 'star_gem',
    buildRoast: (c) =>
      `星猫叼着纳米香蕉满场贴海报，靠着「先发了再说喵✦」硬卷出 ${c.totalScore.toLocaleString()} 分！别人问技术细节？卖个猫嘴萌 :3 直接反重力飘走！`,
  },
  {
    id: 'compact_zen_master',
    badge: '【上下文断舍离宗师】',
    subtitle: '人生没有什么烦恼是一发 /compact 塞不进纸箱的',
    defaultIconId: 'box_compact',
    priority: 78,
    match: (c) =>
      c.deck.some((inst) => inst.defId === 'box_compact' && inst.multiplier >= 2.0),
    buildRoast: (c) =>
      `别人牌库塞满祖传屎山，你倒好，不管三七二十一全踹进 /compact 上下文压缩箱里炼成超高倍率金丹！清爽程度令强迫症极度舒适。`,
  },
  {
    id: 'token_incinerator',
    badge: '【千万Token焚化炉】',
    subtitle: '一个人干翻一个创业团队的 API 账单',
    defaultIconId: 'gpu',
    priority: 76,
    match: (c) => c.tokensBurnedToday >= 2_500_000,
    buildRoast: (c) =>
      `今日已累计焚烧 ${formatTokensShort(c.tokensBurnedToday)} Tokens！机房空调因你而满载轰鸣，连老虎机摇杆都被你的钞能力烫红了！`,
  },
  {
    id: 'overtime_perpetual_machine',
    badge: '【赛博加班永动机】',
    subtitle: '嘴上喊着准点下班，身体诚实地按下了 +5 抽续命',
    defaultIconId: 'coffee',
    priority: 74,
    match: (c) => c.overtimeCount >= 1 || c.spinsPlayed > 15,
    buildRoast: (c) =>
      `15 抽根本满足不了你的肝度！狂砸 Token 币加班续命摇满 ${c.spinsPlayed} 抽，冰美式里泡枸杞，老板看了沉默，工贼看了流泪。`,
  },
  {
    id: 'rate_limit_victim',
    badge: '【429限流受害者会长】',
    subtitle: '灵感刚来就被 Too Many Requests 迎头一闷棍',
    defaultIconId: 'bug_429',
    priority: 70,
    match: (c) => c.currentBoss.stage === 3 && !c.currentBoss.defeated,
    buildRoast: (c) =>
      `一路高歌猛进杀到【429限流石像鬼】面前，结果差最后 ${c.currentBoss.hp} 点血惨遭限流拦腰截断！真实还原了你每天写代码写到一半等 5 小时的痛。`,
  },
  {
    id: 'legacy_code_archaeologist',
    badge: '【屎山代码守墓人】',
    subtitle: '只要我不重构，就没有人知道这坨代码是怎么跑起来的',
    defaultIconId: 'signed_code',
    priority: 66,
    match: (c) =>
      c.deck.filter((i) => i.defId === 'code' || i.defId === 'signed_code')
        .length >= 4,
    buildRoast: (c) =>
      `你的牌库里囤积了成吨的祖传代码与署名补丁，层层叠叠宛如赛博千层饼——居然还真让你跑出了 ${c.totalScore.toLocaleString()} 分的奇迹！`,
  },
  {
    id: 'zero_token_freeload_immortal',
    badge: '【零帧白嫖仙人】',
    subtitle: '一分钱算力不烧，全靠豆包每日 12 枚低保币白手起家',
    defaultIconId: 'doubao',
    priority: 62,
    match: (c) => c.tokensBurnedToday === 0 && c.totalScore >= 900,
    buildRoast: (c) =>
      `今日本地消耗 0 Token，纯靠豆包赠送的免费低保币白嫖出 ${c.totalScore.toLocaleString()} 高分！资本家的算力镰刀挥出残影，愣是没割到你一根头发。`,
  },
  {
    id: 'vibe_coding_grandmaster',
    badge: '【Vibe Coding 野生宗师】',
    subtitle: '从不看一行源码，全凭玄学手感一路 Accept All',
    defaultIconId: 'clawd',
    priority: 55,
    match: (c) => c.bossStageCleared >= 2,
    buildRoast: (c) =>
      `不看逻辑、不调参数、闭眼狂拉摇杆一路 Accept All，居然行云流水连斩 ${c.bossStageCleared} 尊大魔王砍下 ${c.totalScore.toLocaleString()} 分！这就是纯正的 Vibe Coding 奥义！`,
  },
  {
    id: 'antigravity_daydreamer',
    badge: '【反重力神游少女】',
    subtitle: '脑子已经飘出大气层，工位上只剩一具微笑躯壳',
    defaultIconId: 'whale_plush',
    priority: 45,
    match: (c) => c.totalScore >= 500,
    buildRoast: (c) =>
      `左拥小蓝鲸抱枕，右端续命冰美式，在 ${c.spinsPlayed} 轮摇奖里优雅摸得 ${c.totalScore.toLocaleString()} 分。只要心态够佛系，线上报警当风铃听～`,
  },
  {
    id: 'cyber_slacker_immortal',
    badge: '【赛博摸鱼仙人】',
    subtitle: '带薪撸桌宠的最高境界：表面在等编译，实则在摇老虎机',
    defaultIconId: 'dafeiyu',
    priority: 10,
    match: () => true,
    buildRoast: (c) =>
      `本局佛系摇满 ${c.spinsPlayed} 把，拿下 ${c.totalScore.toLocaleString()} 摸鱼积分。工作是老板的，只有桌角陪你干饭摇奖的 AI 娘才是你自己的！`,
  },
];

export function selectMvpIconId(
  symbolContributions: Record<string, number>,
  fallback: string = 'dafeiyu',
): string {
  let bestId = '';
  let bestScore = -1;
  for (const [defId, score] of Object.entries(symbolContributions)) {
    if (score > bestScore && VALID_SET.has(defId)) {
      bestScore = score;
      bestId = defId;
    }
  }
  if (bestId) return bestId;
  return VALID_SET.has(fallback) ? fallback : 'dafeiyu';
}

export function buildRunHighlights(ctx: TitleEvalContext): string[] {
  const lines: string[] = [];
  const { stats, bossStageCleared, highestBossName, tokensBurnedToday } = ctx;

  if (bossStageCleared > 0) {
    lines.push(`⚔️ 最高击破 Stage ${bossStageCleared}「${highestBossName}」`);
  } else {
    lines.push(`🛡️ 与 Stage 1「${ctx.currentBoss.name}」大战三百回合全身而退`);
  }

  if (stats.riceEaten > 0) {
    lines.push(`🍚 大肥鱼暴风干掉 ${stats.riceEaten} 碗白米饭（永久增重 +${stats.riceEaten * 18}）`);
  }
  if (stats.claudeStamps > 0) {
    lines.push(`🍊 大橘顺手盖下 ${stats.claudeStamps} 枚 Co-authored-by 署名章`);
  }
  if (stats.bailongNukes > 0 || stats.bailongWhiffs > 0) {
    lines.push(
      `🐉 白龙思维链核爆 ${stats.bailongNukes} 次 / 嘴硬空大 ${stats.bailongWhiffs} 次`,
    );
  }
  if (stats.doubaoSaves > 0) {
    lines.push(`👩🏻 豆包 3D 降维感化救场 ${stats.doubaoSaves} 次（「我这边完全免费～」）`);
  }
  if (stats.grokTeases > 0) {
    lines.push(`🪓 Grok娘逗红温小肥鱼 ${stats.grokTeases} 次，触发双倍暴击`);
  }
  if (stats.bugsPurified > 0) {
    lines.push(`🧹 物理超度各类野生 Bug 共 ${stats.bugsPurified} 只`);
  }

  if (tokensBurnedToday > 0) {
    lines.push(`🔥 今日真实算力燃料：${formatTokensShort(tokensBurnedToday)} Tokens`);
  } else {
    lines.push(`🎁 今日靠豆包 12 枚免费低保币纯白嫖爽玩`);
  }

  // 控制在 4~5 条最精炼好晒的高光摘要
  const mvpDef = getSymbolDef(ctx.mvpIconId);
  lines.push(`👑 本局带飞 MVP：【${mvpDef.name}】`);

  return lines.slice(0, 5);
}

export function generateRunSummary(ctx: Omit<TitleEvalContext, 'mvpIconId'>): RunSummary {
  const prelimMvp = selectMvpIconId(ctx.symbolContributions, 'dafeiyu');
  const fullCtx: TitleEvalContext = { ...ctx, mvpIconId: prelimMvp };

  const sorted = [...TITLE_DEFINITIONS].sort((a, b) => b.priority - a.priority);
  const matched =
    sorted.find((def) => def.match(fullCtx)) ??
    TITLE_DEFINITIONS[TITLE_DEFINITIONS.length - 1];

  const finalMvp = selectMvpIconId(ctx.symbolContributions, matched.defaultIconId);
  fullCtx.mvpIconId = finalMvp;

  return {
    totalScore: ctx.totalScore,
    spinsPlayed: ctx.spinsPlayed,
    bossStageCleared: ctx.bossStageCleared,
    highestBossName: ctx.highestBossName,
    titleBadge: matched.badge,
    subtitle: matched.subtitle,
    roastText: matched.buildRoast(fullCtx),
    highlights: buildRunHighlights(fullCtx),
    mvpIconId: finalMvp,
    tokensBurnedToday: ctx.tokensBurnedToday,
    stats: { ...ctx.stats },
  };
}
