// MIT License - Original procedural music-box & arcade SFX synthesizer (zero external deps)

export type SfxName =
  | 'spin'
  | 'reelStop'
  | 'eat'
  | 'stamp'
  | 'jackpot'
  | 'bug'
  | 'doubao'
  | 'victory'
  | 'click'
  | 'pat'
  | 'typeKey'
  | 'pickup'
  | 'land'
  | 'yawn'
  | 'bonk'
  | 'dizzy';

let muted = false;
let audioCtx: AudioContext | null = null;
let unlockBound = false;
let lastTypeKeyAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (!unlockBound) {
    unlockBound = true;
    const unlock = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        void audioCtx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  offsetSec: number,
  durSec: number,
  type: OscillatorType,
  gainPeak: number,
  slideToFreq?: number,
): void {
  const t0 = ctx.currentTime + Math.max(0, offsetSec);
  const tEnd = t0 + Math.max(0.02, durSec);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideToFreq && slideToFreq > 20) {
    osc.frequency.exponentialRampToValueAtTime(slideToFreq, tEnd);
  }

  const attack = Math.min(0.008, durSec * 0.25);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(tEnd + 0.01);
}

function playBell(ctx: AudioContext, freq: number, offsetSec: number, durSec: number, vol = 0.11): void {
  // Music-box tine: warm triangle fundamental + delicate 2x/3x sine overtones
  playTone(ctx, freq, offsetSec, durSec, 'triangle', vol);
  playTone(ctx, freq * 2, offsetSec, durSec * 0.45, 'sine', vol * 0.32);
  playTone(ctx, freq * 3, offsetSec, durSec * 0.22, 'sine', vol * 0.12);
}

function playSnap(ctx: AudioContext, offsetSec: number, durSec: number, filterHz: number, vol: number): void {
  const sampleCount = Math.max(64, Math.floor(ctx.sampleRate * durSec));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp((-i / sampleCount) * 5);
  }

  const t0 = ctx.currentTime + Math.max(0, offsetSec);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterHz, t0);
  filter.Q.setValueAtTime(1.8, t0);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + durSec + 0.01);
}

export function setMuted(nextMuted: boolean): void {
  muted = Boolean(nextMuted);
}

export function isMuted(): boolean {
  return muted;
}

