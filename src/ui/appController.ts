import { ENABLE_SLOT_MACHINE } from '../config';
import {
  fetchTokenSnapshot,
  getWalkBounds,
  isTauriDesktop,
  moveWindowTo,
  onTrayAction,
  setClickThrough,
  setWalkMenuChecked,
  simulateBurnTokens,
  simulateTokenRate,
  startRatePolling,
  startTokenPolling,
  type TokenRateSample,
} from '../bridge/tauriBridge';
import type { ProviderId, TokenSnapshot } from '../game/types';
import { RATE_TIERS, WALK_STORAGE_KEY, type KVStore, type WalkRange } from '../pet/fishBrain';
import { FishDirector } from '../pet/fishDirector';
import { isMuted, playSfx, setMuted } from '../pet/petAudio';
import {
  mountPet,
  type PetAction,
  type PetController,
  type PetMood,
} from '../pet/petRenderer';
import {
  escapeHtml,
  formatCompactNumber,
  formatRate,
  PET_ROSTER,
  SIM_PROVIDER_BUTTONS,
  type SwitchablePetId,
} from './formatters';
import {
  buildBowlTitle,
  buildCharSwitcherHtml,
  buildFootCapsuleStatsHtml,
  buildPetHoverToysHtml,
  buildRateCapsuleTitle,
  isPetToyAction,
  type PureFootCapsuleOptions,
} from './slotBoard';
import { buildSparkline } from '../pet/fishBrain';

const STORAGE_CHAR_KEY = 'cyber_pet_slot_char_v1';
const STORAGE_MUTED_KEY = 'cyber_pet_slot_muted_v1';
const STORAGE_LANG_KEY = 'deepslack_lang_v1';

type DemoLang = 'zh' | 'en';

function detectInitialLang(isTauri: boolean): DemoLang {
  if (isTauri) return 'zh';
  const saved = readStorage(STORAGE_LANG_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  return 'zh';
}

const SIM_RATE_LABELS_EN: Record<string, string> = {
  zero: '🧊 Idle 0',
  slow: '🐢 Slow',
  fast: '🚀 Fast',
  red: '🔥 Overheat',
};

/** 浏览器预览里 `.widget-root` 的横向溜达范围（收窄防止胶囊被裁切） */
const BROWSER_WALK_RANGE: WalkRange = { minX: -92, maxX: 92 };
const SIM_RATE_DURATION_MS = 20_000;
const TICK_IDLE_MS = 250;
const TICK_WALK_MS = 16;
const WALK_BOUNDS_REFRESH_MS = 5000;

function isAuditQueryMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('audit') === '1';
  } catch {
    return false;
  }
}
const SELF_MOVE_GUARD_MS = 450;

/** 调试条「模拟速率」按钮：按档位阈值自动取值，档位调整后无需改这里 */
export const SIM_RATE_BUTTONS: readonly { key: string; label: string; tps: number }[] = [
  { key: 'zero', label: '🧊 模拟 0', tps: 0 },
  { key: 'slow', label: '🐢 慢', tps: Math.round(RATE_TIERS[1].enter * 4) },
  { key: 'fast', label: '🚀 快', tps: Math.round(RATE_TIERS[2].enter * 1.8) },
  { key: 'red', label: '🔥 红温', tps: Math.round(RATE_TIERS[3].enter * 1.6) },
];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  openai: 'ChatGPT',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  grok: 'Grok',
  antigravity: 'Antigravity',
  other: 'Other',
};

function isValidPetId(val: string | null): val is SwitchablePetId {
  return PET_ROSTER.some((item) => item.id === val);
}

function isPetAction(val: string | undefined): val is PetAction {
  return val === 'pat' || val === 'work' || val === 'eat' || val === 'sleep' || val === 'music';
}

function readStorage(key: string): string | null {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // 忽略无痕/沙盒写入限制
  }
}

const LOCAL_KV: KVStore = { get: readStorage, set: writeStorage };

export class CyberPetApp {
  private readonly rootEl: HTMLElement;
  private readonly isTauri: boolean;

  private pet: PetController | null = null;
  private readonly director: FishDirector;
  private stopPolling: (() => void) | null = null;
  private stopRatePolling: (() => void) | null = null;
  private stopTray: (() => void) | null = null;

  private autoPassthrough = false;
  private activeChar: SwitchablePetId;
  private muted: boolean;
  private lang: DemoLang;
  private todayTokens = 0;
  private byProvider: Partial<Record<ProviderId, number>> = {};

  private suppressPollingToast = false;
  private suppressTokenWork = false;
  private hasInitialSyncRun = false;
  private lastSeenTotalTokens: number | null = null;
  private toastTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private browserReturnTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private tauriDragIdleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private tickTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private lastPassthroughCheckAt = 0;
  private lastHoverCheckAt = 0;
  private destroyed = false;

