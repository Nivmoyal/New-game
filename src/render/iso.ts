import type { Vec2 } from '../core/types';
import type { Camera } from './camera';

/**
 * פרימיטיבים לציור איזומטרי (מבט 2:1, כמו במשחקי אסטרטגיה קלאסיים).
 *
 * אריח בעולם הוא ריבוע 1x1; על המסך הוא מעוין ברוחב `zoom` ובגובה `zoom/2`.
 * ציר Z (גובה) נמדד גם הוא ביחידות אריח, ומתורגם להיסט אנכי כלפי מעלה.
 */

export type Rgb = { r: number; g: number; b: number };

/**
 * מפרק צבע ל-RGB. תומך גם ב-#hex וגם ב-rgb()/rgba(), כי הפלט של
 * shade() הוא rgb() ולעיתים מוזן בחזרה לתוך shade()/faceColors()
 * (למשל בסיס מוצלל של מבנה). בלי זה נוצר fill לא חוקי והמשטח
 * צויר בצבע שגוי.
 */
export function hexToRgb(color: string): Rgb {
  if (color.startsWith('rgb')) {
    const nums = color.match(/-?\d+(\.\d+)?/g);
    if (nums && nums.length >= 3) {
      return { r: Number(nums[0]), g: Number(nums[1]), b: Number(nums[2]) };
    }
    return { r: 128, g: 128, b: 128 };
  }
  const h = color.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return { r: 128, g: 128, b: 128 };
  }
  return { r, g, b };
}

