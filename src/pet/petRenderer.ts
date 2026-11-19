// MIT License - Original multi-action VPet/Shimeji/BongoCat physics pet renderer (zero external deps)

import { WALK_SPEED_PX } from './fishBrain';
import { playSfx } from './petAudio';
import {
  drawBlueWhiteBowl,
  drawBonkShockwave,
  drawBug,
  drawDizzyOrbit,
  drawDustPuff,
  drawHeadSteam,
  drawIcedCoffee,
  drawKeyboardRainbow,
  drawOverheatGlow,
  drawPattingHand,
  drawSoapBubble,
  drawToyHammer,
  drawWaterfallTears,
} from './fishFx';
import {
  moodToPosture,
  organicBreath,
  PostureBridge,
  SecondOrderSpring,
  ShakeDetector,
  SpriteBlender,
  StrideClock,
  volumePreservingScale,
  type PostureFamily,
  type PostureTransitionStyle,
  type SpriteBlendKind,
} from './petMotion';

export type PetMood =
  | 'idle'
  | 'pat'
  | 'poke'
  | 'dangle'
  | 'work'
  | 'eat'
  | 'happy'
  | 'angry'
  | 'sleep'
  | 'spin'
  | 'shock'
  | 'slack'
  | 'caught'
  | 'overheat'
  | 'tired'
  | 'scared'
  | 'coffee'
  | 'cry'
  | 'drowsy'
  | 'dizzy'
  | 'bonk'
  | 'music';

export type PetCharId = 'dafeiyu' | 'daju' | 'bailong' | 'xingmao' | 'grok';
export type PetAction = 'pat' | 'work' | 'eat' | 'sleep' | 'music';
/** 计时动作结束后回落的常驻姿态 */
export type PetBaseMood = 'idle' | 'slack' | 'work';
export type DropKind = 'rice' | 'coffee' | 'bug';
export type DropSource = 'auto' | 'toy';

export type PetEvent =
  | { type: 'item-caught'; kind: DropKind; source: DropSource }
  | { type: 'bowl-landed' }
  | { type: 'tower-collapse' }
  | { type: 'coffee-boost'; until: number };

export interface PetMotionTelemetry {
  nowMs: number;
  mood: PetMood;
  posture: PostureFamily;
  spriteKey: string;
  blendActive: boolean;
  blendProgress: number;
  blendAlphaFrom: number;
  blendAlphaTo: number;
  centerX: number;
  footY: number;
  topY: number;
  totalH: number;
  baseW: number;
  scaleX: number;
  scaleY: number;
  squash: number;
  tiltDeg: number;
  flipScale: number;
  headShearPx: number;
  tailSwayPx: number;
  scootX: number;
  hopY: number;
  frameDrawn: boolean;
}

export interface PetController {
  setMood(mood: PetMood, bubbleText?: string, durationMs?: number): void;
  getMood(): PetMood;
  triggerBounce(intensity?: number): void;
  setCharacter(charId: PetCharId): void;
  getCharacter(): PetCharId;
  isPointOpaque(clientX: number, clientY: number): boolean;
  startDrag(): void;
  feedDragDelta(dx: number, dy: number): void;
  endDrag(): void;
  triggerAction(action: PetAction): void;
  /** 速率档位（0–3）与当前平滑速率，驱动拍键盘频率与特效 */
  setRateTier(tier: 0 | 1 | 2 | 3, tokensPerSec: number): void;
  setBaseMood(mood: PetBaseMood): void;
  getBaseMood(): PetBaseMood;
  /** 抓包后「假装慢速拍键盘」 */
  playFakeTyping(durationMs: number): void;
  /** 溜达：dir=0 停下；peeking=true 时在边缘探头；speedRatio 驱动真实步频 */
  setLocomotion(dir: -1 | 0 | 1, peeking?: boolean, speedRatio?: number): void;
  setBowlCount(layers: number): void;
  getBowlCount(): number;
  /** 从窗口顶部空投物品；没有空位时返回 false */
  dropItem(kind: DropKind, source?: DropSource): boolean;
  /** 冰美式提速剩余时间（ms），0 表示无加速 */
  getBoostRemainingMs(): number;
  /** 拖拽/空投/计时动作/睡觉中 */
  isBusy(): boolean;
  getMotionSnapshot(): PetMotionTelemetry;
  stepAuditFrame(dtMs: number): PetMotionTelemetry;
  resetAuditState(): void;
  onEvent(cb: (ev: PetEvent) => void): () => void;
  destroy(): void;
}

interface BoundsRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Particle {
  kind:
    | 'rice'
    | 'note'
    | 'star'
    | 'steam'
    | 'zzz'
    | 'bang'
    | 'heart'
    | 'sweat'
    | 'code'
    | 'spark'
    | 'tear'
    | 'bubble'
    | 'dust';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  color: string;
  text?: string;
}

interface CharMetaEntry {
  accent: string;
  bodyColor: string;
  patLines: string[];
  pokeLines: string[];
  dangleLine: string;
  workLine: string;
  eatLine: string;
  sleepLine: string;
  wakeLine: string;
}

const ALL_CHARS: PetCharId[] = ['dafeiyu', 'daju', 'bailong', 'xingmao', 'grok'];
const ACTION_SPRITE_SUFFIXES = [
  'blink',
  'pat',
  'happy',
  'dangle',
  'work_a',
  'work_b',
  'eat_a',
  'eat_b',
  'sleep',
] as const;
/** 大肥鱼专属摸鱼小女仆贴图（缺失时优雅回退到现有贴图 + 特效） */
const FUN_SPRITE_SUFFIXES = [
  'walk_a',
  'walk_b',
  'walk_c',
  'walk_d',
  'work_c',
  'work_d',
  'music_a',
  'music_b',
  'music_c',
  'music_d',
  'eat_c',
  'eat_d',
  'slack',
  'caught',
  'overheat',
  'overheat_b',
  'tired',
  'scared',
  'coffee',
  'cry',
  'crouch',
  'sit_trans',
  'drowsy',
  'peek',
  'dizzy',
  'bonk_a',
  'bonk_mid',
  'bonk_b',
  'idle_b',
] as const;
const FUN_SPRITE_CHARS: readonly PetCharId[] = ['dafeiyu'];
type ActionSpriteSuffix =
  | (typeof ACTION_SPRITE_SUFFIXES)[number]
  | (typeof FUN_SPRITE_SUFFIXES)[number];

/**
 * 大肥鱼各姿态水平重心锚点（归一化 0..1，排除长尾巴横向外伸），
 * 消除待机/走路/摸鱼/眩晕切换时的 10-18px 水平横移跳变；其余角色默认 0.5。
 */
export const DAFEIYU_ANCHOR_X: Record<string, number> = {
  dafeiyu: 0.473,
  dafeiyu_blink: 0.473,
  dafeiyu_idle_b: 0.473,
  dafeiyu_sit_trans: 0.41,
  dafeiyu_pat: 0.473,
  dafeiyu_happy: 0.419,
  dafeiyu_dangle: 0.491,
  dafeiyu_sleep: 0.44,
  dafeiyu_tired: 0.403,
  dafeiyu_drowsy: 0.471,
  dafeiyu_crouch: 0.463,
  dafeiyu_slack: 0.376,
  dafeiyu_caught: 0.422,
  dafeiyu_scared: 0.526,
  dafeiyu_cry: 0.426,
  dafeiyu_coffee: 0.458,
  dafeiyu_dizzy: 0.427,
  dafeiyu_peek: 0.644,
  dafeiyu_overheat: 0.42,
  dafeiyu_overheat_b: 0.42,
  dafeiyu_bonk_a: 0.596,
  dafeiyu_bonk_mid: 0.564,
  dafeiyu_bonk_b: 0.583,
  dafeiyu_walk_a: 0.583,
  dafeiyu_walk_b: 0.583,
  dafeiyu_walk_c: 0.583,
  dafeiyu_walk_d: 0.583,
  dafeiyu_work_a: 0.443,
  dafeiyu_work_b: 0.443,
  dafeiyu_work_c: 0.443,
  dafeiyu_work_d: 0.443,
  dafeiyu_music_a: 0.385,
  dafeiyu_music_b: 0.385,
  dafeiyu_music_c: 0.385,
  dafeiyu_music_d: 0.385,
  dafeiyu_eat_a: 0.418,
  dafeiyu_eat_b: 0.418,
  dafeiyu_eat_c: 0.418,
  dafeiyu_eat_d: 0.418,
};

export function getSpriteAnchorX(spriteKey: string): number {
  const val = DAFEIYU_ANCHOR_X[spriteKey];
  return typeof val === 'number' && Number.isFinite(val) ? val : 0.5;
}

const TIMED_MOODS: ReadonlySet<PetMood> = new Set<PetMood>([
  'eat',
  'happy',
  'angry',
  'shock',
  'pat',
  'poke',
  'caught',
  'overheat',
  'tired',
  'scared',
  'coffee',
  'cry',
  'drowsy',
  'dizzy',
  'bonk',
  'music',
]);

const TIER_BEAT_HZ = [3.8, 1.8, 4.4, 6.8] as const;
const FAKE_TYPING_HZ = 1.25;
const MAX_TOWER_DRAW = 15;
const MAX_DROPS = 3;
const SCOOT_SPEED_PX = 88;
const SCOOT_BUG_SPEED_PX = 112;
const SCOOT_MAX_PX = 54;
const COFFEE_BOOST_MS = 10_000;
const PEEK_BUBBLE_MS = 1500;
const MUSIC_BEAT_HZ = 1.12;
const DIZZY_DURATION_MS = 2800;
const BONK_WINDUP_MS = 300;
const BONK_MID_MS = 75;
const BONK_SLAM_MS = 520;
const BONK_HITSTOP_MS = 55;
const BONK_SHOCKWAVE_DURATION = 0.36;
const SPRITE_MIN_HOLD_MS = 48;
const IDLE_VARIANT_GAP_MIN_MS = 6000;
const IDLE_VARIANT_GAP_MAX_MS = 9000;
const IDLE_VARIANT_HOLD_MIN_MS = 1600;
const IDLE_VARIANT_HOLD_MAX_MS = 2400;

const FUN_LINES = {
  coffee: '冰美式续命！今天的我元气 1.4 倍速！',
  bugScared: '呀啊啊！有 Bug！！别过来！',
  bugSwat: '尾巴拍飞！啪——！',
  bonk: '吃我一记大肥鱼重锤！啪叽！！',
  dizzy: '呜哇＠_＠…脑子里的 Token 摇匀了…',
  music: '戴上小鲸鱼耳机，跟着节拍晃脑袋～♪',
  drowsy: '呼啊…有点犯困了…',
  cry: '呜哇啊——我的饭碗塔！！',
  peek: '外面…有什么好吃的吗？👀',
} as const;

interface FallingItem {
  active: boolean;
  kind: DropKind;
  source: DropSource;
  phase: 'fall' | 'ground' | 'fly';
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  t: number;
}

interface BowlDebris {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
}

const SLICE_COUNT = 14;
const MAX_IDLE_TILT_RAD = (6.5 * Math.PI) / 180;
const GAZE_RANGE_PX = 240;
const MAX_DANGLE_RAD = (26 * Math.PI) / 180;
const IDLE_DROWSY_MS = 32_000;
const IDLE_SLEEP_MS = 38_000;
const WAKE_STRETCH_MS = 850;
const GRAVITY_DROP_HEIGHT_PX = 26;

const CHAR_META: Record<PetCharId, CharMetaEntry> = {
  dafeiyu: {
    accent: '#2563eb',
    bodyColor: '#60a5fa',
    patLines: [
      '唔～摸头最舒服啦～',
      '呼噜呼噜…再多摸两下嘛～♥',
      '被摸到头顶呆毛，算力都变甜了～',
    ],
    pokeLines: [
      '别戳肚子！这是算力储备！',
      '喂！圆滚滚是为了装更多 Token 啦！',
      '老板再来一碗大白米饭！🍚',
      '摸鱼？这叫深度思考喵～🐳',
    ],
    dangleLine: '哇啊啊放我下来！',
    workLine: '算力烧起来了！键盘敲冒烟啦！',
    eatLine: '嗷呜！大白米饭真香！！🍚',
    sleepLine: '呼…抱住小鲸鱼眯一会儿…',
    wakeLine: '唔哇！我没偷懒！随时可以干活！',
  },
  daju: {
    accent: '#ea580c',
    bodyColor: '#fb923c',
    patLines: [
      '唔…摸头的话，今天就免签一次署名单～',
      '轻点摸，橘色呆毛会炸起来的🍊',
    ],
    pokeLines: [
      '别戳！正在认真审代码边界！',
      '顺手署上 Co-authored-by: Claude ✦',
      '这段祖传代码我帮你重构好啦。',
    ],
    dangleLine: '哇啊啊放我下来！领结要歪了！',
    workLine: '咔嗒咔嗒…先跑通全套单元测试！',
    eatLine: '优雅补给时间，慢慢细嚼慢咽～',
    sleepLine: '抱着 Clawd 打个小盹……',
    wakeLine: '咳、我只是闭目复盘架构！',
  },
  bailong: {
    accent: '#4f46e5',
    bodyColor: '#a5b4fc',
    patLines: [
      '哼…就破例让你摸一下龙角旁边吧。',
      '（淡紫膜翼偷偷舒展）勉强还行。',
    ],
    pokeLines: [
      '别乱戳！正在高强度推理中🐉',
      '200刀的尊贵思维链，哼。',
      '尾巴晃一下都是在做形式化验证。',
    ],
    dangleLine: '哇啊啊放我下来！龙尾都要打结了！',
    workLine: '高速推导中…理论吞吐拉满！',
    eatLine: '补充糖分，好继续算长推理链～',
    sleepLine: '进入低功耗深度思考休眠……',
    wakeLine: '咳，我已经处理好了，理论上没问题！',
  },
  xingmao: {
    accent: '#7c3aed',
    bodyColor: '#c084fc',
    patLines: [
      '喵呜～摸耳朵最舒服了喵♥',
      '蹭蹭手心～今天也是全榜第一喵！',
    ],
    pokeLines: [
      '喵呀！别戳猫猫肚皮啦！',
      '先发跑分第一海报再说喵✦',
      '百万上下文，再多都塞得下喵！🐱',
    ],
    dangleLine: '哇啊啊放我下来！猫耳要竖成天线了喵！',
    workLine: '哒哒哒哒！百万上下文狂写中喵！',
    eatLine: '干饭也是全榜第一速度喵！！',
    sleepLine: '呼噜呼噜…卷成星猫球睡着了喵…',
    wakeLine: '喵哇？！纳米香蕉差点掉了喵！',
  },
  grok: {
    accent: '#e11d48',
    bodyColor: '#fb7185',
    patLines: [
      '切，突然摸头干嘛…还挺顺手的嘛～',
      '别停啊，再揉两下本小姐心情不错！',
    ],
    pokeLines: [
      '喂！别戳了！小心我拿斧头吓唬你🪓',
      '哪有 Bug？看我一斧头劈爆！',
      '429 限流？在我这儿不存在的！',
    ],
    dangleLine: '哇啊啊放我下来！把我当蝙蝠挂着吗！',
    workLine: '全速输出！根本不带限流的！',
    eatLine: '狂炫能量，吃完再去砍 Bug！',
    sleepLine: 'zZz…休整十秒，马上回来冲…',
    wakeLine: '哈？！谁在偷袭！Bug 在哪？！',
  },
};

function resolveAssetDirs(assetBaseUrl?: string): { petDir: string; iconDir: string } {
  const raw = (assetBaseUrl ?? '/assets').trim().replace(/\/+$/, '');
  if (!raw || raw === '/') {
    return { petDir: '/assets/pet', iconDir: '/assets/icons' };
  }
  if (raw.endsWith('/pet')) {
    return { petDir: raw, iconDir: `${raw.slice(0, -4)}/icons` };
  }
  return { petDir: `${raw}/pet`, iconDir: `${raw}/icons` };
}

