import type { SlotGameState, SymbolDef } from '../game/types';
import { escapeHtml, getIconUrl, getSymbolShortHint, RARITY_META } from './formatters';

/**
 * 构建每 3 抽弹出的「挑 1 张新卡塞进老虎机（含 2🪙 刷新与跳过）」精致浮层
 */
export function buildDraftOverlayHtml(state: SlotGameState): string {
  const options = state.pendingDraft;
  if (!options || options.length === 0) return '';

  const rerollCost = state.costs.rerollDraft;
  const canReroll = state.tokenCoins >= rerollCost;
  const cardsHtml = options
    .map((sym, idx) => {
      const rarity = RARITY_META[sym.rarity] || RARITY_META.common;
      const sign = sym.baseValue >= 0 ? `+${sym.baseValue}` : `${sym.baseValue}`;
      return `
        <button class="draft-option-card rarity-${escapeHtml(sym.rarity)}" data-draft-idx="${idx}" type="button">
          <div class="draft-icon-wrap">
            <img src="${escapeHtml(getIconUrl(sym.iconId))}" alt="${escapeHtml(sym.name)}" class="draft-icon-img" />
          </div>
          <div class="draft-card-main">
            <div class="draft-card-top">
              <span class="draft-card-name">${escapeHtml(sym.name)}</span>
              <span class="draft-rarity-pill" style="color:${rarity.color};background:${rarity.bg};border-color:${rarity.border}">
                ${escapeHtml(rarity.label)}
              </span>
              <span class="draft-base-val">${escapeHtml(sign)}分</span>
            </div>
            <div class="draft-card-desc">${escapeHtml(getSymbolShortHint(sym.id))}</div>
          </div>
        </button>
      `;
    })
    .join('');

  return `
    <div class="modal-backdrop ui-interactive" id="draft-modal">
      <div class="draft-sheet">
        <div class="draft-header">
          <div class="draft-title-group">
            <span class="draft-title">🎁 挑 1 张新卡塞进老虎机</span>
            ${
              state.draftRerollLevel > 0
                ? `<span class="draft-sub">已提纯 ×${state.draftRerollLevel}</span>`
                : ''
            }
          </div>
          <div class="draft-header-right">
            <span class="draft-coin-pill">🪙 ${state.tokenCoins}</span>
            <button type="button" class="btn-draft-skip" id="btn-draft-skip" title="跳过本次选卡">跳过</button>
          </div>
        </div>

        <div class="draft-options-list">
          ${cardsHtml}
        </div>

        <div class="draft-footer">
          <button
            type="button"
            class="btn-draft-reroll ${canReroll ? '' : 'is-disabled'}"
            id="btn-draft-reroll"
            ${canReroll ? '' : 'disabled'}
          >
            🎲 刷新卡池 · 稀有度UP (${rerollCost}🪙)
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * 构建本局牌库条目 HTML（供首次渲染与 Tab 局部切换复用）
 */
export function buildDeckTabItemsHtml(
  state: SlotGameState,
  symbolsMap: Record<string, SymbolDef>,
): string {
  return state.deck
    .map((inst) => {
      const def = symbolsMap[inst.defId] || {
        id: inst.defId,
        name: inst.defId,
        iconId: inst.defId,
        rarity: 'common' as const,
        baseValue: 0,
        description: '',
        flavor: '',
      };
      const rarity = RARITY_META[def.rarity] || RARITY_META.common;
      const effectiveBase = def.baseValue + inst.bonusValue;
      const multStr = inst.multiplier !== 1 ? ` ×${Number(inst.multiplier.toFixed(2))}` : '';
      return `
        <div class="codex-item rarity-${escapeHtml(def.rarity)}">
          <img src="${escapeHtml(getIconUrl(def.iconId))}" alt="${escapeHtml(def.name)}" class="codex-icon" />
          <div class="codex-info">
            <div class="codex-row1">
              <strong>${escapeHtml(def.name)}</strong>
              <span class="codex-tag" style="color:${rarity.color};background:${rarity.bg}">${escapeHtml(rarity.label)}</span>
              ${inst.stampedByClaude ? '<span class="claude-stamp-mini">✦Claude章</span>' : ''}
              ${inst.bonusValue > 0 ? `<span class="growth-mini">成长+${inst.bonusValue}</span>` : ''}
              <span class="codex-score">${effectiveBase >= 0 ? `+${effectiveBase}` : effectiveBase}${escapeHtml(multStr)}</span>
            </div>
            <div class="codex-desc">${escapeHtml(def.description)}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * 构建全梗图鉴条目 HTML（供首次渲染与 Tab 局部切换复用）
 */
export function buildCodexTabItemsHtml(symbolsMap: Record<string, SymbolDef>): string {
  return Object.values(symbolsMap)
    .map((def) => {
      const rarity = RARITY_META[def.rarity] || RARITY_META.common;
      return `
        <div class="codex-item rarity-${escapeHtml(def.rarity)}">
          <img src="${escapeHtml(getIconUrl(def.iconId))}" alt="${escapeHtml(def.name)}" class="codex-icon" />
          <div class="codex-info">
            <div class="codex-row1">
              <strong>${escapeHtml(def.name)}</strong>
              <span class="codex-tag" style="color:${rarity.color};background:${rarity.bg}">${escapeHtml(rarity.label)}</span>
              <span class="codex-score">${def.baseValue >= 0 ? `+${def.baseValue}` : def.baseValue}分</span>
            </div>
            <div class="codex-desc">${escapeHtml(def.description)}</div>
            <div class="codex-flavor">${escapeHtml(def.flavor)}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * 构建「📖 牌库 / 全梗图鉴」浮层
 */
export function buildDeckModalHtml(
  state: SlotGameState,
  symbolsMap: Record<string, SymbolDef>,
  activeTab: 'deck' | 'codex'
): string {
  const allDefsCount = Object.keys(symbolsMap).length;
  const bodyHtml =
    activeTab === 'deck'
      ? buildDeckTabItemsHtml(state, symbolsMap)
      : buildCodexTabItemsHtml(symbolsMap);

  return `
    <div class="modal-backdrop ui-interactive" id="deck-modal">
      <div class="codex-sheet">
        <div class="codex-header">
          <div class="codex-tabs">
            <button
              type="button"
              class="codex-tab ${activeTab === 'deck' ? 'is-active' : ''}"
              data-codex-tab="deck"
            >
              🎒 本局牌库 (${state.deck.length})
            </button>
            <button
              type="button"
              class="codex-tab ${activeTab === 'codex' ? 'is-active' : ''}"
              data-codex-tab="codex"
            >
              📘 全梗图鉴 (${allDefsCount})
            </button>
          </div>
          <button type="button" class="icon-close-btn" id="btn-close-codex">✕</button>
        </div>

        <div class="codex-body">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;
}
