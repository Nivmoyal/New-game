/**
 * ערפל מלחמה: לכל שחקן שתי שכבות —
 * explored (נחקר אי-פעם) ו-visible (נראה עכשיו).
 */
export const FOG_HIDDEN = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

export class FogOfWar {
  readonly width: number;
  readonly height: number;
  /** ספירת מקורות ראייה לכל אריח (0 = מעורפל). */
  private counts: Int16Array;
  private explored: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.counts = new Int16Array(width * height);
    this.explored = new Uint8Array(width * height);
  }

  /** חושף שטח עגול סביב נקודה. */
  reveal(cx: number, cy: number, radius: number): void {
    const r = Math.max(1, Math.round(radius));
    const r2 = r * r;
    const x0 = Math.max(0, Math.round(cx) - r);
    const x1 = Math.min(this.width - 1, Math.round(cx) + r);
    const y0 = Math.max(0, Math.round(cy) - r);
    const y1 = Math.min(this.height - 1, Math.round(cy) + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * this.width + x;
        this.counts[i]++;
        this.explored[i] = 1;
      }
    }
  }

  /** מאפס את שכבת הנראות לפני חישוב מחדש (שומר על הנחקר). */
  clearVisible(): void {
    this.counts.fill(0);
  }

  state(x: number, y: number): 0 | 1 | 2 {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return FOG_HIDDEN;
    const i = y * this.width + x;
    if (this.counts[i] > 0) return FOG_VISIBLE;
    return this.explored[i] ? FOG_EXPLORED : FOG_HIDDEN;
  }

  isVisible(x: number, y: number): boolean {
    return this.state(Math.floor(x), Math.floor(y)) === FOG_VISIBLE;
  }

  isExplored(x: number, y: number): boolean {
    return this.state(Math.floor(x), Math.floor(y)) !== FOG_HIDDEN;
  }

  /** חושף את כל המפה (מצב "ללא ערפל"). */
  revealAll(): void {
    this.explored.fill(1);
    this.counts.fill(1);
  }

  exploredRatio(): number {
    let n = 0;
    for (let i = 0; i < this.explored.length; i++) n += this.explored[i];
    return n / this.explored.length;
  }

  serialize(): string {
    // דחיסת RLE פשוטה של שכבת הנחקר
    const parts: string[] = [];
    let run = 1;
    for (let i = 1; i <= this.explored.length; i++) {
      if (i < this.explored.length && this.explored[i] === this.explored[i - 1]) {
        run++;
      } else {
        parts.push(`${this.explored[i - 1]}x${run}`);
        run = 1;
      }
    }
    return parts.join(',');
  }

  static deserialize(width: number, height: number, data: string): FogOfWar {
    const fog = new FogOfWar(width, height);
    let i = 0;
    for (const part of data.split(',')) {
      const [v, n] = part.split('x');
      const value = Number(v);
      const count = Number(n);
      for (let k = 0; k < count && i < fog.explored.length; k++, i++) {
        fog.explored[i] = value;
      }
    }
    return fog;
  }
}