  private dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    active: boolean;
    isTauriMode: boolean;
  } | null = null;
  private browserDragOffset = { x: 0, y: 0 };
  private lastTauriWinPos: { x: number; y: number } | null = null;
  private stopTauriMove: (() => void) | null = null;

  // 溜达
  private walkX = 0;
  private walkRange: WalkRange = BROWSER_WALK_RANGE;
  private walkReady: boolean;
  private walkBoundsAt = Number.NEGATIVE_INFINITY;
  private walkBoundsInFlight = false;
  private lastSentWalkX: number | null = null;
  private selfMoveUntil = 0;
  private lastTickAt = 0;

  private stageShellEl: HTMLElement | null = null;
  private widgetRootEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private charSwitcherEl!: HTMLElement;
  private footCapsuleEl!: HTMLElement;
  private petCanvasEl!: HTMLCanvasElement;
  private petHoverToysEl!: HTMLElement;
  private capRateEl: HTMLElement | null = null;
  private capRateValEl: HTMLElement | null = null;
  private capSparkEl: HTMLElement | null = null;
  private capBowlsEl: HTMLElement | null = null;
  private capBowlsValEl: HTMLElement | null = null;

  private readonly boundPointerMove: (ev: PointerEvent) => void;
  private readonly boundDragPointerDown: (ev: PointerEvent) => void;
  private readonly boundDragPointerMove: (ev: PointerEvent) => void;
  private readonly boundDragPointerEnd: (ev: PointerEvent) => void;
  private readonly boundCanvasHover: (ev: PointerEvent) => void;
  private readonly boundWindowBlur: () => void;
  private readonly boundWindowResize: () => void;

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;
    this.isTauri = isTauriDesktop();
    this.walkReady = !this.isTauri;

    const savedMuted = readStorage(STORAGE_MUTED_KEY) === '1';
    this.muted = savedMuted;
    setMuted(savedMuted);
    this.lang = detectInitialLang(this.isTauri);

    const savedChar = readStorage(STORAGE_CHAR_KEY);
    this.activeChar = isValidPetId(savedChar) ? savedChar : 'dafeiyu';

    // 老虎机功能已通过 ENABLE_SLOT_MACHINE = false 隔离封存，不初始化任何游戏状态
    if (ENABLE_SLOT_MACHINE) {
      // Reserved slot mode disabled in pure pet build
    }

    this.director = new FishDirector({
      storage: LOCAL_KV,
      now: performance.now(),
      walkEnabled: readStorage(WALK_STORAGE_KEY) !== '0',
      onChange: () => this.updateCapsuleLive(),
    });

    this.boundPointerMove = (ev) => this.handlePointerMove(ev);
    this.boundDragPointerDown = (ev) => this.handlePetDragPointerDown(ev);
    this.boundDragPointerMove = (ev) => this.handlePetDragPointerMove(ev);
    this.boundDragPointerEnd = (ev) => this.handlePetDragPointerEnd(ev);
    this.boundCanvasHover = (ev) => this.handleCanvasHover(ev);
    this.boundWindowBlur = () => this.finishActiveDrag();
    this.boundWindowResize = () => this.syncBrowserWalkRange();
  }

  public async mount(): Promise<void> {
    this.applyModeClasses();
    this.buildShellDom();
    this.syncBrowserWalkRange();
    this.bindEvents();
    this.renderAllDynamic();

    this.pet = await mountPet(this.petCanvasEl, './assets');
    if (this.destroyed) {
      this.pet.destroy();
      return;
    }
    this.pet.setCharacter(this.activeChar);
    if (!isAuditQueryMode()) {
      this.director.attachPet(this.pet);
    }

    if (this.isTauri) {
      const tauriGlobal = (
        window as unknown as {
          __TAURI__?: {
            window?: {
              getCurrentWindow?: () => {
                outerPosition?: () => Promise<{ x: number; y: number }>;
              };
            };
            event?: {
              listen?: (
                name: string,
                cb: (ev: { payload?: unknown }) => void,
              ) => Promise<() => void>;
            };
          };
        }
      ).__TAURI__;

      const outerPosPromise = tauriGlobal?.window?.getCurrentWindow?.()?.outerPosition?.();
      if (outerPosPromise && typeof outerPosPromise.then === 'function') {
        void outerPosPromise
          .then((pos) => {
            if (!this.destroyed && pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
              const dpr = Math.max(1, window.devicePixelRatio || 1);
              this.lastTauriWinPos = { x: pos.x / dpr, y: pos.y / dpr };
            }
          })
          .catch(() => {});
      }

      const tauriListen = tauriGlobal?.event?.listen;
      if (typeof tauriListen === 'function') {
        void tauriListen('tauri://move', (ev) => this.handleTauriWindowMove(ev.payload))
          .then((unlisten) => {
            if (this.destroyed) unlisten();
            else this.stopTauriMove = unlisten;
          })
          .catch(() => {});
      }

      void setWalkMenuChecked(this.director.walker.enabled);
      void this.refreshWalkBounds(performance.now());
    }

    // 25s 快照：今日总量与各平台明细；1.5s 实时速率：驱动档位、摸鱼、碗塔与转速条
    this.stopPolling = startTokenPolling((snap) => this.handleTokenSnapshot(snap), 25000);
    this.stopRatePolling = startRatePolling((s) => this.handleRateSample(s), 1500);
    this.stopTray = onTrayAction((action) => this.handleTrayAction(action));

    this.lastTickAt = performance.now();
    this.scheduleTick(TICK_IDLE_MS);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.toastTimer) globalThis.clearTimeout(this.toastTimer);
    if (this.browserReturnTimer) globalThis.clearTimeout(this.browserReturnTimer);
    if (this.tauriDragIdleTimer) globalThis.clearTimeout(this.tauriDragIdleTimer);
    if (this.tickTimer) globalThis.clearTimeout(this.tickTimer);

    this.stopPolling?.();
    this.stopRatePolling?.();
    this.stopTray?.();
    this.stopTauriMove?.();
    this.director.detach();
    this.pet?.destroy();

    this.petCanvasEl?.removeEventListener('pointerdown', this.boundDragPointerDown);
    this.petCanvasEl?.removeEventListener('pointermove', this.boundCanvasHover);
    this.petCanvasEl?.removeEventListener('pointerenter', this.boundCanvasHover);
    this.petCanvasEl?.removeEventListener('lostpointercapture', this.boundDragPointerEnd);
    window.removeEventListener('pointermove', this.boundDragPointerMove);
    window.removeEventListener('pointerup', this.boundDragPointerEnd);
    window.removeEventListener('pointercancel', this.boundDragPointerEnd);
    window.removeEventListener('blur', this.boundWindowBlur);
    window.removeEventListener('resize', this.boundWindowResize);
    window.removeEventListener('pointermove', this.boundPointerMove);
  }

  private applyModeClasses(): void {
    document.documentElement.classList.toggle('mode-tauri', this.isTauri);
    document.documentElement.classList.toggle('mode-browser', !this.isTauri);
    document.body.classList.toggle('mode-tauri', this.isTauri);
    document.body.classList.toggle('mode-browser', !this.isTauri);
  }

  private buildHeroHeaderInnerHtml(): string {
    const isEn = this.lang === 'en';
    return `
      <div class="web-hero-title-row">
        <h1 class="web-hero-title">${isEn ? '🐳 DeepSlack · AI Token Desktop Pet' : '🐳 DeepSlack · 深度摸鱼（烧币版）'}</h1>
        <div class="web-hero-links">
          <a
            class="web-hero-link is-primary"
            href="https://github.com/fanhhh1103/deepslack/releases/latest"
            target="_blank"
            rel="noopener"
          >${isEn ? '⬇️ macOS / Windows' : '⬇️ 下载 macOS / Windows'}</a>
          <a
            class="web-hero-link"
            href="https://github.com/fanhhh1103/deepslack"
            target="_blank"
            rel="noopener"
          >⭐ GitHub</a>
          <button
            type="button"
            class="web-hero-link"
            id="btn-lang-toggle"
            title="${isEn ? '切换为中文界面' : 'Switch to English UI'}"
          >🌐 ${isEn ? '中文' : 'EN'}</button>
        </div>
      </div>
      <p class="web-hero-subtitle">${
        isEn
          ? 'Powered by your daily Claude Code / Codex / Antigravity token burn · Click, drag & toss toys right here!'
          : '烧真实 AI Token 喂养的赛博电子鸡 · 点桌宠 / 丢玩具 3 秒免安装试玩'
      }</p>
    `;
  }

  private buildSimBarInnerHtml(): string {
    const isEn = this.lang === 'en';
    return `
      <span class="sim-bar-label">${isEn ? '🎮 3s Interactive Demo' : '🎮 3 秒试玩交互'}</span>
      ${SIM_RATE_BUTTONS.map(
        (btn) => `
          <button
            type="button"
            class="sim-feed-btn sim-rate-btn"
            data-sim-rate="${btn.tps}"
            data-sim-rate-key="${btn.key}"
            title="${escapeHtml(
              isEn
                ? `Simulate ${formatRate(btn.tps)} token burn for 20s`
                : `模拟实时速率 ${formatRate(btn.tps)}，持续 20 秒`,
            )}"
          >${escapeHtml(isEn ? (SIM_RATE_LABELS_EN[btn.key] ?? btn.label) : btn.label)}</button>
        `,
      ).join('')}
      <button type="button" class="sim-feed-btn sim-walk-btn" id="btn-sim-walk" title="${
        isEn ? 'Walk & peek around the stage' : '立刻溜达一下（含边缘探头）'
      }">${isEn ? '🚶 Walk' : '🚶溜达一下'}</button>
      <span class="sim-bar-sep" aria-hidden="true"></span>
      ${SIM_PROVIDER_BUTTONS.map(
        (btn) => `
          <button
            type="button"
            class="sim-feed-btn"
            data-sim-provider="${btn.provider}"
            data-sim-tokens="${btn.tokens}"
            style="--btn-accent:${btn.color}"
            title="${escapeHtml(
              isEn
                ? `Simulate +${formatCompactNumber(btn.tokens)} ${btn.label} tokens`
                : `模拟 ${btn.label} 消耗 +${formatCompactNumber(btn.tokens)} Tokens 并联动敲键盘打工`,
            )}"
          >
            ${btn.emoji} +${formatCompactNumber(btn.tokens)} ${escapeHtml(btn.label)}
          </button>
        `,
      ).join('')}
      <button
        type="button"
        class="sim-feed-btn sim-burst"
        id="btn-sim-burst"
        title="${isEn ? 'Simulate token burn burst & trigger typing' : '一键模拟烧 Token 并触发当前 AI 娘敲键盘打工'}"
      >
        ${isEn ? '🔥 Burn Tokens' : '🔥 模拟烧 Token 触发打工'}
      </button>
      <span class="sim-bar-sep" aria-hidden="true"></span>
      <button type="button" class="sim-feed-btn sim-action-btn" data-sim-action="pat" title="${isEn ? 'Head pat' : '触发摸头杀动作'}">${isEn ? '🤚 Pat' : '🤚摸头'}</button>
      <button type="button" class="sim-feed-btn sim-action-btn" data-sim-action="work" title="${isEn ? 'Typing work' : '触发狂敲键盘打工动作'}">${isEn ? '⌨️ Work' : '⌨️打工'}</button>
      <button type="button" class="sim-feed-btn sim-action-btn" data-sim-action="eat" title="${isEn ? 'Feed rice' : '触发坐姿投喂吃美食动作'}">${isEn ? '🍰 Eat' : '🍰投喂'}</button>
      <button type="button" class="sim-feed-btn sim-action-btn" data-sim-action="music" title="${isEn ? 'Whale headphones vibe' : '触发小鲸鱼耳机听歌摇摆动作'}">${isEn ? '🎧 Music' : '🎧听歌'}</button>
      <button type="button" class="sim-feed-btn sim-action-btn" data-sim-action="sleep" title="${isEn ? 'Nap on whale pillow' : '触发抱枕趴睡动作'}">${isEn ? '💤 Sleep' : '💤睡觉'}</button>
    `;
  }

  private renderWebDemoChrome(): void {
    if (this.isTauri) return;
    const heroEl = this.rootEl.querySelector<HTMLElement>('#web-hero-header');
    if (heroEl) heroEl.innerHTML = this.buildHeroHeaderInnerHtml();
    const simBarEl = this.rootEl.querySelector<HTMLElement>('#web-sim-bar');
    if (simBarEl) simBarEl.innerHTML = this.buildSimBarInnerHtml();
  }

  private toggleDemoLang(): void {
    this.lang = this.lang === 'en' ? 'zh' : 'en';
    writeStorage(STORAGE_LANG_KEY, this.lang);
    this.renderWebDemoChrome();
    this.renderPetHoverToys();
    playSfx('click');
    this.showToast(this.lang === 'en' ? '🌐 Switched to English UI' : '🌐 已切换为中文界面');
  }

  private buildShellDom(): void {
    const heroHeaderHtml = !this.isTauri
      ? `<header class="web-hero-header" id="web-hero-header">${this.buildHeroHeaderInnerHtml()}</header>`
      : '';

    const simBarHtml = !this.isTauri
      ? `<div class="web-sim-bar" id="web-sim-bar">${this.buildSimBarInnerHtml()}</div>`
      : '';

    this.rootEl.innerHTML = `
      ${heroHeaderHtml}
      <div class="browser-stage-shell">
        <div class="widget-root is-pure-pet" id="widget-root">
          <div class="floating-toast" id="floating-toast" role="status" aria-live="polite"></div>

          <section class="companion-zone ui-interactive" id="companion-zone">
            <div class="pet-canvas-wrap">
              <canvas class="pet-canvas" id="pet-canvas" width="256" height="234"></canvas>
            </div>

            <div class="pet-hover-toys" id="pet-hover-toys"></div>

            <div class="companion-dock-right">
              <div class="char-switcher" id="char-switcher"></div>
              <div class="foot-capsule" id="foot-capsule"></div>
            </div>
          </section>
        </div>
      </div>
      ${simBarHtml}
    `;

    this.stageShellEl = this.rootEl.querySelector('.browser-stage-shell');
    this.widgetRootEl = this.rootEl.querySelector('#widget-root')!;
    this.toastEl = this.rootEl.querySelector('#floating-toast')!;
    this.charSwitcherEl = this.rootEl.querySelector('#char-switcher')!;
    this.footCapsuleEl = this.rootEl.querySelector('#foot-capsule')!;
    this.petCanvasEl = this.rootEl.querySelector('#pet-canvas')!;
    this.petHoverToysEl = this.rootEl.querySelector('#pet-hover-toys')!;
  }

  private syncBrowserWalkRange(): void {
    if (this.isTauri) return;
    const shellW = this.stageShellEl?.clientWidth || 310;
    const slack = Math.max(24, Math.min(130, Math.floor((shellW - 260) * 0.5)));
    this.walkRange = { minX: -slack, maxX: slack };
    if (this.walkX < this.walkRange.minX || this.walkX > this.walkRange.maxX) {
      this.walkX = Math.max(this.walkRange.minX, Math.min(this.walkRange.maxX, this.walkX));
      this.applyWidgetTransform();
    }
  }

  private bindEvents(): void {
    const heroHeader = this.rootEl.querySelector('#web-hero-header');
    if (heroHeader) {
      heroHeader.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (target?.closest('#btn-lang-toggle')) {
          this.toggleDemoLang();
        }
      });
    }

    // 浏览器顶部纯桌宠调试条（模拟速率 / 溜达 / 模拟烧 Token / 4 动作快捷键）
    const simBar = this.rootEl.querySelector('#web-sim-bar');
    if (simBar) {
      simBar.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;

        const rateBtn = target.closest<HTMLButtonElement>('.sim-rate-btn[data-sim-rate]');
        if (rateBtn) {
          const tps = Number(rateBtn.dataset.simRate || 0);
          simulateTokenRate(tps, tps > 0 ? SIM_RATE_DURATION_MS : 0);
          this.director.previewRate(tps, performance.now());
          playSfx('click');
          this.showToast(
            tps > 0
              ? `⚡ 模拟速率 ${formatRate(tps)} · 持续 20 秒`
              : '🧊 已停止模拟速率（归零）',
          );
          return;
        }

        if (target.closest('#btn-sim-walk')) {
          const now = performance.now();
          this.syncBrowserWalkRange();
          if (this.pet && !this.dragState?.active) {
            this.pet.setMood('idle');
          }
          this.director.forceWalk(now, this.walkX, this.walkRange);
          this.scheduleTick(0);
          this.showToast('🚶 溜达一下～');
          return;
        }

        const providerBtn = target.closest<HTMLButtonElement>('.sim-feed-btn[data-sim-provider]');
        if (providerBtn) {
          const provider = (providerBtn.dataset.simProvider || 'other') as ProviderId;
          const tokens = Number(providerBtn.dataset.simTokens || 60_000);
          this.handleSimFeed(provider, tokens);
          return;
        }

        if (target.closest('#btn-sim-burst')) {
          this.handleSimBurst();
          return;
        }

        const actionBtn = target.closest<HTMLButtonElement>('.sim-feed-btn[data-sim-action]');
        if (actionBtn && isPetAction(actionBtn.dataset.simAction)) {
          this.director.noteInteraction(performance.now());
          this.pet?.triggerAction(actionBtn.dataset.simAction);
        }
      });
    }

    // 揪后领拖拽物理闭环（> 5px 判定为拖拽）
    this.petCanvasEl.addEventListener('pointerdown', this.boundDragPointerDown);
    this.petCanvasEl.addEventListener('lostpointercapture', this.boundDragPointerEnd);
    window.addEventListener('pointermove', this.boundDragPointerMove, { passive: true });
    window.addEventListener('pointerup', this.boundDragPointerEnd, { passive: true });
    window.addEventListener('pointercancel', this.boundDragPointerEnd, { passive: true });
    window.addEventListener('blur', this.boundWindowBlur);
    if (!this.isTauri) {
      window.addEventListener('resize', this.boundWindowResize, { passive: true });
    }

    // 摸鱼抓包：鼠标移入桌宠身体
    this.petCanvasEl.addEventListener('pointermove', this.boundCanvasHover, { passive: true });
    this.petCanvasEl.addEventListener('pointerenter', this.boundCanvasHover, { passive: true });

    // 悬停空投小玩具条（扔饭 / 冰美式 / 扔Bug / 摸头 / 睡觉）
    this.petHoverToysEl.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        '.pet-toy-btn[data-pet-toy]',
      );
      const toy = btn?.dataset.petToy;
      if (!btn || !isPetToyAction(toy)) return;
      this.handleToy(toy);
    });

    // 5 位 AI 娘切换器
    this.charSwitcherEl.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        '.char-switch-btn[data-pet-char]',
      );
      if (!btn) return;
      const charId = btn.dataset.petChar ?? null;
      if (!isValidPetId(charId)) return;
      this.switchCharacter(charId);
    });

    // 底部转速条交互（静音按钮事件委托，避免胶囊重建后丢监听）
    this.footCapsuleEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest('#btn-mute')) {
        this.toggleMute();
      }
    });

    if (this.isTauri) {
      window.addEventListener('pointermove', this.boundPointerMove, { passive: true });
    }
  }

  private handleToy(toy: 'rice' | 'coffee' | 'bug' | 'music' | 'pat' | 'sleep'): void {
    const now = performance.now();
    if (toy === 'pat' || toy === 'sleep' || toy === 'music') {
      this.director.noteInteraction(now);
      this.pet?.triggerAction(toy);
      return;
    }
    if (this.director.throwToy(toy, now)) {
      playSfx('click');
    } else {
      this.showToast('🪂 空投太多啦，等她先接完～');
    }
  }

  private handleCanvasHover(ev: PointerEvent): void {
    if (!this.pet || this.destroyed || this.dragState?.active) return;
    const now = performance.now();
    if (now - this.lastHoverCheckAt < 120) return;
    this.lastHoverCheckAt = now;
    if (!this.director.brain.slacking) return;
    if (!this.pet.isPointOpaque(ev.clientX, ev.clientY)) return;
    this.director.handleHover(now);
  }

  private toggleMute(): void {
    this.muted = !isMuted();
    setMuted(this.muted);
    writeStorage(STORAGE_MUTED_KEY, this.muted ? '1' : '0');
    this.renderFootCapsule();
    if (!this.muted) playSfx('click');
    this.showToast(this.muted ? '🔇 已静音音效' : '🔊 已开启音效');
  }

  private handlePointerMove(ev: PointerEvent): void {
    if (!this.isTauri || !this.autoPassthrough) return;
    const now = performance.now();
    if (now - this.lastPassthroughCheckAt < 48) return;
    this.lastPassthroughCheckAt = now;

    const interactive = this.isPointInteractive(ev.clientX, ev.clientY);
    void setClickThrough(!interactive);
  }

  private isPointInteractive(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return false;

    if (el.closest('.char-switcher') || el.closest('.foot-capsule') || el.closest('.pet-hover-toys')) {
      return true;
    }

    if (el.id === 'pet-canvas' || el.closest('.pet-canvas-wrap')) {
      return this.pet ? this.pet.isPointOpaque(clientX, clientY) : true;
    }

    return false;
  }

  private handleTrayAction(action: string): void {
    switch (action) {
      case 'pet-pat': {
        this.pet?.triggerAction('pat');
        break;
      }
      case 'refresh-tokens': {
        void this.refreshTokensManual();
        break;
      }
      case 'restore-panel': {
        this.autoPassthrough = false;
        void setClickThrough(false);
        this.showToast('🖱️ 已取消穿透，桌宠已恢复可点击');
        break;
      }
      case 'toggle-top': {
        this.showToast('📌 已切换窗口置顶状态');
        break;
      }
      case 'reset-position': {
        this.autoPassthrough = false;
        void setClickThrough(false);
        this.walkBoundsAt = Number.NEGATIVE_INFINITY;
        this.showToast('📐 已重置桌宠位置至右下角');
        break;
      }
      case 'toggle-walk': {
        this.setWalkEnabled(!this.director.walker.enabled);
        break;
      }
      default:
        break;
    }
  }

  private setWalkEnabled(on: boolean): void {
    this.director.setWalkEnabled(on, performance.now());
    writeStorage(WALK_STORAGE_KEY, on ? '1' : '0');
    void setWalkMenuChecked(on);
    this.showToast(on ? '🚶 已开启自由溜达' : '🧍 已关闭自由溜达，乖乖待在原地');
  }

  // ==================== 溜达调度 ====================

  private scheduleTick(delayMs: number): void {
    if (this.destroyed || isAuditQueryMode()) return;
    if (this.tickTimer) globalThis.clearTimeout(this.tickTimer);
    this.tickTimer = globalThis.setTimeout(() => {
      this.tickTimer = null;
      this.runTick();
    }, delayMs);
  }

  private runTick(): void {
    if (this.destroyed) return;
    const now = performance.now();
    const dt = Math.min(1, Math.max(0, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;

    this.director.tick(now);

    const walker = this.director.walker;
    if (
      this.isTauri &&
      walker.phase === 'rest' &&
      now - this.walkBoundsAt >= WALK_BOUNDS_REFRESH_MS
    ) {
      void this.refreshWalkBounds(now);
    }

    const hardBlocked = !this.walkReady || Boolean(this.dragState?.active) || this.widgetRootEl.classList.contains('is-drag-returning');
    const step = this.director.stepWalk(now, dt, this.walkX, this.walkRange, hardBlocked);
    if (step.x !== this.walkX) {
      this.walkX = step.x;
      this.applyWalkPosition(now);
    }

    this.scheduleTick(walker.isMoving ? TICK_WALK_MS : TICK_IDLE_MS);
  }

  private async refreshWalkBounds(now: number): Promise<void> {
    if (!this.isTauri || this.walkBoundsInFlight) return;
    this.walkBoundsInFlight = true;
    this.walkBoundsAt = now;
    try {
      const b = await getWalkBounds();
      if (this.destroyed || !b) return;
      // 溜达中不覆盖当前位置，避免与自身移动打架
      this.walkRange = { minX: b.minX, maxX: b.maxX };
      if (this.director.walker.phase === 'rest') {
        this.walkX = b.winX;
        this.lastSentWalkX = Math.round(b.winX);
      }
      this.walkReady = true;
    } finally {
      this.walkBoundsInFlight = false;
    }
  }

  private applyWalkPosition(now: number): void {
    if (this.isTauri) {
      const rx = Math.round(this.walkX);
      if (rx === this.lastSentWalkX) return;
      this.lastSentWalkX = rx;
      this.selfMoveUntil = now + SELF_MOVE_GUARD_MS;
      void moveWindowTo(rx);
      return;
    }
    this.applyWidgetTransform();
  }

  private applyWidgetTransform(): void {
    const tx = (this.isTauri ? 0 : this.walkX) + this.browserDragOffset.x;
    const ty = this.browserDragOffset.y;
    this.widgetRootEl.style.transform =
      tx === 0 && ty === 0 ? '' : `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
  }

  // ==================== 拖拽 ====================

  private handlePetDragPointerDown(ev: PointerEvent): void {
    if (!this.pet || this.destroyed) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (!this.pet.isPointOpaque(ev.clientX, ev.clientY)) return;
    this.director.noteInteraction(performance.now());

    if (this.dragState?.active) {
      this.finishActiveDrag();
    }
    if (this.browserReturnTimer) {
      globalThis.clearTimeout(this.browserReturnTimer);
      this.browserReturnTimer = null;
    }
    this.widgetRootEl.classList.remove('is-drag-returning');
    this.dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      active: false,
      isTauriMode: this.isTauri,
    };
  }

  private handlePetDragPointerMove(ev: PointerEvent): void {
    const ds = this.dragState;
    if (!ds || ev.pointerId !== ds.pointerId || !this.pet || this.destroyed) return;

    const dx = ev.clientX - ds.lastX;
    const dy = ev.clientY - ds.lastY;
    ds.lastX = ev.clientX;
    ds.lastY = ev.clientY;

    if (!ds.active) {
      if (Math.hypot(ev.clientX - ds.startX, ev.clientY - ds.startY) <= 5) {
        return;
      }
      ds.active = true;
      this.widgetRootEl.classList.add('is-dragging');
      this.director.noteInteraction(performance.now());
      this.pet.startDrag();

      if (ds.isTauriMode) {
        this.scheduleTauriDragIdleEnd(260);
        try {
          const tauriWin = (
            window as unknown as {
              __TAURI__?: {
                window?: {
                  getCurrentWindow?: () => { startDragging?: () => Promise<void> | void };
                };
              };
            }
          ).__TAURI__?.window?.getCurrentWindow?.();
          const dragPromise = tauriWin?.startDragging?.();
          if (dragPromise && typeof (dragPromise as Promise<void>).catch === 'function') {
            (dragPromise as Promise<void>).catch(() => {});
          }
        } catch {
          // 忽略非桌面权限异常
        }
        return;
      }

      try {
        this.petCanvasEl.setPointerCapture(ev.pointerId);
      } catch {
        // 忽略合成事件无 pointerId 情况
      }
    }

    if (ds.isTauriMode) {
      this.pet.feedDragDelta(dx, dy);
      this.scheduleTauriDragIdleEnd(160);
    } else {
      const minDragX = this.walkRange.minX - this.walkX;
      const maxDragX = this.walkRange.maxX - this.walkX;
      const nextX = Math.max(minDragX, Math.min(maxDragX, this.browserDragOffset.x + dx));
      const nextY = Math.max(-42, Math.min(16, this.browserDragOffset.y + dy));
      this.browserDragOffset = { x: nextX, y: nextY };
      this.applyWidgetTransform();
      this.pet.feedDragDelta(dx, dy);
    }
  }

  private handlePetDragPointerEnd(ev: PointerEvent): void {
    const ds = this.dragState;
    if (!ds || ev.pointerId !== ds.pointerId) return;
    this.finishActiveDrag();
  }

  private handleTauriWindowMove(payload: unknown): void {
    if (this.destroyed) return;
    const p = payload as { x?: number; y?: number; position?: { x?: number; y?: number } } | undefined;
    const rawX = typeof p?.x === 'number' ? p.x : p?.position?.x;
    const rawY = typeof p?.y === 'number' ? p.y : p?.position?.y;
    if (typeof rawX !== 'number' || typeof rawY !== 'number') return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const nx = rawX / dpr;
    const ny = rawY / dpr;

    // 自己溜达移动窗口也会触发 tauri://move：屏蔽，绝不当成用户拖拽
    const selfMove =
      performance.now() < this.selfMoveUntil || this.director.walker.isMoving;
    if (selfMove) {
      this.lastTauriWinPos = { x: nx, y: ny };
      return;
    }

    if (this.lastTauriWinPos && this.dragState?.active && this.dragState.isTauriMode) {
      const dx = nx - this.lastTauriWinPos.x;
      const dy = ny - this.lastTauriWinPos.y;
      if (dx !== 0 || dy !== 0) {
        this.pet?.feedDragDelta(dx, dy);
        this.scheduleTauriDragIdleEnd(160);
      }
    }
    this.lastTauriWinPos = { x: nx, y: ny };
    // 用户拖动/归位后同步溜达起点
    this.walkX = nx;
    this.lastSentWalkX = Math.round(nx);
    this.walkBoundsAt = Number.NEGATIVE_INFINITY;
  }

  private scheduleTauriDragIdleEnd(delayMs: number): void {
    if (this.tauriDragIdleTimer) {
      globalThis.clearTimeout(this.tauriDragIdleTimer);
    }
    this.tauriDragIdleTimer = globalThis.setTimeout(() => {
      this.tauriDragIdleTimer = null;
      if (this.dragState?.active && this.dragState.isTauriMode) {
        this.finishActiveDrag();
      }
    }, delayMs);
  }

  private finishActiveDrag(): void {
    const ds = this.dragState;
    if (!ds) return;
    this.dragState = null;

    if (this.tauriDragIdleTimer) {
      globalThis.clearTimeout(this.tauriDragIdleTimer);
      this.tauriDragIdleTimer = null;
    }
    this.widgetRootEl.classList.remove('is-dragging');
    if (!ds.active) return;

    try {
      if (this.petCanvasEl.hasPointerCapture?.(ds.pointerId)) {
        this.petCanvasEl.releasePointerCapture(ds.pointerId);
      }
    } catch {
      // 忽略释放失败
    }

    this.pet?.endDrag();
    this.director.noteInteraction(performance.now());

    if (!ds.isTauriMode) {
      this.walkX = Math.max(
        this.walkRange.minX,
        Math.min(this.walkRange.maxX, this.walkX + this.browserDragOffset.x),
      );
      this.widgetRootEl.classList.add('is-drag-returning');
      this.browserDragOffset = { x: 0, y: 0 };
      this.applyWidgetTransform();
      if (!this.widgetRootEl.style.transform) {
        this.widgetRootEl.style.transform = 'translate(0px, 0px)';
      }
      this.browserReturnTimer = globalThis.setTimeout(() => {
        this.browserReturnTimer = null;
        this.widgetRootEl.classList.remove('is-drag-returning');
        this.applyWidgetTransform();
      }, 360);
    }
  }

  // ==================== Token 数据 ====================

  private handleRateSample(sample: TokenRateSample): void {
    if (this.destroyed) return;
    this.director.handleRateSample(sample, performance.now());
    if (sample.todayTokens > this.todayTokens) {
      this.todayTokens = sample.todayTokens;
    }
  }

  private triggerTokenWorkIfEligible(): void {
    if (!this.pet || this.destroyed) return;
    const mood = this.pet.getMood();
    if (mood === 'eat' || mood === 'dangle') return;
    this.pet.triggerAction('work');
  }

  private handleTokenSnapshot(snap: TokenSnapshot): void {
    if (this.destroyed) return;
    const prevTokens = this.lastSeenTotalTokens;
    this.lastSeenTotalTokens = snap.totalTokens;

    this.todayTokens = snap.totalTokens;
    this.byProvider = snap.byProvider ?? {};
    this.updateCapsuleLive();

    if (!this.suppressPollingToast && !this.hasInitialSyncRun && snap.totalTokens > 0) {
      this.showToast(`🔥 今日已同步 ${formatCompactNumber(snap.totalTokens)} Tokens`);
    }
    this.hasInitialSyncRun = true;
    void prevTokens;
  }

  private async refreshTokensManual(): Promise<void> {
    const snap = await fetchTokenSnapshot(true);
    if (this.destroyed) return;
    this.lastSeenTotalTokens = snap.totalTokens;
    this.todayTokens = snap.totalTokens;
    this.byProvider = snap.byProvider ?? {};
    this.updateCapsuleLive();
    this.showToast(`🔄 已刷新快照：今日 ${formatCompactNumber(snap.totalTokens)} Tokens`);
  }

  private handleSimFeed(provider: ProviderId, tokens: number): void {
    const label = PROVIDER_LABELS[provider] ?? provider;
    this.suppressPollingToast = true;
    this.suppressTokenWork = true;
    let snap: TokenSnapshot;
    try {
      snap = simulateBurnTokens(provider, tokens);
    } finally {
      this.suppressPollingToast = false;
      this.suppressTokenWork = false;
    }
    playSfx('click');
    this.triggerTokenWorkIfEligible();
    this.showToast(
      `🔥 ${label} +${formatCompactNumber(tokens)} Tokens · 今日 ${formatCompactNumber(snap.totalTokens)}`,
    );
  }

  private handleSimBurst(): void {
    const burstPlan: Array<[ProviderId, number]> = [
      ['deepseek', 60_000],
      ['claude', 60_000],
      ['openai', 60_000],
      ['gemini', 60_000],
      ['grok', 60_000],
    ];
    this.suppressPollingToast = true;
    this.suppressTokenWork = true;
    let lastSnap: TokenSnapshot | null = null;
    try {
      for (const [provider, amount] of burstPlan) {
        lastSnap = simulateBurnTokens(provider, amount);
      }
    } finally {
      this.suppressPollingToast = false;
      this.suppressTokenWork = false;
    }

    const total = lastSnap?.totalTokens ?? this.todayTokens;
    playSfx('click');
    this.triggerTokenWorkIfEligible();
    this.showToast(`🔥 模拟烧 Token（今日 ${formatCompactNumber(total)}）· AI 娘狂敲键盘中！`);
  }

  private setPetMood(mood: PetMood, bubbleText?: string, durationMs?: number): void {
    if (!this.pet) return;
    this.pet.setMood(mood, bubbleText, durationMs);
  }

  private switchCharacter(charId: SwitchablePetId): void {
    this.activeChar = charId;
    writeStorage(STORAGE_CHAR_KEY, charId);
    this.pet?.setCharacter(charId);
    playSfx('click');
    const meta = PET_ROSTER.find((c) => c.id === charId);
    if (meta) {
      this.setPetMood('happy', meta.greetLine, 2600);
    }
    this.renderCharSwitcher();
  }

  // ==================== 渲染 ====================

  private renderAllDynamic(): void {
    this.renderPetHoverToys();
    this.renderCharSwitcher();
    this.renderFootCapsule();
  }

  private renderPetHoverToys(): void {
    this.petHoverToysEl.innerHTML = buildPetHoverToysHtml(this.lang);
  }

  private renderCharSwitcher(): void {
    this.charSwitcherEl.innerHTML = buildCharSwitcherHtml(this.activeChar);
  }

  private capsuleOptions(): PureFootCapsuleOptions {
    return {
      todayTokens: Math.max(this.todayTokens, this.director.rateTodayTokens),
      byProvider: this.byProvider,
      muted: this.muted,
      rate: this.director.displayRate,
      totalRate: this.director.totalRate,
      rateSamples: this.director.samples,
      tier: this.director.tier,
      bowls: this.director.ledger.total,
    };
  }

  private renderFootCapsule(): void {
    this.footCapsuleEl.innerHTML = buildFootCapsuleStatsHtml(this.capsuleOptions());
    this.capRateEl = this.footCapsuleEl.querySelector('#stat-rate');
    this.capRateValEl = this.footCapsuleEl.querySelector('#stat-rate-val');
    this.capSparkEl = this.footCapsuleEl.querySelector('#stat-spark');
    this.capBowlsEl = this.footCapsuleEl.querySelector('#stat-bowls');
    this.capBowlsValEl = this.footCapsuleEl.querySelector('#stat-bowls-val');
  }

  /** 只改文本节点与 class，不重建胶囊（避免 1.5s 一次的 DOM 抖动与悬停提示闪烁） */
  private updateCapsuleLive(): void {
    if (!this.capRateEl || !this.capRateValEl || !this.capSparkEl || !this.capBowlsValEl) {
      if (this.footCapsuleEl) this.renderFootCapsule();
      return;
    }
    const opts = this.capsuleOptions();
    const rateText = formatRate(opts.rate ?? 0);
    if (this.capRateValEl.textContent !== rateText) this.capRateValEl.textContent = rateText;
    const spark = buildSparkline(opts.rateSamples ?? [], 20).padStart(20, '▁');
    if (this.capSparkEl.textContent !== spark) this.capSparkEl.textContent = spark;
    const tierCls = `capsule-stat rate tier-${opts.tier ?? 0}`;
    if (this.capRateEl.className !== tierCls) this.capRateEl.className = tierCls;
    const rateTitle = buildRateCapsuleTitle(opts);
    if (this.capRateEl.title !== rateTitle) this.capRateEl.title = rateTitle;
    const bowlsText = String(opts.bowls ?? 0);
    if (this.capBowlsValEl.textContent !== bowlsText) {
      this.capBowlsValEl.textContent = bowlsText;
      if (this.capBowlsEl) this.capBowlsEl.title = buildBowlTitle(opts.bowls ?? 0);
    }
  }

  private showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer) globalThis.clearTimeout(this.toastTimer);
    this.toastTimer = globalThis.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
    }, 2400);
  }
}

export async function mountCyberPetApp(rootEl: HTMLElement): Promise<CyberPetApp> {
  const app = new CyberPetApp(rootEl);
  await app.mount();
  return app;
}
