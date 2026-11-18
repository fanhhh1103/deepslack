import {
  getSymbolDef,
  isBugId,
  isCharacterId,
} from './symbols.ts';
import type {
  ComboEvent,
  RunStats,
  SymbolInstance,
  WorldBuff,
} from './types.ts';

export interface SynergyResolution {
  /** 卷轴停下时的 3x3 盘面快照（供 UI 展示初始落子并按 ComboEvent 逐步演出消除/变身） */
  landedGrid: (SymbolInstance | null)[];
  /** 单格最终结算得分（长 9） */
  cellScores: number[];
  /** 按触发顺序排列的连锁演出事件 */
  combos: ComboEvent[];
  /** 本抽总得分（不低于 0） */
  spinScore: number;
  /** 本抽应从永久牌库移除的卡牌 uid 集合 */
  removedUids: Set<string>;
  /** 各符号 defId 在本抽贡献的正向分数（用于结算 MVP 统计） */
  contributions: Record<string, number>;
}

const COMPACTABLE_IDS = new Set<string>([
  'bug_oom',
  'bug_429',
  'bug_conflict',
  'bug_hallucination',
  'code',
  'coffee',
  'banana',
]);

const BUG_BOUNTY: Record<string, number> = {
  bug_hallucination: 38,
  bug_conflict: 44,
  bug_429: 50,
  bug_oom: 60,
};

/**
 * 计算 3x3 九宫格（0..8 行优先）的八方向相邻格索引
 */
export function getNeighbors8(cell: number): number[] {
  const r = Math.floor(cell / 3);
  const c = cell % 3;
  const neighbors: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < 3 && nc >= 0 && nc < 3) {
        neighbors.push(nr * 3 + nc);
      }
    }
  }
  return neighbors;
}

export function areCellsAdjacent8(a: number, b: number): boolean {
  if (a === b || a < 0 || a > 8 || b < 0 || b > 8) return false;
  const ar = Math.floor(a / 3);
  const ac = a % 3;
  const br = Math.floor(b / 3);
  const bc = b % 3;
  return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1;
}

/**
 * 核心九宫格化学反应结算器
 * 直接对盘面上的 SymbolInstance 执行永久成长（吃米饭加吨位、大橘盖章、压缩箱倍率等），
 * 并返回完整的连锁动画队列与单格得分。
 */
