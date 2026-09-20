import type { Vec2 } from '../core/types';
import type { Camera } from './camera';
import { surfacePattern, TEXELS_PER_TILE, type Surface } from './art/surfaces';

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
/**
 * תאורה כיוונית אחידה לכל הגופים: פאה עליונה מוארת, ימנית ניטרלית,
 * שמאלית מוצללת. ניגוד גבוה יותר בין הפאות = הגוף נקרא כנפח ולא
 * כמדבקה שטוחה.
 */
export const FACE_LIGHT = { top: 0.2, right: -0.07, left: -0.4 };

/**
 * האם לצייר טקסטורות משטח בזום הנוכחי.
 * בזום נמוך אריח טקסטורה קטן מפיקסל, ואז הוא רק רעש שעולה זמן.
 */
export function texturesOn(cam: Camera): boolean {
  return cam.zoom >= 26;
}

type V3 = { x: number; y: number; z: number };

/**
 * ממלא מרובע מישורי בטקסטורה **מיושרת למשטח**.
 *
 * הטריק: במקום לחשב פוליגון במרחב המסך ולמלא אותו בדפוס (שהיה נמרח
 * בכיוון שרירותי), מגדירים טרנספורם שממפה את מרחב הטקסטורה ישירות אל
 * המשטח — שני וקטורי הקצה שלו במרחב העולם. כך נדבכי אבן רצים לאורך
 * הקיר, שורות רעפים לאורך המדרון, וקרשים לאורך הדופן.
 *
 * `u` ו-`v` הם וקטורי הקצה המלאים של המרובע (לא מנורמלים).
 */
export function fillQuad(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  origin: V3,
  u: V3,
  v: V3,
  kind: Surface,
  color: string,
): void {
  const ulen = Math.hypot(u.x, u.y, u.z);
  const vlen = Math.hypot(v.x, v.y, v.z);
  if (ulen < 1e-5 || vlen < 1e-5) return;
  const pat = surfacePattern(ctx, kind, color);
  if (!pat) return;

  const z = cam.zoom;
  // נגזרות ההקרנה: +x, +y ו-+z במרחב המסך
  const sx = (d: V3): number => ((d.x - d.y) * z) / 2;
  const sy = (d: V3): number => ((d.x + d.y) * z) / 4 - (d.z * z) / 2;
  const uh = { x: u.x / ulen, y: u.y / ulen, z: u.z / ulen };
  const vh = { x: v.x / vlen, y: v.y / vlen, z: v.z / vlen };
  const s = 1 / TEXELS_PER_TILE;
  const o = cam.worldToScreen(origin.x, origin.y, origin.z);

  ctx.save();
  ctx.transform(sx(uh) * s, sy(uh) * s, sx(vh) * s, sy(vh) * s, o.x, o.y);
  ctx.fillStyle = pat;
  // חצי טקסל חפיפה מכסה תפרי עיגול בין פאות שכנות
  ctx.fillRect(-0.5, -0.5, ulen / s + 1, vlen / s + 1);
  ctx.restore();
}

/**
 * מילוי פוליגון עם טקסטורה במרחב המסך.
 * משמש לגופים שאינם מרובעים מישוריים — דמויות, נוף, סלעים. בקנה מידה
 * הזה הכיוון המדויק של החומר לא נקרא, ומספיק שיש לו מרקם.
 */
export function polyTextured(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  pts: Vec2[],
  fill: string,
  kind: Surface,
): void {
  poly(ctx, pts, fill);
  if (!texturesOn(cam)) return;
  const pat = surfacePattern(ctx, kind, fill);
  if (!pat) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();
  const s = cam.zoom / TEXELS_PER_TILE / 2;
  ctx.translate(pts[0].x, pts[0].y);
  ctx.scale(s, s);
  ctx.fillStyle = pat;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-400, -400, 800, 800);
  ctx.restore();
}

/** כמה כהה תחתית הקיר (הצללה סביבתית) וכמה גבוה הפס. */
const WALL_AO = { strength: 0.16, height: 0.42 };

/**
 * צלליות הפאות של גוף בצבע בסיס אחד.
 * `surface` אופציונלי — אם נתון, הפאות יקבלו גם טקסטורת חומר.
 */
