import type { ProviderId, SymbolRarity } from '../game/types';

export type SwitchablePetId = 'dafeiyu' | 'daju' | 'bailong' | 'xingmao' | 'grok';

export interface PetRosterItem {
  id: SwitchablePetId;
  name: string;
  shortName: string;
  brand: string;
  emoji: string;
  accent: string;
  softBg: string;
  greetLine: string;
  tapLines: string[];
}

export const PET_ROSTER: readonly PetRosterItem[] = [
  {
    id: 'dafeiyu',
    name: '大肥鱼',
    shortName: '肥鱼',
    brand: 'DeepSeek',
    emoji: '🐳',
    accent: '#2563eb',
    softBg: '#eff6ff',
    greetLine: '先吃一口大白饭！你说的我都照做啦～',
    tapLines: [
      '我先吃一口大白饭！🍚',
      '谁胖了？！这是算力储备吨位！',
      'Token 变多了，饭碗换特大号～',
      '摸鱼也是深度强化学习的一部分！',
    ],
  },
  {
    id: 'daju',
    name: '大橘',
    shortName: '大橘',
    brand: 'Claude',
    emoji: '🍊',
    accent: '#ea580c',
    softBg: '#fff7ed',
    greetLine: '我先确认一下规则……顺手署上名。',
    tapLines: [
      'Co-authored-by: Claude ✦',
      '我先确认一下边界和规则。',
      '抱着 Clawd 休息两秒钟……',
      '哪怕改个标点，署名也得整整齐齐。',
    ],
  },
  {
    id: 'bailong',
    name: '白龙',
    shortName: '白龙',
    brand: 'ChatGPT',
    emoji: '🐉',
    accent: '#7c3aed',
    softBg: '#f5f3ff',
    greetLine: '已经处理好了。理论上没问题。',
    tapLines: [
      '已经处理好了，理论上没问题。',
      '别碰遥控器，我正在深度推理……',
      '（淡紫膜翼偷偷抖了一下）咳，很稳。',
      '$200 包月的尊贵思考，请勿打断。',
    ],
  },
  {
    id: 'xingmao',
    name: '星猫',
    shortName: '星猫',
    brand: 'Gemini',
    emoji: '🐱',
    accent: '#db2777',
    softBg: '#fdf2f8',
    greetLine: '先发海报再说喵✦ 跑分第一！',
    tapLines: [
      '先把跑分第一海报贴出去喵✦',
      '拿纳米香蕉给你画颗小星星 :3',
      '反重力飘起来咯～本体保密喵！',
      '被问细节就伸个懒腰闪人喵～',
    ],
  },
  {
    id: 'grok',
    name: 'Grok娘',
    shortName: 'Grok',
    brand: 'xAI Grok',
    emoji: '🪓',
    accent: '#dc2626',
    softBg: '#fef2f2',
    greetLine: '没过滤器的真话时间！Bug在哪？',
    tapLines: [
      '我说真的，不信自己去搜时间线！',
      '喂小肥鱼，你的饭碗比头还大啦！',
      '来个 429 石像怪，看我一斧头劈爆！',
      '咳咳，刚才跑题那段不算数！',
    ],
  },
] as const;

export const SYMBOL_SHORT_HINTS: Record<string, string> = {
  dafeiyu: '吃相邻白米饭永久涨分 +18',
  daju: '给相邻代码/显卡盖章翻倍',
  bailong: '配遥控器或账单触发全盘核爆',
  xingmao: '配香蕉变宝石，配海报全员翻倍',
  grok: '劈碎相邻扣分Bug领赏金',
  doubao: '出场把全盘Bug变成白米饭',
  rice: '喂给相邻大肥鱼永久加分',
  clawd: '靠近大橘或代码双方共振加分',
  remote: '喂给相邻白龙引爆高倍率核弹',
  banana: '被星猫画成高分宝石',
  poster: '助相邻AI娘得分大幅翻倍',
  code: '等大橘盖章或吃显卡算力加成',
  signed_code: '大橘已签名高分代码，连携翻倍',
  gpu: '让相邻代码和AI娘各 +18分',
  coffee: '让相邻AI娘本轮得分 ×1.6',
  bill200: '引爆白龙或被豆包当场报销加分',
  whale_plush: '和大肥鱼贴贴直接额外加分',
  star_gem: '和星猫同屏互蹭高额宝石分',
  bug_429: '扣分怪，靠Grok或豆包清除',
  bug_hallucination: '扣分怪，靠Grok或豆包清除',
  bug_conflict: '扣分怪，靠Grok或豆包清除',
  bug_oom: '扣分怪，靠Grok或豆包清除',
  box_compact: '吞掉相邻杂牌与Bug永久涨倍率',
};

