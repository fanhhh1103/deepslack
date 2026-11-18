import { describe, expect, it } from 'vitest';
import { ENABLE_SLOT_MACHINE } from '../config';
import { SlotGame, SYMBOL_LIST, SYMBOLS, WORLD_BUFFS } from '../game/slotEngine';
import type { ComboEvent, RunSummary } from '../game/types';
import {
  escapeHtml,
  formatCompactNumber,
  formatRate,
  getIconUrl,
  getSymbolShortHint,
  PET_ROSTER,
  RARITY_META,
  SIM_PROVIDER_BUTTONS,
  SYMBOL_SHORT_HINTS,
  wrapTextByWidth,
} from './formatters';
import {
  buildCodexTabItemsHtml,
  buildDeckModalHtml,
  buildDeckTabItemsHtml,
  buildDraftOverlayHtml,
} from './overlays';
import { buildReportModalHtml, buildShareText } from './reportCard';
import { playSfx, type SfxName } from '../pet/petAudio';
import { mountPet, type PetCharId, type PetMood } from '../pet/petRenderer';
import {
  buildCharSwitcherHtml,
  buildFootCapsuleStatsHtml,
  buildPetHoverToysHtml,
  buildReelsGridHtml,
  getCellCenterPercent,
  isPetToyAction,
  PET_HOVER_TOYS,
  renderComboStepVisual,
} from './slotBoard';

describe('UI formatters', () => {
  it('formats compact numbers across boundaries including negatives and invalid numbers', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(980)).toBe('980');
    expect(formatCompactNumber(60_000)).toBe('60k');
    expect(formatCompactNumber(1_250_000)).toBe('1.25M');
    expect(formatCompactNumber(-4500)).toBe('-4.5k');
    expect(formatCompactNumber(Number.NaN)).toBe('0');
  });

  it('sanitizes icon paths and escapes unsafe HTML entities', () => {
    expect(getIconUrl('dafeiyu')).toBe('./assets/icons/dafeiyu.png');
    expect(getIconUrl('../bad/path!')).toBe('./assets/icons/badpath.png');
    expect(getIconUrl('')).toBe('./assets/icons/dafeiyu.png');
    expect(escapeHtml(`<script>"a&b'c"</script>`)).toBe(
      '&lt;script&gt;&quot;a&amp;b&#39;c&quot;&lt;/script&gt;',
    );
  });

  it('wraps text lines while keeping Chinese punctuation off line starts', () => {
    const lines = wrapTextByWidth('你好世界，这是一段测试文本！\n第二行', 5, (s) => s.length);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line.startsWith('，')).toBe(false);
      expect(line.startsWith('！')).toBe(false);
    }
    expect(PET_ROSTER).toHaveLength(5);
    expect(SIM_PROVIDER_BUTTONS).toHaveLength(5);
    expect(Object.keys(RARITY_META)).toEqual(['common', 'rare', 'epic', 'bug']);
    expect(Object.keys(SYMBOL_SHORT_HINTS)).toHaveLength(23);
    for (const def of SYMBOL_LIST) {
      const hint = getSymbolShortHint(def.id);
      expect(hint.length).toBeGreaterThan(0);
      expect(hint.length).toBeLessThanOrEqual(15);
    }
  });
});

