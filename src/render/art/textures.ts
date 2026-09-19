import type { Terrain } from '../../core/types';

/**
 * טקסטורות קרקע פרוצדורליות.
 *
 * במקום למלא כל אריח בצבע אחיד (שנראה כמו מעוינים שטוחים), כל סוג
 * קרקע מקבל טקסטורה רציפה עם גרעיניות, כתמים ופרטים. הטקסטורות
 * נוצרות פעם אחת בזיכרון ונדגמות במרחב האריחים.
 */

export type MaterialStyle = {
  /** צבע בסיס */
  base: string;
  /** צבע כתמים כהים */
  dark: string;
  /** צבע כתמים בהירים */
  light: string;
  /** צפיפות הגרעיניות (0..1) */
  grain: number;
  /** עדיפות מיזוג: חומר עם ערך גבוה נמרח מעל שכנו */
  priority: number;
};

export const MATERIALS: Record<Terrain, MaterialStyle> = {
  grass: { base: '#5d8f43', dark: '#4a7735', light: '#74a652', grain: 0.55, priority: 1 },
  dirt: { base: '#7d7048', dark: '#665a39', light: '#94855a', grain: 0.5, priority: 3 },
  sand: { base: '#c4b483', dark: '#ad9d6f', light: '#d9cb9e', grain: 0.35, priority: 4 },
  forest: { base: '#4a7d3a', dark: '#3b672e', light: '#5c9147', grain: 0.6, priority: 2 },
  hill: { base: '#7a8a4e', dark: '#63723e', light: '#93a165', grain: 0.5, priority: 5 },
  rock: { base: '#8a9098', dark: '#6f757c', light: '#a5abb3', grain: 0.45, priority: 6 },
  water: { base: '#2a6ea8', dark: '#1f5585', light: '#3c88c4', grain: 0.2, priority: 0 },
  shallow: { base: '#4a9ac4', dark: '#3b83aa', light: '#62b0d6', grain: 0.25, priority: 0 },
};

/** רעש דטרמיניסטי לפי קואורדינטה — אותה מפה תיראה תמיד אותו דבר. */
function noise2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * מייצר אריח טקסטורה רציף (seamless) לחומר נתון.
 * `px` הוא גודל הטקסטורה בפיקסלים — היא נפרסת על N אריחים.
 */
export function materialTexture(terrain: Terrain, px = 64, tiles = 2): HTMLCanvasElement {
  const key = `${terrain}|${px}|${tiles}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const m = MATERIALS[terrain];
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = m.base;
  ctx.fillRect(0, 0, px, px);

  const seed = terrain.length * 7919;
  // כתמים רחבים — שוברים את האחידות
  const blobs = Math.round(px * 0.5);
  for (let i = 0; i < blobs; i++) {
    const n = noise2(i, 0, seed);
    const x = noise2(i, 1, seed) * px;
    const y = noise2(i, 2, seed) * px;
    const r = px * (0.04 + n * 0.1);
    ctx.fillStyle = n > 0.5 ? m.light : m.dark;
    ctx.globalAlpha = 0.1 + n * 0.14;
    // מצויר ארבע פעמים כדי שהטקסטורה תתפור לעצמה בקצוות
    for (const [ox, oy] of [[0, 0], [px, 0], [0, px], [-px, 0], [0, -px]]) {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // גרעיניות דקה
  const img = ctx.getImageData(0, 0, px, px);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const p = (i / 4) | 0;
    const n = noise2(p % px, (p / px) | 0, seed + 31) - 0.5;
    const k = n * 42 * m.grain;
    d[i] = Math.max(0, Math.min(255, d[i] + k));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + k));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + k));
  }
  ctx.putImageData(img, 0, 0);

  void tiles;
  cache.set(key, canvas);
  return canvas;
}

/**
 * טקסטורת גרעיניות ניטרלית (אפור סביב 50%) לשכבת overlay.
 * מוסיפה פרטים בלי לשנות את גוון הקרקע.
 */
export function grainTexture(px = 96): HTMLCanvasElement {
  const key = `grain|${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const d = img.data;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4;
      // שתי תדירויות: כתמים רחבים + גרגר דק
      const coarse = noise2(x >> 3, y >> 3, 11);
      const fine = noise2(x, y, 23);
      const v = 128 + (coarse - 0.5) * 46 + (fine - 0.5) * 30;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cache.set(key, canvas);
  return canvas;
}

/** מנקה את המטמון (בשינוי רזולוציה). */
export function clearTextureCache(): void {
  cache.clear();
}
