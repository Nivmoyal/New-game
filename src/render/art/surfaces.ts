/**
 * טקסטורות משטח פרוצדורליות.
 *
 * במשחק הזה אין קבצי אמנות — כל פיקסל נוצר בקוד. עד כאן כל משטח היה
 * צבע אחיד, ולכן אבן, עץ ורעפים נראו כאותו חומר בגוונים שונים. כאן
 * נוצרות טקסטורות **תפירות** (seamless) לכל חומר: נדבכי אבן עם מלט,
 * קרשים עם סיבי עץ, שורות רעפים חופפות, קש, דשא, פח עם מסמרות, זכוכית,
 * אריג, עור וקליפת עץ.
 *
 * כל טקסטורה נוצרת סביב **צבע נתון** (הצבע שהפאה הייתה מקבלת ממילא),
 * כך שהתאורה והצללת הפאות נשמרות בדיוק — הטקסטורה רק מוסיפה מבנה.
 * הכול נשמר במטמון לפי (חומר, צבע, גודל).
 */

export type Surface =
  | 'stone'
  | 'brick'
  | 'plaster'
  | 'wood'
  | 'timber'
  | 'tile'
  | 'thatch'
  | 'turf'
  | 'metal'
  | 'glass'
  | 'cloth'
  | 'leather'
  | 'bark'
  | 'foliage'
  | 'rubble';

/**
 * טקסלים לאריח עולם אחד — קובע את "גודל האבן" ביחס לעולם.
 *
 * הערך גבוה בכוונה: אריח הטקסטורה (52px) מכסה בערך חצי אריח עולם, ולכן
 * על קיר בגובה חצי אריח נראים ארבעה נדבכי אבן ולא אחד. בערך נמוך יותר
 * האבנים יצאו בגודל של חדר והקיר נראה שטוח.
 */
export const TEXELS_PER_TILE = 100;

/** גודל אריח הטקסטורה בפיקסלים (חייב להתפור לעצמו). */
const TEX = 52;