export function faceColors(base: string, surface?: Surface): BoxColors {
  return {
    top: shade(base, FACE_LIGHT.top),
    right: shade(base, FACE_LIGHT.right),
    left: shade(base, FACE_LIGHT.left),
    surface,
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

/** כמו polyTextured, לצורות עגולות (צמרות עצים, שיחים). */
export function circleTextured(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  kind: Surface,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!texturesOn(cam)) return;
  const pat = surfacePattern(ctx, kind, fill);
  if (!pat) return;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  const s = cam.zoom / TEXELS_PER_TILE / 2;
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = pat;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-400, -400, 800, 800);
  ctx.restore();
}

/**
 * מוסיף טקסטורה לצורה שכבר נבנתה ב-path הנוכחי ומולאה.
 * נועד לצורות עגולות שמצוירות ב-arc (קסדות, מגנים, כיפות), שבהן אין
 * מרובע מישורי להיתלות בו.
 */
export function texturizePath(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  fill: string,
  kind: Surface,
  anchorX: number,
  anchorY: number,
): void {
  if (!texturesOn(cam)) return;
  const pat = surfacePattern(ctx, kind, fill);
  if (!pat) return;
  ctx.save();
  ctx.clip();
  const s = cam.zoom / TEXELS_PER_TILE / 2;
  ctx.translate(anchorX, anchorY);
  ctx.scale(s, s);
  ctx.fillStyle = pat;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-500, -500, 1000, 1000);
  ctx.restore();
}