export function rgbToCss({ r, g, b }: Rgb, alpha = 1): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return alpha >= 1 ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${alpha})`;
}

/** מכהה (amount<0) או מבהיר (amount>0) צבע. amount בטווח -1..1. */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  if (amount >= 0) {
    return rgbToCss({
      r: r + (255 - r) * amount,
      g: g + (255 - g) * amount,
      b: b + (255 - b) * amount,
    });
  }
  const k = 1 + amount;
  return rgbToCss({ r: r * k, g: g * k, b: b * k });
}

/** מערבב שני צבעים. t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToCss({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/** עוצמות התאורה לשלוש הפאות הנראות (אור מלמעלה-ימין). */
export const FACE_LIGHT = { top: 0.16, right: -0.04, left: -0.3 };

/** צלליות הפאות של גוף בצבע בסיס אחד. */
export function faceColors(base: string) {
  return {
    top: shade(base, FACE_LIGHT.top),
    right: shade(base, FACE_LIGHT.right),
    left: shade(base, FACE_LIGHT.left),
  };
}

export function poly(ctx: CanvasRenderingContext2D, pts: Vec2[], fill: string, stroke?: string): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** מעוין של אריח בודד (או של שטח w×d). */
export function tileDiamond(cam: Camera, wx: number, wy: number, w = 1, d = 1, z = 0): Vec2[] {
  return [
    cam.worldToScreen(wx, wy, z),
    cam.worldToScreen(wx + w, wy, z),
    cam.worldToScreen(wx + w, wy + d, z),
    cam.worldToScreen(wx, wy + d, z),
  ];
}

export type BoxColors = { top: string; left: string; right: string };

/**
 * תיבה תלת-ממדית: בסיס בפינה (wx,wy), מידות w×d אריחים וגובה h.
 * מציירת את שלוש הפאות הנראות בסדר הנכון.
 */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  h: number,
  colors: BoxColors,
  baseZ = 0,
): void {
  const z0 = baseZ;
  const z1 = baseZ + h;
  // פאה שמאלית (הצד שפונה אל +y)
  poly(ctx, [
    cam.worldToScreen(wx, wy + d, z0),
    cam.worldToScreen(wx + w, wy + d, z0),
    cam.worldToScreen(wx + w, wy + d, z1),
    cam.worldToScreen(wx, wy + d, z1),
  ], colors.left);
  // פאה ימנית (הצד שפונה אל +x)
  poly(ctx, [
    cam.worldToScreen(wx + w, wy, z0),
    cam.worldToScreen(wx + w, wy + d, z0),
    cam.worldToScreen(wx + w, wy + d, z1),
    cam.worldToScreen(wx + w, wy, z1),
  ], colors.right);
  // גג שטוח
  poly(ctx, tileDiamond(cam, wx, wy, w, d, z1), colors.top);
}

/** גג רעפים משופע: הרכס לאורך ציר x (ridgeAlongX) או ציר y. */
export function drawGableRoof(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  baseZ: number,
  peak: number,
  base: string,
  ridgeAlongX = true,
  overhang = 0.12,
): void {
  const ox = wx - overhang;
  const oy = wy - overhang;
  const ow = w + overhang * 2;
  const od = d + overhang * 2;
  const top = shade(base, 0.12);
  const dark = shade(base, -0.26);
  const side = shade(base, -0.42);

  if (ridgeAlongX) {
    const midY = oy + od / 2;
    // מדרון אחורי (פונה אל -y) — כמעט לא נראה, מצויר ראשון
    poly(ctx, [
      cam.worldToScreen(ox, oy, baseZ),
      cam.worldToScreen(ox + ow, oy, baseZ),
      cam.worldToScreen(ox + ow, midY, baseZ + peak),
      cam.worldToScreen(ox, midY, baseZ + peak),
    ], top);
    // מדרון קדמי (פונה אל +y)
    poly(ctx, [
      cam.worldToScreen(ox, midY, baseZ + peak),
      cam.worldToScreen(ox + ow, midY, baseZ + peak),
      cam.worldToScreen(ox + ow, oy + od, baseZ),
      cam.worldToScreen(ox, oy + od, baseZ),
    ], dark);
    // גמלון ימני
    poly(ctx, [
      cam.worldToScreen(ox + ow, oy, baseZ),
      cam.worldToScreen(ox + ow, oy + od, baseZ),
      cam.worldToScreen(ox + ow, midY, baseZ + peak),
    ], side);
  } else {
    const midX = ox + ow / 2;
    poly(ctx, [
      cam.worldToScreen(ox, oy, baseZ),
      cam.worldToScreen(ox, oy + od, baseZ),
      cam.worldToScreen(midX, oy + od, baseZ + peak),
      cam.worldToScreen(midX, oy, baseZ + peak),
    ], top);
    poly(ctx, [
      cam.worldToScreen(midX, oy, baseZ + peak),
      cam.worldToScreen(midX, oy + od, baseZ + peak),
      cam.worldToScreen(ox + ow, oy + od, baseZ),
      cam.worldToScreen(ox + ow, oy, baseZ),
    ], dark);
    poly(ctx, [
      cam.worldToScreen(ox, oy + od, baseZ),
      cam.worldToScreen(ox + ow, oy + od, baseZ),
      cam.worldToScreen(midX, oy + od, baseZ + peak),
    ], side);
  }
}

/** גג פירמידה בארבעה מדרונות. */
export function drawHipRoof(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  baseZ: number,
  peak: number,
  base: string,
  overhang = 0.12,
): void {
  const ox = wx - overhang;
  const oy = wy - overhang;
  const ow = w + overhang * 2;
  const od = d + overhang * 2;
  const apex = cam.worldToScreen(ox + ow / 2, oy + od / 2, baseZ + peak);
  const c = [
    cam.worldToScreen(ox, oy, baseZ),
    cam.worldToScreen(ox + ow, oy, baseZ),
    cam.worldToScreen(ox + ow, oy + od, baseZ),
    cam.worldToScreen(ox, oy + od, baseZ),
  ];
  poly(ctx, [c[0], c[1], apex], shade(base, 0.14)); // אחורי-ימני
  poly(ctx, [c[0], c[3], apex], shade(base, -0.34)); // אחורי-שמאלי
  poly(ctx, [c[1], c[2], apex], shade(base, -0.06)); // קדמי-ימני
  poly(ctx, [c[2], c[3], apex], shade(base, -0.24)); // קדמי-שמאלי
}

/** צל אליפטי על הקרקע. */
export function drawShadow(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  radius: number,
  alpha = 0.22,
): void {
  const p = cam.worldToScreen(wx, wy, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#0b1a10';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, radius * cam.zoom * 0.5, radius * cam.zoom * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** עמוד/גליל מקורב במנסרה מתומנת — לעמודים, מגדלים וארובות. */
export function drawColumn(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  radius: number,
  height: number,
  base: string,
  baseZ = 0,
): void {
  const steps = 8;
  const pts: Vec2[] = [];
  const top: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = wx + Math.cos(a) * radius;
    const y = wy + Math.sin(a) * radius;
    pts.push(cam.worldToScreen(x, y, baseZ));
    top.push(cam.worldToScreen(x, y, baseZ + height));
  }
  // דפנות
  for (let i = 0; i < steps; i++) {
    const j = (i + 1) % steps;
    const a = (i / steps) * Math.PI * 2;
    const light = 0.1 - 0.4 * (0.5 + 0.5 * Math.sin(a + Math.PI * 0.75));
    poly(ctx, [pts[i], pts[j], top[j], top[i]], shade(base, light));
  }
  poly(ctx, top, shade(base, 0.18));
}

/** דגל מתנופף על תורן. */
export function drawFlag(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  baseZ: number,
  height: number,
  color: string,
  time: number,
): void {
  const bottom = cam.worldToScreen(wx, wy, baseZ);
  const top = cam.worldToScreen(wx, wy, baseZ + height);
  ctx.strokeStyle = '#6b5b45';
  ctx.lineWidth = Math.max(1, cam.zoom * 0.025);
  ctx.beginPath();
  ctx.moveTo(bottom.x, bottom.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  const w = cam.zoom * 0.28;
  const h = cam.zoom * 0.16;
  const wave = Math.sin(time * 0.004 + wx + wy) * h * 0.22;
  poly(ctx, [
    { x: top.x, y: top.y + 1 },
    { x: top.x + w, y: top.y + h * 0.35 + wave },
    { x: top.x + w, y: top.y + h + wave },
    { x: top.x, y: top.y + h * 0.9 },
  ], color);
}

/** סגנונות גג — מה שנותן לכל אומה את השפה האדריכלית שלה. */
export type RoofStyle = 'gable' | 'hip' | 'pagoda' | 'dome' | 'flat' | 'turf';

/** כיפה מקורבת בחצי-כדור, לאדריכלות עם קשתות. */
export function drawDomeRoof(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  cx: number,
  cy: number,
  radius: number,
  baseZ: number,
  height: number,
  base: string,
): void {
  const rings = 6;
  // מלמטה למעלה: הטבעת הרחבה והנמוכה ראשונה, והצרות מעליה.
  // בסדר ההפוך הטבעת התחתונה כיסתה את כל הכיפה והיא נראתה כמו גומה.
  for (let i = 0; i < rings; i++) {
    const t = i / rings;
    const r = radius * Math.cos((t * Math.PI) / 2);
    const z = baseZ + height * Math.sin((t * Math.PI) / 2);
    const pts: Vec2[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      pts.push(cam.worldToScreen(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
    }
    poly(ctx, pts, shade(base, -0.24 + t * 0.4));
  }
}

/** גג שטוח עם מעקה — אדריכלות מדברית/מודרנית. */
export function drawFlatRoof(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  baseZ: number,
  base: string,
): void {
  poly(ctx, tileDiamond(cam, wx, wy, w, d, baseZ), shade(base, 0.1));
  const t = Math.min(w, d) * 0.08;
  // מעקה בשתי הפאות הנראות
  drawBox(ctx, cam, wx, wy + d - t, w, t, 0.1, faceColors(shade(base, -0.05)), baseZ);
  drawBox(ctx, cam, wx + w - t, wy, t, d - t, 0.1, faceColors(shade(base, -0.02)), baseZ);
}

/** גג פגודה: שתי שכבות רעפים רחבות עם מרזבים בולטים. */
export function drawPagodaRoof(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  baseZ: number,
  peak: number,
  base: string,
): void {
  drawHipRoof(ctx, cam, wx, wy, w, d, baseZ, peak * 0.42, base, 0.34);
  const inset = Math.min(w, d) * 0.16;
  drawHipRoof(
    ctx, cam,
    wx + inset, wy + inset,
    w - inset * 2, d - inset * 2,
    baseZ + peak * 0.46, peak * 0.58,
    shade(base, 0.06), 0.3,
  );
}

/** בוחר ומצייר גג לפי הסגנון של האומה. */
export function drawRoof(
  style: RoofStyle,
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  baseZ: number,
  peak: number,
  base: string,
  ridgeAlongX = true,
): void {
  switch (style) {
    case 'hip':
      drawHipRoof(ctx, cam, wx, wy, w, d, baseZ, peak, base, 0.14);
      break;
    case 'pagoda':
      drawPagodaRoof(ctx, cam, wx, wy, w, d, baseZ, peak * 1.15, base);
      break;
    case 'dome':
      drawFlatRoof(ctx, cam, wx, wy, w, d, baseZ, base);
      drawDomeRoof(ctx, cam, wx + w / 2, wy + d / 2, Math.min(w, d) * 0.42, baseZ + 0.08, peak * 1.1, base);
      break;
    case 'flat':
      drawFlatRoof(ctx, cam, wx, wy, w, d, baseZ, base);
      break;
    case 'turf':
      drawGableRoof(ctx, cam, wx, wy, w, d, baseZ, peak * 1.35, base, ridgeAlongX, 0.24);
      break;
    case 'gable':
    default:
      drawGableRoof(ctx, cam, wx, wy, w, d, baseZ, peak, base, ridgeAlongX);
      break;
  }
}