export function playSfx(name: SfxName): void {
  if (muted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    switch (name) {
      case 'click': {
        playTone(ctx, 784, 0, 0.065, 'triangle', 0.09, 1175);
        playTone(ctx, 1568, 0.01, 0.045, 'sine', 0.035);
        break;
      }
      case 'spin': {
        const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
        notes.forEach((n, idx) => playBell(ctx, n, idx * 0.032, 0.13, 0.085));
        break;
      }
      case 'reelStop': {
        playTone(ctx, 230, 0, 0.065, 'triangle', 0.13, 92);
        playSnap(ctx, 0, 0.035, 1400, 0.06);
        playBell(ctx, 698.46, 0.012, 0.09, 0.065);
        break;
      }
      case 'eat': {
        playSnap(ctx, 0, 0.045, 950, 0.075);
        playTone(ctx, 440, 0, 0.09, 'sine', 0.1, 622.25);
        playSnap(ctx, 0.09, 0.045, 1150, 0.075);
        playTone(ctx, 523.25, 0.09, 0.1, 'sine', 0.1, 783.99);
        playBell(ctx, 1046.5, 0.18, 0.18, 0.09);
        break;
      }
      case 'stamp': {
        playTone(ctx, 165, 0, 0.09, 'triangle', 0.16, 56);
        playSnap(ctx, 0, 0.05, 820, 0.09);
        playBell(ctx, 659.25, 0.055, 0.16, 0.095);
        playBell(ctx, 987.77, 0.1, 0.22, 0.11);
        break;
      }
      case 'jackpot': {
        const arp = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
        arp.forEach((n, idx) => playBell(ctx, n, idx * 0.055, 0.34, 0.11));
        playBell(ctx, 2093, 0.34, 0.45, 0.09);
        break;
      }
      case 'bug': {
        playTone(ctx, 311.13, 0, 0.11, 'sawtooth', 0.055, 233.08);
        playTone(ctx, 220, 0.095, 0.15, 'square', 0.048, 146.83);
        break;
      }
      case 'doubao': {
        const chord = [349.23, 440, 523.25, 659.25, 783.99, 1046.5];
        chord.forEach((n, idx) => playBell(ctx, n, idx * 0.048, 0.38, 0.09));
        break;
      }
      case 'victory': {
        const melody: Array<[number, number, number]> = [
          [523.25, 0.0, 0.14],
          [659.25, 0.1, 0.14],
          [783.99, 0.2, 0.14],
          [1046.5, 0.31, 0.24],
          [880.0, 0.48, 0.14],
          [1046.5, 0.6, 0.48],
        ];
        for (const [freq, off, dur] of melody) {
          playBell(ctx, freq, off, dur, 0.115);
        }
        playBell(ctx, 523.25, 0.6, 0.48, 0.075);
        break;
      }
      case 'pat': {
        // 温柔双音风铃 + 轻柔咕噜共鸣
        playTone(ctx, 196, 0, 0.24, 'sine', 0.032, 220);
        playBell(ctx, 880, 0, 0.22, 0.058);
        playBell(ctx, 1174.66, 0.085, 0.28, 0.068);
        break;
      }
      case 'typeKey': {
        const nowMs =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        if (nowMs - lastTypeKeyAt < 75) return;
        lastTypeKeyAt = nowMs;

        const pitch = 0.92 + Math.random() * 0.16;
        playSnap(ctx, 0, 0.022, 2250 * pitch, 0.042);
        playTone(ctx, 640 * pitch, 0, 0.026, 'triangle', 0.048, 280 * pitch);
        playTone(ctx, 1760 * pitch, 0.002, 0.018, 'sine', 0.02, 1080 * pitch);
        break;
      }
      case 'pickup': {
        // 拎起时俏皮上滑音
        playTone(ctx, 340, 0, 0.12, 'sine', 0.085, 760);
        playTone(ctx, 540, 0.035, 0.09, 'triangle', 0.045, 980);
        break;
      }
      case 'land': {
        // 松手落地软萌噗叽弹跳音
        playTone(ctx, 210, 0, 0.085, 'sine', 0.11, 88);
        playSnap(ctx, 0, 0.028, 640, 0.035);
        playTone(ctx, 290, 0.06, 0.075, 'triangle', 0.065, 430);
        break;
      }
      case 'yawn': {
        // 轻柔入睡气泡音
        playTone(ctx, 470, 0, 0.28, 'sine', 0.045, 295);
        playTone(ctx, 620, 0.14, 0.065, 'sine', 0.032, 860);
        playTone(ctx, 760, 0.24, 0.065, 'sine', 0.026, 980);
        break;
      }
      case 'bonk': {
        // 充气玩具大锤噗叽撞击声
        playTone(ctx, 185, 0, 0.085, 'sine', 0.14, 68);
        playTone(ctx, 540, 0.01, 0.075, 'triangle', 0.085, 920);
        playSnap(ctx, 0, 0.036, 780, 0.075);
        playTone(ctx, 255, 0.065, 0.07, 'sine', 0.065, 420);
        break;
      }
      case 'dizzy': {
        // 轻快颤音眩晕星环声
        const trill = [740, 622.25, 698.46, 587.33, 659.25, 523.25];
        trill.forEach((freq, idx) => {
          playBell(ctx, freq, idx * 0.055, 0.11, 0.07);
        });
        break;
      }
    }
  } catch {
    // Silent catch when audio device is unavailable or blocked by autoplay policy
  }
}
