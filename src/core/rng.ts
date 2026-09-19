/** מחולל מספרים אקראיים עם זרע (deterministic) — חיוני לבדיקות ולשמירה. */
export class Rng {
  private state: number;

  constructor(seed = 1) {
    // mulberry32
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** מספר שלם בטווח [min, max] כולל. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  serialize(): number {
    return this.state;
  }

  static restore(state: number): Rng {
    const r = new Rng(1);
    (r as unknown as { state: number }).state = state >>> 0;
    return r;
  }
}

/** רעש ערך חלק (value noise) פשוט לייצור מפות. */
export function valueNoise2D(seed: number) {
  const hash = (x: number, y: number): number => {
    let h = seed + x * 374761393 + y * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** רעש פרקטלי בכמה אוקטבות. */
export function fbm(seed: number, octaves = 4) {
  const noises = Array.from({ length: octaves }, (_, i) => valueNoise2D(seed + i * 7919));
  return (x: number, y: number): number => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (const n of noises) {
      sum += n(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}