export type BoxColors = { top: string; left: string; right: string; surface?: Surface };

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
  const tex = colors.surface && texturesOn(cam) ? colors.surface : null;
  // גובה הפס הכהה בתחתית — מדמה הצללה סביבתית ליד הקרקע
  const ao = Math.min(h * WALL_AO.height, 0.34);
  // פאה שמאלית (הצד שפונה אל +y)
  poly(ctx, [
    cam.worldToScreen(wx, wy + d, z0),
    cam.worldToScreen(wx + w, wy + d, z0),
    cam.worldToScreen(wx + w, wy + d, z1),
    cam.worldToScreen(wx, wy + d, z1),
  ], colors.left);
  if (tex) {
    fillQuad(ctx, cam, { x: wx, y: wy + d, z: z0 }, { x: w, y: 0, z: 0 }, { x: 0, y: 0, z: h }, tex, colors.left);
  }
  if (ao > 0.02) {
    poly(ctx, [
      cam.worldToScreen(wx, wy + d, z0),
      cam.worldToScreen(wx + w, wy + d, z0),
      cam.worldToScreen(wx + w, wy + d, z0 + ao),
      cam.worldToScreen(wx, wy + d, z0 + ao),
    ], shade(colors.left, -WALL_AO.strength));
  }
  // פאה ימנית (הצד שפונה אל +x)
  poly(ctx, [
    cam.worldToScreen(wx + w, wy, z0),
    cam.worldToScreen(wx + w, wy + d, z0),
    cam.worldToScreen(wx + w, wy + d, z1),
    cam.worldToScreen(wx + w, wy, z1),
  ], colors.right);
  if (tex) {
    fillQuad(ctx, cam, { x: wx + w, y: wy, z: z0 }, { x: 0, y: d, z: 0 }, { x: 0, y: 0, z: h }, tex, colors.right);
  }
  if (ao > 0.02) {
    poly(ctx, [
      cam.worldToScreen(wx + w, wy, z0),
      cam.worldToScreen(wx + w, wy + d, z0),
      cam.worldToScreen(wx + w, wy + d, z0 + ao),
      cam.worldToScreen(wx + w, wy, z0 + ao),
    ], shade(colors.right, -WALL_AO.strength));
  }
  // גג שטוח
  poly(ctx, tileDiamond(cam, wx, wy, w, d, z1), colors.top);
  if (tex) {
    fillQuad(ctx, cam, { x: wx, y: wy, z: z1 }, { x: w, y: 0, z: 0 }, { x: 0, y: d, z: 0 }, tex, colors.top);
  }
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
  surface?: Surface,
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
    if (surface && texturesOn(cam)) {
      fillQuad(ctx, cam, { x: ox, y: oy + od, z: baseZ },
        { x: ow, y: 0, z: 0 }, { x: 0, y: -od / 2, z: peak }, surface, dark);
      fillQuad(ctx, cam, { x: ox, y: oy, z: baseZ },
        { x: ow, y: 0, z: 0 }, { x: 0, y: od / 2, z: peak }, surface, top);
    }
    const rows = Math.max(2, Math.round(od * 2.4));
    drawRoofCourses(ctx, cam,
      { x: ox, y: midY, z: baseZ + peak }, { x: ox + ow, y: midY, z: baseZ + peak },
      { x: ox, y: oy + od, z: baseZ }, { x: ox + ow, y: oy + od, z: baseZ },
      rows, shade(base, -0.42));
    drawRoofCourses(ctx, cam,
      { x: ox, y: midY, z: baseZ + peak }, { x: ox + ow, y: midY, z: baseZ + peak },
      { x: ox, y: oy, z: baseZ }, { x: ox + ow, y: oy, z: baseZ },
      rows, shade(base, -0.06));
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
    if (surface && texturesOn(cam)) {
      fillQuad(ctx, cam, { x: ox + ow, y: oy, z: baseZ },
        { x: 0, y: od, z: 0 }, { x: -ow / 2, y: 0, z: peak }, surface, dark);
      fillQuad(ctx, cam, { x: ox, y: oy, z: baseZ },
        { x: 0, y: od, z: 0 }, { x: ow / 2, y: 0, z: peak }, surface, top);
    }
    const rows = Math.max(2, Math.round(ow * 2.4));
    drawRoofCourses(ctx, cam,
      { x: midX, y: oy, z: baseZ + peak }, { x: midX, y: oy + od, z: baseZ + peak },
      { x: ox + ow, y: oy, z: baseZ }, { x: ox + ow, y: oy + od, z: baseZ },
      rows, shade(base, -0.44));
    drawRoofCourses(ctx, cam,
      { x: midX, y: oy, z: baseZ + peak }, { x: midX, y: oy + od, z: baseZ + peak },
      { x: ox, y: oy, z: baseZ }, { x: ox, y: oy + od, z: baseZ },
      rows, shade(base, -0.08));
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
  surface?: Surface,
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
  if (surface && texturesOn(cam)) {
    // ארבעת המדרונות, כל אחד מהמרזב אל הפסגה
    fillQuad(ctx, cam, { x: ox, y: oy + od, z: baseZ },
      { x: ow, y: 0, z: 0 }, { x: 0, y: -od / 2, z: peak }, surface, shade(base, -0.24));
    fillQuad(ctx, cam, { x: ox + ow, y: oy, z: baseZ },
      { x: 0, y: od, z: 0 }, { x: -ow / 2, y: 0, z: peak }, surface, shade(base, -0.06));
  }
  const rows = Math.max(2, Math.round(Math.min(ow, od) * 2));
  const top = { x: ox + ow / 2, y: oy + od / 2, z: baseZ + peak };
  drawRoofCourses(ctx, cam, top, top,
    { x: ox + ow, y: oy, z: baseZ }, { x: ox + ow, y: oy + od, z: baseZ },
    rows, shade(base, -0.34));
  drawRoofCourses(ctx, cam, top, top,
    { x: ox, y: oy + od, z: baseZ }, { x: ox + ow, y: oy + od, z: baseZ },
    rows, shade(base, -0.46));
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
  surface?: Surface,
): void {
  const steps = 8;
  const pts: Vec2[] = [];
  const top: Vec2[] = [];
  const world: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = wx + Math.cos(a) * radius;
    const y = wy + Math.sin(a) * radius;
    world.push({ x, y });
    pts.push(cam.worldToScreen(x, y, baseZ));
    top.push(cam.worldToScreen(x, y, baseZ + height));
  }
  const tex = surface && texturesOn(cam) ? surface : null;
  // דפנות
  for (let i = 0; i < steps; i++) {
    const j = (i + 1) % steps;
    const a = (i / steps) * Math.PI * 2;
    const light = 0.1 - 0.4 * (0.5 + 0.5 * Math.sin(a + Math.PI * 0.75));
    const color = shade(base, light);
    poly(ctx, [pts[i], pts[j], top[j], top[i]], color);
    if (tex) {
      fillQuad(
        ctx, cam,
        { x: world[i].x, y: world[i].y, z: baseZ },
        { x: world[j].x - world[i].x, y: world[j].y - world[i].y, z: 0 },
        { x: 0, y: 0, z: height },
        tex, color,
      );
    }
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
    polyTextured(ctx, cam, pts, shade(base, -0.24 + t * 0.4), 'plaster');
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
  if (texturesOn(cam)) {
    fillQuad(ctx, cam, { x: wx, y: wy, z: baseZ }, { x: w, y: 0, z: 0 }, { x: 0, y: d, z: 0 },
      'plaster', shade(base, 0.1));
  }
  const t = Math.min(w, d) * 0.08;
  // מעקה בשתי הפאות הנראות
  drawBox(ctx, cam, wx, wy + d - t, w, t, 0.1, faceColors(shade(base, -0.05), 'plaster'), baseZ);
  drawBox(ctx, cam, wx + w - t, wy, t, d - t, 0.1, faceColors(shade(base, -0.02), 'plaster'), baseZ);
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
  drawHipRoof(ctx, cam, wx, wy, w, d, baseZ, peak * 0.42, base, 0.34, 'tile');
  const inset = Math.min(w, d) * 0.16;
  drawHipRoof(
    ctx, cam,
    wx + inset, wy + inset,
    w - inset * 2, d - inset * 2,
    baseZ + peak * 0.46, peak * 0.58,
    shade(base, 0.06), 0.3, 'tile',
  );
}