describe('UI slotBoard builders', () => {
  it('renders spin-0 beginner guide card and active spin grid with single score badge & spinning classes', () => {
    const game = new SlotGame({ rng: () => 0.1, initialDate: '2026-11-16' });
    const initialHtml = buildReelsGridHtml(game.getState(), SYMBOLS);
    expect(initialHtml).toContain('beginner-guide-card');
    expect(initialHtml).toContain('🎮 3秒上手 · 无脑摇大奖');
    expect(initialHtml).toContain('支持空格键');
    expect(initialHtml).not.toContain('is-preview');

    game.spinWithForcedGrid([
      'daju', 'code', 'bug_oom',
      'dafeiyu', 'rice', null,
      null, null, null,
    ]);
    const spunState = game.getState();
    const activeHtml = buildReelsGridHtml(
      spunState,
      SYMBOLS,
      new Set([0]),
      new Set([1]),
    );
    expect(activeHtml).toContain('is-spinning');
    expect(activeHtml).toContain('just-stopped');
    expect(activeHtml).toContain('is-neg');
    expect(activeHtml).toContain(getSymbolShortHint('dafeiyu'));
    expect(activeHtml).not.toContain('beginner-guide-card');
    expect(activeHtml).not.toContain('class="cell-Buff-mini">');

    // 验证大橘盖章保留 ✦章，而 +bonusValue / ×multiplier 次级角标不再渲染
    const stampedState = {
      ...spunState,
      grid: spunState.grid.map((cell, idx) => {
        if (!cell) return null;
        if (idx === 1) return { ...cell, defId: 'signed_code', stampedByClaude: true };
        if (idx === 3) return { ...cell, bonusValue: 18, multiplier: 1.8 };
        return cell;
      }),
    };
    const stampedHtml = buildReelsGridHtml(stampedState, SYMBOLS);
    expect(stampedHtml).toContain('<span class="cell-Buff-mini">✦章</span>');
    expect(stampedHtml).not.toContain('class="cell-Buff-mini">+');
    expect(stampedHtml).not.toContain('class="cell-Buff-mini">×');
  });

  it('keeps slot machine isolated and renders pure-pet switcher, hover toys, and minimal foot capsule', () => {
    expect(ENABLE_SLOT_MACHINE).toBe(false);

    expect(getCellCenterPercent(0)).toEqual({
      xPct: (0.5 * 100) / 3,
      yPct: (0.5 * 100) / 3,
    });
    expect(getCellCenterPercent(4)).toEqual({ xPct: 50, yPct: 50 });

    const switcherHtml = buildCharSwitcherHtml('xingmao');
    expect(switcherHtml).toContain('data-pet-char="xingmao"');
    expect(switcherHtml).toContain('class="char-switch-btn is-active"');
    expect(switcherHtml).toContain('🐳');
    expect(switcherHtml).toContain('🍊');
    expect(switcherHtml).toContain('🐉');
    expect(switcherHtml).toContain('🐱');
    expect(switcherHtml).toContain('🪓');
    expect(switcherHtml).not.toContain('<span>星猫</span>');

    const pureCapsule = buildFootCapsuleStatsHtml({
      todayTokens: 1_200_000,
      byProvider: { deepseek: 700_000, claude: 500_000 },
      muted: false,
      rate: 1800,
      totalRate: 24_000,
      rateSamples: [0, 300, 900, 1800, 1200],
      tier: 2,
      bowls: 12,
    });
    expect(pureCapsule).toContain('data-tauri-drag-region');
    expect(pureCapsule).toContain('⠿');
    expect(pureCapsule).toContain('⚡');
    expect(pureCapsule).toContain('1.8k/s');
    expect(pureCapsule).toContain('id="stat-spark"');
    expect(pureCapsule).toContain('▁'.repeat(15) + '▁▂▅█▆');
    expect(pureCapsule).toContain('tier-2');
    expect(pureCapsule).toContain('🍚×<strong id="stat-bowls-val">12</strong>');
    // 悬停显示今日总量 + 各平台明细 + 各档说明
    expect(pureCapsule).toContain('今日总量 1.2M Tokens');
    expect(pureCapsule).toContain('DeepSeek 700k');
    expect(pureCapsule).toContain('Claude 500k');
    expect(pureCapsule).toContain('T3 红温冒烟');
    expect(pureCapsule).toContain('当前档位：T2 全力');
    expect(pureCapsule).toContain('id="btn-mute"');
    expect(pureCapsule).toContain('🔊');
    expect(pureCapsule).not.toContain('btn-expand-slot');
    expect(pureCapsule).not.toContain('玩一局');
    expect(pureCapsule).not.toContain('🪙');
    expect(pureCapsule).not.toContain('币');

    const mutedCapsule = buildFootCapsuleStatsHtml({
      todayTokens: 50_000,
      muted: true,
    });
    expect(mutedCapsule).toContain('0/s');
    expect(mutedCapsule).toContain('▁'.repeat(20));
    expect(mutedCapsule).toContain('🍚×<strong id="stat-bowls-val">0</strong>');
    expect(mutedCapsule).toContain('🔇');
    expect(mutedCapsule).not.toContain('btn-expand-slot');

    expect(formatRate(0)).toBe('0/s');
    expect(formatRate(420)).toBe('420/s');
    expect(formatRate(1800)).toBe('1.8k/s');
    expect(formatRate(Number.NaN)).toBe('0/s');

    expect(PET_HOVER_TOYS.map((t) => t.action)).toEqual(['rice', 'coffee', 'bug', 'music', 'pat', 'sleep']);
    const hoverToysHtml = buildPetHoverToysHtml();
    expect(hoverToysHtml).toContain('class="pet-toy-btn"');
    for (const toy of ['rice', 'coffee', 'bug', 'music', 'pat', 'sleep']) {
      expect(hoverToysHtml).toContain(`data-pet-toy="${toy}"`);
      expect(isPetToyAction(toy)).toBe(true);
    }
    expect(isPetToyAction('work')).toBe(false);
    expect(hoverToysHtml).toContain('🍚扔饭');
    expect(hoverToysHtml).toContain('☕美式');
    expect(hoverToysHtml).toContain('🐛砸Bug');
    expect(hoverToysHtml).toContain('🎧听歌');
    expect(hoverToysHtml).toContain('🤚摸头');
    expect(hoverToysHtml).toContain('💤睡觉');
  });

  it('applies combo source/target classes, SVG beam line, and floating score tag', () => {
    const makeClassList = () => {
      const set = new Set<string>();
      return {
        add: (...cls: string[]) => cls.forEach((c) => set.add(c)),
        remove: (...cls: string[]) => cls.forEach((c) => set.delete(c)),
        contains: (c: string) => set.has(c),
      };
    };

    const cell0 = { classList: makeClassList() };
    const cell4 = { classList: makeClassList() };
    const appended: Array<{ className: string; textContent: string; style: Record<string, string>; remove: () => void }> = [];

    const mockGrid = {
      querySelectorAll: () => [cell0, cell4],
      querySelector: (sel: string) => {
        if (sel.includes('"0"')) return cell0;
        if (sel.includes('"4"')) return cell4;
        return null;
      },
    } as unknown as HTMLElement;

    const mockSvg = { innerHTML: '' } as unknown as SVGSVGElement;
    const mockFloatLayer = {
      appendChild: (node: (typeof appended)[number]) => {
        appended.push(node);
      },
    } as unknown as HTMLElement;

    const origDocument = globalThis.document;
    globalThis.document = {
      createElement: () => ({
        className: '',
        textContent: '',
        style: {} as Record<string, string>,
        remove: () => {},
      }),
    } as unknown as Document;

    try {
      const combo: ComboEvent = {
        step: 1,
        sourceCell: 0,
        targetCell: 4,
        title: 'Claude强行署名',
        funnyLine: 'Co-authored-by: Claude',
        deltaScore: 28,
        petMood: 'happy',
        sfx: 'stamp',
      };
      renderComboStepVisual(mockGrid, mockSvg, mockFloatLayer, combo);
      expect(cell0.classList.contains('combo-source')).toBe(true);
      expect(cell4.classList.contains('combo-target')).toBe(true);
      expect(mockSvg.innerHTML).toContain('<line class="combo-beam-line"');
      expect(appended).toHaveLength(1);
      expect(appended[0].textContent).toBe('Claude强行署名 +28');
    } finally {
      globalThis.document = origDocument;
    }
  });
});

