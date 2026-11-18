import { describe, expect, it } from 'vitest';
import {
  DAILY_DOUBAO_RELIEF_COINS,
  SlotGame,
  SYMBOL_LIST,
  TITLE_DEFINITIONS,
  VALID_ICON_IDS,
  tokensToCurveCoins,
} from './slotEngine.ts';

function makeSeededRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('SlotGame core mechanics & 6 AI girls synergies', () => {
  it('validates all 23 symbol icons and 16+ hilarious titles', () => {
    expect(SYMBOL_LIST).toHaveLength(23);
    const valid = new Set<string>(VALID_ICON_IDS);
    for (const def of SYMBOL_LIST) {
      expect(valid.has(def.iconId)).toBe(true);
    }
    expect(TITLE_DEFINITIONS.length).toBeGreaterThanOrEqual(16);
  });

  it('converts local tokens on piecewise log curve and syncs incrementally without duplicate coins', () => {
    expect(tokensToCurveCoins(0)).toBe(0);
    expect(tokensToCurveCoins(50_000)).toBe(15);
    expect(tokensToCurveCoins(500_000)).toBe(40);
    expect(tokensToCurveCoins(5_000_000)).toBe(75);
    expect(tokensToCurveCoins(7_000_000)).toBe(83);

    const game = new SlotGame({ initialDate: '2026-11-16' });
    expect(game.getState().tokenCoins).toBe(DAILY_DOUBAO_RELIEF_COINS);

    const r1 = game.syncTokenSnapshot({
      date: '2026-11-16',
      totalTokens: 50_000,
      byProvider: { claude: 50_000 },
      updatedAt: 1,
      isLiveLocal: true,
    });
    expect(r1.coinsAdded).toBe(15);
    expect(r1.tokenCoins).toBe(27);
    expect(r1.worldBuff.provider).toBe('claude');

    // 重复同步同一快照不重复发币
    const r2 = game.syncTokenSnapshot({
      date: '2026-11-16',
      totalTokens: 50_000,
      byProvider: { claude: 50_000 },
      updatedAt: 2,
      isLiveLocal: true,
    });
    expect(r2.coinsAdded).toBe(0);
    expect(r2.tokenCoins).toBe(27);

    // 增量涨到 500k 只补发新增差额 25 币，并切换世界 Buff
    const r3 = game.syncTokenSnapshot({
      date: '2026-11-16',
      totalTokens: 500_000,
      byProvider: { claude: 50_000, deepseek: 450_000 },
      updatedAt: 3,
      isLiveLocal: true,
    });
    expect(r3.coinsAdded).toBe(25);
    expect(r3.tokenCoins).toBe(52);
    expect(r3.worldBuff.provider).toBe('deepseek');
  });

  it('triggers Dafeiyu eating rice, Daju stamping code, Xingmao banana+poster, Grok axe+tease, Doubao purify', () => {
    const game = new SlotGame({ rng: () => 0.1, initialDate: '2026-11-16' });
    const res = game.spinWithForcedGrid([
      'rice', 'dafeiyu', 'grok',
      'daju', 'code', 'bug_429',
      'xingmao', 'banana', 'poster',
    ]);

    const state = game.getState();
    expect(state.stats.riceEaten).toBe(1);
    expect(state.stats.claudeStamps).toBeGreaterThanOrEqual(1);
    expect(state.stats.bugsPurified).toBe(1);
    expect(state.stats.grokTeases).toBe(1);
    expect(res.combos.some((c) => c.sfx === 'eat')).toBe(true);
    expect(res.combos.some((c) => c.sfx === 'stamp')).toBe(true);
    expect(state.deck.find((i) => i.defId === 'dafeiyu')?.bonusValue).toBe(18);
    expect(state.deck.some((i) => i.defId === 'signed_code' && i.stampedByClaude)).toBe(true);
    expect(state.deck.some((i) => i.defId === 'star_gem')).toBe(true);
    expect(state.deck.some((i) => i.defId === 'rice')).toBe(false);

    // 测试豆包全场感化 Bug
    const game2 = new SlotGame({ rng: () => 0.2, initialDate: '2026-11-16' });
    const res2 = game2.spinWithForcedGrid([
      'doubao', null, null,
      null, 'bug_oom', 'bug_conflict',
      null, null, 'bill200',
    ]);
    expect(game2.getState().stats.doubaoSaves).toBeGreaterThanOrEqual(2);
    expect(res2.combos.some((c) => c.sfx === 'doubao')).toBe(true);
  });

  it('triggers Bailong 85% chain-of-thought nuke and 15% overload whiff', () => {
    const nukeGame = new SlotGame({ rng: () => 0.2, initialDate: '2026-11-16' });
    const rNuke = nukeGame.spinWithForcedGrid([
      'bailong', 'remote', 'gpu', null, null, null, null, null, null,
    ]);
    expect(nukeGame.getState().stats.bailongNukes).toBe(1);
    expect(rNuke.spinScore).toBeGreaterThan(80);

    const whiffGame = new SlotGame({ rng: () => 0.95, initialDate: '2026-11-16' });
    const rWhiff = whiffGame.spinWithForcedGrid([
      'bailong', 'bill200', null, null, null, null, null, null, null,
    ]);
    expect(whiffGame.getState().stats.bailongWhiffs).toBe(1);
    expect(rWhiff.cellScores[0]).toBe(0);
    expect(rWhiff.combos.some((c) => c.funnyLine.includes('理论上没问题'))).toBe(true);
  });

  it('completes a full 15-spin run with draft reroll, lucky boost, overtime spins & serialization', () => {
    const game = new SlotGame({ rng: makeSeededRng(2026), initialDate: '2026-11-16' });
    expect(game.buyLuckyBoost()).toBe(true);

    let last!: ReturnType<SlotGame['spin']>;
    for (let i = 0; i < 15; i++) {
      last = game.spin();
      if (i === 0) {
        expect(last.combos.length).toBeGreaterThanOrEqual(2);
      }
      if (last.pendingDraft) {
        if (i === 2) {
          expect(game.rerollDraft()).toBe(true);
          expect(game.getState().pendingDraft?.some((d) => d.rarity === 'epic')).toBe(true);
        }
        expect(game.pickDraft(0)).toBe(true);
      }
    }

    expect(last.isRunOver).toBe(true);
    expect(last.runSummary).not.toBeNull();
    expect(last.runSummary!.titleBadge.length).toBeGreaterThan(2);

    const raw = game.serialize();
    const restored = SlotGame.deserialize(raw, { rng: makeSeededRng(7) });
    expect(restored.getState().totalRunScore).toBe(game.getState().totalRunScore);
    expect(restored.buyOvertimeSpins()).toBe(true);
    expect(restored.getState().isRunOver).toBe(false);
    expect(restored.getState().maxSpins).toBe(20);
  });
});