/** בוחר ומצייר גג לפי הסגנון של האומה. */
/** חומר הגג לפי הסגנון האדריכלי. */
export function roofSurface(style: RoofStyle): Surface {
  switch (style) {
    case 'turf':
      return 'turf';
    case 'dome':
    case 'flat':
      return 'plaster';
    default:
      return 'tile';
  }
}

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
  const surface = roofSurface(style);
  switch (style) {
    case 'hip':
      drawHipRoof(ctx, cam, wx, wy, w, d, baseZ, peak, base, 0.14, surface);
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
      drawGableRoof(ctx, cam, wx, wy, w, d, baseZ, peak * 1.35, base, ridgeAlongX, 0.24, surface);
      break;
    case 'gable':
    default:
      drawGableRoof(ctx, cam, wx, wy, w, d, baseZ, peak, base, ridgeAlongX, 0.12, surface);
      break;
  }
}

/**
 * כיוון השמש, ביחידות אריח להיסט לכל יחידת גובה.
 * נבחר כך שהצללים נופלים שמאלה-מטה על המסך (שמש מימין-מעלה),
 * באותו כיוון שבו מוצללות הפאות של כל גוף.
 */
export const SUN = { dx: -0.52, dy: 0.86 };

/** צבע הצל המוטל. */
export const SHADOW_FILL = 'rgba(12, 22, 16, 0.3)';

/** היסט הצל במרחב המסך ליחידת גובה אחת. */
export function shadowScreenOffset(cam: Camera): Vec2 {
  return {
    x: (SUN.dx - SUN.dy) * (cam.zoom / 2),
    y: (SUN.dx + SUN.dy) * (cam.zoom / 4),
  };
}

/** עוטף קמור של נקודות מסך (Andrew monotone chain). */
function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * צל מוטל של גוף מלבני על הקרקע.
 *
 * הצל הוא העוטף הקמור של טביעת הרגל ושל טביעת הרגל המוסטת בכיוון
 * השמש לפי הגובה — כלומר בדיוק מה שגוף קופסתי היה מטיל.
 */
export function drawCastShadow(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  height: number,
): void {
  if (height <= 0.02) return;
  const ox = SUN.dx * height;
  const oy = SUN.dy * height;
  const base: Vec2[] = [
    cam.worldToScreen(wx, wy, 0),
    cam.worldToScreen(wx + w, wy, 0),
    cam.worldToScreen(wx + w, wy + d, 0),
    cam.worldToScreen(wx, wy + d, 0),
  ];
  const top: Vec2[] = [
    cam.worldToScreen(wx + ox, wy + oy, 0),
    cam.worldToScreen(wx + w + ox, wy + oy, 0),
    cam.worldToScreen(wx + w + ox, wy + d + oy, 0),
    cam.worldToScreen(wx + ox, wy + d + oy, 0),
  ];
  poly(ctx, convexHull([...base, ...top]), SHADOW_FILL);
}