describe('UI overlays & reportCard', () => {
  it('builds draft overlay on every 3rd spin with short hint & skip button, plus deck/codex tabs', () => {
    const game = new SlotGame({ rng: () => 0.2, initialDate: '2026-11-16' });
    game.spin();
    expect(buildDraftOverlayHtml(game.getState())).toBe('');
    game.spin();
    expect(buildDraftOverlayHtml(game.getState())).toBe('');

    game.spin(); // 第 3 抽触发三选一
    const draftState = game.getState();
    expect(draftState.pendingDraft).toHaveLength(3);
    const draftHtml = buildDraftOverlayHtml(draftState);
    expect(draftHtml).toContain('id="draft-modal"');
    expect(draftHtml).toContain('🎁 挑 1 张新卡塞进老虎机');
    expect(draftHtml).toContain('id="btn-draft-skip"');
    expect(draftHtml).toContain('data-draft-idx="0"');
    expect(draftHtml).toContain('data-draft-idx="2"');
    expect(draftHtml).toContain('id="btn-draft-reroll"');
    expect(draftHtml).not.toContain('btn-draft-reroll is-disabled');
    expect(draftHtml).toContain(getSymbolShortHint(draftState.pendingDraft![0].id));

    const deckHtml = buildDeckModalHtml(draftState, SYMBOLS, 'deck');
    expect(deckHtml).toContain('id="deck-modal"');
    expect(deckHtml).toContain(`🎒 本局牌库 (${draftState.deck.length})`);

    const codexHtml = buildDeckModalHtml(draftState, SYMBOLS, 'codex');
    expect(codexHtml).toContain('📘 全梗图鉴 (23)');
    expect(codexHtml).toContain('豆包');

    const deckItemsOnly = buildDeckTabItemsHtml(draftState, SYMBOLS);
    expect(deckItemsOnly).toContain('codex-item');
    const codexItemsOnly = buildCodexTabItemsHtml(SYMBOLS);
    expect(codexItemsOnly).toContain('上下文压缩纸箱');
    expect(codexItemsOnly).toContain('codex-flavor');
  });

  it('builds share text and report modal HTML at end of 15-spin run', () => {
    const summary: RunSummary = {
      totalScore: 2680,
      spinsPlayed: 15,
      bossStageCleared: 3,
      highestBossName: '429限流石像鬼',
      titleBadge: '【赛博算力大亨】',
      subtitle: '连破三关的打工战神',
      roastText: '今天不是在暴击就是去爆砍 Bug 的路上！',
      highlights: ['大肥鱼狂炫 5 碗大白饭', '白龙触发思维链核爆'],
      mvpIconId: 'dafeiyu',
      tokensBurnedToday: 420_000,
      stats: {
        riceEaten: 5,
        claudeStamps: 3,
        bailongNukes: 2,
        bailongWhiffs: 0,
        bugsPurified: 4,
        grokTeases: 1,
        doubaoSaves: 1,
      },
    };

    const share = buildShareText(summary, WORLD_BUFFS.claude);
    expect(share).toContain('📜【今日赛博打工鉴定书】【赛博算力大亨】');
    expect(share).toContain('今日Buff：Claude 署名强迫症');
    expect(share).toContain('420k');
    expect(share).toContain('2,680');
    expect(share).toContain('✦ 大肥鱼狂炫 5 碗大白饭');

    const game = new SlotGame({ rng: () => 0.15, initialDate: '2026-11-16' });
    for (let i = 0; i < 15; i++) {
      game.spin();
      if (game.getState().pendingDraft) {
        game.pickDraft(0);
      }
    }
    const endState = game.getState();
    expect(endState.isRunOver).toBe(true);
    const reportHtml = buildReportModalHtml(endState);
    expect(reportHtml).toContain('id="report-modal"');
    expect(reportHtml).toContain('id="btn-report-overtime"');
    expect(reportHtml).toContain('id="btn-report-png"');
    expect(reportHtml).toContain('id="btn-report-copy"');
    expect(reportHtml).toContain('id="report-export-preview"');
  });
});