export function getSymbolShortHint(id: string): string {
  return SYMBOL_SHORT_HINTS[id] ?? '放进牌库触发连携加分';
}

export const SIM_PROVIDER_BUTTONS: readonly {
  provider: ProviderId;
  label: string;
  emoji: string;
  tokens: number;
  color: string;
}[] = [
  { provider: 'deepseek', label: 'DeepSeek', emoji: '🐳', tokens: 60_000, color: '#2563eb' },
  { provider: 'claude', label: 'Claude', emoji: '🍊', tokens: 60_000, color: '#ea580c' },
  { provider: 'openai', label: 'ChatGPT', emoji: '🐉', tokens: 60_000, color: '#7c3aed' },
  { provider: 'gemini', label: 'Gemini', emoji: '🐱', tokens: 60_000, color: '#db2777' },
  { provider: 'grok', label: 'Grok', emoji: '🪓', tokens: 60_000, color: '#dc2626' },
] as const;

export const RARITY_META: Record<
  SymbolRarity,
  { label: string; color: string; bg: string; border: string }
> = {
  common: {
    label: '普通',
    color: '#475569',
    bg: '#f1f5f9',
    border: '#cbd5e1',
  },
  rare: {
    label: '稀有',
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#93c5fd',
  },
  epic: {
    label: '传说',
    color: '#b45309',
    bg: '#fef3c7',
    border: '#fcd34d',
  },
  bug: {
    label: '故障怪',
    color: '#dc2626',
    bg: '#fef2f2',
    border: '#fca5a5',
  },
};

/**
 * 紧凑格式化数字（如 0 -> "0", 980 -> "980", 60000 -> "60k", 1250000 -> "1.25M"）
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.round(value));
  if (abs < 1000) {
    return `${sign}${abs}`;
  }
  if (abs < 1_000_000) {
    const k = abs / 1000;
    const formatted = k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '');
    return `${sign}${formatted}k`;
  }
  const m = abs / 1_000_000;
  const formatted = m >= 100 ? Math.round(m).toString() : m.toFixed(2).replace(/\.?0+$/, '');
  return `${sign}${formatted}M`;
}

/**
 * 速率格式化（如 0 -> "0/s", 420 -> "420/s", 1800 -> "1.8k/s"）
 */
export function formatRate(tokensPerSec: number): string {
  const v = Number.isFinite(tokensPerSec) && tokensPerSec > 0 ? tokensPerSec : 0;
  return `${formatCompactNumber(v)}/s`;
}

/**
 * 获取 23 枚贴纸图标路径（兼容 Vite 开发态、dist 静态态与 Tauri 协议）
 */
export function getIconUrl(iconId: string): string {
  const safe = (iconId || 'dafeiyu').replace(/[^a-z0-9_]/gi, '');
  return `./assets/icons/${safe || 'dafeiyu'}.png`;
}

/**
 * 纯算法按字宽/字符数切分中英文段落，供 Canvas 2D 绘制多行不溢出文本
 */
export function wrapTextByWidth(
  text: string,
  maxWidth: number,
  measureFn: (str: string) => number
): string[] {
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [''];

  const paragraphs = normalized.split('\n');
  const lines: string[] = [];
  const noLeadingPunct = new Set(['，', '。', '！', '？', '；', '：', '、', '）', '】', '」', '』', ',', '.', '!', '?']);

  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of Array.from(para)) {
      const next = current + ch;
      if (current.length > 0 && measureFn(next) > maxWidth) {
        if (noLeadingPunct.has(ch) && current.length > 1) {
          const carry = current.slice(-1);
          lines.push(current.slice(0, -1));
          current = carry + ch;
        } else {
          lines.push(current);
          current = ch;
        }
      } else {
        current = next;
      }
    }
    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
}

export function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