function loadImageSafe(
  url: string,
  timeoutMs = 15000,
  onLateLoad?: (img: HTMLImageElement) => void,
): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const img = new Image();
    const finish = (res: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => {
      if (img.naturalWidth > 0) {
        if (settled) {
          onLateLoad?.(img);
        } else {
          finish(img);
        }
      } else {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const chars = Array.from(text.trim());
  const lines: string[] = [];
  let cur = '';
  for (const ch of chars) {
    const next = cur + ch;
    if (cur.length > 0 && ctx.measureText(next).width > maxWidth) {
      lines.push(cur);
      if (lines.length >= maxLines) {
        const last = lines[lines.length - 1];
        lines[lines.length - 1] = `${last.slice(0, Math.max(1, last.length - 1))}…`;
        return lines;
      }
      cur = ch;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  cw: number,
  text: string,
  accent: string,
  popScale: number,
  anchorTopY?: number,
  minTopY?: number,
): BoundsRect | null {
  if (!text) return null;
  const compact = cw < 150;
  const fontSize = compact ? 9.5 : 11.5;
  const lineH = compact ? 12.5 : 15;
  const padX = compact ? 6 : 9;
  const padY = compact ? 4 : 6;
  const maxBoxW = Math.max(64, cw - (compact ? 6 : 12));

  ctx.save();
  ctx.font = `800 ${fontSize}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`;
  const lines = wrapTextLines(ctx, text, maxBoxW - padX * 2, compact ? 2 : 3);
  if (lines.length === 0) {
    ctx.restore();
    return null;
  }

  let textW = 0;
  for (const line of lines) {
    textW = Math.max(textW, ctx.measureText(line).width);
  }
  const boxW = Math.min(maxBoxW, Math.ceil(textW + padX * 2));
  const boxH = Math.ceil(lines.length * lineH + padY * 2);
  const tailW = compact ? 5 : 6.5;
  const tailH = compact ? 4.5 : 6;
  const bx = Math.round((cw - boxW) * 0.5);
  const safeMinTopY = minTopY ?? (compact ? 2 : 4);
  const rawBy =
    anchorTopY !== undefined
      ? Math.round(anchorTopY - 4 - boxH - tailH)
      : safeMinTopY;
  const by = Math.max(safeMinTopY, rawBy);

  const cx = bx + boxW * 0.5;
  const cy = by + boxH;
  ctx.translate(cx, cy);
  ctx.scale(popScale, popScale);
  ctx.translate(-cx, -cy);

  ctx.shadowColor = 'rgba(15, 23, 42, 0.16)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  drawRoundedRect(ctx, bx, by, boxW, boxH, compact ? 9 : 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = compact ? 1.6 : 2;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - tailW, by + boxH - 1);
  ctx.lineTo(cx, by + boxH + tailH);
  ctx.lineTo(cx + tailW, by + boxH - 1);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - tailW, by + boxH - 0.5);
  ctx.lineTo(cx, by + boxH + tailH);
  ctx.lineTo(cx + tailW, by + boxH - 0.5);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = compact ? 1.6 : 2;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.fillRect(bx + 10, by + 1.5, Math.max(12, boxW - 20), 2);

  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  lines.forEach((line, idx) => {
    ctx.fillText(line, cx, by + padY + idx * lineH + 1);
  });

  ctx.restore();
  return { x: bx, y: by, w: boxW, h: boxH + tailH };
}

function drawStar4(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : r * 0.36;
    const ang = (i * Math.PI) / 4;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();
  ctx.restore();
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rot: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const s = size * 0.55;
  ctx.beginPath();
  ctx.moveTo(0, s * 1.1);
  ctx.bezierCurveTo(-s * 1.4, s * 0.15, -s * 1.35, -s * 1.05, 0, -s * 0.35);
  ctx.bezierCurveTo(s * 1.35, -s * 1.05, s * 1.4, s * 0.15, 0, s * 1.1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

function drawSweatDrop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rot: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const r = size;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.25);
  ctx.bezierCurveTo(r * 0.9, -r * 0.2, r * 0.95, r * 0.9, 0, r * 0.95);
  ctx.bezierCurveTo(-r * 0.95, r * 0.9, -r * 0.9, -r * 0.2, 0, -r * 1.25);
  ctx.closePath();
  ctx.fillStyle = '#7dd3fc';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#0369a1';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-r * 0.22, r * 0.2, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

function drawAngryVein(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI * 0.5);
    ctx.beginPath();
    ctx.moveTo(2.5, -7);
    ctx.quadraticCurveTo(2.5, -2.5, 7, -2.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShockMarks(ctx: CanvasRenderingContext2D, x: number, y: number, bounce: number): void {
  ctx.save();
  ctx.translate(x, y - bounce);
  ctx.font = '900 17px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#1e293b';
  ctx.strokeText('!!', 0, 0);
  ctx.fillStyle = '#facc15';
  ctx.fillText('!!', 0, 0);
  ctx.restore();
}

function drawFallbackChibi(
  ctx: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  h: number,
  charId: PetCharId,
  mood: PetMood,
): void {
  const r = h * 0.38;
  const cy = footY - r;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = CHAR_META[charId].bodyColor;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  ctx.strokeStyle = '#0f172a';
  ctx.fillStyle = '#0f172a';
  ctx.lineWidth = 2;
  if (mood === 'sleep') {
    ctx.beginPath();
    ctx.arc(cx - r * 0.28, cy - r * 0.06, r * 0.12, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.28, cy - r * 0.06, r * 0.12, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx - r * 0.28, cy - r * 0.08, Math.max(2, r * 0.09), 0, Math.PI * 2);
    ctx.arc(cx + r * 0.28, cy - r * 0.08, Math.max(2, r * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.08, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function pushParticle(
  list: Particle[],
  kind: Particle['kind'],
  x: number,
  y: number,
  vx: number,
  vy: number,
  maxLife: number,
  size: number,
  color: string,
  text?: string,
): void {
  if (list.length > 30) return;
  list.push({ kind, x, y, vx, vy, life: 0, maxLife, size, rot: (Math.random() - 0.5) * 0.8, color, text });
}

function formatTok(n: number): string {
  const v = Math.max(1, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function spawnParticle(list: Particle[], mood: PetMood, cx: number, headY: number, bodyW: number): void {
  if (list.length > 28 || mood === 'idle' || mood === 'slack') return;
  if (mood === 'caught' || mood === 'scared' || mood === 'tired') {
    const side = Math.random() < 0.5 ? -1 : 1;
    pushParticle(
      list,
      'sweat',
      cx + side * bodyW * (0.22 + Math.random() * 0.12),
      headY + 8 + Math.random() * 12,
      side * (12 + Math.random() * 16),
      -(10 + Math.random() * 12),
      0.65,
      4.5 + Math.random() * 1.5,
      '#38bdf8',
    );
    return;
  }
  if (mood === 'overheat') {
    pushParticle(list, 'steam', cx + (Math.random() - 0.5) * bodyW * 0.5, headY, (Math.random() - 0.5) * 18, -(34 + Math.random() * 20), 0.7, 5 + Math.random() * 4, 'rgba(255, 241, 242, 0.92)');
    pushParticle(list, 'spark', cx + (Math.random() - 0.5) * bodyW * 0.7, headY + bodyW * 0.75, (Math.random() - 0.5) * 120, -(60 + Math.random() * 60), 0.45, 3, Math.random() < 0.5 ? '#f97316' : '#facc15');
    return;
  }
  if (mood === 'cry') {
    const side = Math.random() < 0.5 ? -1 : 1;
    pushParticle(list, 'tear', cx + side * bodyW * 0.12, headY + bodyW * 0.32, side * (40 + Math.random() * 40), -(20 + Math.random() * 30), 0.7, 3.2, '#7dd3fc');
    return;
  }
  if (mood === 'coffee') {
    spawnParticle(list, 'happy', cx, headY, bodyW);
    return;
  }
  const spread = (Math.random() - 0.5) * bodyW * 0.78;
  if (mood === 'eat') {
    const roll = Math.random();
    if (roll < 0.52) {
      list.push({
        kind: 'rice',
        x: cx + spread * 0.7,
        y: headY + bodyW * 0.34,
        vx: (Math.random() - 0.5) * 32,
        vy: -(28 + Math.random() * 26),
        life: 0,
        maxLife: 0.75 + Math.random() * 0.3,
        size: 4.8,
        rot: (Math.random() - 0.5) * 0.9,
        color: '#ffffff',
      });
    } else if (roll < 0.84) {
      const palette = ['#fbbf24', '#38bdf8', '#f472b6'];
      list.push({
        kind: 'star',
        x: cx + spread * 0.9,
        y: headY + bodyW * 0.2,
        vx: (Math.random() - 0.5) * 26,
        vy: -(24 + Math.random() * 24),
        life: 0,
        maxLife: 0.75 + Math.random() * 0.3,
        size: 4.8 + Math.random() * 2.5,
        rot: Math.random() * Math.PI,
        color: palette[Math.floor(Math.random() * palette.length)],
      });
    } else {
      list.push({
        kind: 'note',
        x: cx + spread * 0.7,
        y: headY + bodyW * 0.25,
        vx: (Math.random() - 0.5) * 24,
        vy: -(26 + Math.random() * 20),
        life: 0,
        maxLife: 0.8 + Math.random() * 0.25,
        size: 11,
        rot: 0,
        color: '#f59e0b',
        text: Math.random() < 0.5 ? '♪' : '♫',
      });
    }
  } else if (mood === 'pat') {
    const palette = ['#f472b6', '#fb7185', '#ec4899'];
    list.push({
      kind: 'heart',
      x: cx + spread * 0.75,
      y: headY + Math.random() * 14,
      vx: (Math.random() - 0.5) * 18,
      vy: -(24 + Math.random() * 20),
      life: 0,
      maxLife: 0.9 + Math.random() * 0.35,
      size: 6 + Math.random() * 2.5,
      rot: (Math.random() - 0.5) * 0.4,
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  } else if (mood === 'work') {
    const tokens: Array<[string, string]> = [
      ['{}', '#2563eb'],
      ['⚡', '#f59e0b'],
      ['01', '#10b981'],
    ];
    const [glyph, color] = tokens[Math.floor(Math.random() * tokens.length)];
    list.push({
      kind: 'code',
      x: cx + spread * 0.85,
      y: headY + bodyW * 0.32,
      vx: (Math.random() - 0.5) * 24,
      vy: -(32 + Math.random() * 24),
      life: 0,
      maxLife: 0.75 + Math.random() * 0.25,
      size: 11,
      rot: 0,
      color,
      text: glyph,
    });
  } else if (mood === 'dangle') {
    const side = Math.random() < 0.5 ? -1 : 1;
    list.push({
      kind: 'sweat',
      x: cx + side * bodyW * (0.28 + Math.random() * 0.14),
      y: headY + 12 + Math.random() * 14,
      vx: side * (16 + Math.random() * 18),
      vy: -(12 + Math.random() * 14),
      life: 0,
      maxLife: 0.6 + Math.random() * 0.2,
      size: 4.5 + Math.random() * 1.5,
      rot: side * 0.35,
      color: '#38bdf8',
    });
  } else if (mood === 'music') {
    const palette = ['#38bdf8', '#a78bfa', '#f472b6', '#f59e0b'];
    list.push({
      kind: 'note',
      x: cx + spread * 0.85,
      y: headY + 6 + Math.random() * 14,
      vx: (Math.random() - 0.5) * 24,
      vy: -(24 + Math.random() * 18),
      life: 0,
      maxLife: 0.95 + Math.random() * 0.3,
      size: 13,
      rot: 0,
      color: palette[Math.floor(Math.random() * palette.length)],
      text: Math.random() < 0.35 ? '♪' : Math.random() < 0.65 ? '♫' : '♬',
    });
  } else if (mood === 'dizzy') {
    const palette = ['#facc15', '#fb7185', '#fde047'];
    list.push({
      kind: 'star',
      x: cx + spread * 0.8,
      y: headY + 4,
      vx: (Math.random() - 0.5) * 28,
      vy: -(18 + Math.random() * 18),
      life: 0,
      maxLife: 0.7,
      size: 4.5 + Math.random() * 2.5,
      rot: Math.random() * Math.PI,
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  } else if (mood === 'drowsy') {
    list.push({
      kind: 'zzz',
      x: cx + bodyW * 0.2,
      y: headY + 12,
      vx: 7 + Math.random() * 5,
      vy: -(12 + Math.random() * 6),
      life: 0,
      maxLife: 1.2,
      size: 9 + Math.random() * 3,
      rot: 0,
      color: '#94a3b8',
      text: 'z',
    });
  } else if (mood === 'bonk') {
    list.push({
      kind: 'spark',
      x: cx + spread * 0.7,
      y: headY + bodyW * 0.5,
      vx: (Math.random() - 0.5) * 110,
      vy: -(45 + Math.random() * 55),
      life: 0,
      maxLife: 0.42,
      size: 3,
      rot: 0,
      color: Math.random() < 0.5 ? '#38bdf8' : '#facc15',
    });
  } else if (mood === 'happy' || mood === 'spin') {
    const palette = ['#fbbf24', '#38bdf8', '#f472b6', '#a78bfa'];
    list.push({
      kind: 'star',
      x: cx + spread,
      y: headY + Math.random() * bodyW * 0.45,
      vx: (Math.random() - 0.5) * 18,
      vy: -(20 + Math.random() * 22),
      life: 0,
      maxLife: 0.8 + Math.random() * 0.35,
      size: 5 + Math.random() * 3.5,
      rot: Math.random() * Math.PI,
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  } else if (mood === 'angry') {
    list.push({
      kind: 'steam',
      x: cx + spread * 0.6,
      y: headY + 6,
      vx: (Math.random() - 0.5) * 16,
      vy: -(26 + Math.random() * 18),
      life: 0,
      maxLife: 0.7 + Math.random() * 0.25,
      size: 5 + Math.random() * 4,
      rot: 0,
      color: 'rgba(255, 241, 242, 0.9)',
    });
  } else if (mood === 'sleep') {
    list.push({
      kind: 'zzz',
      x: cx + bodyW * 0.24,
      y: headY + 10,
      vx: 10 + Math.random() * 6,
      vy: -(16 + Math.random() * 8),
      life: 0,
      maxLife: 1.5,
      size: 10 + Math.random() * 4,
      rot: 0,
      color: '#6366f1',
      text: Math.random() < 0.5 ? 'Z' : 'z',
    });
  } else if (mood === 'shock' || mood === 'poke') {
    list.push({
      kind: 'bang',
      x: cx + spread * 0.8,
      y: headY + 4,
      vx: spread * 0.9,
      vy: -(30 + Math.random() * 20),
      life: 0,
      maxLife: 0.55,
      size: 5.5,
      rot: Math.random() * Math.PI,
      color: mood === 'poke' ? '#fb7185' : '#facc15',
    });
  }
}

function updateAndDrawParticles(ctx: CanvasRenderingContext2D, list: Particle[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      list.splice(i, 1);
      continue;
    }
    const u = p.life / p.maxLife;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === 'rice') p.vy += 88 * dt;
    else if (p.kind === 'sweat') p.vy += 120 * dt;
    else if (p.kind === 'tear') p.vy += 260 * dt;
    else if (p.kind === 'spark') p.vy += 240 * dt;
    else if (p.kind === 'dust') p.vx *= Math.exp(-3.5 * dt);
    else if (p.kind === 'bubble') p.x += Math.sin(p.life * 3 + p.rot * 5) * 10 * dt;
    else if (p.kind === 'zzz') p.x += Math.sin(p.life * 5) * 8 * dt;
    else if (p.kind === 'heart') p.x += Math.sin(p.life * 5.2 + p.rot * 6) * 14 * dt;

    const alpha = u < 0.2 ? u / 0.2 : Math.max(0, 1 - (u - 0.2) / 0.8);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (p.kind === 'dust') {
      drawDustPuff(ctx, p.x, p.y, p.size * (0.75 + u * 0.55), alpha * 0.85);
    } else if (p.kind === 'spark') {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.lineWidth = p.size * 0.8;
      ctx.lineCap = 'round';
      ctx.strokeStyle = p.color;
      ctx.stroke();
    } else if (p.kind === 'tear') {
      drawSweatDrop(ctx, p.x, p.y, p.size, Math.atan2(p.vy, p.vx) - Math.PI * 0.5);
    } else if (p.kind === 'bubble') {
      drawSoapBubble(ctx, p.x, p.y, p.size * (0.6 + u * 0.6));
    } else if (p.kind === 'rice') {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot + p.life * 4);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = '#334155';
      ctx.stroke();
    } else if (p.kind === 'heart') {
      drawHeart(ctx, p.x, p.y, p.size * (0.8 + 0.25 * Math.sin(u * Math.PI)), p.rot, p.color);
    } else if (p.kind === 'sweat') {
      drawSweatDrop(ctx, p.x, p.y, p.size, p.rot);
    } else if (p.kind === 'star' || p.kind === 'bang') {
      drawStar4(ctx, p.x, p.y, p.size * (0.7 + 0.4 * Math.sin(u * Math.PI)), p.rot + p.life * 3, p.color);
    } else if (p.kind === 'steam') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.7 + u * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(225, 29, 72, 0.45)';
      ctx.stroke();
    } else if (p.kind === 'code' && p.text) {
      ctx.font = `900 ${Math.round(p.size)}px ui-monospace, SFMono-Regular, Menlo, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.text) {
      ctx.font = `900 ${Math.round(p.size)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }
}

export async function mountPet(
  canvas: HTMLCanvasElement,
  assetBaseUrl?: string,
): Promise<PetController> {
  const ctx = canvas.getContext('2d');
  const spriteCanvas = document.createElement('canvas');
  const spriteCtx = spriteCanvas.getContext('2d');
  let manualClockNow: number | null = null;
  const nowMs = (): number => (manualClockNow !== null ? manualClockNow : performance.now());

  const { petDir, iconDir } = resolveAssetDirs(assetBaseUrl);
  const sprites: Record<string, HTMLImageElement | null> = {};
  const baseLoadPromises = new Map<PetCharId, Promise<void>>();
  const packLoadPromises = new Map<PetCharId, Promise<void>>();
  let lastDrawTs = Number.NEGATIVE_INFINITY;

  const loadCharWithFallback = (id: PetCharId): Promise<void> => {
    const existing = baseLoadPromises.get(id);
    if (existing) return existing;
    const task = (async () => {
      const primary = await loadImageSafe(`${petDir}/${id}.png`, 15000, (lateImg) => {
        sprites[id] = lateImg;
        lastDrawTs = Number.NEGATIVE_INFINITY;
      });
      sprites[id] =
        primary ??
        (await loadImageSafe(`${iconDir}/${id}.png`, 10000, (lateIcon) => {
          if (!sprites[id]) {
            sprites[id] = lateIcon;
            lastDrawTs = Number.NEGATIVE_INFINITY;
          }
        }));
      lastDrawTs = Number.NEGATIVE_INFINITY;
    })();
    baseLoadPromises.set(id, task);
    return task;
  };

  const ensureCharacterPackLoaded = (charId: PetCharId): Promise<void> => {
    const existing = packLoadPromises.get(charId);
    if (existing) return existing;
    const task = (async () => {
      const suffixes: readonly string[] = FUN_SPRITE_CHARS.includes(charId)
        ? [...ACTION_SPRITE_SUFFIXES, ...FUN_SPRITE_SUFFIXES]
        : ACTION_SPRITE_SUFFIXES;
      await Promise.all([
        loadCharWithFallback(charId),
        ...suffixes.map(async (suffix) => {
          const key = `${charId}_${suffix}`;
          const loaded = await loadImageSafe(`${petDir}/${key}.png`, 15000, (lateImg) => {
            sprites[key] = lateImg;
            lastDrawTs = Number.NEGATIVE_INFINITY;
          });
          if (loaded) {
            sprites[key] = loaded;
            lastDrawTs = Number.NEGATIVE_INFINITY;
          } else if (!(key in sprites)) {
            sprites[key] = null;
          }
        }),
      ]);
      lastDrawTs = Number.NEGATIVE_INFINITY;
    })();
    packLoadPromises.set(charId, task);
    return task;
  };

  // 先启动默认角色（dafeiyu）全动作包加载；公网慢速 CDN 下不长期阻塞首帧交互，其余贴图加载完成自动热替换
  const initialPackPromise = ensureCharacterPackLoaded('dafeiyu');
  const isAuditMode =
    typeof window !== 'undefined' &&
    typeof window.location?.search === 'string' &&
    new URLSearchParams(window.location.search).get('audit') === '1';
  if (isAuditMode) {
    await initialPackPromise;
  } else {
    const baseReady = loadCharWithFallback('dafeiyu');
    await Promise.race([
      initialPackPromise,
      Promise.all([
        Promise.race([baseReady, new Promise<void>((r) => setTimeout(r, 900))]),
        new Promise<void>((r) => setTimeout(r, 350)),
      ]),
    ]);
  }
  void Promise.all(
    ALL_CHARS.filter((c) => c !== 'dafeiyu').map((c) => loadCharWithFallback(c)),
  );

  let currentChar: PetCharId = 'dafeiyu';
  let currentMood: PetMood = 'idle';
  let moodRevertAt = 0;

  let bubbleText = '';
  let bubbleUntil = 0;
  let bubblePop = 1;
  let lastClickBubbleAt = 0;
  let patLineIdx = 0;
  let pokeLineIdx = 0;

  // 二阶弹簧与自然运动系统（果冻挤压、头顶滞后剪切、裙摆/尾巴拖曳、2.5D 转身、横移缓动、姿态过渡桥、等功率切帧、步频时钟、狂摇检测）
  const squashSpring = new SecondOrderSpring(2.6, 0.68, 0, 0);
  const headShearSpring = new SecondOrderSpring(2.2, 0.62, -0.25, 0);
  const tailSwaySpring = new SecondOrderSpring(1.8, 0.56, -0.35, 0);
  const facingSpring = new SecondOrderSpring(3.4, 0.8, 0.15, 1);
  const scootSpring = new SecondOrderSpring(2.2, 0.84, 0.15, 0);
  const tiltSpring = new SecondOrderSpring(3.4, 0.84, 0.05, 0);
  const postureBridge = new PostureBridge<HTMLImageElement>(4.2);
  const spriteBlender = new SpriteBlender<HTMLImageElement>();
  const strideClock = new StrideClock(22, 2.4);
  const shakeDetector = new ShakeDetector();

  let sway = 0;
  let swayVel = 0;
  let prevFlipSign: 1 | -1 = 1;
  let turnHopRemaining = 0;
  let blinkNodAmt = 0;

  // Mouse gaze tilt (±6.5°, 240px) & smoothed patting hand tracking
  let targetIdleTilt = 0;
  let idleTilt = 0;
  let mouseLookNormX = 0;
  let hoverPointerLocal: { x: number; y: number } | null = null;
  let smoothedHoverX: number | null = null;
  let smoothedHoverY: number | null = null;
  let hoverOnHead = false;

  // Natural blink state (2.8–5.0s interval, 130ms duration, 20% double blink)
  let nextBlinkAt = nowMs() + 2800 + Math.random() * 2200;
  let blinkEndAt = 0;
  let pendingSecondBlinkAt = 0;
  let isBlinking = false;
  let lastDrawnBlink = false;

  // Collar drag pendulum & gravity drop
  let isDragging = false;
  let isDropping = false;
  let dangleAngle = 0;
  let dangleVel = 0;
  let dropOffsetY = 0;
  let dropVelY = 0;
  let dragSuppressClickUntil = 0;

  // BongoCat typing beat tracker
  let lastWorkFrame = -1;
  let workBeatAge = 1;

  // Idle auto-drowsy (32s) & auto-sleep (38s) tracker
  let lastInteractionAt = nowMs();
  let drowsyEnteredAt = 0;
  let drowsyWakeStretch = false;
  let bonkStartedAt = 0;

  // Head rub & tap tracker
  let lastPointerX: number | null = null;
  let headRubAccum = 0;
  let lastRubPatAt = 0;
  let pointerDownOnCanvas = false;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pointerMovedDrag = false;

  let emitTimer = 0;
  const particles: Particle[] = [];

  let bubbleBounds: BoundsRect | null = null;
  let bodyBounds: BoundsRect = { x: 0, y: 0, w: 0, h: 0 };
  let destroyed = false;
  let rafId = 0;

  // ===== 实时算力转速表 + 摸鱼小女仆状态 =====
  let baseMood: PetBaseMood = 'idle';
  let rateTier: 0 | 1 | 2 | 3 = 0;
  let rateTps = 0;
  let beatPhase = 0;
  let workFrameIdx = 0;
  let workFrameA = true;
  let lastBeatSfxAt = 0;
  let fakeTypingUntil = 0;
  let locoDir: -1 | 0 | 1 = 0;
  let peeking = false;
  let locoSpeedRatio = 1;
  let facing: 1 | -1 = 1;
  let boostUntil = 0;
  let animElapsed = 0;
  let eatPhaseStart = 0;
  let musicPhaseStart = 0;
  let towerCount = 0;
  let towerBounds: BoundsRect | null = null;
  let towerPopAge = 1;
  let bowlFlyT = -1;
  let bowlFlyFromX = 0;
  let bowlFlyFromY = 0;
  let pendingBowlFlies = 0;
  let scootX = 0;
  let scootTarget = 0;
  let bugHuntPhase: 'none' | 'scared' | 'approach' | 'windup' | 'midswing' | 'slam' = 'none';
  let bugHuntSlot: FallingItem | null = null;
  let bugHuntUntil = 0;
  let bugHuntDir: 1 | -1 = 1;
  let lastCatchAt = Number.NEGATIVE_INFINITY;
  let suppressNextTurnHop = false;
  let bonkHitstopUntil = 0;
  let bonkShakeAmp = 0;
  let bonkShakeElapsed = 0;
  let bonkDirectSlammed = false;
  const bonkShockwave = {
    active: false,
    x: 0,
    y: 0,
    elapsed: 0,
    duration: BONK_SHOCKWAVE_DURATION,
    dir: 1 as 1 | -1,
  };
  let idleVariantActive = false;
  let idleVariantStartedAt = 0;
  let idleVariantEndAt = 0;
  let idleVariantDir: 1 | -1 = 1;
  let nextIdleVariantAt =
    nowMs() + IDLE_VARIANT_GAP_MIN_MS + Math.random() * (IDLE_VARIANT_GAP_MAX_MS - IDLE_VARIANT_GAP_MIN_MS);
  let slackVariant: 'comic' | 'music' | 'bubble' | 'daze' = 'comic';
  let slackVariantUntil = 0;
  let spriteSwapPending = false;
  let fxTimer = 0;
  let lastLayout = { centerX: 128, topY: 40, totalH: 170, baseW: 160, footY: 225 };
  const lastTelemetry: PetMotionTelemetry = {
    nowMs: nowMs(),
    mood: 'idle',
    posture: 'stand',
    spriteKey: 'dafeiyu',
    blendActive: false,
    blendProgress: 1,
    blendAlphaFrom: 0,
    blendAlphaTo: 1,
    centerX: 128,
    footY: 225,
    topY: 40,
    totalH: 170,
    baseW: 160,
    scaleX: 1,
    scaleY: 1,
    squash: 0,
    tiltDeg: 0,
    flipScale: 1,
    headShearPx: 0,
    tailSwayPx: 0,
    scootX: 0,
    hopY: 0,
    frameDrawn: false,
  };
  const dropSlots: FallingItem[] = Array.from({ length: MAX_DROPS }, () => ({
    active: false,
    kind: 'rice' as DropKind,
    source: 'toy' as DropSource,
    phase: 'fall' as const,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    vr: 0,
    t: 0,
  }));
  const debris: BowlDebris[] = Array.from({ length: MAX_TOWER_DRAW }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    vr: 0,
    life: 0,
  }));
  const eventListeners = new Set<(ev: PetEvent) => void>();
  const emit = (ev: PetEvent): void => {
    for (const cb of eventListeners) {
      try {
        cb(ev);
      } catch {
        // 隔离监听器异常
      }
    }
  };
  const hasActiveDrops = (): boolean => {
    for (let i = 0; i < dropSlots.length; i++) if (dropSlots[i].active) return true;
    return false;
  };
  const hasActiveDebris = (): boolean => {
    for (let i = 0; i < debris.length; i++) if (debris[i].active) return true;
    return false;
  };

  const markInteracted = (now = nowMs()): void => {
    lastInteractionAt = now;
  };

  const showBubble = (text: string, durationMs = 2600, now = nowMs()): void => {
    const trimmed = text.trim();
    bubbleText = trimmed;
    if (trimmed) {
      bubblePop = 0.64;
      bubbleUntil = now + Math.max(400, durationMs);
    } else {
      bubbleUntil = 0;
    }
  };

  const triggerBounce = (intensity = 1): void => {
    const clamped = Math.max(0.15, Math.min(2.2, intensity));
    squashSpring.impulse(1.38 * clamped);
    markInteracted();
  };

  const isPointInTower = (lx: number, ly: number): boolean =>
    towerCount > 0 &&
    towerBounds !== null &&
    lx >= towerBounds.x - 4 &&
    lx <= towerBounds.x + towerBounds.w + 4 &&
    ly >= towerBounds.y - 4 &&
    ly <= towerBounds.y + towerBounds.h + 2;

  const findGroundBugAt = (lx: number, ly: number): FallingItem | null => {
    for (const d of dropSlots) {
      if (d.active && d.kind === 'bug' && d.phase === 'ground') {
        if (Math.hypot(lx - d.x, ly - d.y) <= 22) return d;
      }
    }
    return null;
  };

  const isPointOpaque = (clientX: number, clientY: number): boolean => {
    if (destroyed) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    if (lx < 0 || ly < 0 || lx >= rect.width || ly >= rect.height) return false;

    if (
      bubbleBounds &&
      lx >= bubbleBounds.x - 4 &&
      lx <= bubbleBounds.x + bubbleBounds.w + 4 &&
      ly >= bubbleBounds.y - 4 &&
      ly <= bubbleBounds.y + bubbleBounds.h + 4
    ) {
      return true;
    }

    if (isPointInTower(lx, ly)) return true;
    if (findGroundBugAt(lx, ly)) return true;

    if (bodyBounds.w <= 0 || bodyBounds.h <= 0) return false;
    const cx = bodyBounds.x + bodyBounds.w * 0.5;
    const cy = bodyBounds.y + bodyBounds.h * 0.5;
    const rx = bodyBounds.w * 0.46;
    const ry = bodyBounds.h * 0.46;
    const nx = (lx - cx) / rx;
    const ny = (ly - cy) / ry;
    return nx * nx + ny * ny <= 1;
  };

  const enterDrowsy = (now = nowMs()): void => {
    currentMood = 'drowsy';
    moodRevertAt = 0;
    drowsyEnteredAt = now;
    drowsyWakeStretch = false;
    idleVariantActive = false;
    isBlinking = false;
    pendingSecondBlinkAt = 0;
    lastDrawTs = Number.NEGATIVE_INFINITY;
  };

  const wakeFromSleep = (wakeBubble?: string, durationMs = 1800): void => {
    const now = nowMs();
    markInteracted(now);
    currentMood = 'drowsy';
    drowsyWakeStretch = true;
    drowsyEnteredAt = now;
    moodRevertAt = now + WAKE_STRETCH_MS;
    squashSpring.impulse(-1.2);
    playSfx('click');
    if (wakeBubble) {
      showBubble(wakeBubble, durationMs, now);
    }
    const cx = (canvas.clientWidth || 200) * 0.5;
    for (let i = 0; i < 3; i++) spawnParticle(particles, 'happy', cx, 48, 72);
  };

  const enterSleep = (now = nowMs()): void => {
    currentMood = 'sleep';
    moodRevertAt = 0;
    drowsyWakeStretch = false;
    idleVariantActive = false;
    isBlinking = false;
    pendingSecondBlinkAt = 0;
    lastDrawTs = Number.NEGATIVE_INFINITY;
    playSfx('yawn');
    showBubble(CHAR_META[currentChar].sleepLine, 2600, now);
    const cx = (canvas.clientWidth || 256) * 0.5;
    spawnParticle(particles, 'sleep', cx, 50, 72);
  };

  const setMood = (mood: PetMood, text?: string, durationMs?: number): void => {
    const now = nowMs();
    if (isDragging && mood !== 'dangle') {
      return;
    }
    if (mood !== 'idle' && mood !== 'sleep') {
      markInteracted(now);
    } else if (mood === 'idle') {
      markInteracted(now);
    }

    const prevMood = currentMood;
    const wasSleep = currentMood === 'sleep';
    currentMood = mood;
    drowsyWakeStretch = false;
    idleVariantActive = false;
    if (mood === 'idle') {
      nextIdleVariantAt =
        now + IDLE_VARIANT_GAP_MIN_MS + Math.random() * (IDLE_VARIANT_GAP_MAX_MS - IDLE_VARIANT_GAP_MIN_MS);
    }
    if (mood === 'drowsy') drowsyEnteredAt = now;
    if (mood === 'bonk') {
      bonkStartedAt = now;
      bonkDirectSlammed = false;
    }
    if (mood === 'eat') eatPhaseStart = animElapsed;
    if (mood === 'music') musicPhaseStart = animElapsed;
    if (mood !== 'scared' && mood !== 'bonk') {
      bugHuntPhase = 'none';
      bugHuntSlot = null;
    }
    if (mood !== 'dangle') {
      isDropping = false;
      dropOffsetY = 0;
      dropVelY = 0;
      dangleAngle = 0;
      dangleVel = 0;
    }

    if (mood === 'poke') {
      squashSpring.impulse(1.8);
    } else if (wasSleep && mood !== 'sleep') {
      triggerBounce(1.0);
    } else if (mood === prevMood) {
      triggerBounce(0.32);
    } else {
      triggerBounce(mood === 'shock' ? 1.15 : mood === 'idle' ? 0.35 : 0.85);
    }

    if (typeof text === 'string') {
      const trimmed = text.trim();
      if (trimmed) {
        showBubble(trimmed, durationMs && durationMs > 0 ? durationMs : 2800, now);
      } else {
        bubbleText = '';
        bubbleUntil = 0;
      }
    } else if (now - lastClickBubbleAt > 180 && mood === 'idle') {
      // Keep natural bubble fade
    }

    if (durationMs && durationMs > 0) {
      moodRevertAt = now + durationMs;
    } else if (mood === 'work') {
      moodRevertAt = now + 4000;
    } else if (TIMED_MOODS.has(mood)) {
      moodRevertAt = now + 2600;
    } else {
      moodRevertAt = 0;
    }

    if (mood === 'work') {
      lastWorkFrame = -1;
      workFrameIdx = 0;
      workFrameA = true;
      workBeatAge = 0;
    }
    if (mood !== 'work') fakeTypingUntil = 0;

    const cx = (canvas.clientWidth || 200) * 0.5;
    const headY = (canvas.clientHeight || 180) * 0.28;
    const burstCount = mood === 'sleep' ? 1 : 4;
    for (let i = 0; i < burstCount; i++) spawnParticle(particles, mood, cx, headY, 72);
  };

  const triggerAction = (action: PetAction): void => {
    const now = nowMs();
    markInteracted(now);
    isDragging = false;
    isDropping = false;
    dropOffsetY = 0;
    dropVelY = 0;
    dangleAngle = 0;
    dangleVel = 0;
    bugHuntPhase = 'none';
    bugHuntSlot = null;

    const meta = CHAR_META[currentChar];
    if (action === 'pat') {
      const line = meta.patLines[patLineIdx % meta.patLines.length];
      patLineIdx++;
      playSfx('pat');
      setMood('pat', line, 2600);
    } else if (action === 'work') {
      playSfx('typeKey');
      setMood('work', meta.workLine, 4000);
    } else if (action === 'eat') {
      playSfx('eat');
      setMood('eat', meta.eatLine, 3000);
    } else if (action === 'music') {
      playSfx('pat');
      setMood('music', FUN_LINES.music, 6500);
    } else if (action === 'sleep') {
      enterSleep(now);
    }
  };

  const isBaseLikeMood = (m: PetMood): boolean =>
    m === 'idle' ||
    m === 'slack' ||
    (m === 'drowsy' && moodRevertAt === 0) ||
    (m === 'work' && moodRevertAt === 0);

  const setBaseMood = (mood: PetBaseMood): void => {
    if (baseMood === mood) return;
    baseMood = mood;
    if (mood === 'slack') {
      const roll = Math.random();
      slackVariant = roll < 0.42 ? 'comic' : roll < 0.68 ? 'music' : roll < 0.85 ? 'bubble' : 'daze';
      slackVariantUntil = nowMs() + 9000 + Math.random() * 6000;
    }
    if (!isDragging && !isDropping && currentMood !== 'sleep' && isBaseLikeMood(currentMood)) {
      currentMood = mood;
      moodRevertAt = 0;
      if (mood === 'work') {
        lastWorkFrame = -1;
        workFrameIdx = 0;
        workFrameA = true;
        workBeatAge = 0;
      }
      lastDrawTs = Number.NEGATIVE_INFINITY;
    }
  };

  const setRateTier = (tier: 0 | 1 | 2 | 3, tps: number): void => {
    rateTier = tier;
    rateTps = Number.isFinite(tps) && tps > 0 ? tps : 0;
  };

  const playFakeTyping = (durationMs: number): void => {
    const now = nowMs();
    if (isDragging || isDropping) return;
    currentMood = 'work';
    moodRevertAt = now + Math.max(400, durationMs);
    fakeTypingUntil = moodRevertAt;
    lastWorkFrame = -1;
    workFrameIdx = 0;
    workFrameA = true;
    workBeatAge = 0;
  };

  const setLocomotion = (dir: -1 | 0 | 1, isPeeking = false, speedRatio = 1): void => {
    locoDir = dir;
    peeking = dir !== 0 && isPeeking;
    locoSpeedRatio = Number.isFinite(speedRatio) ? Math.max(0, speedRatio) : 1;
    if (dir !== 0) {
      facing = dir;
      if (bugHuntPhase === 'none') scootTarget = 0;
      if (currentMood === 'drowsy' && moodRevertAt === 0) {
        currentMood = baseMood;
      }
    }
    if (peeking && !bubbleText) {
      showBubble(FUN_LINES.peek, PEEK_BUBBLE_MS);
    }
  };

  const setBowlCount = (layers: number): void => {
    const next = Math.max(0, Math.floor(Number.isFinite(layers) ? layers : 0));
    if (next > towerCount) towerPopAge = 0;
    towerCount = next;
  };

  const dropItem = (kind: DropKind, source: DropSource = 'toy'): boolean => {
    if (destroyed || isDragging) return false;
    let slot: FallingItem | null = null;
    for (const d of dropSlots) {
      if (!d.active) {
        slot = d;
        break;
      }
    }
    if (!slot) return false;
    const cw = Math.max(64, canvas.clientWidth || canvas.width || 256);
    const spreadMin = cw * 0.3;
    const spreadMax = cw * 0.66;
    slot.active = true;
    slot.kind = kind;
    slot.source = source;
    slot.phase = 'fall';
    slot.x = spreadMin + Math.random() * (spreadMax - spreadMin);
    slot.y = -18;
    slot.vx = 0;
    slot.vy = 20;
    slot.rot = (Math.random() - 0.5) * 0.6;
    slot.vr = (Math.random() - 0.5) * 3;
    slot.t = 0;
    if (kind !== 'bug') {
      scootTarget = Math.max(-SCOOT_MAX_PX, Math.min(SCOOT_MAX_PX, slot.x - cw * 0.5));
    }
    markInteracted();
    lastDrawTs = Number.NEGATIVE_INFINITY;
    return true;
  };

  const collapseTower = (): void => {
    const shown = Math.min(MAX_TOWER_DRAW, towerCount);
    const tb = towerBounds;
    if (tb) {
      const bowlH = tb.h / Math.max(1, shown);
      for (let i = 0; i < shown; i++) {
        const d = debris[i];
        d.active = true;
        d.x = tb.x + tb.w * 0.5;
        d.y = tb.y + tb.h - i * bowlH;
        d.vx = (Math.random() - 0.65) * 200;
        d.vy = -(60 + Math.random() * 180);
        d.rot = 0;
        d.vr = (Math.random() - 0.5) * 14;
        d.life = 0;
      }
    }
    towerCount = 0;
    playSfx('land');
    setMood('cry', FUN_LINES.cry, 2500);
    emit({ type: 'tower-collapse' });
  };

  const isBusy = (): boolean =>
    isDragging ||
    isDropping ||
    hasActiveDrops() ||
    bowlFlyT >= 0 ||
    pendingBowlFlies > 0 ||
    bugHuntPhase !== 'none' ||
    currentMood === 'sleep' ||
    (moodRevertAt > 0 && TIMED_MOODS.has(currentMood)) ||
    (currentMood === 'work' && moodRevertAt > 0);

  const startDrag = (): void => {
    const now = nowMs();
    markInteracted(now);
    pointerDownOnCanvas = false;
    pointerMovedDrag = false;
    hoverOnHead = false;
    dragSuppressClickUntil = now + 400;
    if (isDragging) return;
    isDragging = true;
    isDropping = false;
    dropVelY = 0;
    bugHuntPhase = 'none';
    bugHuntSlot = null;
    shakeDetector.reset();
    currentMood = 'dangle';
    moodRevertAt = 0;
    dangleAngle = 0;
    dangleVel = 0;
    squashSpring.impulse(-1.0);
    playSfx('pickup');
    showBubble(CHAR_META[currentChar].dangleLine, 2600, now);
    const cx = (canvas.clientWidth || 200) * 0.5;
    for (let i = 0; i < 4; i++) spawnParticle(particles, 'dangle', cx, 42, 72);
  };

  const feedDragDelta = (dx: number, dy: number): void => {
    if (!isDragging) return;
    const now = nowMs();
    markInteracted(now);
    shakeDetector.feed(dx, now);
    // Pulling collar right leaves lower body lagging left (positive clockwise angle around top anchor)
    dangleVel += Math.max(-12, Math.min(12, dx * 0.24));
    dangleVel = Math.max(-16, Math.min(16, dangleVel));
    if (Math.abs(dy) > 0.5) {
      squashSpring.impulse(Math.max(-1.1, Math.min(1.1, -dy * 0.04)));
    }
  };

  const endDrag = (): void => {
    const now = nowMs();
    markInteracted(now);
    pointerDownOnCanvas = false;
    pointerMovedDrag = false;
    dragSuppressClickUntil = now + 400;
    if (!isDragging && !isDropping) return;
    isDragging = false;
    isDropping = true;
    dropOffsetY = Math.min(-GRAVITY_DROP_HEIGHT_PX, dropOffsetY);
    dropVelY = 40;
    moodRevertAt = 0;
  };

  const setCharacter = (charId: PetCharId): void => {
    if (!ALL_CHARS.includes(charId)) return;
    markInteracted();
    void ensureCharacterPackLoaded(charId);
    if (currentChar !== charId) {
      currentChar = charId;
      isBlinking = false;
      pendingSecondBlinkAt = 0;
      lastDrawnBlink = false;
      spriteSwapPending = false;
      spriteBlender.reset();
      postureBridge.reset(moodToPosture(currentMood));
      lastDrawTs = Number.NEGATIVE_INFINITY;
      triggerBounce(0.95);
      const cx = (canvas.clientWidth || 256) * 0.5;
      for (let i = 0; i < 4; i++) spawnParticle(particles, 'happy', cx, 48, 72);
    }
  };

  const updateMouseTilt = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      targetIdleTilt = 0;
      mouseLookNormX = 0;
      return;
    }
    const margin = GAZE_RANGE_PX;
    const insideNearZone =
      clientX >= rect.left - margin &&
      clientX <= rect.right + margin &&
      clientY >= rect.top - margin &&
      clientY <= rect.bottom + margin;
    if (!insideNearZone) {
      targetIdleTilt = 0;
      mouseLookNormX = 0;
      return;
    }
    const cx = rect.left + rect.width * 0.5;
    const normX = Math.max(-1, Math.min(1, (clientX - cx) / Math.max(90, rect.width * 0.72)));
    mouseLookNormX = normX;
    targetIdleTilt = normX * MAX_IDLE_TILT_RAD;
  };

  const onWindowPointerMove = (e: PointerEvent): void => {
    if (destroyed) return;
    updateMouseTilt(e.clientX, e.clientY);
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
    ) {
      hoverOnHead = false;
      hoverPointerLocal = null;
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (destroyed) return;
    pointerDownOnCanvas = true;
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    pointerMovedDrag = false;
    hoverOnHead = false;
  };

  const onPointerMove = (e: PointerEvent): void => {
    updateMouseTilt(e.clientX, e.clientY);

    const rect = canvas.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    if (rect.width > 0 && rect.height > 0 && lx >= 0 && lx <= rect.width && ly >= 0 && ly <= rect.height) {
      hoverPointerLocal = { x: lx, y: ly };
    } else {
      hoverPointerLocal = null;
    }

    if (pointerDownOnCanvas && (e.buttons & 1) !== 0) {
      if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > 5) {
        pointerMovedDrag = true;
        headRubAccum = 0;
      }
    }

    const relY = bodyBounds.h > 0 ? (ly - bodyBounds.y) / bodyBounds.h : 1;
    const inHeadZone =
      (e.buttons & 1) === 0 &&
      !isDragging &&
      !isDropping &&
      !pointerDownOnCanvas &&
      isPointOpaque(e.clientX, e.clientY) &&
      !isPointInTower(lx, ly) &&
      relY >= 0 &&
      relY <= 0.42;
    hoverOnHead = inHeadZone;

    if (lastPointerX !== null) {
      const dx = e.clientX - lastPointerX;
      swayVel += Math.max(-35, Math.min(35, dx * 0.55));
      headShearSpring.impulse(Math.max(-25, Math.min(25, dx * 0.4)));

      // Unpressed horizontal rub across upper 42% head area triggers pat
      if (inHeadZone) {
        headRubAccum += Math.abs(dx);
        const now = nowMs();
        if (headRubAccum > 26 && now - lastRubPatAt > 1100) {
          headRubAccum = 0;
          lastRubPatAt = now;
          if (currentMood === 'sleep') {
            wakeFromSleep(CHAR_META[currentChar].wakeLine, 1800);
          } else {
            triggerAction('pat');
          }
        }
      } else {
        headRubAccum = 0;
      }
    }
    lastPointerX = e.clientX;
  };

  const onPointerUpOrCancel = (): void => {
    pointerDownOnCanvas = false;
  };

  const onPointerLeave = (): void => {
    lastPointerX = null;
    headRubAccum = 0;
    targetIdleTilt = 0;
    mouseLookNormX = 0;
    hoverPointerLocal = null;
    hoverOnHead = false;
  };

  const onClick = (e: MouseEvent): void => {
    const now = nowMs();
    if (now < dragSuppressClickUntil || isDragging || isDropping || pointerMovedDrag) {
      pointerMovedDrag = false;
      return;
    }
    {
      const r = canvas.getBoundingClientRect();
      const lx = e.clientX - r.left;
      const ly = e.clientY - r.top;
      if (isPointInTower(lx, ly)) {
        markInteracted(now);
        collapseTower();
        return;
      }
      const clickedBug = findGroundBugAt(lx, ly);
      if (clickedBug && bugHuntPhase !== 'windup' && bugHuntPhase !== 'midswing' && bugHuntPhase !== 'slam') {
        markInteracted(now);
        bugHuntSlot = clickedBug;
        bugHuntPhase = 'approach';
        bugHuntUntil = 0;
        if (currentMood === 'scared') {
          currentMood = baseMood;
          moodRevertAt = 0;
        }
        playSfx('click');
        return;
      }
    }
    if (!isPointOpaque(e.clientX, e.clientY)) return;

    markInteracted(now);
    lastClickBubbleAt = now;

    if (currentMood === 'sleep') {
      wakeFromSleep(CHAR_META[currentChar].wakeLine, 1800);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const ly = e.clientY - rect.top;
    const relY = bodyBounds.h > 0 ? (ly - bodyBounds.y) / bodyBounds.h : 0.6;

    if (relY <= 0.42) {
      triggerAction('pat');
    } else {
      const meta = CHAR_META[currentChar];
      const line = meta.pokeLines[pokeLineIdx % meta.pokeLines.length];
      pokeLineIdx++;
      playSfx('click');
      setMood('poke', line, 2400);
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
  canvas.addEventListener('click', onClick);
  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUpOrCancel, { passive: true });
    window.addEventListener('pointercancel', onPointerUpOrCancel, { passive: true });
  }

  let prevTs = nowMs();
  const startTs = prevTs;

  const getCharSprite = (suffix: ActionSpriteSuffix): HTMLImageElement | null =>
    sprites[`${currentChar}_${suffix}`] ?? null;

  interface SpritePickResult {
    img: HTMLImageElement | null;
    key: string;
    kind: SpriteBlendKind;
  }

  const pickCharSprite = (suffix: ActionSpriteSuffix): { img: HTMLImageElement; key: string } | null => {
    const img = getCharSprite(suffix);
    if (!img) return null;
    return { img, key: `${currentChar}_${suffix}` };
  };

  const pickCycle4 = (
    idx: number,
    a: ActionSpriteSuffix,
    b: ActionSpriteSuffix,
    c: ActionSpriteSuffix,
    d: ActionSpriteSuffix,
    fallbackA = idx % 2 === 0,
  ): { img: HTMLImageElement; key: string } | null => {
    const sA = pickCharSprite(a);
    const sB = pickCharSprite(b);
    const sC = pickCharSprite(c);
    const sD = pickCharSprite(d);
    if (sA && sB && sC && sD) {
      const frames = [sA, sB, sC, sD];
      return frames[((idx % 4) + 4) % 4];
    }
    return (fallbackA ? sA : sB) ?? sA ?? sB ?? sC ?? sD;
  };

  let currentStrideFrameA = true;
  let currentStrideFrameIndex: 0 | 1 | 2 | 3 = 0;

  const isScooting = (): boolean =>
    Math.abs(scootTarget - scootX) > 2.2 || Math.abs(scootSpring.yd) > 8;
  const hasCatchableFalling = (): boolean => {
    for (let i = 0; i < dropSlots.length; i++) {
      const d = dropSlots[i];
      if (d.active && d.kind !== 'bug' && d.phase === 'fall') return true;
    }
    return false;
  };

  const isWalkingVisual = (): boolean =>
    !isDragging &&
    !isDropping &&
    bugHuntPhase !== 'windup' &&
    bugHuntPhase !== 'midswing' &&
    bugHuntPhase !== 'slam' &&
    ((locoDir !== 0 &&
      (currentMood === 'idle' ||
        currentMood === 'slack' ||
        (currentMood === 'work' && moodRevertAt === 0))) ||
      bugHuntPhase === 'approach' ||
      (isScooting() && (isBaseLikeMood(currentMood) || hasCatchableFalling())));

  const chooseActiveSprite = (
    t: number,
    useCrouch: boolean,
    useSitTrans: boolean,
    now: number,
  ): SpritePickResult => {
    const baseImg = sprites[currentChar] ?? null;
    const basePick = {
      img: baseImg,
      key: baseImg ? currentChar : `${currentChar}:fallback`,
    };
    const wasBlink = spriteBlender.key.endsWith('_blink');
    const poseOrBlinkEnd = (pick: { img: HTMLImageElement | null; key: string }): SpritePickResult => ({
      ...pick,
      kind: wasBlink ? 'blink' : 'pose',
    });

    if (currentMood === 'dangle' || isDragging || isDropping) {
      return { ...(pickCharSprite('dangle') ?? basePick), kind: 'pose' };
    }
    if (useCrouch) {
      const crouchPick = pickCharSprite('crouch');
      if (crouchPick) return { ...crouchPick, kind: 'pose' };
    }
    if (useSitTrans) {
      const sitTransPick = pickCharSprite('sit_trans');
      if (sitTransPick) return { ...sitTransPick, kind: 'pose' };
    }
    if (isWalkingVisual()) {
      if (peeking && locoDir !== 0) {
        const peekPick = pickCharSprite('peek');
        if (peekPick) return { ...peekPick, kind: 'pose' };
      }
      const walkPick = pickCycle4(
        currentStrideFrameIndex,
        'walk_a',
        'walk_b',
        'walk_c',
        'walk_d',
        currentStrideFrameA,
      );
      if (walkPick) {
        if (peeking && locoDir !== 0) {
          return { ...(pickCharSprite('walk_a') ?? walkPick), kind: 'pose' };
        }
        return { ...walkPick, kind: 'step' };
      }
      return { ...basePick, kind: 'pose' };
    }
    switch (currentMood) {
      case 'pat':
        return { ...(pickCharSprite('pat') ?? pickCharSprite('happy') ?? basePick), kind: 'pose' };
      case 'work': {
        if (moodRevertAt === 0 && rateTier >= 3) {
          const ohA = pickCharSprite('overheat');
          const ohB = pickCharSprite('overheat_b');
          if (ohA || ohB) {
            return { ...((workFrameIdx % 2 === 0 ? ohA : ohB) ?? ohA ?? ohB)!, kind: 'step' };
          }
        }
        return {
          ...(pickCycle4(workFrameIdx, 'work_a', 'work_b', 'work_c', 'work_d', workFrameA) ?? basePick),
          kind: 'step',
        };
      }
      case 'overheat': {
        const ohA = pickCharSprite('overheat');
        const ohB = pickCharSprite('overheat_b');
        if (ohA || ohB) {
          return { ...((workFrameIdx % 2 === 0 ? ohA : ohB) ?? ohA ?? ohB)!, kind: 'step' };
        }
        return {
          ...(pickCycle4(workFrameIdx, 'work_a', 'work_b', 'work_c', 'work_d', workFrameA) ?? basePick),
          kind: 'step',
        };
      }
      case 'eat': {
        const eatIdx = Math.floor(Math.max(0, t - eatPhaseStart) / 0.45);
        return {
          ...(pickCycle4(eatIdx, 'eat_a', 'eat_b', 'eat_c', 'eat_d') ?? basePick),
          kind: 'beat',
        };
      }
      case 'sleep':
        return { ...(pickCharSprite('sleep') ?? basePick), kind: 'pose' };
      case 'drowsy': {
        if (drowsyWakeStretch) {
          return { ...(pickCharSprite('drowsy') ?? pickCharSprite('happy') ?? basePick), kind: 'pose' };
        }
        const drowsyPick = pickCharSprite('drowsy');
        if (drowsyPick) {
          const cycleMs = Math.max(0, now - drowsyEnteredAt) % 2400;
          if (cycleMs > 2140) {
            const nodBlink = pickCharSprite('blink') ?? drowsyPick;
            return { ...nodBlink, kind: nodBlink.key.endsWith('_blink') ? 'blink' : 'pose' };
          }
          return poseOrBlinkEnd(drowsyPick);
        }
        const dAge = Math.max(0, now - drowsyEnteredAt);
        if (dAge >= 2800 && dAge < 3350) return { ...basePick, kind: 'blink' };
        const blinkPick = pickCharSprite('blink');
        return { ...(blinkPick ?? basePick), kind: blinkPick ? 'blink' : 'pose' };
      }
      case 'dizzy':
        return {
          ...(pickCharSprite('dizzy') ?? pickCharSprite('scared') ?? pickCharSprite('dangle') ?? basePick),
          kind: 'pose',
        };
      case 'bonk': {
        const wasBonkMid = spriteBlender.key.endsWith('_bonk_mid');
        if (bugHuntPhase === 'windup') {
          return { ...(pickCharSprite('bonk_a') ?? pickCharSprite('happy') ?? basePick), kind: 'pose' };
        }
        if (bugHuntPhase === 'midswing') {
          return {
            ...(pickCharSprite('bonk_mid') ?? pickCharSprite('bonk_a') ?? pickCharSprite('happy') ?? basePick),
            kind: 'smear',
          };
        }
        if (bugHuntPhase === 'slam') {
          return {
            ...(pickCharSprite('bonk_b') ?? pickCharSprite('work_b') ?? basePick),
            kind: wasBonkMid ? 'smear' : 'pose',
          };
        }
        const bonkAge = Math.max(0, now - bonkStartedAt);
        if (bonkAge < BONK_WINDUP_MS) {
          return { ...(pickCharSprite('bonk_a') ?? pickCharSprite('happy') ?? basePick), kind: 'pose' };
        }
        if (bonkAge < BONK_WINDUP_MS + BONK_MID_MS) {
          const midPick = pickCharSprite('bonk_mid');
          if (midPick) return { ...midPick, kind: 'smear' };
        }
        return {
          ...(pickCharSprite('bonk_b') ??
            pickCharSprite('bonk_a') ??
            pickCharSprite('happy') ??
            basePick),
          kind: wasBonkMid ? 'smear' : 'pose',
        };
      }
      case 'music': {
        const musicIdx = Math.floor(Math.max(0, t - musicPhaseStart) * MUSIC_BEAT_HZ);
        return {
          ...(pickCycle4(musicIdx, 'music_a', 'music_b', 'music_c', 'music_d') ??
            pickCharSprite('happy') ??
            pickCharSprite('pat') ??
            basePick),
          kind: 'beat',
        };
      }
      case 'happy':
        return { ...(pickCharSprite('happy') ?? pickCharSprite('pat') ?? basePick), kind: 'pose' };
      case 'slack': {
        if (slackVariant === 'music') {
          const musicIdx = Math.floor(Math.max(0, t - musicPhaseStart) * MUSIC_BEAT_HZ);
          const musicPick = pickCycle4(musicIdx, 'music_a', 'music_b', 'music_c', 'music_d');
          if (musicPick) return { ...musicPick, kind: 'beat' };
          return { ...(pickCharSprite('happy') ?? basePick), kind: 'pose' };
        }
        if (slackVariant === 'comic') {
          const slackPick = pickCharSprite('slack');
          if (slackPick) return poseOrBlinkEnd(slackPick);
        }
        if (isBlinking) {
          const blinkPick = pickCharSprite('blink');
          return { ...(blinkPick ?? basePick), kind: blinkPick ? 'blink' : 'pose' };
        }
        return poseOrBlinkEnd(basePick);
      }
      case 'caught':
        return { ...(pickCharSprite('caught') ?? basePick), kind: 'pose' };
      case 'tired':
        return { ...(pickCharSprite('tired') ?? pickCharSprite('sleep') ?? basePick), kind: 'pose' };
      case 'scared':
        return { ...(pickCharSprite('scared') ?? pickCharSprite('dangle') ?? basePick), kind: 'pose' };
      case 'coffee':
        return { ...(pickCharSprite('coffee') ?? pickCharSprite('eat_a') ?? basePick), kind: 'pose' };
      case 'cry':
        return { ...(pickCharSprite('cry') ?? basePick), kind: 'pose' };
      case 'idle': {
        if (isBlinking) {
          const blinkPick = pickCharSprite('blink');
          return { ...(blinkPick ?? basePick), kind: blinkPick ? 'blink' : 'pose' };
        }
        if (idleVariantActive) {
          const idleBPick = pickCharSprite('idle_b');
          if (idleBPick) return poseOrBlinkEnd(idleBPick);
        }
        return poseOrBlinkEnd(basePick);
      }
      default:
        return { ...basePick, kind: 'pose' };
    }
  };

  const handleCatch = (kind: DropKind, source: DropSource, now: number): void => {
    const meta = CHAR_META[currentChar];
    lastCatchAt = now;
    if (kind === 'rice') {
      playSfx('eat');
      setMood('eat', meta.eatLine, 1800);
      pendingBowlFlies++;
    } else if (kind === 'coffee') {
      playSfx('eat');
      setMood('coffee', FUN_LINES.coffee, 1600);
      boostUntil = now + 1600 + COFFEE_BOOST_MS;
      emit({ type: 'coffee-boost', until: boostUntil });
    }
    emit({ type: 'item-caught', kind, source });
  };

  const findActiveGroundBug = (): FallingItem | null => {
    if (bugHuntSlot && bugHuntSlot.active && bugHuntSlot.kind === 'bug' && bugHuntSlot.phase === 'ground') {
      return bugHuntSlot;
    }
    for (const d of dropSlots) {
      if (d.active && d.kind === 'bug' && d.phase === 'ground') return d;
    }
    return null;
  };

  const triggerBugBonkWindup = (bug: FallingItem, now: number, centerX: number): void => {
    bugHuntSlot = bug;
    bugHuntDir = bug.x >= centerX ? 1 : -1;
    facing = bugHuntDir;
    bugHuntPhase = 'windup';
    bugHuntUntil = now + BONK_WINDUP_MS;
    bonkStartedAt = now;
    currentMood = 'bonk';
    moodRevertAt = now + BONK_WINDUP_MS + (getCharSprite('bonk_mid') ? BONK_MID_MS : 0) + BONK_SLAM_MS;
    squashSpring.impulse(-1.3);
  };

  const triggerBonkImpact = (now: number, cw: number, footY: number, launchBugs: boolean): void => {
    bonkHitstopUntil = now + BONK_HITSTOP_MS;
    bonkShakeAmp = 2.6;
    bonkShakeElapsed = 0;
    squashSpring.impulse(1.4);
    playSfx('bonk');

    const impactX = cw * 0.5 + scootX + bugHuntDir * 22;
    bonkShockwave.active = true;
    bonkShockwave.x = impactX;
    bonkShockwave.y = footY - 12;
    bonkShockwave.elapsed = 0.012;
    bonkShockwave.duration = BONK_SHOCKWAVE_DURATION;
    bonkShockwave.dir = bugHuntDir;

    if (!launchBugs) return;

    bugHuntPhase = 'slam';
    bugHuntUntil = now + BONK_SLAM_MS;
    currentMood = 'bonk';
    moodRevertAt = bugHuntUntil;
    showBubble(FUN_LINES.bonk, 1600, now);

    let hitAny = false;
    for (const d of dropSlots) {
      if (d.active && d.kind === 'bug' && d.phase === 'ground') {
        if (d === bugHuntSlot || Math.abs(d.x - impactX) <= 52) {
          hitAny = true;
          d.phase = 'fly';
          d.t = 0;
          d.vx = bugHuntDir * (240 + Math.random() * 80);
          d.vy = -(250 + Math.random() * 60);
          d.vr = 18;
          bonkShockwave.x = d.x;
          bonkShockwave.y = d.y - 4;
          for (let i = 0; i < 6; i++) {
            pushParticle(
              particles,
              i % 2 === 0 ? 'bang' : 'spark',
              d.x,
              d.y - 6,
              (Math.random() - 0.5) * 150,
              -(50 + Math.random() * 80),
              0.5,
              i % 2 === 0 ? 5.5 : 3.2,
              i % 2 === 0 ? '#facc15' : '#38bdf8',
            );
          }
          pushParticle(particles, 'dust', d.x - 6, footY - 2, -26, -10, 0.4, 6.5, '#f8fafc');
          pushParticle(particles, 'dust', d.x + 6, footY - 2, 26, -10, 0.4, 6.5, '#f8fafc');
        }
      }
    }
    if (!hitAny && bugHuntSlot && bugHuntSlot.active && bugHuntSlot.kind === 'bug') {
      bugHuntSlot.phase = 'fly';
      bugHuntSlot.t = 0;
      bugHuntSlot.vx = bugHuntDir * 260;
      bugHuntSlot.vy = -260;
      bugHuntSlot.vr = 18;
    }
  };

  const updateDrops = (dtReal: number, now: number, cw: number, ch: number, footY: number): void => {
    let anyCatchableFalling = false;
    for (const d of dropSlots) {
      if (!d.active) continue;
      d.t += dtReal;
      if (d.phase === 'fall') {
        d.vy += 520 * dtReal;
        d.y += d.vy * dtReal;
        d.rot += d.vr * dtReal;
        if (d.kind === 'bug') {
          const groundY = footY - 6;
          if (d.y >= groundY) {
            d.y = groundY;
            d.phase = 'ground';
            d.vy = 0;
            d.rot = 0;
            d.t = 0;
            playSfx('bug');
            setMood('scared', FUN_LINES.bugScared, 720);
            bugHuntSlot = d;
            bugHuntPhase = 'scared';
            bugHuntUntil = now + (boostUntil > now ? 500 : 700);
            emit({ type: 'item-caught', kind: 'bug', source: d.source });
          }
        } else {
          anyCatchableFalling = true;
          const catchY = lastLayout.topY + lastLayout.totalH * 0.48;
          if (d.y >= catchY) {
            d.active = false;
            handleCatch(d.kind, d.source, now);
          }
        }
      } else if (d.phase === 'ground') {
        d.x = Math.max(18, Math.min(cw - 18, d.x + Math.sin(d.t * 4) * 10 * dtReal));
      } else {
        d.vy += 520 * dtReal;
        d.x += d.vx * dtReal;
        d.y += d.vy * dtReal;
        d.rot += d.vr * dtReal;
        if (d.t > 2.4 || d.y > ch + 30 || d.x < -40 || d.x > cw + 40) d.active = false;
      }
    }

    if (bugHuntPhase === 'scared' && now >= bugHuntUntil && !isDragging && !isDropping) {
      const bug = findActiveGroundBug();
      if (bug) {
        bugHuntSlot = bug;
        const centerNow = cw * 0.5 + scootX;
        const strikeOffset = 22;
        const desiredX = bug.x + (centerNow <= bug.x ? -strikeOffset : strikeOffset);
        const desiredScoot = Math.max(-SCOOT_MAX_PX, Math.min(SCOOT_MAX_PX, desiredX - cw * 0.5));
        if (Math.abs(desiredScoot - scootX) <= 12) {
          scootTarget = desiredScoot;
          triggerBugBonkWindup(bug, now, centerNow);
        } else {
          bugHuntPhase = 'approach';
          currentMood = baseMood;
          moodRevertAt = 0;
        }
      } else {
        bugHuntPhase = 'none';
        bugHuntSlot = null;
      }
    }

    if (bugHuntPhase === 'approach' && !isDragging && !isDropping) {
      const bug = findActiveGroundBug();
      if (!bug) {
        bugHuntPhase = 'none';
        bugHuntSlot = null;
      } else {
        const centerNow = cw * 0.5 + scootX;
        const strikeOffset = 22;
        const desiredX = bug.x + (centerNow <= bug.x ? -strikeOffset : strikeOffset);
        scootTarget = Math.max(-SCOOT_MAX_PX, Math.min(SCOOT_MAX_PX, desiredX - cw * 0.5));
        if (Math.abs(scootTarget - scootX) <= 3.5) {
          triggerBugBonkWindup(bug, now, cw * 0.5 + scootX);
        }
      }
    }

    if (bugHuntPhase === 'windup' && now >= bugHuntUntil && !isDragging && !isDropping) {
      if (getCharSprite('bonk_mid')) {
        bugHuntPhase = 'midswing';
        bugHuntUntil = now + BONK_MID_MS;
        currentMood = 'bonk';
        moodRevertAt = now + BONK_MID_MS + BONK_SLAM_MS;
        squashSpring.impulse(0.35);
      } else {
        triggerBonkImpact(now, cw, footY, true);
      }
    } else if (bugHuntPhase === 'midswing' && now >= bugHuntUntil && !isDragging && !isDropping) {
      triggerBonkImpact(now, cw, footY, true);
    }

    if (bugHuntPhase === 'slam' && now >= bugHuntUntil) {
      const nextBug = findActiveGroundBug();
      if (nextBug) {
        bugHuntSlot = nextBug;
        bugHuntPhase = 'approach';
      } else {
        bugHuntPhase = 'none';
        bugHuntSlot = null;
        scootTarget = 0;
        suppressNextTurnHop = true;
        currentMood = baseMood;
        moodRevertAt = 0;
      }
    }

    if (
      !anyCatchableFalling &&
      bugHuntPhase === 'none' &&
      currentMood !== 'eat' &&
      currentMood !== 'coffee'
    ) {
      scootTarget = 0;
    }
  };

  const updateDebris = (dtReal: number, footY: number): void => {
    for (const d of debris) {
      if (!d.active) continue;
      d.life += dtReal;
      d.vy += 620 * dtReal;
      d.x += d.vx * dtReal;
      d.y += d.vy * dtReal;
      d.rot += d.vr * dtReal;
      if (d.y >= footY - 2) {
        d.y = footY - 2;
        d.vy *= -0.32;
        d.vx *= 0.72;
        d.vr *= 0.6;
      }
      if (d.life >= 1.9) d.active = false;
    }
  };

  const stepRenderFrame = (now: number, forceDraw = false): void => {
    if (destroyed) return;
    if (!forceDraw && typeof document !== 'undefined' && document.hidden) {
      return;
    }

    const cwPreview = Math.max(64, canvas.clientWidth || canvas.width || 256);
    const compactPreview = cwPreview < 150;

    // 32s 闲置先打瞌睡 drowsy，38s 经 PostureBridge 趴睡
    if (
      !compactPreview &&
      locoDir === 0 &&
      !isDragging &&
      !isDropping &&
      !hasActiveDrops() &&
      bugHuntPhase === 'none'
    ) {
      const idleElapsed = now - lastInteractionAt;
      if (
        (currentMood === 'idle' || currentMood === 'slack') &&
        idleElapsed >= IDLE_DROWSY_MS &&
        idleElapsed < IDLE_SLEEP_MS
      ) {
        enterDrowsy(now);
      } else if (
        (currentMood === 'idle' ||
          currentMood === 'slack' ||
          (currentMood === 'drowsy' && !drowsyWakeStretch)) &&
        idleElapsed >= IDLE_SLEEP_MS
      ) {
        enterSleep(now);
      }
    }

    // 摸鱼小变奏：看漫画 / 戴耳机听歌 / 吹泡泡 / 发呆 轮换
    if (currentMood === 'slack' && now >= slackVariantUntil) {
      const roll = Math.random();
      slackVariant = roll < 0.42 ? 'comic' : roll < 0.68 ? 'music' : roll < 0.85 ? 'bubble' : 'daze';
      if (slackVariant === 'music') musicPhaseStart = animElapsed;
      slackVariantUntil =
        now +
        (slackVariant === 'comic' || slackVariant === 'music'
          ? 11_000 + Math.random() * 6000
          : 6000 + Math.random() * 3000);
    }

    // 计时动作到期回落先于眨眼判定执行，避免回落首帧命中过期 nextBlinkAt 造成 16.7ms 闪切
    if (moodRevertAt > 0 && now >= moodRevertAt && !isDragging && !isDropping && bugHuntPhase === 'none') {
      currentMood = baseMood;
      moodRevertAt = 0;
      fakeTypingUntil = 0;
      drowsyWakeStretch = false;
      if (baseMood === 'work') {
        lastWorkFrame = -1;
        workFrameIdx = 0;
        workFrameA = true;
        workBeatAge = 0;
      }
    }

    // 待机微生命感（0-8s 待机期间每隔 6-9s 柔缓切至 idle_b 停留 1.6-2.4s）
    const canIdleVariant =
      currentMood === 'idle' &&
      locoDir === 0 &&
      !isDragging &&
      !isDropping &&
      !hasActiveDrops() &&
      bugHuntPhase === 'none' &&
      !isScooting() &&
      Boolean(getCharSprite('idle_b'));
    if (canIdleVariant) {
      if (idleVariantActive && now >= idleVariantEndAt) {
        idleVariantActive = false;
        nextIdleVariantAt =
          now + IDLE_VARIANT_GAP_MIN_MS + Math.random() * (IDLE_VARIANT_GAP_MAX_MS - IDLE_VARIANT_GAP_MIN_MS);
      } else if (!idleVariantActive && !isBlinking && now >= nextIdleVariantAt) {
        idleVariantActive = true;
        idleVariantStartedAt = now;
        idleVariantDir = Math.random() < 0.5 ? -1 : 1;
        idleVariantEndAt =
          now + IDLE_VARIANT_HOLD_MIN_MS + Math.random() * (IDLE_VARIANT_HOLD_MAX_MS - IDLE_VARIANT_HOLD_MIN_MS);
      }
    } else {
      if (idleVariantActive) {
        idleVariantActive = false;
      }
      if (nextIdleVariantAt < now + IDLE_VARIANT_GAP_MIN_MS) {
        nextIdleVariantAt =
          now + IDLE_VARIANT_GAP_MIN_MS + Math.random() * (IDLE_VARIANT_GAP_MAX_MS - IDLE_VARIANT_GAP_MIN_MS);
      }
    }

    // Natural blink scheduling (every 2.8–5.0s for 130ms, 20% double blink)
    const canBlink =
      (currentMood === 'idle' ||
        (currentMood === 'slack' &&
          slackVariant !== 'music' &&
          (slackVariant !== 'comic' || !getCharSprite('slack')))) &&
      locoDir === 0 &&
      !isDragging &&
      !isDropping &&
      Boolean(getCharSprite('blink'));
    const nearIdleVariantBoundary =
      idleVariantActive && (now - idleVariantStartedAt < 200 || idleVariantEndAt - now < 220);

    const wasBlinking = isBlinking;
    if (canBlink) {
      if (isBlinking && now >= blinkEndAt) {
        isBlinking = false;
        if (pendingSecondBlinkAt === 0) {
          nextBlinkAt = now + 2800 + Math.random() * 2200;
        }
      }
      if (!isBlinking && pendingSecondBlinkAt > 0 && now >= pendingSecondBlinkAt) {
        isBlinking = true;
        blinkEndAt = now + 130;
        pendingSecondBlinkAt = 0;
      } else if (!isBlinking && pendingSecondBlinkAt === 0 && now >= nextBlinkAt) {
        if (nearIdleVariantBoundary) {
          nextBlinkAt = now + 240;
        } else {
          isBlinking = true;
          blinkEndAt = now + 130;
          if (Math.random() < 0.2) {
            pendingSecondBlinkAt = blinkEndAt + 140;
          } else {
            nextBlinkAt = blinkEndAt + 2800 + Math.random() * 2200;
          }
        }
      }
    } else {
      isBlinking = false;
      pendingSecondBlinkAt = 0;
      if (nextBlinkAt < now + 900) {
        nextBlinkAt = now + 1200 + Math.random() * 1600;
      }
    }
    if (!wasBlinking && isBlinking) {
      squashSpring.impulse(0.45);
      blinkNodAmt = 1;
    }

    const gazeAllowed =
      !isDragging &&
      !isDropping &&
      !peeking &&
      (currentMood === 'idle' ||
        currentMood === 'slack' ||
        currentMood === 'eat' ||
        currentMood === 'happy' ||
        currentMood === 'music' ||
        currentMood === 'pat' ||
        currentMood === 'drowsy');
    const effectiveTargetTilt = gazeAllowed ? targetIdleTilt : 0;
    const pattingActive =
      !isDragging &&
      !isDropping &&
      !compactPreview &&
      (currentMood === 'pat' ||
        (hoverOnHead &&
          currentMood !== 'sleep' &&
          currentMood !== 'dizzy' &&
          currentMood !== 'scared' &&
          currentMood !== 'bonk'));

    // 帧率守门：活跃动画与过渡期间全速 60 FPS，仅真正静止/稳态睡眠回落节流
    const blinkEdgeChanged = isBlinking !== lastDrawnBlink;
    const gazeTrackingActive = Math.abs(targetIdleTilt) > 0.002 || hoverPointerLocal !== null;
    const bonkFxActive = now < bonkHitstopUntil || bonkShakeAmp > 0.04 || bonkShockwave.active;
    const springsSettled =
      squashSpring.isSettled(0.006, 0.04) &&
      headShearSpring.isSettled(0.2, 1.0) &&
      tailSwaySpring.isSettled(0.2, 1.0) &&
      facingSpring.isSettled(0.02, 0.1) &&
      scootSpring.isSettled(0.4, 2.0) &&
      tiltSpring.isSettled(0.002, 0.02) &&
      !postureBridge.active &&
      !spriteBlender.active &&
      !spriteSwapPending &&
      !bonkFxActive &&
      turnHopRemaining <= 0 &&
      blinkNodAmt < 0.05 &&
      Math.abs(sway) < 0.2 &&
      Math.abs(1 - bubblePop) < 0.02 &&
      Math.abs(idleTilt - effectiveTargetTilt) < 0.002;
    const activeInteractiveMood =
      currentMood === 'pat' ||
      currentMood === 'poke' ||
      currentMood === 'happy' ||
      currentMood === 'eat' ||
      currentMood === 'coffee' ||
      currentMood === 'angry' ||
      currentMood === 'spin' ||
      currentMood === 'shock' ||
      currentMood === 'caught' ||
      currentMood === 'scared' ||
      currentMood === 'cry' ||
      currentMood === 'overheat' ||
      currentMood === 'dizzy' ||
      currentMood === 'bonk' ||
      currentMood === 'music';

    let minFrameGapMs = 15;
    if (
      isDragging ||
      isDropping ||
      hasActiveDrops() ||
      hasActiveDebris() ||
      bowlFlyT >= 0 ||
      isScooting() ||
      bugHuntPhase !== 'none' ||
      bonkFxActive ||
      pattingActive ||
      spriteBlender.active ||
      spriteSwapPending ||
      !springsSettled ||
      activeInteractiveMood ||
      gazeTrackingActive ||
      currentMood === 'work' ||
      currentMood === 'drowsy' ||
      locoDir !== 0 ||
      (currentMood === 'slack' && (slackVariant === 'music' || slackVariant === 'bubble')) ||
      (currentMood === 'idle' && particles.length > 0)
    ) {
      minFrameGapMs = 15;
    } else if (currentMood === 'sleep' || currentMood === 'tired') {
      minFrameGapMs = 32;
    } else if (currentMood === 'idle' || currentMood === 'slack') {
      minFrameGapMs = 40;
    }
    if (!forceDraw && !blinkEdgeChanged && now - lastDrawTs < minFrameGapMs) {
      lastTelemetry.nowMs = now;
      lastTelemetry.frameDrawn = false;
      return;
    }

    // dtWall：墙钟间隔（后台节流时 rAF 可能很稀疏），空投/碗塔按子步积分；弹簧按 1/60s 子步积分保证低帧率下仍丝滑不跳变
    const dtWall = Math.min(0.5, Math.max(0.001, (now - prevTs) / 1000));
    const dtReal = Math.min(0.05, dtWall);
    const inHitstop = now < bonkHitstopUntil;
    const dtPhys = inHitstop ? 0 : dtReal;
    const dtWallPhys = inHitstop ? 0 : dtWall;
    const springSubSteps = dtPhys > 0.02 ? Math.max(1, Math.ceil(dtPhys / (1 / 60))) : 1;
    const springDt = dtPhys / springSubSteps;
    prevTs = now;
    lastDrawTs = now;
    lastDrawnBlink = isBlinking;
    if (boostUntil > 0 && now >= boostUntil) boostUntil = 0;
    const timeScale = boostUntil > now ? 1.38 : 1;
    const dt = dtPhys * timeScale;
    animElapsed += dt;
    const elapsed = animElapsed;

    if (bubbleText && bubbleUntil > 0 && now >= bubbleUntil) {
      bubbleText = '';
      bubbleUntil = 0;
    }
    bubblePop += (1 - bubblePop) * Math.min(1, dtReal * 16);
    blinkNodAmt *= Math.exp(-16 * dtPhys);
    turnHopRemaining = Math.max(0, turnHopRemaining - dtPhys);

    // 命中阻尼微震 & 冲击波推进（在 Hitstop 冻结期间仍微震与爆发，拳拳到肉）
    let bonkShakeX = 0;
    let bonkShakeY = 0;
    if (bonkShakeAmp > 0.04) {
      bonkShakeElapsed += dtReal;
      const decay = Math.exp(-bonkShakeElapsed * 11);
      if (bonkShakeAmp * decay <= 0.04) {
        bonkShakeAmp = 0;
      } else {
        bonkShakeX = bonkShakeAmp * decay * Math.sin(bonkShakeElapsed * 38);
        bonkShakeY = bonkShakeAmp * 0.42 * decay * Math.cos(bonkShakeElapsed * 42);
      }
    }
    if (bonkShockwave.active) {
      bonkShockwave.elapsed += dtReal;
      if (bonkShockwave.elapsed >= bonkShockwave.duration) {
        bonkShockwave.active = false;
      }
    }

    // Horizontal sway + gaze tilt + pointer smoothing
    if (!inHitstop) {
      swayVel += (-72 * sway - 7.2 * swayVel) * dtPhys;
      sway = Math.max(-14, Math.min(14, sway + swayVel * dtPhys));
      idleTilt += (effectiveTargetTilt - idleTilt) * Math.min(1, dtPhys * 11);
    }
    if (hoverPointerLocal) {
      if (smoothedHoverX === null || smoothedHoverY === null) {
        smoothedHoverX = hoverPointerLocal.x;
        smoothedHoverY = hoverPointerLocal.y;
      } else {
        const followAlpha = Math.min(1, dtReal * 11);
        smoothedHoverX += (hoverPointerLocal.x - smoothedHoverX) * followAlpha;
        smoothedHoverY += (hoverPointerLocal.y - smoothedHoverY) * followAlpha;
      }
    } else {
      smoothedHoverX = null;
      smoothedHoverY = null;
    }

    // Collar drag pendulum & gravity drop physics
    if (isDragging) {
      dropOffsetY += (-GRAVITY_DROP_HEIGHT_PX - dropOffsetY) * Math.min(1, dtReal * 20);
      dangleVel += (-95 * dangleAngle - 5.2 * dangleVel) * dtReal;
      dangleAngle += dangleVel * dtReal;
      if (dangleAngle > MAX_DANGLE_RAD) {
        dangleAngle = MAX_DANGLE_RAD;
        dangleVel *= -0.35;
      } else if (dangleAngle < -MAX_DANGLE_RAD) {
        dangleAngle = -MAX_DANGLE_RAD;
        dangleVel *= -0.35;
      }
    } else if (isDropping) {
      dropVelY += 1550 * dtReal;
      dropOffsetY += dropVelY * dtReal;
      dangleAngle *= Math.exp(-11 * dtReal);
      dangleVel *= Math.exp(-11 * dtReal);
      if (dropOffsetY >= 0) {
        dropOffsetY = 0;
        dropVelY = 0;
        isDropping = false;
        dangleAngle = 0;
        dangleVel = 0;
        const wasDizzy = shakeDetector.consumeDizzy();
        const cxLand = (canvas.clientWidth || 200) * 0.5 + scootX;
        const footLandY = (canvas.clientHeight || 234) - ((canvas.clientWidth || 256) < 150 ? 5 : 9);
        pushParticle(particles, 'dust', cxLand - 14, footLandY - 2, -26, -8, 0.44, 6.2, '#f8fafc');
        pushParticle(particles, 'dust', cxLand + 14, footLandY - 2, 26, -8, 0.44, 6.2, '#f8fafc');
        if (wasDizzy) {
          playSfx('dizzy');
          setMood('dizzy', FUN_LINES.dizzy, DIZZY_DURATION_MS);
        } else {
          squashSpring.impulse(1.8);
          currentMood = baseMood;
          moodRevertAt = 0;
          playSfx('land');
          const landY = (canvas.clientHeight || 180) * 0.65;
          for (let i = 0; i < 6; i++) spawnParticle(particles, 'happy', cxLand, landY, 82);
        }
      }
    }

    const cw = Math.max(64, canvas.clientWidth || canvas.width || 256);
    const ch = Math.max(64, canvas.clientHeight || canvas.height || 234);
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const targetW = Math.round(cw * dpr);
    const targetH = Math.round(ch * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const compact = cw < 150;
    const footY = ch - (compact ? 5 : 9);

    // 直接 setMood('bonk') 的命中瞬间也触发 Hitstop + 冲击波 + 微震
    if (currentMood === 'bonk' && bugHuntPhase === 'none' && !bonkDirectSlammed) {
      const directSlamAt = bonkStartedAt + BONK_WINDUP_MS + (getCharSprite('bonk_mid') ? BONK_MID_MS : 0);
      if (now >= directSlamAt) {
        bonkDirectSlammed = true;
        triggerBonkImpact(now, cw, footY, false);
      }
    }

    // 空投物品、碗塔碎片、二阶弹簧驱动的小碎步横移（Hitstop 冻结期间暂停）
    if (dtWallPhys > 0) {
      const subSteps = Math.max(1, Math.ceil(dtWallPhys / 0.025));
      const subDt = dtWallPhys / subSteps;
      for (let i = 0; i < subSteps; i++) {
        updateDrops(subDt, now, cw, ch, footY);
        updateDebris(subDt, footY);
        if (now < bonkHitstopUntil) break;
      }
    }
    if (isDragging) {
      scootSpring.snap(scootX);
    } else if (!inHitstop) {
      for (let s = 0; s < springSubSteps; s++) {
        scootX = scootSpring.update(springDt, scootTarget);
      }
      if (
        isScooting() &&
        (isBaseLikeMood(currentMood) ||
          hasCatchableFalling() ||
          bugHuntPhase === 'approach' ||
          currentMood === 'eat' ||
          currentMood === 'coffee')
      ) {
        const diff = scootTarget - scootX;
        if (Math.abs(diff) > 2.5) facing = diff >= 0 ? 1 : -1;
      }
    }

    const walkingVisual = isWalkingVisual();

    // BongoCat 节拍（按档位平顺拍打，4 帧 work_a..d 循环）
    if ((currentMood === 'work' || currentMood === 'overheat') && !walkingVisual) {
      const hz =
        fakeTypingUntil > 0
          ? FAKE_TYPING_HZ
          : currentMood === 'overheat'
            ? TIER_BEAT_HZ[3]
            : moodRevertAt > 0
              ? TIER_BEAT_HZ[0]
              : TIER_BEAT_HZ[rateTier];
      workBeatAge += dt;
      beatPhase += dt * hz;
      if (beatPhase >= 1) {
        beatPhase -= Math.floor(beatPhase);
        workFrameIdx = (workFrameIdx + 1) % 4;
        workFrameA = workFrameIdx % 2 === 0;
        workBeatAge = 0;
        lastWorkFrame = workFrameIdx;
        if (now - lastBeatSfxAt >= 110) {
          lastBeatSfxAt = now;
          playSfx('typeKey');
        }
        if (
          currentMood === 'work' &&
          moodRevertAt === 0 &&
          rateTier === 1 &&
          rateTps > 0 &&
          cwPreview >= 150
        ) {
          const gain = rateTps / TIER_BEAT_HZ[1];
          pushParticle(
            particles,
            'code',
            lastLayout.centerX + (Math.random() - 0.3) * lastLayout.baseW * 0.5,
            lastLayout.topY + lastLayout.totalH * 0.62,
            (Math.random() - 0.5) * 14,
            -(26 + Math.random() * 10),
            1.1,
            10,
            '#16a34a',
            `+${formatTok(gain)} tok`,
          );
        }
      }
    } else {
      beatPhase = 0;
      lastWorkFrame = -1;
    }

    const centerX = cw * 0.5 + scootX;

    // 双档 PostureBridge：区分 energetic（接掉落/打虫/受惊）与 gentle（入睡/睡醒/听歌/摸鱼/吃完回待机）
    const effectivePosture: PostureFamily =
      isDragging || isDropping
        ? 'air'
        : walkingVisual
          ? 'stand'
          : moodToPosture(currentMood);
    const postureStyle: PostureTransitionStyle =
      bugHuntPhase !== 'none' ||
      currentMood === 'bonk' ||
      currentMood === 'scared' ||
      currentMood === 'shock' ||
      currentMood === 'caught' ||
      currentMood === 'angry' ||
      currentMood === 'poke' ||
      currentMood === 'spin' ||
      currentMood === 'cry' ||
      hasCatchableFalling() ||
      now - lastCatchAt < 260 ||
      (postureBridge.currentPosture === 'air' && currentMood !== 'dizzy' && effectivePosture === 'stand')
        ? 'energetic'
        : 'gentle';
    postureBridge.sync(effectivePosture, null, false, postureStyle);
    const bridgeFrame = postureBridge.step(dtPhys * 1000);
    if (bridgeFrame.justLanded) {
      squashSpring.impulse(bridgeFrame.style === 'energetic' ? 1.5 : 0.28);
    }

    // 2.5D 转身方向（扒边探头：左边缘朝右进屏 +1，右边缘水平镜像朝左 -1）
    let desiredFlipSign: 1 | -1 = 1;
    if (peeking && locoDir !== 0 && walkingVisual) {
      desiredFlipSign = locoDir === -1 ? 1 : -1;
    } else if (walkingVisual) {
      desiredFlipSign = locoDir !== 0 ? locoDir : facing;
    } else if (currentMood === 'bonk' && bugHuntPhase !== 'none') {
      desiredFlipSign = bugHuntDir;
    }
    if (desiredFlipSign !== prevFlipSign) {
      prevFlipSign = desiredFlipSign;
      if (!suppressNextTurnHop && walkingVisual) {
        turnHopRemaining = 0.24;
      }
    }
    if (suppressNextTurnHop && bugHuntPhase === 'none' && !isScooting()) {
      suppressNextTurnHop = false;
    }
    if (!inHitstop) {
      for (let s = 0; s < springSubSteps; s++) {
        facingSpring.update(springDt, desiredFlipSign);
      }
    }
    const turnHopY = turnHopRemaining > 0 ? -3.0 * Math.sin((turnHopRemaining / 0.24) * Math.PI) : 0;

    // 步频时钟（真实位移速率驱动 4 帧步态，斜行挪步直接使用 scootSpring 真实速度）
    let realWalkSpeedPx = 0;
    if (!walkingVisual) {
      strideClock.reset();
    } else if (!(peeking && locoDir !== 0)) {
      if (bugHuntPhase === 'approach' || isScooting()) {
        realWalkSpeedPx = Math.abs(scootSpring.yd);
      } else if (locoDir !== 0) {
        realWalkSpeedPx = WALK_SPEED_PX * timeScale * locoSpeedRatio;
      }
    }
    const strideOut = strideClock.update(dt, realWalkSpeedPx, desiredFlipSign);
    currentStrideFrameA = strideOut.frameA;
    currentStrideFrameIndex = strideOut.frameIndex;
    if (strideOut.justStepped && realWalkSpeedPx > 14 && !compact) {
      pushParticle(
        particles,
        'dust',
        centerX - desiredFlipSign * 9,
        footY - 2,
        -desiredFlipSign * 16,
        -6,
        0.36,
        4.2,
        '#f8fafc',
      );
    }

    const picked = chooseActiveSprite(elapsed, bridgeFrame.useCrouch, bridgeFrame.useSitTrans, now);
    const prevBlendKey = spriteBlender.key;
    const minSpriteHoldMs =
      picked.kind === 'instant' ||
      picked.kind === 'smear' ||
      currentMood === 'dangle' ||
      currentMood === 'scared' ||
      isDragging ||
      isDropping
        ? 0
        : SPRITE_MIN_HOLD_MS;
    const spriteSwapped = spriteBlender.sync(picked.img, picked.key, picked.kind, minSpriteHoldMs);
    const blendStepMs =
      prevBlendKey !== '' && spriteSwapped
        ? Math.min(dtReal * 1000, 1000 / 60)
        : dtReal * 1000;
    const blendFrame = spriteBlender.step(blendStepMs);
    const activeImg = blendFrame.toSprite ?? picked.img;
    const activeSpriteKey = blendFrame.key || picked.key;
    spriteSwapPending = picked.img !== null && picked.key !== activeSpriteKey;

    // 统一比例锁：以基础立绘高度为基准，保持全员站/蹲/坐/趴头身比例恒定
    const maxPetW = cw * (compact ? 0.88 : 0.84);
    const maxPetH = ch * (compact ? 0.84 : 0.74);
    const refH = sprites[currentChar]?.naturalHeight || 712;
    const imgW = activeImg ? activeImg.naturalWidth : 240;
    const imgH = activeImg ? activeImg.naturalHeight : 280;
    const fitScale = Math.min(maxPetW / imgW, maxPetH / refH);
    const baseW = imgW * fitScale;
    const baseH = imgH * fitScale;

    // 二阶弹簧驱动果冻挤压、呆毛剪切与裙摆摇曳（所有姿态挤压形变均入弹簧滤波）
    const crouchTarget = bridgeFrame.useCrouch
      ? getCharSprite('crouch')
        ? 0.04
        : 0.12
      : bridgeFrame.softSquash;
    const inBonkWindup =
      bugHuntPhase === 'windup' ||
      (bugHuntPhase === 'none' && now - bonkStartedAt < BONK_WINDUP_MS);
    const inBonkMid =
      bugHuntPhase === 'midswing' ||
      (bugHuntPhase === 'none' &&
        Boolean(getCharSprite('bonk_mid')) &&
        now - bonkStartedAt >= BONK_WINDUP_MS &&
        now - bonkStartedAt < BONK_WINDUP_MS + BONK_MID_MS);
    const bonkTarget = currentMood === 'bonk' ? (inBonkWindup ? -0.08 : inBonkMid ? 0.02 : 0.11) : 0;
    const wakeTarget = currentMood === 'drowsy' && drowsyWakeStretch ? -0.07 : 0;
    const targetSquash = crouchTarget + bonkTarget + wakeTarget;
    if (!inHitstop) {
      for (let s = 0; s < springSubSteps; s++) {
        squashSpring.update(springDt, targetSquash);
      }
    }
    const effectiveSquash = Math.max(-0.22, Math.min(0.32, squashSpring.y));

    const patNuzzleX =
      pattingActive && smoothedHoverX !== null
        ? Math.max(-8, Math.min(8, (smoothedHoverX - centerX) * 0.25))
        : 0;
    const patNuzzleTilt =
      pattingActive && smoothedHoverX !== null
        ? Math.max(-0.095, Math.min(0.095, ((smoothedHoverX - centerX) / Math.max(40, baseW * 0.45)) * 0.08))
        : 0;
    const gazeShearTarget = gazeAllowed ? mouseLookNormX * 3.5 : 0;
    const walkLagTarget =
      walkingVisual && !(peeking && locoDir !== 0) ? -desiredFlipSign * Math.min(6, realWalkSpeedPx * 0.08) : 0;
    const isMusicMode = currentMood === 'music' || (currentMood === 'slack' && slackVariant === 'music');
    const musicTime = isMusicMode ? Math.max(0, elapsed - musicPhaseStart) : 0;
    // 与 4 帧听歌序列（a 左歪 -> b 正点头 -> c 右歪 -> d 正摇摆）相位精准同频
    const musicBeatSin = isMusicMode
      ? -Math.cos((musicTime * MUSIC_BEAT_HZ - 0.5) * Math.PI * 0.5)
      : 0;
    const idleMicroShear = idleVariantActive && currentMood === 'idle' ? idleVariantDir * 1.4 : 0;
    const idleMicroTail = idleVariantActive && currentMood === 'idle' ? -idleVariantDir * 1.8 : 0;

    const headTarget = gazeShearTarget + walkLagTarget + patNuzzleX + musicBeatSin * 2.8 + idleMicroShear;
    const tailTarget = -walkLagTarget * 0.9 - musicBeatSin * 3.4 + idleMicroTail;
    if (!inHitstop) {
      for (let s = 0; s < springSubSteps; s++) {
        headShearSpring.update(springDt, headTarget);
        tailSwaySpring.update(springDt, tailTarget);
      }
    }

    const breathSpeed =
      currentMood === 'sleep' || currentMood === 'tired' || currentMood === 'drowsy'
        ? 1.25
        : currentMood === 'spin'
          ? 3.8
          : 1.85;
    const breathRaw = organicBreath(elapsed * breathSpeed);
    const breathAmp =
      currentMood === 'sleep' || currentMood === 'tired'
        ? 0.032
        : currentMood === 'dangle'
          ? 0.01
          : 0.018;
    const { scaleX: vpScaleX, scaleY } = volumePreservingScale(
      effectiveSquash,
      breathRaw * breathAmp,
    );
    const totalH = baseH * scaleY;

    let hopY = 0;
    if (walkingVisual && !(peeking && locoDir !== 0)) hopY = strideOut.hopY;
    else if (currentMood === 'eat') hopY = -0.5 * (1 - Math.cos(elapsed * 7.6)) * 3.2;
    else if (currentMood === 'happy' || currentMood === 'coffee')
      hopY = -0.5 * (1 - Math.cos(elapsed * 5.4)) * 3.6;
    else if (isMusicMode) hopY = -0.5 * (1 - Math.cos(musicTime * MUSIC_BEAT_HZ * Math.PI * 2)) * 2.2;
    else if (currentMood === 'spin') hopY = -0.5 * (1 - Math.cos(elapsed * 9.5)) * 2.4;
    else if (currentMood === 'shock' || currentMood === 'caught')
      hopY = -0.5 * (1 - Math.cos(elapsed * 8.5)) * (currentMood === 'caught' ? 2.6 : 4.2);
    else if (currentMood === 'work' || currentMood === 'overheat')
      hopY = -(rateTier >= 3 ? 2.2 : 1.5) * Math.exp(-workBeatAge * 14);
    else if (currentMood === 'drowsy' && !drowsyWakeStretch && !getCharSprite('drowsy')) {
      const dAge = Math.max(0, now - drowsyEnteredAt);
      if (dAge >= 2800 && dAge < 3350) hopY = -3.2 * Math.sin(((dAge - 2800) / 550) * Math.PI);
    }

    const totalHopY = hopY + bridgeFrame.hopOffsetY + turnHopY + bonkShakeY;
    const visualFootY = footY + totalHopY + dropOffsetY;
    const topY = visualFootY - totalH;

    // 1. Breathing & lift-reactive ground shadow oval
    const airFactor = Math.max(0, Math.min(1, -dropOffsetY / GRAVITY_DROP_HEIGHT_PX));
    const shadowRx = baseW * 0.34 * (1 + effectiveSquash * 0.65 + breathRaw * 0.03) * (1 - airFactor * 0.28);
    const shadowRy = Math.max(3.5, baseH * 0.048) * (1 - airFactor * 0.22);
    const shadowAlpha = 0.2 * (1 - airFactor * 0.45);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centerX, footY - 1, shadowRx, shadowRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(15, 23, 42, ${shadowAlpha.toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    const baseWorking = currentMood === 'work' && moodRevertAt === 0;
    const isFieryOverheat = currentMood === 'overheat' || (baseWorking && rateTier >= 3 && !walkingVisual);
    if (isFieryOverheat && !compact) {
      drawOverheatGlow(ctx, centerX, topY + totalH * 0.56, baseW * 0.44, totalH * 0.42, elapsed);
    }

    // 2. Render pet sprite with equal-power SpriteBlender crossfade & seamless slices
    const useSlices =
      effectivePosture !== 'lie' && effectivePosture !== 'air' && !isDragging && !isDropping;
    const tintRgb =
      currentMood === 'angry'
        ? '244, 63, 94'
        : isFieryOverheat && !getCharSprite('overheat')
          ? '239, 68, 68'
          : null;
    const useOffscreen = tintRgb !== null && spriteCtx !== null;
    const drawTarget: CanvasRenderingContext2D = useOffscreen && spriteCtx ? spriteCtx : ctx;
    if (useOffscreen && spriteCtx) {
      if (spriteCanvas.width !== targetW || spriteCanvas.height !== targetH) {
        spriteCanvas.width = targetW;
        spriteCanvas.height = targetH;
      }
      spriteCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spriteCtx.clearRect(0, 0, cw, ch);
    }

    const idleSway = Math.sin(elapsed * 1.35) * (compact ? 1.5 : 2.3);
    let spriteShiftX = bonkShakeX;

    // 2.5D 平滑水平翻转尺度（仅走路/探头/重锤或过渡期间离开 +1）
    const flipScaleRaw = facingSpring.y;
    const flipScale =
      Math.abs(flipScaleRaw) < 0.03 ? (flipScaleRaw >= 0 ? 0.03 : -0.03) : Math.max(-1.12, Math.min(1.12, flipScaleRaw));
    const flipSign = flipScale >= 0 ? 1 : -1;

    const sleepSpriteRef = getCharSprite('sleep');
    const tiredSpriteRef = getCharSprite('tired');
    const dangleSpriteRef = getCharSprite('dangle');

    let targetTilt = 0;
    let shiftX = bonkShakeX;
    if (useSlices) {
      targetTilt = idleTilt + patNuzzleTilt;
      if (walkingVisual) {
        targetTilt += peeking && locoDir !== 0 ? desiredFlipSign * 0.11 : strideOut.leanRad;
      } else if (currentMood === 'pat') {
        targetTilt += Math.sin(elapsed * 3.6) * 0.048;
      } else if (currentMood === 'poke') {
        targetTilt += sway * 0.008;
      } else if (isMusicMode) {
        targetTilt += musicBeatSin * 0.048;
      } else if (currentMood === 'drowsy' && !drowsyWakeStretch) {
        const dAge = Math.max(0, now - drowsyEnteredAt);
        if (!getCharSprite('drowsy') && dAge >= 2800 && dAge < 3350) {
          targetTilt -= 0.04;
        } else {
          targetTilt += Math.sin(elapsed * 1.6) * 0.042 + 0.02;
        }
      } else if (currentMood === 'dizzy') {
        targetTilt += Math.sin(elapsed * 3.8) * 0.07;
        shiftX += Math.sin(elapsed * 3.2) * 2.0;
      } else if (currentMood === 'bonk') {
        targetTilt += inBonkWindup ? -bugHuntDir * 0.08 : inBonkMid ? bugHuntDir * 0.02 : bugHuntDir * 0.1;
      } else if (currentMood === 'work' || currentMood === 'overheat') {
        const isFallback = !getCharSprite('work_a') && !getCharSprite('work_b');
        if (isFallback) targetTilt += workFrameA ? -0.045 : 0.045;
        if (isFieryOverheat) {
          shiftX += Math.sin(elapsed * 18) * 1.0;
        }
      } else if (currentMood === 'spin') {
        targetTilt += Math.sin(elapsed * 8.5) * 0.09;
        shiftX += Math.sin(elapsed * 11) * 1.6;
      } else if (currentMood === 'shock' || currentMood === 'caught') {
        shiftX += Math.sin(elapsed * 17) * 1.4;
      } else if (currentMood === 'scared') {
        shiftX += Math.sin(elapsed * 19) * 1.6;
      } else if (currentMood === 'cry') {
        shiftX += Math.sin(elapsed * 13) * 1.0;
      } else if (currentMood === 'slack') {
        targetTilt += Math.sin(elapsed * 1.3) * 0.022;
      } else if (currentMood === 'idle' && idleVariantActive) {
        targetTilt += idleVariantDir * 0.028;
      }
      spriteShiftX = shiftX;
    }
    let totalTilt = tiltSpring.y;
    const tiltTarget = useSlices ? targetTilt : 0;
    if (!inHitstop) {
      for (let s = 0; s < springSubSteps; s++) {
        totalTilt = tiltSpring.update(springDt, tiltTarget);
      }
    }

    const renderSingleSprite = (
      targetCtx: CanvasRenderingContext2D,
      img: HTMLImageElement,
      spriteKey: string,
      alpha: number,
      passFlipSign: 1 | -1 = flipSign,
      parentBlended = false,
    ): void => {
      if (alpha <= 0.005) return;
      const iImgW = img.naturalWidth || 240;
      const iImgH = img.naturalHeight || 280;
      const iFit = Math.min(maxPetW / iImgW, maxPetH / refH);
      const iBaseW = iImgW * iFit;
      const iBaseH = iImgH * iFit;
      const iTotalH = iBaseH * scaleY;
      const iTopY = visualFootY - iTotalH;
      const anchorX = getSpriteAnchorX(spriteKey);
      const isWholePoseSprite =
        !useSlices || img === sleepSpriteRef || img === tiredSpriteRef || img === dangleSpriteRef;

      targetCtx.save();
      if (alpha < 0.999) {
        targetCtx.globalAlpha *= alpha;
      }

      if (!isWholePoseSprite) {
        const allowIdleSway = currentMood === 'idle' || currentMood === 'slack' || currentMood === 'angry';
        const isBlended = parentBlended || alpha < 0.999;
        for (let i = 0; i < SLICE_COUNT; i++) {
          const t0 = i / SLICE_COUNT;
          const t1 = (i + 1) / SLICE_COUNT;
          const tMid = (i + 0.5) / SLICE_COUNT;

          const belly = Math.sin(tMid * Math.PI) * breathRaw * 0.022;
          const eatMod = currentMood === 'eat' ? Math.sin(elapsed * 7.6) * 0.014 : 0;
          const patMod = currentMood === 'pat' ? Math.sin(elapsed * 3.6) * 0.009 : 0;
          const sliceScaleX = Math.max(0.76, Math.min(1.34, vpScaleX + belly + eatMod + patMod));
          const dw = iBaseW * sliceScaleX;

          const headWeight = Math.pow(Math.max(0, 1 - tMid * 1.45), 1.5);
          const hemWeight = Math.sin(tMid * Math.PI) * 0.52 + Math.max(0, tMid - 0.35) * 0.7;
          const ambientHem =
            Math.sin(elapsed * 2.1 - tMid * 3.0) * (1.0 + Math.abs(sway) * 0.12) * (0.28 + tMid * 0.72);
          const moodJitter = currentMood === 'angry' ? Math.sin(elapsed * 18) * 1.2 : 0;
          const baseIdleOffset = allowIdleSway ? (idleSway + sway) * headWeight : sway * 0.3 * headWeight;

          const worldOffset =
            headShearSpring.y * headWeight +
            tailSwaySpring.y * hemWeight +
            baseIdleOffset +
            ambientHem +
            moodJitter;
          // 锚点位于 centerX + shiftX，drawFlippedPass 绕 centerX + shiftX 做水平缩放时身体重心自动精确锁死零跳变
          const dx = centerX + shiftX - dw * anchorX + worldOffset * passFlipSign;

          if (isBlended) {
            const sy0 = Math.round(t0 * iImgH);
            const sy1 = Math.round(t1 * iImgH);
            const sh = Math.max(1, sy1 - sy0);
            const dip0 = blinkNodAmt * Math.max(0, 1 - t0 / 0.43) * 2.2;
            const dip1 = blinkNodAmt * Math.max(0, 1 - t1 / 0.43) * 2.2;
            const dy0 = Math.round((iTopY + t0 * iTotalH + dip0) * dpr) / dpr;
            const dy1 = Math.round((iTopY + t1 * iTotalH + dip1) * dpr) / dpr;
            const dh = Math.max(1 / dpr, dy1 - dy0);
            targetCtx.drawImage(img, 0, sy0, iImgW, sh, dx, dy0, dw, dh);
          } else {
            const sy = t0 * iImgH;
            const sh = Math.max(0.5, Math.min(iImgH - sy, iImgH / SLICE_COUNT + 0.85));
            const blinkDip = i < 6 ? blinkNodAmt * (1 - tMid * 1.6) * 2.2 : 0;
            const dy = iTopY + t0 * iTotalH + blinkDip;
            const dh = iTotalH / SLICE_COUNT + 0.75;
            targetCtx.drawImage(img, 0, sy, iImgW, sh, dx, dy, dw, dh);
          }
        }
      } else {
        let scaleXMod = vpScaleX;
        if (currentMood === 'dangle' || isDragging || isDropping) {
          const anchorY = iTopY + iTotalH * 0.12;
          targetCtx.translate(centerX, anchorY);
          targetCtx.rotate(dangleAngle);
          targetCtx.translate(-centerX, -anchorY);
        } else {
          scaleXMod -= breathRaw * 0.016;
          if (currentMood === 'tired' && !getCharSprite('tired')) scaleXMod += 0.05;
        }
        const dw = iBaseW * Math.max(0.74, Math.min(1.36, scaleXMod));
        const dx = centerX + shiftX - dw * anchorX;
        targetCtx.drawImage(img, dx, iTopY, dw, iTotalH);
      }

      targetCtx.restore();
    };

    if (useSlices) {
      drawTarget.save();
      if (totalTilt !== 0) {
        drawTarget.translate(centerX + shiftX, visualFootY);
        drawTarget.rotate(totalTilt);
        drawTarget.translate(-(centerX + shiftX), -visualFootY);
      }

      if (blendFrame.toSprite) {
        const toSprite = blendFrame.toSprite;
        const drawFlippedPass = (passFlipScale: number, passAlpha: number): void => {
          if (passAlpha <= 0.008) return;
          const passSign: 1 | -1 = passFlipScale >= 0 ? 1 : -1;
          const passBlended = passAlpha < 0.999;
          drawTarget.save();
          if (passBlended) {
            drawTarget.globalAlpha *= passAlpha;
          }
          if (Math.abs(passFlipScale - 1) > 0.002) {
            drawTarget.translate(centerX + shiftX, 0);
            drawTarget.scale(passFlipScale, 1);
            drawTarget.translate(-(centerX + shiftX), 0);
          }

          // 红温残影拖尾（最多 2 层）
          if (isFieryOverheat) {
            const ghostSuffix: ActionSpriteSuffix =
              getCharSprite('overheat') && getCharSprite('overheat_b')
                ? workFrameIdx % 2 === 0
                  ? 'overheat_b'
                  : 'overheat'
                : workFrameA
                  ? 'work_b'
                  : 'work_a';
            const ghostImg = getCharSprite(ghostSuffix);
            const ghost = ghostImg ?? toSprite;
            const ghostAnchorX = getSpriteAnchorX(ghostImg ? `${currentChar}_${ghostSuffix}` : activeSpriteKey);
            const prevAlpha = drawTarget.globalAlpha;
            const gdw = baseW * vpScaleX;
            const gdx = centerX + shiftX - gdw * ghostAnchorX;
            drawTarget.globalAlpha = prevAlpha * 0.24;
            drawTarget.drawImage(ghost, gdx - 3.5, topY + 1, gdw, totalH);
            drawTarget.globalAlpha = prevAlpha * 0.11;
            drawTarget.drawImage(ghost, gdx + 4.5, topY + 2, gdw, totalH);
            drawTarget.globalAlpha = prevAlpha;
          }

          if (blendFrame.active && blendFrame.fromSprite && blendFrame.alphaFrom > 0.005) {
            renderSingleSprite(
              drawTarget,
              blendFrame.fromSprite,
              blendFrame.fromKey || activeSpriteKey,
              blendFrame.alphaFrom,
              passSign,
              passBlended,
            );
          }
          renderSingleSprite(drawTarget, toSprite, activeSpriteKey, blendFrame.alphaTo, passSign, passBlended);
          drawTarget.restore();
        };

        // 2.5D 转身跨中区保持 >= 0.58 体宽并做等功率镜像交叉淡化，彻底消灭纸片人帧
        const TURN_CROSS_LIMIT = 0.58;
        if (Math.abs(flipScaleRaw) >= TURN_CROSS_LIMIT) {
          drawFlippedPass(flipScale, 1);
        } else {
          const uTurn = Math.max(0, Math.min(1, (flipScaleRaw + TURN_CROSS_LIMIT) / (2 * TURN_CROSS_LIMIT)));
          const angleTurn = uTurn * Math.PI * 0.5;
          drawFlippedPass(TURN_CROSS_LIMIT, Math.sin(angleTurn));
          drawFlippedPass(-TURN_CROSS_LIMIT, Math.cos(angleTurn));
        }
      } else {
        if (Math.abs(flipScale - 1) > 0.002) {
          drawTarget.translate(centerX + shiftX, 0);
          drawTarget.scale(flipScale, 1);
          drawTarget.translate(-(centerX + shiftX), 0);
        }
        drawFallbackChibi(drawTarget, centerX + shiftX + idleSway, visualFootY, totalH, currentChar, currentMood);
      }
      drawTarget.restore();
    } else if (blendFrame.toSprite) {
      if (blendFrame.active && blendFrame.fromSprite && blendFrame.alphaFrom > 0.005) {
        renderSingleSprite(
          drawTarget,
          blendFrame.fromSprite,
          blendFrame.fromKey || activeSpriteKey,
          blendFrame.alphaFrom,
        );
      }
      renderSingleSprite(drawTarget, blendFrame.toSprite, activeSpriteKey, blendFrame.alphaTo);
    } else {
      drawFallbackChibi(drawTarget, centerX, visualFootY, totalH, currentChar, currentMood);
    }

    if (useOffscreen && spriteCtx && tintRgb) {
      const tintAlpha = (isFieryOverheat ? 0.26 : 0.15) + 0.07 * Math.sin(elapsed * 10);
      spriteCtx.save();
      spriteCtx.globalCompositeOperation = 'source-atop';
      spriteCtx.fillStyle = `rgba(${tintRgb}, ${tintAlpha.toFixed(3)})`;
      spriteCtx.fillRect(0, 0, cw, ch);
      spriteCtx.restore();

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(spriteCanvas, 0, 0);
      ctx.restore();
    }

    bodyBounds = { x: centerX - baseW * 0.48, y: topY, w: baseW * 0.96, h: totalH };
    lastLayout.centerX = centerX;
    lastLayout.topY = topY;
    lastLayout.totalH = totalH;
    lastLayout.baseW = baseW;
    lastLayout.footY = footY;

    // 2b. 键盘彩虹光（全力及以上 + 红温）+ 头顶蒸汽（红温 & 持续 T3）+ 眩晕星环 + 重锤冲击波 + 程序化重锤兜底 + 摸头小手
    if ((baseWorking && rateTier >= 2 && !walkingVisual) || currentMood === 'overheat') {
      const usingWorkSprite = Boolean(
        getCharSprite('work_a') || getCharSprite('work_b') || getCharSprite('overheat'),
      );
      const kbY = usingWorkSprite ? topY + totalH * 0.885 : footY - 6;
      drawKeyboardRainbow(
        ctx,
        centerX + spriteShiftX - baseW * 0.03,
        kbY,
        baseW * 0.5,
        Math.max(4, totalH * 0.05),
        elapsed,
        isFieryOverheat ? 1.25 : 0.9,
      );
    }
    if (isFieryOverheat) {
      drawHeadSteam(
        ctx,
        centerX + spriteShiftX + baseW * 0.14,
        Math.max(14, topY + totalH * 0.06),
        elapsed,
        compact ? 6 : 10,
      );
    }
    if (currentMood === 'cry' && !compact && !getCharSprite('cry')) {
      drawWaterfallTears(ctx, centerX + spriteShiftX, topY + totalH * 0.42, baseW * 0.1, elapsed);
    }
    if (currentMood === 'dizzy' && !compact) {
      drawDizzyOrbit(
        ctx,
        centerX + spriteShiftX,
        Math.max(16, topY + totalH * 0.02),
        Math.max(22, baseW * 0.32),
        elapsed,
      );
    }
    if (bonkShockwave.active && !compact) {
      drawBonkShockwave(
        ctx,
        bonkShockwave.x,
        bonkShockwave.y,
        bonkShockwave.elapsed / bonkShockwave.duration,
        Math.max(32, baseW * 0.34),
        bonkShockwave.dir,
      );
    }
    if (currentMood === 'bonk' && !compact && !getCharSprite('bonk_a') && !getCharSprite('bonk_b')) {
      const hRot = inBonkWindup ? -bugHuntDir * 0.45 : inBonkMid ? bugHuntDir * 0.35 : bugHuntDir * 1.22;
      drawToyHammer(
        ctx,
        centerX + bugHuntDir * baseW * 0.26,
        topY + totalH * 0.54,
        Math.max(20, totalH * 0.26),
        hRot,
      );
    }
    if (pattingActive) {
      const handX =
        smoothedHoverX !== null
          ? Math.max(22, Math.min(cw - 22, smoothedHoverX))
          : centerX + Math.sin(elapsed * 4.0) * 10;
      const handY =
        smoothedHoverY !== null
          ? Math.max(18, Math.min(topY + totalH * 0.24, smoothedHoverY))
          : topY + totalH * 0.1;
      drawPattingHand(ctx, handX, handY, elapsed * 4.4, compact ? 0.7 : 0.92);
    }

    // 3. Mood head badges & particle emitter
    if (currentMood === 'angry') {
      drawAngryVein(ctx, centerX + baseW * 0.26, topY + totalH * 0.18, compact ? 0.72 : 0.95);
    } else if (currentMood === 'shock' || currentMood === 'caught') {
      drawShockMarks(ctx, centerX, Math.max(18, topY - 2), Math.abs(Math.sin(elapsed * 14)) * 5);
    }

    // 3b. 脚边青花碗塔（越高越晃）
    towerBounds = null;
    if (!compact) {
      const shown = Math.min(MAX_TOWER_DRAW, towerCount);
      const bowlW = 28;
      const step = 7.4;
      const towerX = cw - 24;
      towerPopAge += dtReal;
      if (shown > 0) {
        const wobble = Math.sin(elapsed * 2.3) * 0.0021 * Math.pow(shown, 1.5);
        ctx.save();
        ctx.translate(towerX, footY);
        ctx.rotate(wobble);
        for (let i = 0; i < shown; i++) {
          const jitter = Math.sin(elapsed * 3.1 + i * 0.7) * i * 0.1;
          const pop = i === shown - 1 && towerPopAge < 0.25 ? 1 + 0.3 * (1 - towerPopAge / 0.25) : 1;
          drawBlueWhiteBowl(ctx, jitter, -i * step, bowlW * pop);
        }
        ctx.restore();
        const towerH = shown * step + 6;
        towerBounds = { x: towerX - bowlW * 0.6, y: footY - towerH, w: bowlW * 1.2, h: towerH };
      }

      // 碗塔倒塌碎片
      for (const d of debris) {
        if (!d.active) continue;
        ctx.save();
        ctx.globalAlpha = d.life > 1.3 ? Math.max(0, 1 - (d.life - 1.3) / 0.6) : 1;
        drawBlueWhiteBowl(ctx, d.x, d.y, bowlW, d.rot);
        ctx.restore();
      }

      // 吃完的空碗飞向碗塔
      if (pendingBowlFlies > 0 && bowlFlyT < 0 && currentMood !== 'eat' && !isDragging) {
        pendingBowlFlies--;
        bowlFlyT = 0;
        bowlFlyFromX = centerX;
        bowlFlyFromY = topY + totalH * 0.6;
      }
      if (bowlFlyT >= 0) {
        bowlFlyT += (dtWall * timeScale) / 0.55;
        const u = Math.min(1, bowlFlyT);
        const toY = footY - shown * step;
        const fx = bowlFlyFromX + (towerX - bowlFlyFromX) * u;
        const fy = bowlFlyFromY + (toY - bowlFlyFromY) * u - Math.sin(u * Math.PI) * 46;
        drawBlueWhiteBowl(ctx, fx, fy, bowlW, (1 - u) * 6);
        if (u >= 1) {
          bowlFlyT = -1;
          towerCount++;
          towerPopAge = 0;
          playSfx('click');
          emit({ type: 'bowl-landed' });
        }
      }
    } else if (pendingBowlFlies > 0 && currentMood !== 'eat') {
      pendingBowlFlies--;
      towerCount++;
      emit({ type: 'bowl-landed' });
    }

    // 3c. 空投中的物品
    for (const d of dropSlots) {
      if (!d.active) continue;
      if (d.kind === 'rice') drawBlueWhiteBowl(ctx, d.x, d.y + 6, 26, d.rot, true);
      else if (d.kind === 'coffee') drawIcedCoffee(ctx, d.x, d.y, 22, d.rot);
      else drawBug(ctx, d.x, d.y, 16, d.rot, elapsed);
    }

    // 3d. 粒子发射
    emitTimer += dt;
    let emitInterval =
      currentMood === 'sleep'
        ? 0.62
        : currentMood === 'work'
          ? 0.15
          : currentMood === 'pat'
            ? 0.22
            : currentMood === 'music'
              ? 0.36
              : currentMood === 'dizzy'
                ? 0.32
                : currentMood === 'drowsy'
                  ? 0.72
                  : currentMood === 'bonk'
                    ? 0.22
                    : currentMood === 'dangle'
                      ? 0.24
                      : currentMood === 'cry'
                        ? 0.07
                        : currentMood === 'overheat'
                          ? 0.08
                          : currentMood === 'tired'
                            ? 0.55
                            : 0.16;
    if (currentMood === 'work') {
      if (fakeTypingUntil > 0) emitInterval = 0.6;
      else if (moodRevertAt === 0) emitInterval = rateTier >= 3 ? 0.07 : rateTier === 2 ? 0.18 : Infinity;
    }
    if (currentMood === 'slack') {
      emitInterval =
        slackVariant === 'music'
          ? 0.38
          : slackVariant === 'bubble'
            ? 0.85
            : slackVariant === 'daze'
              ? 2.4
              : Infinity;
    }
    if (currentMood !== 'idle' && emitTimer >= emitInterval && !walkingVisual) {
      emitTimer = 0;
      const headY = topY + totalH * 0.15;
      if (currentMood === 'work' && fakeTypingUntil > 0) {
        spawnParticle(particles, 'caught', centerX, headY, baseW);
      } else if (currentMood === 'work' && moodRevertAt === 0 && rateTier >= 3) {
        fxTimer++;
        if (fxTimer % 2 === 0) {
          pushParticle(particles, 'steam', centerX + (Math.random() - 0.5) * baseW * 0.4, topY + 4, (Math.random() - 0.5) * 18, -(34 + Math.random() * 18), 0.7, 5 + Math.random() * 4, 'rgba(255, 241, 242, 0.92)');
        }
        pushParticle(particles, 'spark', centerX + (Math.random() - 0.5) * baseW * 0.5, topY + totalH * 0.86, (Math.random() - 0.5) * 140, -(60 + Math.random() * 70), 0.45, 3, Math.random() < 0.5 ? '#f97316' : '#facc15');
      } else if (currentMood === 'slack') {
        if (slackVariant === 'music') {
          spawnParticle(particles, 'music', centerX, headY, baseW);
        } else if (slackVariant === 'bubble') {
          pushParticle(particles, 'bubble', centerX + baseW * 0.06, topY + totalH * 0.46, 8 + Math.random() * 10, -(14 + Math.random() * 8), 2.2, 5 + Math.random() * 4, '#38bdf8');
        } else {
          pushParticle(particles, 'note', centerX + baseW * 0.22, topY + 6, 6, -14, 1.6, 13, '#6366f1', Math.random() < 0.6 ? '?' : '…');
        }
      } else {
        spawnParticle(particles, currentMood, centerX, headY, baseW);
      }
    }
    updateAndDrawParticles(ctx, particles, dt);

    // 4. Cute anime speech bubble (suppressed in compact 58×54 slot footer; avoids #floating-toast.is-visible)
    const toastVisible =
      typeof document !== 'undefined' &&
      typeof document.querySelector === 'function' &&
      Boolean(document.querySelector('#floating-toast.is-visible'));
    const bubbleMinTopY = compact ? 2 : toastVisible ? 30 : 4;
    bubbleBounds =
      !compact && bubbleText
        ? drawSpeechBubble(
            ctx,
            cw,
            bubbleText,
            CHAR_META[currentChar].accent,
            bubblePop,
            topY,
            bubbleMinTopY,
          )
        : null;

    const frameTiltRad = useSlices
      ? totalTilt
      : currentMood === 'dangle' || isDragging || isDropping
        ? dangleAngle
        : 0;
    lastTelemetry.nowMs = now;
    lastTelemetry.mood = currentMood;
    lastTelemetry.posture = effectivePosture;
    lastTelemetry.spriteKey = activeSpriteKey;
    lastTelemetry.blendActive = blendFrame.active;
    lastTelemetry.blendProgress = blendFrame.progress;
    lastTelemetry.blendAlphaFrom = blendFrame.alphaFrom;
    lastTelemetry.blendAlphaTo = blendFrame.alphaTo;
    lastTelemetry.centerX = centerX + spriteShiftX;
    lastTelemetry.footY = visualFootY;
    lastTelemetry.topY = topY;
    lastTelemetry.totalH = totalH;
    lastTelemetry.baseW = baseW;
    lastTelemetry.scaleX = vpScaleX;
    lastTelemetry.scaleY = scaleY;
    lastTelemetry.squash = effectiveSquash;
    lastTelemetry.tiltDeg = (frameTiltRad * 180) / Math.PI;
    lastTelemetry.flipScale = flipScale;
    lastTelemetry.headShearPx = headShearSpring.y;
    lastTelemetry.tailSwayPx = tailSwaySpring.y;
    lastTelemetry.scootX = scootX;
    lastTelemetry.hopY = totalHopY;
    lastTelemetry.frameDrawn = true;
  };

  const renderFrame = (now: number): void => {
    if (destroyed || manualClockNow !== null) return;
    rafId = requestAnimationFrame(renderFrame);
    stepRenderFrame(now, false);
  };

  const stepAuditFrame = (dtMs: number): PetMotionTelemetry => {
    if (manualClockNow === null) {
      cancelAnimationFrame(rafId);
      manualClockNow = Math.max(prevTs, lastDrawTs > 0 ? lastDrawTs : prevTs, performance.now());
    }
    const stepMs = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 1000 / 60;
    manualClockNow += stepMs;
    stepRenderFrame(manualClockNow, true);
    return { ...lastTelemetry };
  };

  const resetAuditState = (): void => {
    if (manualClockNow === null) {
      cancelAnimationFrame(rafId);
      manualClockNow = Math.max(prevTs, lastDrawTs > 0 ? lastDrawTs : prevTs, performance.now());
    }
    particles.length = 0;
    towerCount = 0;
    towerBounds = null;
    pendingBowlFlies = 0;
    bowlFlyT = -1;
    for (const d of dropSlots) d.active = false;
    for (const d of debris) d.active = false;
    bugHuntPhase = 'none';
    bugHuntSlot = null;
    bugHuntUntil = 0;
    lastCatchAt = Number.NEGATIVE_INFINITY;
    suppressNextTurnHop = false;
    bonkHitstopUntil = 0;
    bonkShakeAmp = 0;
    bonkShakeElapsed = 0;
    bonkDirectSlammed = false;
    bonkShockwave.active = false;
    bonkShockwave.elapsed = 0;
    idleVariantActive = false;
    idleVariantStartedAt = 0;
    idleVariantEndAt = 0;
    idleVariantDir = 1;
    nextIdleVariantAt =
      manualClockNow + IDLE_VARIANT_GAP_MIN_MS + Math.random() * (IDLE_VARIANT_GAP_MAX_MS - IDLE_VARIANT_GAP_MIN_MS);
    locoDir = 0;
    peeking = false;
    locoSpeedRatio = 1;
    facing = 1;
    currentStrideFrameA = true;
    currentStrideFrameIndex = 0;
    boostUntil = 0;
    fakeTypingUntil = 0;
    scootTarget = 0;
    scootX = 0;
    squashSpring.snap(0);
    headShearSpring.snap(0);
    tailSwaySpring.snap(0);
    scootSpring.snap(0);
    tiltSpring.snap(0);
    facingSpring.snap(1);
    prevFlipSign = 1;
    turnHopRemaining = 0;
    sway = 0;
    swayVel = 0;
    idleTilt = 0;
    targetIdleTilt = 0;
    mouseLookNormX = 0;
    hoverPointerLocal = null;
    smoothedHoverX = null;
    smoothedHoverY = null;
    hoverOnHead = false;
    isDragging = false;
    isDropping = false;
    dropOffsetY = 0;
    dropVelY = 0;
    dangleAngle = 0;
    dangleVel = 0;
    dragSuppressClickUntil = 0;
    baseMood = 'idle';
    currentMood = 'idle';
    moodRevertAt = 0;
    drowsyEnteredAt = 0;
    drowsyWakeStretch = false;
    bonkStartedAt = 0;
    bubbleText = '';
    bubbleUntil = 0;
    bubbleBounds = null;
    bubblePop = 1;
    isBlinking = false;
    lastDrawnBlink = false;
    pendingSecondBlinkAt = 0;
    blinkEndAt = 0;
    blinkNodAmt = 0;
    nextBlinkAt = manualClockNow + 1100;
    animElapsed = 0;
    eatPhaseStart = 0;
    musicPhaseStart = 0;
    beatPhase = 0;
    workFrameIdx = 0;
    workFrameA = true;
    lastWorkFrame = -1;
    workBeatAge = 1;
    emitTimer = 0;
    fxTimer = 0;
    lastInteractionAt = manualClockNow;
    lastClickBubbleAt = 0;
    lastBeatSfxAt = 0;
    lastRubPatAt = 0;
    lastPointerX = null;
    headRubAccum = 0;
    pointerDownOnCanvas = false;
    pointerMovedDrag = false;
    prevTs = manualClockNow;
    lastDrawTs = Number.NEGATIVE_INFINITY;
    postureBridge.reset('stand');
    spriteSwapPending = false;
    spriteBlender.reset();
    strideClock.reset();
    shakeDetector.reset();
    stepAuditFrame(1000 / 60);
    stepAuditFrame(1000 / 60);
  };

  rafId = requestAnimationFrame(renderFrame);

  const controller: PetController = {
    setMood,
    getMood: () => currentMood,
    triggerBounce,
    setCharacter,
    getCharacter: () => currentChar,
    isPointOpaque,
    startDrag,
    feedDragDelta,
    endDrag,
    triggerAction,
    setRateTier,
    setBaseMood,
    getBaseMood: () => baseMood,
    playFakeTyping,
    setLocomotion,
    setBowlCount,
    getBowlCount: () => towerCount,
    dropItem,
    getBoostRemainingMs: () => Math.max(0, boostUntil - nowMs()),
    isBusy,
    getMotionSnapshot: () => ({ ...lastTelemetry }),
    stepAuditFrame,
    resetAuditState,
    onEvent: (cb: (ev: PetEvent) => void) => {
      eventListeners.add(cb);
      return () => {
        eventListeners.delete(cb);
      };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      eventListeners.clear();
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onPointerUpOrCancel);
        window.removeEventListener('pointercancel', onPointerUpOrCancel);
      }
      delete (canvas as unknown as Record<string, unknown>).__petController;
    },
  };

  (canvas as unknown as Record<string, unknown>).__petController = controller;
  return controller;
}
