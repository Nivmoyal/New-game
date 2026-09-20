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

/**
 * לוח הצבעים של הקרקע.
 *
 * הגוונים מכוונים נמוך בריווי בכוונה: צבעים רוויים הפכו את המפה
 * ל"שטיח טלאים" צעקני, שבו כל אריח נקרא בנפרד. גוונים עפרוריים
 * וקרובים זה לזה נקראים כשטח אחד, והתלת-ממד של הגופים שעליו בולט
 * יותר כי הוא לא מתחרה בקרקע על תשומת הלב.
 */
export const MATERIALS: Record<Terrain, MaterialStyle> = {
  grass: { base: '#6d8757', dark: '#5d7449', light: '#7e9866', grain: 0.5, priority: 1 },
  dirt: { base: '#7a6e56', dark: '#685d48', light: '#8b7f66', grain: 0.45, priority: 3 },
  sand: { base: '#c0b394', dark: '#ab9e80', light: '#d0c5a8', grain: 0.32, priority: 4 },
  forest: { base: '#5d7549', dark: '#4e643d', light: '#6d8657', grain: 0.55, priority: 2 },
  hill: { base: '#7d8560', dark: '#6b7251', light: '#8e9672', grain: 0.45, priority: 5 },
  rock: { base: '#8b8f93', dark: '#73777b', light: '#a0a4a8', grain: 0.4, priority: 6 },
  water: { base: '#3a6a90', dark: '#2e5878', light: '#4b7ea6', grain: 0.18, priority: 0 },
  shallow: { base: '#5590ad', dark: '#457b96', light: '#68a3bf', grain: 0.22, priority: 0 },
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