const cache = new Map<string, HTMLCanvasElement>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function parse(color: string): { r: number; g: number; b: number } {
  if (color.startsWith('#')) {
    const hex = color.length === 4
      ? color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      : color.slice(1, 7);
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return { r: 140, g: 140, b: 140 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m = color.match(/-?\d+(\.\d+)?/g);
  if (m && m.length >= 3) {
    return { r: Number(m[0]) | 0, g: Number(m[1]) | 0, b: Number(m[2]) | 0 };
  }
  return { r: 140, g: 140, b: 140 };
}

function css(r: number, g: number, b: number, a = 1): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return a >= 1 ? `rgb(${c(r)}, ${c(g)}, ${c(b)})` : `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a})`;
}

/** מבהיר/מכהה צבע ביחס יחסי. */
function tone(color: { r: number; g: number; b: number }, k: number): string {
  return k >= 0
    ? css(color.r + (255 - color.r) * k, color.g + (255 - color.g) * k, color.b + (255 - color.b) * k)
    : css(color.r * (1 + k), color.g * (1 + k), color.b * (1 + k));
}

/** גרעיניות דקה על כל הטקסטורה — מה שהופך משטח שטוח לחומר. */
function grain(ctx: CanvasRenderingContext2D, px: number, seed: number, amount: number): void {
  const img = ctx.getImageData(0, 0, px, px);
  const d = img.data;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4;
      const n = (hash(x, y, seed) - 0.5) * amount;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** מצייר מלבן שמתפור לעצמו: כל מה שחורג נמשך גם בצד הנגדי. */
function wrapRect(
  ctx: CanvasRenderingContext2D, px: number,
  x: number, y: number, w: number, h: number, fill: string,
): void {
  ctx.fillStyle = fill;
  for (const ox of [0, -px, px]) {
    for (const oy of [0, -px, px]) {
      if (x + ox > px || x + ox + w < 0 || y + oy > px || y + oy + h < 0) continue;
      ctx.fillRect(x + ox, y + oy, w, h);
    }
  }
}

function build(kind: Surface, color: string): HTMLCanvasElement {
  const px = TEX;
  const c = parse(color);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, px, px);
  const seed = kind.length * 7919 + c.r + c.g * 3 + c.b * 7;

  switch (kind) {
    case 'stone': {
      // נדבכי אבן לא־אחידים עם קווי מלט
      const rows = 4;
      const rh = px / rows;
      ctx.strokeStyle = tone(c, -0.3);
      ctx.lineWidth = 1;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        const offset = (r % 2) * rh * 0.8;
        let x = -offset;
        while (x < px) {
          const w = rh * (1.1 + hash(r, Math.round(x), seed) * 1.1);
          const k = (hash(r, Math.round(x), seed + 5) - 0.5) * 0.24;
          wrapRect(ctx, px, x + 1, y + 1, w - 2, rh - 2, tone(c, k));
          x += w;
        }
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(px, y + 0.5);
        ctx.stroke();
      }
      grain(ctx, px, seed, 22);
      break;
    }
    case 'brick': {
      const rows = 7;
      const rh = px / rows;
      const bw = px / 4;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        const off = (r % 2) * bw * 0.5;
        for (let i = -1; i < 5; i++) {
          const k = (hash(r, i, seed) - 0.5) * 0.14;
          wrapRect(ctx, px, i * bw + off + 0.6, y + 0.6, bw - 1.2, rh - 1.2, tone(c, k));
        }
      }
      grain(ctx, px, seed, 12);
      break;
    }
    case 'plaster': {
      // טיח: כתמים רכים וכמה סדקים דקים
      for (let i = 0; i < 26; i++) {
        const x = hash(i, 0, seed) * px;
        const y = hash(i, 1, seed) * px;
        const r = px * (0.05 + hash(i, 2, seed) * 0.12);
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = hash(i, 3, seed) > 0.5 ? tone(c, 0.12) : tone(c, -0.1);
        for (const [ox, oy] of [[0, 0], [px, 0], [-px, 0], [0, px], [0, -px]]) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tone(c, -0.22);
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 3; i++) {
        let x = hash(i, 7, seed) * px;
        let y = hash(i, 8, seed) * px;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (hash(i, k + 10, seed) - 0.5) * 12;
          y += hash(i, k + 20, seed) * 9;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      grain(ctx, px, seed, 10);
      break;
    }
    case 'wood': {
      // קרשים אנכיים עם סיבים
      const planks = 5;
      const pw = px / planks;
      for (let i = 0; i < planks; i++) {
        const k = (hash(i, 0, seed) - 0.5) * 0.18;
        wrapRect(ctx, px, i * pw, 0, pw - 1, px, tone(c, k));
        ctx.strokeStyle = tone(c, -0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(i * pw + pw - 0.5, 0);
        ctx.lineTo(i * pw + pw - 0.5, px);
        ctx.stroke();
        // סיבי עץ
        ctx.strokeStyle = tone(c, -0.14);
        ctx.lineWidth = 0.6;
        for (let g = 0; g < 3; g++) {
          const gx = i * pw + 2 + hash(i, g, seed) * (pw - 4);
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          for (let y = 0; y <= px; y += 8) {
            ctx.lineTo(gx + Math.sin((y / px) * Math.PI * 2 + g) * 1.2, y);
          }
          ctx.stroke();
        }
      }
      break;
    }
    case 'timber': {
      // בולי עץ אופקיים
      const rows = 5;
      const rh = px / rows;
      for (let r = 0; r < rows; r++) {
        const k = (hash(r, 0, seed) - 0.5) * 0.16;
        wrapRect(ctx, px, 0, r * rh, px, rh - 1, tone(c, k));
        const g = ctx.createLinearGradient(0, r * rh, 0, r * rh + rh);
        g.addColorStop(0, 'rgba(255,255,255,0.12)');
        g.addColorStop(0.5, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.16)');
        ctx.fillStyle = g;
        ctx.fillRect(0, r * rh, px, rh - 1);
      }
      grain(ctx, px, seed, 10);
      break;
    }
    case 'tile': {
      // שורות רעפים חופפות
      const rows = 6;
      const rh = px / rows;
      const cols = 6;
      const cw = px / cols;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        const off = (r % 2) * cw * 0.5;
        for (let i = -1; i < cols + 1; i++) {
          const x = i * cw + off;
          const k = (hash(r, i, seed) - 0.5) * 0.12;
          ctx.fillStyle = tone(c, k);
          ctx.beginPath();
          ctx.moveTo(x, y + rh);
          ctx.lineTo(x, y + rh * 0.35);
          ctx.quadraticCurveTo(x + cw / 2, y - rh * 0.25, x + cw, y + rh * 0.35);
          ctx.lineTo(x + cw, y + rh);
          ctx.closePath();
          ctx.fill();
        }
        // קו צל מתחת לכל שורה
        ctx.fillStyle = tone(c, -0.34);
        ctx.fillRect(0, y + rh - 1.1, px, 1.1);
      }
      grain(ctx, px, seed, 8);
      break;
    }
    case 'thatch': {
      ctx.strokeStyle = tone(c, -0.2);
      ctx.lineWidth = 1;
      for (let i = 0; i < 160; i++) {
        const x = hash(i, 0, seed) * px;
        const y = hash(i, 1, seed) * px;
        const len = 4 + hash(i, 2, seed) * 6;
        ctx.strokeStyle = tone(c, (hash(i, 3, seed) - 0.5) * 0.5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (hash(i, 4, seed) - 0.5) * 3, y + len);
        ctx.stroke();
      }
      grain(ctx, px, seed, 14);
      break;
    }
    case 'turf': {
      for (let i = 0; i < 120; i++) {
        const x = hash(i, 0, seed) * px;
        const y = hash(i, 1, seed) * px;
        ctx.fillStyle = tone(c, (hash(i, 2, seed) - 0.45) * 0.5);
        ctx.beginPath();
        ctx.ellipse(x, y, 2.6, 1.6, hash(i, 3, seed) * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      grain(ctx, px, seed, 18);
      break;
    }
    case 'metal': {
      const rows = 3;
      const rh = px / rows;
      for (let r = 0; r < rows; r++) {
        const g = ctx.createLinearGradient(0, r * rh, 0, r * rh + rh);
        g.addColorStop(0, 'rgba(255,255,255,0.14)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.02)');
        g.addColorStop(1, 'rgba(0,0,0,0.14)');
        ctx.fillStyle = g;
        ctx.fillRect(0, r * rh, px, rh);
        ctx.fillStyle = tone(c, -0.3);
        ctx.fillRect(0, r * rh + rh - 1, px, 1);
        // מסמרות
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = tone(c, 0.2);
          ctx.beginPath();
          ctx.arc((i + 0.5) * (px / 6), r * rh + 3, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      grain(ctx, px, seed, 8);
      break;
    }
    case 'glass': {
      const cols = 4;
      const rows = 4;
      const cw = px / cols;
      const rh = px / rows;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < cols; i++) {
          const lit = hash(r, i, seed) > 0.55;
          ctx.fillStyle = lit ? tone(c, 0.3) : tone(c, -0.18);
          ctx.fillRect(i * cw + 1.5, r * rh + 1.5, cw - 3, rh - 3);
          // בבואה אלכסונית
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          ctx.moveTo(i * cw + 1.5, r * rh + rh - 3);
          ctx.lineTo(i * cw + cw - 3, r * rh + 1.5);
          ctx.lineTo(i * cw + cw - 3, r * rh + rh * 0.45);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.strokeStyle = tone(c, -0.45);
      ctx.lineWidth = 1.4;
      for (let i = 0; i <= cols; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cw, 0);
        ctx.lineTo(i * cw, px);
        ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * rh);
        ctx.lineTo(px, r * rh);
        ctx.stroke();
      }
      break;
    }
    case 'cloth': {
      // אריג רך: אלכסוני טוויל בניגוד נמוך.
      // גרסה קודמת ציירה רשת חוטים בצפיפות 3px — בקנה המידה של דמות
      // במשחק זה יצא "נייר משבצות" שגם מרצד בתנועה.
      ctx.strokeStyle = tone(c, -0.06);
      ctx.lineWidth = 1.4;
      for (let i = -px; i < px * 2; i += 9) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + px, px);
        ctx.stroke();
      }
      ctx.strokeStyle = tone(c, 0.05);
      for (let i = -px; i < px * 2; i += 9) {
        ctx.beginPath();
        ctx.moveTo(i + 4, 0);
        ctx.lineTo(i + 4 + px, px);
        ctx.stroke();
      }
      grain(ctx, px, seed, 7);
      break;
    }
    case 'leather': {
      for (let i = 0; i < 70; i++) {
        const x = hash(i, 0, seed) * px;
        const y = hash(i, 1, seed) * px;
        ctx.fillStyle = tone(c, (hash(i, 2, seed) - 0.5) * 0.3);
        ctx.beginPath();
        ctx.ellipse(x, y, 3 + hash(i, 3, seed) * 3, 2 + hash(i, 4, seed) * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      grain(ctx, px, seed, 14);
      break;
    }
    case 'bark': {
      ctx.strokeStyle = tone(c, -0.3);
      for (let i = 0; i < 26; i++) {
        const x = hash(i, 0, seed) * px;
        ctx.lineWidth = 0.8 + hash(i, 1, seed) * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let y = 0; y <= px; y += 7) {
          ctx.lineTo(x + Math.sin(y * 0.25 + i) * 1.6, y);
        }
        ctx.stroke();
      }
      grain(ctx, px, seed, 18);
      break;
    }
    case 'foliage': {
      for (let i = 0; i < 90; i++) {
        const x = hash(i, 0, seed) * px;
        const y = hash(i, 1, seed) * px;
        ctx.fillStyle = tone(c, (hash(i, 2, seed) - 0.42) * 0.45);
        ctx.beginPath();
        ctx.ellipse(x, y, 3.4, 2.2, hash(i, 3, seed) * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      grain(ctx, px, seed, 12);
      break;
    }
    case 'rubble': {
      for (let i = 0; i < 60; i++) {
        const x = hash(i, 0, seed) * px;
        const y = hash(i, 1, seed) * px;
        const r = 1.5 + hash(i, 2, seed) * 3.5;
        ctx.fillStyle = tone(c, (hash(i, 3, seed) - 0.5) * 0.42);
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x + r * 0.3, y + r);
        ctx.lineTo(x - r * 0.8, y + r * 0.4);
        ctx.closePath();
        ctx.fill();
      }
      grain(ctx, px, seed, 16);
      break;
    }
  }
  return canvas;
}

/** טקסטורה תפורה לחומר בצבע נתון. */
export function surfaceTexture(kind: Surface, color: string): HTMLCanvasElement {
  const key = `${kind}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = build(kind, color);
  // תקרה על המטמון — צבעי שחקנים ואומות מוגבלים, אבל עדיף לא להפתיע
  if (cache.size > 400) cache.clear();
  cache.set(key, made);
  return made;
}

/** דפוס מילוי לחומר בצבע נתון, במטמון לכל הקשר ציור. */
export function surfacePattern(
  ctx: CanvasRenderingContext2D,
  kind: Surface,
  color: string,
): CanvasPattern | null {
  // בסביבה בלי DOM (בדיקות) אין קנבס ליצור ממנו טקסטורה — הציור
  // ממשיך בצבעים שטוחים בלבד.
  if (typeof document === 'undefined' || typeof ctx.createPattern !== 'function') return null;
  let byCtx = patterns.get(ctx);
  if (!byCtx) {
    byCtx = new Map();
    patterns.set(ctx, byCtx);
  }
  const key = `${kind}|${color}`;
  const hit = byCtx.get(key);
  if (hit) return hit;
  const pat = ctx.createPattern(surfaceTexture(kind, color), 'repeat');
  if (!pat) return null;
  if (byCtx.size > 120) byCtx.clear();
  byCtx.set(key, pat);
  return pat;
}

/** מנקה את המטמון (שינוי רזולוציה / משחק חדש). */
export function clearSurfaceCache(): void {
  cache.clear();
}