/** צל מוטל של גוף צר וגבוה (עץ, עמוד, דמות). */
export function drawCastShadowEllipse(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  radius: number,
  height: number,
): void {
  const mid = height * 0.5;
  const c = cam.worldToScreen(wx + SUN.dx * mid, wy + SUN.dy * mid, 0);
  const len = height * cam.zoom * 0.34;
  ctx.save();
  ctx.fillStyle = SHADOW_FILL;
  ctx.translate(c.x, c.y);
  // מאורך בכיוון השמש
  const off = shadowScreenOffset(cam);
  ctx.rotate(Math.atan2(off.y, off.x));
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(2, radius * cam.zoom * 0.5 + len * 0.5), Math.max(1.5, radius * cam.zoom * 0.28), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ===== פירוט פני שטח =====

/**
 * רמת הפירוט לפי הזום. בזום נמוך המבנים קטנים מכדי שפרט ייקרא,
 * וציור חלונות ונדבכים רק יוצר רעש (ועולה זמן). לכן הפירוט נדלק
 * בהדרגה: קודם פתחים, ואחר כך מרקם הקיר.
 */
export function detailLevel(cam: Camera): 0 | 1 | 2 {
  if (cam.zoom < 30) return 0;
  if (cam.zoom < 50) return 1;
  return 2;
}

/** גיבוב דטרמיניסטי קטן — כדי שאותו מבנה ייראה אותו דבר בכל פריים. */
function hash3(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * נקודה על פאה אנכית של תיבה.
 * `side` הוא 'left' (הפאה שפונה אל +y) או 'right' (אל +x).
 * `u` רץ 0..1 לאורך הפאה, `v` רץ 0..1 מהקרקע אל הגג.
 */
export function facePoint(
  cam: Camera,
  wx: number, wy: number, w: number, d: number, h: number,
  side: 'left' | 'right',
  u: number, v: number,
  baseZ = 0,
): Vec2 {
  return side === 'left'
    ? cam.worldToScreen(wx + u * w, wy + d, baseZ + v * h)
    : cam.worldToScreen(wx + w, wy + u * d, baseZ + v * h);
}

export type FacadeOpts = {
  /** נדבכי אבן אופקיים */
  courses?: number;
  /** קרשים אנכיים */
  planks?: number;
  /** חלונות בכל פאה: עמודות × שורות */
  windows?: number;
  windowRows?: number;
  /** חלונות מוארים (ערב/מבנה פעיל) */
  lit?: boolean;
  /** דלת במרכז הפאה השמאלית */
  door?: boolean;
  seed?: number;
  baseZ?: number;
};

const LIT_WINDOW = '#ffd98a';

/**
 * מצייר את מרקם הקיר ואת הפתחים על שתי הפאות הנראות של תיבה.
 * נקרא אחרי `drawBox` על אותן קואורדינטות בדיוק.
 */
export function drawFacade(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number, wy: number, w: number, d: number, h: number,
  wallColor: string,
  opts: FacadeOpts = {},
): void {
  const level = detailLevel(cam);
  if (level === 0 || h < 0.12) return;
  const seed = opts.seed ?? 0;
  const baseZ = opts.baseZ ?? 0;
  const sides: Array<'left' | 'right'> = ['left', 'right'];
  const pt = (side: 'left' | 'right', u: number, v: number) =>
    facePoint(cam, wx, wy, w, d, h, side, u, v, baseZ);

  // מרקם הקיר — רק בזום גבוה
  if (level === 2) {
    ctx.save();
    ctx.lineWidth = Math.max(0.6, cam.zoom * 0.012);
    if (opts.courses && opts.courses > 1) {
      ctx.strokeStyle = shade(wallColor, -0.24);
      for (const side of sides) {
        for (let i = 1; i < opts.courses; i++) {
          const v = i / opts.courses;
          const a = pt(side, 0, v);
          const b = pt(side, 1, v);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    if (opts.planks && opts.planks > 1) {
      ctx.strokeStyle = shade(wallColor, -0.2);
      for (const side of sides) {
        for (let i = 1; i < opts.planks; i++) {
          const u = i / opts.planks;
          const a = pt(side, u, 0);
          const b = pt(side, u, 1);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // חלונות
  const cols = opts.windows ?? 0;
  if (cols > 0) {
    const rows = opts.windowRows ?? 1;
    // חלונות גבוהים מרוחבם — אחרת הם נקראים כפס ולא כפתח
    const uw = Math.min(0.13, 0.42 / cols);
    const vh = Math.min(0.34, 0.52 / rows);
    const dark = shade(wallColor, -0.62);
    const sill = shade(wallColor, -0.3);
    for (const side of sides) {
      for (let r = 0; r < rows; r++) {
        const vc = rows === 1 ? 0.56 : 0.34 + (r / (rows - 1)) * 0.42;
        for (let c = 0; c < cols; c++) {
          const uc = (c + 0.5) / cols;
          const litHere = opts.lit && hash3(seed + (side === 'left' ? 11 : 23), r, c) > 0.45;
          poly(ctx, [
            pt(side, uc - uw / 2, vc - vh / 2),
            pt(side, uc + uw / 2, vc - vh / 2),
            pt(side, uc + uw / 2, vc + vh / 2),
            pt(side, uc - uw / 2, vc + vh / 2),
          ], litHere ? LIT_WINDOW : dark);
          if (level === 2) {
            // אדן
            poly(ctx, [
              pt(side, uc - uw * 0.62, vc - vh / 2),
              pt(side, uc + uw * 0.62, vc - vh / 2),
              pt(side, uc + uw * 0.62, vc - vh / 2 - 0.035),
              pt(side, uc - uw * 0.62, vc - vh / 2 - 0.035),
            ], sill);
          }
        }
      }
    }
  }

  // דלת — על הפאה שפונה אל הצופה
  if (opts.door) {
    const uw = Math.min(0.2, 0.9 / Math.max(1, w));
    const vh = Math.min(0.5, 0.36 / h + 0.16);
    const frame = shade(wallColor, -0.34);
    const leaf = shade(wallColor, -0.7);
    poly(ctx, [
      pt('left', 0.5 - uw * 0.8, 0),
      pt('left', 0.5 + uw * 0.8, 0),
      pt('left', 0.5 + uw * 0.8, vh + 0.05),
      pt('left', 0.5 - uw * 0.8, vh + 0.05),
    ], frame);
    poly(ctx, [
      pt('left', 0.5 - uw / 2, 0),
      pt('left', 0.5 + uw / 2, 0),
      pt('left', 0.5 + uw / 2, vh),
      pt('left', 0.5 - uw / 2, vh),
    ], leaf);
  }
}

/**
 * שורות רעפים על מדרון גג.
 * המדרון מוגדר בארבע פינות עולם (עם גובה לכל אחת), והשורות מצוירות
 * במקביל לרכס — כך הן נראות נכון גם אחרי ההטיה האיזומטרית.
 */
export function drawRoofCourses(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  ridgeA: { x: number; y: number; z: number },
  ridgeB: { x: number; y: number; z: number },
  eaveA: { x: number; y: number; z: number },
  eaveB: { x: number; y: number; z: number },
  rows: number,
  color: string,
): void {
  if (detailLevel(cam) < 2 || rows < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, cam.zoom * 0.014);
  for (let i = 1; i < rows; i++) {
    const t = i / rows;
    const a = cam.worldToScreen(
      ridgeA.x + (eaveA.x - ridgeA.x) * t,
      ridgeA.y + (eaveA.y - ridgeA.y) * t,
      ridgeA.z + (eaveA.z - ridgeA.z) * t,
    );
    const b = cam.worldToScreen(
      ridgeB.x + (eaveB.x - ridgeB.x) * t,
      ridgeB.y + (eaveB.y - ridgeB.y) * t,
      ridgeB.z + (eaveB.z - ridgeB.z) * t,
    );
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}