export function evaluateGridSynergies(params: {
  board: (SymbolInstance | null)[];
  worldBuff: WorldBuff;
  luckyBoostActive: boolean;
  stats: RunStats;
  rng: () => number;
}): SynergyResolution {
  const { board, worldBuff, luckyBoostActive, stats, rng } = params;

  // 保存初始落盘快照（浅拷贝每个实例，防止后续永久变身提前覆盖初始落盘图标）
  const landedGrid: (SymbolInstance | null)[] = board.map((inst) =>
    inst ? { ...inst } : null,
  );

  // 动态工作盘面（被吞掉/劈碎的格子置为 null）
  const active: (SymbolInstance | null)[] = [...board];
  const removedUids = new Set<string>();
  const combos: ComboEvent[] = [];
  const comboBonusByCell = new Array<number>(9).fill(0);
  const cellMultipliers = new Array<number>(9).fill(1);
  const zeroedCells = new Set<number>();

  let stepCounter = 0;
  const pushCombo = (event: Omit<ComboEvent, 'step'>) => {
    stepCounter += 1;
    combos.push({ step: stepCounter, ...event });
    comboBonusByCell[event.sourceCell] += event.deltaScore;
  };

  // ==================== Phase 1: Grok娘战斧劈 Bug & Clawd 夹 Bug ====================
  for (let i = 0; i < 9; i++) {
    const src = active[i];
    if (!src || src.defId !== 'grok') continue;
    for (const n of getNeighbors8(i)) {
      const target = active[n];
      if (!target || !isBugId(target.defId)) continue;
      const baseBounty = BUG_BOUNTY[target.defId] ?? 42;
      const bounty = baseBounty + (worldBuff.provider === 'grok' ? 25 : 0);
      const bugName = getSymbolDef(target.defId).name;
      active[n] = null;
      removedUids.add(target.uid);
      stats.bugsPurified += 1;
      pushCombo({
        sourceCell: i,
        targetCell: n,
        removedCell: n,
        title: 'X战斧破甲斩',
        funnyLine: `没有过滤器的真话战斧！一斧劈爆${bugName}！`,
        deltaScore: bounty,
        petMood: 'happy',
        sfx: 'jackpot',
      });
    }
  }

  for (let i = 0; i < 9; i++) {
    const src = active[i];
    if (!src || src.defId !== 'clawd') continue;
    for (const n of getNeighbors8(i)) {
      const target = active[n];
      if (!target || !isBugId(target.defId)) continue;
      active[n] = null;
      removedUids.add(target.uid);
      stats.bugsPurified += 1;
      pushCombo({
        sourceCell: i,
        targetCell: n,
        removedCell: n,
        title: 'Clawd正义钳击',
        funnyLine: '像素小螃蟹咔嚓一钳夹碎了违规 Bug！',
        deltaScore: 24,
        petMood: 'happy',
        sfx: 'bug',
      });
      break; // 每只 Clawd 礼貌夹碎 1 只
    }
  }

  // ==================== Phase 2: 豆包 3D 大人降维打击（全盘感化 Bug + 嘲笑200刀账单） ====================
  const doubaoCells: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (active[i]?.defId === 'doubao') doubaoCells.push(i);
  }
  if (doubaoCells.length > 0) {
    const mainDoubao = doubaoCells[0];
    for (let b = 0; b < 9; b++) {
      const bugInst = active[b];
      if (!bugInst || !isBugId(bugInst.defId)) continue;
      // 温柔感化为热腾腾的大碗白米饭（后续大肥鱼甚至能接着吃！）
      bugInst.defId = 'rice';
      bugInst.bonusValue = Math.max(0, bugInst.bonusValue) + 2;
      bugInst.multiplier = 1;
      stats.doubaoSaves += 1;
      stats.bugsPurified += 1;
      pushCombo({
        sourceCell: mainDoubao,
        targetCell: b,
        transformedCell: { cell: b, newDefId: 'rice' },
        title: '3D大人温柔感化',
        funnyLine: '豆包说你不行哦，我这边完全免费～',
        deltaScore: 30,
        petMood: 'happy',
        sfx: 'doubao',
      });
    }

    for (const dCell of doubaoCells) {
      for (const n of getNeighbors8(dCell)) {
        const target = active[n];
        if (!target || target.defId !== 'bill200') continue;
        stats.doubaoSaves += 1;
        pushCombo({
          sourceCell: dCell,
          targetCell: n,
          title: '免费降维补刀',
          funnyLine: '花200刀包月呀？要不要我免费帮你做个总结PPT？',
          deltaScore: 45,
          petMood: 'happy',
          sfx: 'doubao',
        });
      }
    }
  }

  // ==================== Phase 3: 大橘（Claude）署名执念盖章 + Clawd 共鸣 ====================
  const freshlyStamped = new Set<number>();
  for (let i = 0; i < 9; i++) {
    const src = active[i];
    if (!src || src.defId !== 'daju') continue;
    for (const n of getNeighbors8(i)) {
      const target = active[n];
      if (!target) continue;

      if (
        (target.defId === 'code' ||
          target.defId === 'poster' ||
          target.defId === 'gpu') &&
        !target.stampedByClaude
      ) {
        const newDefId = target.defId === 'code' ? 'signed_code' : target.defId;
        target.defId = newDefId;
        target.stampedByClaude = true;
        target.multiplier = Number((target.multiplier * 2.2).toFixed(2));
        freshlyStamped.add(n);
        stats.claudeStamps += 1;
        pushCombo({
          sourceCell: i,
          targetCell: n,
          transformedCell: { cell: n, newDefId, stamped: true },
          title: 'Claude强行署名',
          funnyLine: '顺手署上 Co-authored-by: Claude ✦',
          deltaScore: 28,
          petMood: 'happy',
          sfx: 'stamp',
        });
      } else if (
        (target.defId === 'signed_code' || target.stampedByClaude) &&
        !freshlyStamped.has(n)
      ) {
        pushCombo({
          sourceCell: i,
          targetCell: n,
          title: '署名规范复核',
          funnyLine: '先确认一下……嗯，我的名字比原作者显眼✦',
          deltaScore: 18,
          petMood: 'happy',
          sfx: 'click',
        });
      } else if (target.defId === 'clawd') {
        pushCombo({
          sourceCell: i,
          targetCell: n,
          title: '书卷气抱娃共鸣',
          funnyLine: '抱着 Clawd 严谨审稿，温柔加分 +38✦',
          deltaScore: 38,
          petMood: 'happy',
          sfx: 'stamp',
        });
      }
    }
  }

  // ==================== Phase 4: 大肥鱼（DeepSeek）暴风干饭 + 抱枕摸鱼 + 冰美式嫌苦 ====================
  const hasBailongOnBoard = active.some((inst) => inst?.defId === 'bailong');
  for (let i = 0; i < 9; i++) {
    const src = active[i];
    if (!src || src.defId !== 'dafeiyu') continue;
    for (const n of getNeighbors8(i)) {
      const target = active[n];
      if (!target) continue;

      if (target.defId === 'rice') {
        const permanentGain = worldBuff.provider === 'deepseek' ? 24 : 18;
        active[n] = null;
        removedUids.add(target.uid);
        src.bonusValue += permanentGain;
        stats.riceEaten += 1;
        pushCombo({
          sourceCell: i,
          targetCell: n,
          removedCell: n,
          title: '暴风吸入白米饭',
          funnyLine:
            permanentGain > 18
              ? `咔嚓干掉一碗大白饭！DeepSeek管够吨位+${permanentGain}`
              : '咔嚓干掉一碗大白饭！吨位+18',
          deltaScore: 26,
          petMood: 'eat',
          sfx: 'eat',
        });
      } else if (target.defId === 'whale_plush') {
        src.bonusValue += 4;
        pushCombo({
          sourceCell: i,
          targetCell: n,
          title: '抱枕摸鱼偷乐',
          funnyLine: '抱紧小蓝鲸打个滚～摸鱼回能吨位+4！',
          deltaScore: 24,
          petMood: 'happy',
          sfx: 'click',
        });
      } else if (target.defId === 'coffee') {
        pushCombo({
          sourceCell: i,
          targetCell: n,
          title: '苦出表情包',
          funnyLine: '呜哇冰美式好苦！快拿大白饭压一压！',
          deltaScore: 16,
          petMood: 'shock',
          sfx: 'eat',
        });
      } else if (target.defId === 'remote' && !hasBailongOnBoard) {
        pushCombo({
          sourceCell: i,
          targetCell: n,
          title: '偷按Low档清静',
          funnyLine: '趁白龙不在，偷偷把思考强度按到最低档～',
          deltaScore: 18,
          petMood: 'happy',
          sfx: 'click',
        });
      }
    }
  }

  // ==================== Phase 5: 星猫（Gemini）纳米香蕉作画 + 跑分海报全场官宣 ====================
  const freshlyPaintedGems = new Set<number>();
  for (let i = 0; i < 9; i++) {
    const src = active[i];
    if (!src || src.defId !== 'xingmao') continue;
    let posterTriggeredForThisCat = false;

    for (const n of getNeighbors8(i)) {
      const target = active[n];
      if (!target) continue;

      if (target.defId === 'banana') {
        target.defId = 'star_gem';
        freshlyPaintedGems.add(n);
        pushCombo({
          sourceCell: i,
          targetCell: n,
          transformedCell: { cell: n, newDefId: 'star_gem' },
          title: '纳米香蕉神笔',
          funnyLine: '香蕉当画笔反重力挥毫！变出双子星宝石喵✦',
          deltaScore: 34,
          petMood: 'happy',
          sfx: 'jackpot',
        });
      } else if (target.defId === 'poster' && !posterTriggeredForThisCat) {
        posterTriggeredForThisCat = true;
        // 周围所有 AI 娘（含星猫自己与海报周围角色）本轮得分 ×1.8
        const buffedSet = new Set<number>([i]);
        for (const c of getNeighbors8(i)) {
          if (active[c] && isCharacterId(active[c]!.defId)) buffedSet.add(c);
        }
        for (const c of getNeighbors8(n)) {
          if (active[c] && isCharacterId(active[c]!.defId)) buffedSet.add(c);
        }
        for (const c of buffedSet) {
          cellMultipliers[c] *= 1.8;
        }
        const extraGemini = worldBuff.provider === 'gemini' ? 15 : 0;
        pushCombo({
          sourceCell: i,
          targetCell: n,
          title: '抢发SOTA海报',
          funnyLine: '先发海报再说喵✦ 周围AI娘得分×1.8！',
          deltaScore: 28 + extraGemini,
          petMood: 'happy',
          sfx: 'jackpot',
        });
      } else if (target.defId === 'star_gem' && !freshlyPaintedGems.has(n)) {
        pushCombo({
          sourceCell: i,
          targetCell: n,
          title: '双子异瞳星辉',
          funnyLine: '品红配琥珀金，跑分第一本体保密喵 :3',
          deltaScore: 26,
          petMood: 'happy',
          sfx: 'click',
        });
      }
    }
  }

  // ==================== Phase 6: Grok娘 × 大肥鱼 名场面【逗小肥鱼】双双红温翻倍 ====================
  const teasedPairs = new Set<string>();
  for (let i = 0; i < 9; i++) {
    const src = active[i];
    if (!src || src.defId !== 'grok') continue;
    for (const n of getNeighbors8(i)) {
      const target = active[n];
      if (!target || target.defId !== 'dafeiyu') continue;
      const pairKey = `${i}-${n}`;
      if (teasedPairs.has(pairKey)) continue;
      teasedPairs.add(pairKey);

      const mult = worldBuff.provider === 'grok' ? 2.4 : 2.0;
      cellMultipliers[i] *= mult;
      cellMultipliers[n] *= mult;
      stats.grokTeases += 1;
      pushCombo({
        sourceCell: i,
        targetCell: n,
        title: '逗小肥鱼红温',
        funnyLine: '「喂，小肥鱼！」「不许叫我胖鱼！！(鼓腮红温翻倍)」',
        deltaScore: 26,
        petMood: 'angry',
        sfx: 'jackpot',
      });
    }
  }

  // ==================== Phase 7: 上下文压缩纸箱 (/compact) 吞杂牌/残余Bug成长 ====================
  for (let i = 0; i < 9; i++) {
    const box = active[i];
    if (!box || box.defId !== 'box_compact') continue;

    // 优先吞残余 Bug，其次吞普通杂牌，每轮最多吞 2 张
    const candidates = getNeighbors8(i).filter((n) => {
      const t = active[n];
      return t !== null && COMPACTABLE_IDS.has(t.defId);
    });
    candidates.sort((a, b) => {
      const aBug = isBugId(active[a]!.defId) ? 0 : 1;
      const bBug = isBugId(active[b]!.defId) ? 0 : 1;
      return aBug - bBug;
    });

    let swallowed = 0;
    for (const n of candidates) {
      if (swallowed >= 2) break;
      const target = active[n];
      if (!target) continue;
      const wasBug = isBugId(target.defId);
      active[n] = null;
      removedUids.add(target.uid);
      box.multiplier = Number((box.multiplier + 0.55).toFixed(2));
      box.bonusValue += 6;
      if (wasBug) stats.bugsPurified += 1;
      swallowed += 1;
      pushCombo({
        sourceCell: i,
        targetCell: n,
        removedCell: n,
        title: '/compact 上下文压缩',
        funnyLine: '咔嚓踹进 /compact 纸箱！永久倍率 +0.55x',
        deltaScore: 22,
        petMood: 'happy',
        sfx: 'stamp',
      });
    }
  }

  // ==================== Phase 8: H100显卡 / 冰美式 / 双子星折射 / 残余Bug捣乱 ====================
  for (let i = 0; i < 9; i++) {
    const inst = active[i];
    if (!inst) continue;

    if (inst.defId === 'gpu') {
      const powered = getNeighbors8(i).filter((n) => {
        const t = active[n];
        if (!t) return false;
        return (
          isCharacterId(t.defId) ||
          t.defId === 'code' ||
          t.defId === 'signed_code' ||
          t.defId === 'star_gem'
        );
      });
      if (powered.length > 0) {
        const perUnit = worldBuff.provider === 'other' ? 22 : 18;
        pushCombo({
          sourceCell: i,
          targetCell: powered[0],
          title: 'H100算力狂飙',
          funnyLine: `老黄皮衣开光！H100 为周围 ${powered.length} 格注入澎湃算力！`,
          deltaScore: perUnit * powered.length,
          petMood: 'happy',
          sfx: 'click',
        });
      }
    } else if (inst.defId === 'coffee') {
      const caffeinated = getNeighbors8(i).filter((n) => {
        const t = active[n];
        return t !== null && isCharacterId(t.defId) && t.defId !== 'dafeiyu';
      });
      if (caffeinated.length > 0) {
        const perUnit = worldBuff.provider === 'other' ? 15 : 12;
        pushCombo({
          sourceCell: i,
          targetCell: caffeinated[0],
          title: '早八冰美式续命',
          funnyLine: `吨吨吨灌下冰美式，${caffeinated.length} 位 AI 娘推理提速！`,
          deltaScore: perUnit * caffeinated.length,
          petMood: 'happy',
          sfx: 'click',
        });
      }
    } else if (inst.defId === 'bug_oom') {
      const gpuNeighbor = getNeighbors8(i).find((n) => active[n]?.defId === 'gpu');
      if (gpuNeighbor !== undefined) {
        const pen = worldBuff.provider === 'doubao' ? -9 : -18;
        pushCombo({
          sourceCell: i,
          targetCell: gpuNeighbor,
          title: 'CUDA显存炸裂',
          funnyLine: 'Out of memory！差 10MB 显存当场红温报错！',
          deltaScore: pen,
          petMood: 'angry',
          sfx: 'bug',
        });
      }
    } else if (inst.defId === 'bug_conflict') {
      const codeNeighbor = getNeighbors8(i).find((n) => active[n]?.defId === 'code');
      if (codeNeighbor !== undefined) {
        const pen = worldBuff.provider === 'doubao' ? -4 : -8;
        pushCombo({
          sourceCell: i,
          targetCell: codeNeighbor,
          title: 'Git冲突死锁',
          funnyLine: '<<<<<<< HEAD 把祖传代码缠成麻花了！',
          deltaScore: pen,
          petMood: 'angry',
          sfx: 'bug',
        });
      }
    }
  }

  // ==================== Phase 9: 白龙（ChatGPT）压轴思维链核爆 vs 15% 思考过载空大 ====================
  for (let i = 0; i < 9; i++) {
    const src = active[i];
    if (!src || src.defId !== 'bailong') continue;

    const neighbors = getNeighbors8(i);
    const remoteCell = neighbors.find((n) => active[n]?.defId === 'remote');
    const billCell = neighbors.find((n) => active[n]?.defId === 'bill200');
    const triggerCell = remoteCell ?? billCell;

    if (triggerCell === undefined) {
      src.bonusValue += 5;
      pushCombo({
        sourceCell: i,
        title: '白龙优雅蓄力',
        funnyLine: '淡紫膜翼轻拢蓄力……永久基础分 +5',
        deltaScore: 10,
        petMood: 'idle',
        sfx: 'click',
      });
    } else {
      const nukeProb = worldBuff.provider === 'openai' ? 0.92 : 0.85;
      const roll = rng();
      if (roll < nukeProb) {
        stats.bailongNukes += 1;
        for (let c = 0; c < 9; c++) {
          if (active[c] && !isBugId(active[c]!.defId)) {
            cellMultipliers[c] *= 1.45;
          }
        }
        let nukeScore = remoteCell !== undefined && billCell !== undefined ? 90 : 65;
        if (worldBuff.provider === 'openai') {
          nukeScore = Math.round(nukeScore * 1.3);
        }
        pushCombo({
          sourceCell: i,
          targetCell: triggerCell,
          title: '神神叨叨思维链核爆',
          funnyLine: '思考强度 HIGH！碎碎念三万字思维链核爆清场！！',
          deltaScore: nukeScore,
          petMood: 'shock',
          sfx: 'jackpot',
        });
      } else {
        stats.bailongWhiffs += 1;
        zeroedCells.add(i);
        pushCombo({
          sourceCell: i,
          targetCell: triggerCell,
          title: '思考过载空大',
          funnyLine: '已经处理好了，理论上没问题。',
          deltaScore: 0,
          petMood: 'sleep',
          sfx: 'bug',
        });
        if (worldBuff.provider === 'openai') {
          comboBonusByCell[triggerCell] += 18;
        }
      }
    }
  }

  // ==================== 汇总单格分数与世界 Buff / 算力暴走倍率 ====================
  const cellScores = new Array<number>(9).fill(0);
  const contributions: Record<string, number> = {};

  for (let i = 0; i < 9; i++) {
    const inst = active[i];
    let raw = 0;

    if (inst) {
      const def = getSymbolDef(inst.defId);
      let base = def.baseValue + inst.bonusValue;

      if (worldBuff.provider === 'other' && base > 0) {
        base += 3;
      }
      if (worldBuff.provider === 'doubao' && isBugId(inst.defId)) {
        base = Math.ceil(base / 2); // 豆包低保减半负面扣分
      }

      raw = base * inst.multiplier + comboBonusByCell[i];

      // 平台专属世界 Buff 加成
      if (raw > 0) {
        if (
          worldBuff.provider === 'claude' &&
          (inst.defId === 'daju' ||
            inst.defId === 'signed_code' ||
            inst.stampedByClaude)
        ) {
          raw *= 1.35;
        } else if (
          worldBuff.provider === 'antigravity' &&
          (inst.defId === 'daju' || inst.defId === 'xingmao')
        ) {
          raw *= 1.3;
        } else if (
          worldBuff.provider === 'gemini' &&
          (inst.defId === 'xingmao' ||
            inst.defId === 'star_gem' ||
            inst.defId === 'poster')
        ) {
          raw *= 1.35;
        }
      }
    } else {
      // 该格卡牌在本轮被吃掉/砍爆，仍保留该格作为触发源产生的分数（若有）
      raw = comboBonusByCell[i];
    }

    if (raw > 0) {
      raw *= cellMultipliers[i];
      if (luckyBoostActive) {
        raw *= 1.5;
      }
    }

    if (zeroedCells.has(i)) {
      cellScores[i] = 0;
    } else {
      cellScores[i] = Math.round(raw);
    }
  }

  // 豆包免费救济世界 Buff：每抽额外保底塞给盘面第一格非空位 +15 救济分
  if (worldBuff.provider === 'doubao') {
    const targetIdx = active.findIndex((x, idx) => x !== null && !zeroedCells.has(idx));
    const reliefCell = targetIdx >= 0 ? targetIdx : 0;
    if (!zeroedCells.has(reliefCell)) {
      cellScores[reliefCell] += luckyBoostActive ? 23 : 15;
    }
  }

  // 记录各符号对本抽的贡献度（用于评选 MVP 贴纸）
  for (let i = 0; i < 9; i++) {
    const inst = active[i] ?? landedGrid[i];
    if (inst && cellScores[i] > 0) {
      contributions[inst.defId] = (contributions[inst.defId] ?? 0) + cellScores[i];
    }
  }

  const rawTotal = cellScores.reduce((sum, val) => sum + val, 0);
  const spinScore = Math.max(0, rawTotal);

  return {
    landedGrid,
    cellScores,
    combos,
    spinScore,
    removedUids,
    contributions,
  };
}