describe('Pet multi-action renderer & procedural SFX', () => {
  it('mounts pet safely with headless fallback, renders all 11 moods, drag pendulum, and new SFX without error', async () => {
    const noop = () => {};
    const makeFakeCtx = () =>
      ({
        save: noop,
        restore: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        arcTo: noop,
        arc: noop,
        ellipse: noop,
        bezierCurveTo: noop,
        quadraticCurveTo: noop,
        fill: noop,
        stroke: noop,
        fillRect: noop,
        clearRect: noop,
        strokeText: noop,
        fillText: noop,
        drawImage: noop,
        translate: noop,
        rotate: noop,
        scale: noop,
        setTransform: noop,
        measureText: (t: string) => ({ width: t.length * 8 }),
      }) as unknown as CanvasRenderingContext2D;

    const makeFakeCanvas = () =>
      ({
        width: 256,
        height: 234,
        clientWidth: 256,
        clientHeight: 234,
        getContext: () => makeFakeCtx(),
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 256, bottom: 234, width: 256, height: 234 }),
        addEventListener: noop,
        removeEventListener: noop,
      }) as unknown as HTMLCanvasElement;

    const origDocument = globalThis.document;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;

    let rafCb: FrameRequestCallback | null = null;
    let rafSeq = 1;

    globalThis.document = {
      hidden: false,
      createElement: () => makeFakeCanvas(),
    } as unknown as Document;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCb = cb;
      return rafSeq++;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = noop as typeof cancelAnimationFrame;

    try {
      const sfxList: SfxName[] = ['pat', 'typeKey', 'pickup', 'land', 'yawn', 'click', 'bonk', 'dizzy'];
      for (const sfx of sfxList) {
        expect(() => playSfx(sfx)).not.toThrow();
      }

      const canvas = makeFakeCanvas();
      const pet = await mountPet(canvas, './assets');
      let tick = performance.now();
      const stepFrame = (deltaMs = 50) => {
        tick += deltaMs;
        rafCb?.(tick);
      };

      const moods: PetMood[] = [
        'idle',
        'pat',
        'poke',
        'dangle',
        'work',
        'eat',
        'happy',
        'angry',
        'sleep',
        'spin',
        'shock',
        'drowsy',
        'dizzy',
        'bonk',
        'music',
      ];
      for (const mood of moods) {
        pet.setMood(mood, `状态:${mood}`, 1200);
        expect(pet.getMood()).toBe(mood);
        stepFrame(50);
      }

      pet.triggerAction('music');
      expect(pet.getMood()).toBe('music');
      stepFrame(50);

      pet.triggerAction('pat');
      expect(pet.getMood()).toBe('pat');
      stepFrame(50);

      pet.triggerAction('work');
      expect(pet.getMood()).toBe('work');
      stepFrame(120);

      pet.triggerAction('eat');
      expect(pet.getMood()).toBe('eat');
      stepFrame(260);

      pet.triggerAction('sleep');
      expect(pet.getMood()).toBe('sleep');
      stepFrame(50);

      pet.startDrag();
      expect(pet.getMood()).toBe('dangle');
      pet.feedDragDelta(28, -6);
      stepFrame(20);
      pet.endDrag();
      for (let i = 0; i < 16; i++) stepFrame(20);
      expect(pet.getMood()).toBe('idle');

      const allChars: PetCharId[] = ['dafeiyu', 'daju', 'bailong', 'xingmao', 'grok'];
      for (const charId of allChars) {
        pet.setCharacter(charId);
        expect(pet.getCharacter()).toBe(charId);
        pet.triggerAction('pat');
        stepFrame(50);
        pet.triggerAction('work');
        stepFrame(120);
        pet.triggerAction('eat');
        stepFrame(260);
        pet.triggerAction('sleep');
        stepFrame(50);
      }
      expect(typeof pet.isPointOpaque(128, 120)).toBe('boolean');

      pet.destroy();
    } finally {
      globalThis.document = origDocument;
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
    }
  });

  it('preloads dafeiyu action pack + other base sprites, lazy-loads character packs on switch, and falls back smoothly', async () => {
    const noop = () => {};
    const drawnUrls: string[] = [];
    const requestedUrls: string[] = [];

    const makeFakeCtx = () =>
      ({
        save: noop,
        restore: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        arcTo: noop,
        arc: noop,
        ellipse: noop,
        bezierCurveTo: noop,
        quadraticCurveTo: noop,
        fill: noop,
        stroke: noop,
        fillRect: noop,
        clearRect: noop,
        strokeText: noop,
        fillText: noop,
        drawImage: (img: { src?: string }) => {
          if (img?.src) drawnUrls.push(img.src);
        },
        translate: noop,
        rotate: noop,
        scale: noop,
        setTransform: noop,
        measureText: (t: string) => ({ width: t.length * 8 }),
      }) as unknown as CanvasRenderingContext2D;

    const makeFakeCanvas = () =>
      ({
        width: 256,
        height: 234,
        clientWidth: 256,
        clientHeight: 234,
        getContext: () => makeFakeCtx(),
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 256, bottom: 234, width: 256, height: 234 }),
        addEventListener: noop,
        removeEventListener: noop,
      }) as unknown as HTMLCanvasElement;

    const origDocument = globalThis.document;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const origImage = globalThis.Image;

    const rafHolder: { cb: FrameRequestCallback | null } = { cb: null };
    let rafSeq = 1;

    class MockImage {
      private _src = '';
      naturalWidth = 240;
      naturalHeight = 280;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      get src(): string {
        return this._src;
      }
      set src(val: string) {
        this._src = val;
        requestedUrls.push(val);
        queueMicrotask(() => {
          // 模拟 grok_sleep 暂缺，验证平滑回退到 grok.png 基础立绘不报错
          if (val.endsWith('/grok_sleep.png')) {
            this.naturalWidth = 0;
            this.onerror?.();
          } else {
            this.onload?.();
          }
        });
      }
    }

    globalThis.document = {
      hidden: false,
      createElement: () => makeFakeCanvas(),
    } as unknown as Document;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafHolder.cb = cb;
      return rafSeq++;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = noop as typeof cancelAnimationFrame;
    globalThis.Image = MockImage as unknown as typeof Image;

    const flushMicrotasks = () => new Promise<void>((r) => globalThis.setTimeout(r, 0));

    try {
      const pet = await mountPet(makeFakeCanvas(), './assets');
      await flushMicrotasks();

      // 默认角色 dafeiyu 的基础图 + 9 张动作贴图包加载完毕，其余 4 角色基础图已后台预加载
      expect(requestedUrls).toContain('./assets/pet/dafeiyu.png');
      expect(requestedUrls).toContain('./assets/pet/dafeiyu_work_a.png');
      expect(requestedUrls).toContain('./assets/pet/dafeiyu_sleep.png');
      expect(requestedUrls).toContain('./assets/pet/daju.png');
      expect(requestedUrls).toContain('./assets/pet/bailong.png');
      expect(requestedUrls).toContain('./assets/pet/xingmao.png');
      expect(requestedUrls).toContain('./assets/pet/grok.png');
      expect(requestedUrls).not.toContain('./assets/pet/daju_work_a.png');

      // 切换到大橘，触发并行懒加载其 9 张动作贴图
      pet.setCharacter('daju');
      await flushMicrotasks();
      expect(requestedUrls).toContain('./assets/pet/daju_blink.png');
      expect(requestedUrls).toContain('./assets/pet/daju_work_a.png');
      expect(requestedUrls).toContain('./assets/pet/daju_eat_b.png');
      expect(requestedUrls).toContain('./assets/pet/daju_sleep.png');

      // 再次切换回 daju 应命中缓存，不重复发起请求
      const countBeforeSecondSwitch = requestedUrls.filter((u) => u.endsWith('/daju_work_a.png')).length;
      pet.setCharacter('xingmao');
      pet.setCharacter('daju');
      await flushMicrotasks();
      const countAfterSecondSwitch = requestedUrls.filter((u) => u.endsWith('/daju_work_a.png')).length;
      expect(countAfterSecondSwitch).toBe(countBeforeSecondSwitch);

      // 验证大橘、星猫动作帧命中各自贴图
      let tick = performance.now();
      pet.setCharacter('daju');
      pet.triggerAction('work');
      tick += 50;
      rafHolder.cb?.(tick);
      expect(drawnUrls.some((u) => u.endsWith('/daju_work_a.png') || u.endsWith('/daju_work_b.png'))).toBe(true);

      pet.setCharacter('xingmao');
      await flushMicrotasks();
      pet.triggerAction('pat');
      tick += 50;
      rafHolder.cb?.(tick);
      expect(drawnUrls.some((u) => u.endsWith('/xingmao_pat.png'))).toBe(true);

      // 验证缺帧时（grok_sleep）平滑回退到 grok.png 基础图
      drawnUrls.length = 0;
      pet.setCharacter('grok');
      await flushMicrotasks();
      pet.triggerAction('sleep');
      tick += 50;
      rafHolder.cb?.(tick);
      expect(drawnUrls.some((u) => u.endsWith('/grok.png'))).toBe(true);

      pet.destroy();
    } finally {
      globalThis.document = origDocument;
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
      globalThis.Image = origImage;
    }
  });

  it('drives rate tiers, slacking, walking, airdrops, bowl tower collapse and coffee boost without errors', async () => {
    const noop = () => {};
    const ctxProxy = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'measureText') return (t: string) => ({ width: t.length * 8 });
          return noop;
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const listeners: Record<string, (ev: unknown) => void> = {};
    const makeFakeCanvas = (capture: boolean) =>
      ({
        width: 256,
        height: 234,
        clientWidth: 256,
        clientHeight: 234,
        getContext: () => ctxProxy,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 256, bottom: 234, width: 256, height: 234 }),
        addEventListener: (name: string, cb: (ev: unknown) => void) => {
          if (capture) listeners[name] = cb;
        },
        removeEventListener: noop,
      }) as unknown as HTMLCanvasElement;

    const origDocument = globalThis.document;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const rafHolder: { cb: FrameRequestCallback | null } = { cb: null };
    globalThis.document = { hidden: false, createElement: () => makeFakeCanvas(false) } as unknown as Document;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafHolder.cb = cb;
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = noop as typeof cancelAnimationFrame;

    try {
      const pet = await mountPet(makeFakeCanvas(true), './assets');
      const events: string[] = [];
      pet.onEvent((ev) => events.push(ev.type === 'item-caught' ? `caught:${ev.kind}` : ev.type));
      let tick = performance.now();
      const run = (ms: number, step = 40) => {
        for (let t = 0; t < ms; t += step) {
          tick += step;
          rafHolder.cb?.(tick);
        }
      };

      // 新增 7 个情绪全部可渲染
      const funMoods: PetMood[] = ['slack', 'caught', 'overheat', 'tired', 'scared', 'coffee', 'cry'];
      for (const mood of funMoods) {
        pet.setMood(mood, `状态:${mood}`, 300);
        expect(pet.getMood()).toBe(mood);
        run(80);
      }
      run(400);

      // 四档手速：常驻 work + 计时动作结束后回落到常驻姿态
      for (const tier of [1, 2, 3] as const) {
        pet.setRateTier(tier, tier * 1000);
        pet.setBaseMood('work');
        expect(pet.getMood()).toBe('work');
        run(300, 16);
      }
      pet.setMood('overheat', '显卡要干烧啦！', 200);
      run(400, 16);
      expect(pet.getMood()).toBe('work');
      pet.setRateTier(0, 0);
      pet.setBaseMood('slack');
      expect(pet.getMood()).toBe('slack');
      expect(pet.getBaseMood()).toBe('slack');
      pet.playFakeTyping(300);
      expect(pet.getMood()).toBe('work');
      run(500);
      expect(pet.getMood()).toBe('slack');

      // 溜达 + 边缘探头
      pet.setLocomotion(-1);
      run(300);
      pet.setLocomotion(1, true);
      run(200);
      pet.setLocomotion(0);

      // 空投：饭 → 接住吃 → 空碗飞上碗塔
      pet.setBowlCount(3);
      expect(pet.dropItem('rice', 'toy')).toBe(true);
      expect(pet.isBusy()).toBe(true);
      run(4000);
      expect(events).toContain('caught:rice');
      expect(events).toContain('bowl-landed');
      expect(pet.getBowlCount()).toBe(4);

      // 冰美式：10s 2 倍速
      expect(pet.dropItem('coffee', 'toy')).toBe(true);
      run(1500);
      expect(events).toContain('caught:coffee');
      expect(events).toContain('coffee-boost');
      expect(pet.getBoostRemainingMs()).toBeGreaterThan(0);

      // Bug：抱头 → 尾巴拍飞
      expect(pet.dropItem('bug', 'toy')).toBe(true);
      run(1200);
      expect(events).toContain('caught:bug');
      run(3000);
      expect(pet.isBusy()).toBe(false);

      // 点击碗塔 → 倒塌大哭
      pet.setBowlCount(10);
      run(80);
      expect(pet.isPointOpaque(232, 200)).toBe(true);
      listeners.click?.({ clientX: 232, clientY: 200 });
      expect(events).toContain('tower-collapse');
      expect(pet.getMood()).toBe('cry');
      expect(pet.getBowlCount()).toBe(0);
      run(3000);

      pet.destroy();
    } finally {
      globalThis.document = origDocument;
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
    }
  });

  it('supports natural posture bridge, shake-dizzy, wake stretch, peek alignment, bug bonk, uniform height lock, and toast avoidance', async () => {
    const noop = () => {};
    const drawnCalls: Array<{ src: string; dx: number; dy: number; dw: number; dh: number }> = [];
    const scaleCalls: Array<[number, number]> = [];
    const fillRectY: number[] = [];
    let toastVisible = false;

    const ctxProxy = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'measureText') return (t: string) => ({ width: t.length * 8 });
          if (prop === 'drawImage') {
            return (img: { src?: string }, ...args: number[]) => {
              if (!img?.src) return;
              if (args.length === 8) {
                drawnCalls.push({ src: img.src, dx: args[4], dy: args[5], dw: args[6], dh: args[7] });
              } else if (args.length === 4) {
                drawnCalls.push({ src: img.src, dx: args[0], dy: args[1], dw: args[2], dh: args[3] });
              }
            };
          }
          if (prop === 'scale') {
            return (sx: number, sy: number) => {
              scaleCalls.push([sx, sy]);
            };
          }
          if (prop === 'fillRect') {
            return (_x: number, y: number) => {
              fillRectY.push(y);
            };
          }
          return noop;
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;

    const listeners: Record<string, (ev: unknown) => void> = {};
    const makeFakeCanvas = (capture: boolean) =>
      ({
        width: 256,
        height: 234,
        clientWidth: 256,
        clientHeight: 234,
        getContext: () => ctxProxy,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 256, bottom: 234, width: 256, height: 234 }),
        addEventListener: (name: string, cb: (ev: unknown) => void) => {
          if (capture) listeners[name] = cb;
        },
        removeEventListener: noop,
      }) as unknown as HTMLCanvasElement;

    const origDocument = globalThis.document;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const origImage = globalThis.Image;
    const origPerfNow = performance.now.bind(performance);

    const rafHolder: { cb: FrameRequestCallback | null } = { cb: null };
    let simNow = 10_000;
    performance.now = () => simNow;

    class SizedMockImage {
      private _src = '';
      naturalWidth = 400;
      naturalHeight = 712;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      get src(): string {
        return this._src;
      }
      set src(val: string) {
        this._src = val;
        if (val.endsWith('_sleep.png')) {
          this.naturalWidth = 520;
          this.naturalHeight = 356;
        }
        queueMicrotask(() => this.onload?.());
      }
    }

    globalThis.document = {
      hidden: false,
      createElement: () => makeFakeCanvas(false),
      querySelector: (sel: string) =>
        sel === '#floating-toast.is-visible' && toastVisible ? ({} as Element) : null,
    } as unknown as Document;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafHolder.cb = cb;
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = noop as typeof cancelAnimationFrame;
    globalThis.Image = SizedMockImage as unknown as typeof Image;

    const flushMicrotasks = () => new Promise<void>((r) => globalThis.setTimeout(r, 0));

    try {
      const pet = await mountPet(makeFakeCanvas(true), './assets');
      await flushMicrotasks();

      const step = (ms: number) => {
        simNow += ms;
        rafHolder.cb?.(simNow);
      };
      const run = (totalMs: number, dtMs = 25) => {
        for (let t = 0; t < totalMs; t += dtMs) step(dtMs);
      };

      // 1. 统一缩放锁：sleep 图矮一半，总高度也按 dafeiyu.png (712) 保持一半，不被放大撑满
      drawnCalls.length = 0;
      step(50);
      const standSliceCount = drawnCalls.filter((c) => c.src.endsWith('/dafeiyu.png')).length;
      expect(standSliceCount).toBe(14); // 14 条软体丝带

      pet.triggerAction('sleep');
      run(390, 30); // 越过 340ms PostureBridge 过渡到 sleep
      drawnCalls.length = 0;
      step(40);
      const sleepDraw = drawnCalls.find((c) => c.src.endsWith('/dafeiyu_sleep.png'));
      expect(sleepDraw).toBeDefined();
      expect(sleepDraw!.dh).toBeLessThan(110); // 未被 maxPetH/356 异常放大到 173

      // 2. 睡醒先进入 850ms 'drowsy' 伸懒腰缓冲，再回到 baseMood
      listeners.click?.({ clientX: 128, clientY: 160 });
      expect(pet.getMood()).toBe('drowsy');
      run(910, 35);
      expect(pet.getMood()).toBe('idle');

      // 3. 狂摇眩晕：连续快速左右摇晃 ≥5 次松手落地进入 dizzy (2800ms)
      pet.startDrag();
      const shakeSeq = [14, -14, 16, -16, 15, -15, 14];
      for (const dx of shakeSeq) {
        step(45);
        pet.feedDragDelta(dx, 0);
      }
      pet.endDrag();
      run(450, 20);
      expect(pet.getMood()).toBe('dizzy');
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_dizzy.png'))).toBe(true);
      run(2900, 50);
      expect(pet.getMood()).toBe('idle');

      // 4. 扒边探头方向对齐：左边缘 (-1) 不镜像朝右，右边缘 (+1) 水平镜像 (-1) 朝左
      scaleCalls.length = 0;
      pet.setLocomotion(-1, true, 0);
      run(300, 20);
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_peek.png'))).toBe(true);
      expect(scaleCalls.every(([sx]) => sx > 0)).toBe(true);

      scaleCalls.length = 0;
      pet.setLocomotion(1, true, 0);
      run(350, 20);
      expect(scaleCalls.some(([sx]) => sx < 0)).toBe(true);
      pet.setLocomotion(0);

      // 5. 空投 Bug → scared 700ms → scootSpring 冲刺 → 360ms bonk_a → 520ms bonk_b 锤飞
      drawnCalls.length = 0;
      expect(pet.dropItem('bug', 'toy')).toBe(true);
      run(2800, 25);
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_bonk_a.png'))).toBe(true);
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_bonk_b.png'))).toBe(true);
      run(1000, 40);
      expect(pet.isBusy()).toBe(false);

      // 6. 鲸鱼耳机听歌切换 music_a / music_b
      drawnCalls.length = 0;
      pet.triggerAction('music');
      run(1400, 40);
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_music_a.png'))).toBe(true);
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_music_b.png'))).toBe(true);

      // 7. 气泡避让顶部 Toast（toast 可见时 minTopY = 30，彩条 fillRect y >= 31）
      toastVisible = true;
      fillRectY.length = 0;
      pet.setMood('happy', '避让顶栏测试气泡文字，确保长气泡也不会顶进 Toast 区域里啦！', 2000);
      step(50);
      const accentBarY = fillRectY[fillRectY.length - 1];
      expect(accentBarY).toBeGreaterThanOrEqual(31);

      // 8. 其余 4 位 AI 娘缺新贴图时零报错优雅回退
      for (const ch of ['daju', 'bailong', 'xingmao', 'grok'] as PetCharId[]) {
        pet.setCharacter(ch);
        await flushMicrotasks();
        for (const m of ['drowsy', 'dizzy', 'bonk', 'music'] as PetMood[]) {
          pet.setMood(m, `回退:${m}`, 400);
          step(40);
        }
      }

      // 9. 闲置 32s 进入 drowsy、满 38s 自动经 PostureBridge 进入 sleep
      pet.setCharacter('dafeiyu');
      await flushMicrotasks();
      pet.setMood('idle');
      run(1000, 50); // 清空互动后弹簧
      expect(pet.getMood()).toBe('idle');
      run(32_000, 500);
      expect(pet.getMood()).toBe('drowsy');
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_drowsy.png'))).toBe(true);
      run(6_500, 500);
      expect(pet.getMood()).toBe('sleep');

      // 10. 鼠标直接点击地面爬行 Bug 立即冲刺暴锤
      listeners.click?.({ clientX: 128, clientY: 160 }); // 唤醒
      run(910, 35);
      expect(pet.getMood()).toBe('idle');
      expect(pet.dropItem('bug', 'toy')).toBe(true);
      run(1000, 25); // Bug 落地处于 scared
      drawnCalls.length = 0;
      // 在画布底部任意可点击地面虫子坐标范围连试点击触发
      for (let bx = 80; bx <= 176; bx += 16) {
        listeners.click?.({ clientX: bx, clientY: 219 });
      }
      run(1500, 25);
      expect(drawnCalls.some((c) => c.src.endsWith('/dafeiyu_bonk_b.png'))).toBe(true);

      // 11. 帧率守门：静止 idle 时 20ms 间隔节流跳过绘制，满 40ms 才重绘
      run(2200, 50); // 让所有弹簧与粒子彻底静止
      drawnCalls.length = 0;
      step(20);
      expect(drawnCalls).toHaveLength(0);
      step(25); // 累计 45ms >= 40ms
      expect(drawnCalls.length).toBeGreaterThan(0);

      pet.destroy();
    } finally {
      performance.now = origPerfNow;
      globalThis.document = origDocument;
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
      globalThis.Image = origImage;
    }
  });
});
