/**
 * אפקטי קול פרוצדורליים (WebAudio) — בלי קבצים חיצוניים.
 * כל צליל נוצר מאוסצילטור פשוט, וקל להחליף בהמשך בקבצי אודיו אמיתיים
 * דרך המפה SOUND_FILES.
 */

export type SoundName =
  | 'select'
  | 'command'
  | 'build'
  | 'complete'
  | 'train'
  | 'attack'
  | 'hit'
  | 'die'
  | 'gather'
  | 'deposit'
  | 'stageUp'
  | 'alert'
  | 'error'
  | 'click'
  | 'victory'
  | 'defeat';

type ToneSpec = {
  freq: number;
  type: OscillatorType;
  duration: number;
  /** תדר סיום (החלקה) */
  slideTo?: number;
  volume?: number;
  /** רעש לבן במקום גל (לפיצוצים ומכות) */
  noise?: boolean;
  /** צלילים נוספים ברצף */
  then?: ToneSpec[];
};

const SOUNDS: Record<SoundName, ToneSpec> = {
  select: { freq: 660, type: 'sine', duration: 0.07, volume: 0.25 },
  command: { freq: 520, type: 'triangle', duration: 0.09, slideTo: 740, volume: 0.28 },
  build: { freq: 180, type: 'square', duration: 0.06, volume: 0.18 },
  complete: {
    freq: 523,
    type: 'sine',
    duration: 0.12,
    volume: 0.3,
    then: [{ freq: 784, type: 'sine', duration: 0.18, volume: 0.28 }],
  },
  train: { freq: 440, type: 'triangle', duration: 0.1, slideTo: 660, volume: 0.25 },
  attack: { freq: 300, type: 'sawtooth', duration: 0.07, slideTo: 140, volume: 0.22 },
  hit: { freq: 200, type: 'square', duration: 0.05, noise: true, volume: 0.2 },
  die: { freq: 160, type: 'sawtooth', duration: 0.25, slideTo: 60, volume: 0.25 },
  gather: { freq: 320, type: 'triangle', duration: 0.05, volume: 0.12 },
  deposit: { freq: 700, type: 'sine', duration: 0.07, slideTo: 900, volume: 0.18 },
  stageUp: {
    freq: 392,
    type: 'sine',
    duration: 0.16,
    volume: 0.32,
    then: [
      { freq: 523, type: 'sine', duration: 0.16, volume: 0.32 },
      { freq: 659, type: 'sine', duration: 0.16, volume: 0.32 },
      { freq: 784, type: 'sine', duration: 0.3, volume: 0.34 },
    ],
  },
  alert: {
    freq: 880,
    type: 'square',
    duration: 0.12,
    volume: 0.3,
    then: [{ freq: 660, type: 'square', duration: 0.18, volume: 0.28 }],
  },
  error: { freq: 180, type: 'square', duration: 0.14, slideTo: 120, volume: 0.22 },
  click: { freq: 900, type: 'sine', duration: 0.04, volume: 0.18 },
  victory: {
    freq: 523,
    type: 'triangle',
    duration: 0.18,
    volume: 0.35,
    then: [
      { freq: 659, type: 'triangle', duration: 0.18, volume: 0.35 },
      { freq: 784, type: 'triangle', duration: 0.18, volume: 0.35 },
      { freq: 1046, type: 'triangle', duration: 0.45, volume: 0.35 },
    ],
  },
  defeat: {
    freq: 392,
    type: 'sawtooth',
    duration: 0.25,
    volume: 0.3,
    then: [
      { freq: 311, type: 'sawtooth', duration: 0.25, volume: 0.3 },
      { freq: 233, type: 'sawtooth', duration: 0.6, volume: 0.3 },
    ],
  },
};

/**
 * מפת קבצי אודיו אופציונלית — אם ממלאים כאן נתיב,
 * הוא יתנגן במקום הצליל הפרוצדורלי.
 */
export const SOUND_FILES: Partial<Record<SoundName, string>> = {};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private lastPlayed = new Map<SoundName, number>();
  private musicTimer: number | null = null;
  sfxVolume = 0.6;
  musicVolume = 0.3;
  enabled = true;

  /** חייב להיקרא מתוך אירוע משתמש (מדיניות דפדפנים). */
  init(): void {
    if (this.ctx) return;
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.master);
      void this.loadFiles();
    } catch {
      this.ctx = null;
    }
  }

  private async loadFiles(): Promise<void> {
    if (!this.ctx) return;
    for (const [name, url] of Object.entries(SOUND_FILES)) {
      try {
        const res = await fetch(url as string);
        const data = await res.arrayBuffer();
        this.buffers.set(name as SoundName, await this.ctx.decodeAudioData(data));
      } catch {
        /* אם הקובץ חסר — נישאר עם הצליל הפרוצדורלי */
      }
    }
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /** משמיע צליל. throttle מונע ספאם כשהרבה יחידות פועלות יחד. */
  play(name: SoundName, throttleMs = 60): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < throttleMs) return;
    this.lastPlayed.set(name, now);

    const buffer = this.buffers.get(name);
    if (buffer) {
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.value = this.sfxVolume;
      src.buffer = buffer;
      src.connect(gain).connect(this.master);
      src.start();
      return;
    }
    this.playTone(SOUNDS[name], this.ctx.currentTime);
  }

  private playTone(spec: ToneSpec, startAt: number): void {
    if (!this.ctx || !this.master) return;
    const gain = this.ctx.createGain();
    const volume = (spec.volume ?? 0.25) * this.sfxVolume;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + spec.duration);
    gain.connect(this.master);

    if (spec.noise) {
      const length = Math.max(1, Math.floor(this.ctx.sampleRate * spec.duration));
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start(startAt);
      src.stop(startAt + spec.duration);
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.freq, startAt);
      if (spec.slideTo) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, spec.slideTo),
          startAt + spec.duration,
        );
      }
      osc.connect(gain);
      osc.start(startAt);
      osc.stop(startAt + spec.duration);
    }

    let offset = spec.duration;
    for (const next of spec.then ?? []) {
      this.playTone(next, startAt + offset);
      offset += next.duration;
    }
  }

  /** מוזיקת רקע: ארפג'ו רגוע ואיטי שנוצר בזמן אמת. */
  startMusic(): void {
    if (!this.ctx || !this.musicGain || this.musicTimer !== null) return;
    const scale = [196, 233, 262, 294, 349, 392, 466, 523];
    let step = 0;
    const tick = () => {
      if (!this.ctx || !this.musicGain || this.musicVolume <= 0) return;
      const now = this.ctx.currentTime;
      const note = scale[(step * 3) % scale.length];
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
      osc.connect(gain).connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 2.5);
      step++;
    };
    tick();
    this.musicTimer = window.setInterval(tick, 2100);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (this.musicGain) this.musicGain.gain.value = music;
    if (music <= 0) this.stopMusic();
    else if (this.ctx) this.startMusic();
  }
}

export const audio = new AudioEngine();
