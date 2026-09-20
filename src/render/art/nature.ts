import type { TileResource } from '../../core/types';
import type { Camera } from '../camera';
import { drawCastShadowEllipse, drawColumn, poly, shade } from '../iso';

/** גיוון דטרמיניסטי לפי אריח — אותו עץ ייראה אותו דבר בכל פריים. */
export function tileHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const CONIFER = ['#2f6b3a', '#377a42', '#2a5f34', '#3f8449'];
const BROADLEAF = ['#4a8b3a', '#3f7a33', '#568f42'];

/** עץ מחט (אורן/ברוש) — שלוש שכבות חרוט. */
export function drawConifer(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  h: number,
  seed: number,
): void {
  const trunk = '#6b4a2f';
  const leaf = CONIFER[Math.floor(tileHash(wx, wy, seed) * CONIFER.length)];
  drawCastShadowEllipse(ctx, cam, wx, wy, 0.3, h * 0.9);
  drawColumn(ctx, cam, wx, wy, 0.085, h * 0.3, trunk);
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const z = h * (0.14 + t * 0.56);
    const r = 0.42 * (1 - t * 0.5);
    const peak = z + h * 0.38;
    const apex = cam.worldToScreen(wx, wy, peak);
    const ring = 10;
    const pts = [];
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      pts.push(cam.worldToScreen(wx + Math.cos(a) * r, wy + Math.sin(a) * r, z));
    }
    // בסיס החרוט (נראה מלמטה רק בקצוות)
    poly(ctx, pts, shade(leaf, -0.3));
    // דפנות החרוט
    for (let k = 0; k < ring; k++) {
      const j = (k + 1) % ring;
      const a = (k / ring) * Math.PI * 2;
      const light = 0.14 - 0.42 * (0.5 + 0.5 * Math.sin(a + Math.PI * 0.75));
      poly(ctx, [pts[k], pts[j], apex], shade(leaf, light));
    }
  }
}

/** עץ רחב-עלים — כיפה עגולה. */
export function drawBroadleaf(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  h: number,
  seed: number,
): void {
  const leaf = BROADLEAF[Math.floor(tileHash(wx, wy, seed) * BROADLEAF.length)];
  drawCastShadowEllipse(ctx, cam, wx, wy, 0.34, h * 0.85);
  drawColumn(ctx, cam, wx, wy, 0.095, h * 0.42, '#6b4a2f');
  const c = cam.worldToScreen(wx, wy, h * 0.72);
  const r = cam.zoom * 0.28;
  ctx.fillStyle = shade(leaf, -0.18);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = leaf;
  ctx.beginPath();
  ctx.arc(c.x + r * 0.18, c.y - r * 0.2, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(leaf, 0.16);
  ctx.beginPath();
  ctx.arc(c.x + r * 0.3, c.y - r * 0.36, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

/** גוש סלע — למכרות אבן ולעיטור. */
export function drawRocks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  seed: number,
  color = '#8d949c',
): void {
  drawCastShadowEllipse(ctx, cam, wx, wy, 0.3, 0.3);
  const count = 3;
  for (let i = 0; i < count; i++) {
    const hx = tileHash(wx, wy, seed + i * 17);
    const hy = tileHash(wx, wy, seed + i * 31);
    const ox = (hx - 0.5) * 0.5;
    const oy = (hy - 0.5) * 0.5;
    const size = 0.14 + hx * 0.13;
    const height = 0.18 + hy * 0.2;
    const c = shade(color, (hx - 0.5) * 0.22);
    const p0 = cam.worldToScreen(wx + ox - size, wy + oy, 0);
    const p1 = cam.worldToScreen(wx + ox, wy + oy - size, 0);
    const p2 = cam.worldToScreen(wx + ox + size, wy + oy, 0);
    const p3 = cam.worldToScreen(wx + ox, wy + oy + size, 0);
    const top = cam.worldToScreen(wx + ox, wy + oy, height);
    poly(ctx, [p0, p3, top], shade(c, -0.3));
    poly(ctx, [p3, p2, top], shade(c, -0.12));
    poly(ctx, [p2, p1, top], shade(c, 0.16));
    poly(ctx, [p1, p0, top], shade(c, 0.02));
  }
}

/** מכרה זהב — סלעים עם עורקים נוצצים. */
export function drawGoldMine(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  seed: number,
  time: number,
): void {
  drawRocks(ctx, cam, wx, wy, seed, '#7d7466');
  const sparkle = 0.5 + 0.5 * Math.sin(time * 0.003 + wx * 1.7 + wy);
  for (let i = 0; i < 4; i++) {
    const hx = tileHash(wx, wy, seed + i * 53);
    const hy = tileHash(wx, wy, seed + i * 71);
    const p = cam.worldToScreen(wx + (hx - 0.5) * 0.5, wy + (hy - 0.5) * 0.5, 0.12 + hy * 0.14);
    ctx.fillStyle = shade('#f0c33c', sparkle * 0.3 - 0.1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, cam.zoom * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** שיח פירות. */
export function drawBerryBush(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  seed: number,
): void {
  drawCastShadowEllipse(ctx, cam, wx, wy, 0.22, 0.3);
  const c = cam.worldToScreen(wx, wy, 0.16);
  const r = cam.zoom * 0.17;
  ctx.fillStyle = '#2f6136';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, r, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3d7a44';
  ctx.beginPath();
  ctx.ellipse(c.x + r * 0.16, c.y - r * 0.2, r * 0.7, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const hx = tileHash(wx, wy, seed + i * 13);
    const hy = tileHash(wx, wy, seed + i * 29);
    ctx.fillStyle = '#b9345a';
    ctx.beginPath();
    ctx.arc(c.x + (hx - 0.5) * r * 1.5, c.y + (hy - 0.5) * r, Math.max(1, cam.zoom * 0.03), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** דגים — סנפיר שמבצבץ מהמים. */
export function drawFish(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  time: number,
): void {
  const wob = Math.sin(time * 0.002 + wx + wy) * 0.12;
  const c = cam.worldToScreen(wx + wob, wy - wob, 0.02);
  ctx.fillStyle = '#5c8fb8';
  ctx.beginPath();
  ctx.moveTo(c.x - cam.zoom * 0.1, c.y);
  ctx.lineTo(c.x, c.y - cam.zoom * 0.09);
  ctx.lineTo(c.x + cam.zoom * 0.1, c.y);
  ctx.closePath();
  ctx.fill();
}

/** שדה חקלאי עם תלמים. */
export function drawFarmField(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  w: number,
  d: number,
  growth: number,
): void {
  // אדמה חרושה
  poly(ctx, [
    cam.worldToScreen(wx, wy, 0.03),
    cam.worldToScreen(wx + w, wy, 0.03),
    cam.worldToScreen(wx + w, wy + d, 0.03),
    cam.worldToScreen(wx, wy + d, 0.03),
  ], '#6d5535');
  // תלמים מוגבהים עם יבול — כל תלם הוא רצועה תלת-ממדית דקה
  const rows = 5;
  const crop = `hsl(${68 + growth * 18}, ${48 + growth * 18}%, ${34 + growth * 16}%)`;
  for (let i = 0; i < rows; i++) {
    const t0 = wx + ((i + 0.18) / rows) * w;
    const t1 = wx + ((i + 0.82) / rows) * w;
    poly(ctx, [
      cam.worldToScreen(t0, wy + 0.06, 0.03),
      cam.worldToScreen(t1, wy + 0.06, 0.03),
      cam.worldToScreen(t1, wy + d - 0.06, 0.03),
      cam.worldToScreen(t0, wy + d - 0.06, 0.03),
    ], shade(crop, -0.25));
    poly(ctx, [
      cam.worldToScreen(t0, wy + 0.06, 0.1),
      cam.worldToScreen(t1, wy + 0.06, 0.1),
      cam.worldToScreen(t1, wy + d - 0.06, 0.1),
      cam.worldToScreen(t0, wy + d - 0.06, 0.1),
    ], crop);
  }
}

/** בוחר את ציור המשאב המתאים. */
export function drawResource(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  res: TileResource,
  time: number,
): void {
  const cx = wx + 0.5;
  const cy = wy + 0.5;
  switch (res.visual) {
    case 'tree': {
      const h = 0.95 + tileHash(wx, wy, 5) * 0.5;
      if (tileHash(wx, wy, 9) > 0.7) drawBroadleaf(ctx, cam, cx, cy, h, 3);
      else drawConifer(ctx, cam, cx, cy, h, 3);
      break;
    }
    case 'stone_mine':
      drawRocks(ctx, cam, cx, cy, 11);
      break;
    case 'gold_mine':
      drawGoldMine(ctx, cam, cx, cy, 13, time);
      break;
    case 'berry':
      drawBerryBush(ctx, cam, cx, cy, 17);
      break;
    case 'fish':
      drawFish(ctx, cam, cx, cy, time);
      break;
    case 'farm':
      drawFarmField(ctx, cam, wx, wy, 1, 1, 0.6);
      break;
  }
}

const FLOWERS = ['#e8d45a', '#e07a9a', '#d8e0ec', '#c98adf'];

/**
 * פרטי קרקע קטנים — קווצות עשב, פרחים וחצץ.
 *
 * נצרבים יחד עם שכבת הקרקע המטמונה, ולכן הם לא עולים דבר בזמן ריצה.
 * מה שמופיע באריח נקבע בגיבוב שלו, כך שהמראה יציב לאורך כל המשחק.
 */
export function drawGroundProps(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  terrain: string,
  worn: boolean,
): void {
  if (worn || cam.zoom < 26) return;
  const grass = terrain === 'grass' || terrain === 'forest';
  const dry = terrain === 'sand' || terrain === 'dirt';
  if (!grass && !dry) return;

  const n = grass ? Math.floor(tileHash(x, y, 71) * 4) : Math.floor(tileHash(x, y, 83) * 3);
  for (let i = 0; i < n; i++) {
    const hx = tileHash(x, y, 101 + i * 7);
    const hy = tileHash(x, y, 211 + i * 7);
    const pick = tileHash(x, y, 307 + i * 13);
    const p = cam.worldToScreen(x + 0.15 + hx * 0.7, y + 0.15 + hy * 0.7, 0);

    if (grass) {
      if (pick > 0.965) {
        // פרח — נקודת צבע קטנה על גבעול
        const stem = cam.worldToScreen(x + 0.15 + hx * 0.7, y + 0.15 + hy * 0.7, 0.07);
        ctx.strokeStyle = '#3f7a33';
        ctx.lineWidth = Math.max(0.6, cam.zoom * 0.012);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(stem.x, stem.y);
        ctx.stroke();
        ctx.fillStyle = FLOWERS[Math.floor(pick * 1000) % FLOWERS.length];
        ctx.beginPath();
        ctx.arc(stem.x, stem.y, Math.max(0.8, cam.zoom * 0.022), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // קווצת עשב — שלושה קווים קצרים שיוצאים מנקודה אחת
        ctx.strokeStyle = pick > 0.5 ? '#35702f' : '#47893a';
        ctx.lineWidth = Math.max(0.7, cam.zoom * 0.018);
        ctx.beginPath();
        for (const dx of [-0.07, 0, 0.07]) {
          const t = cam.worldToScreen(x + 0.15 + hx * 0.7 + dx, y + 0.15 + hy * 0.7, 0.15);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(t.x, t.y);
        }
        ctx.stroke();
      }
    } else {
      // חצץ — אבן זעירה שטוחה
      ctx.fillStyle = pick > 0.5 ? '#bfae8c' : '#a89877';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, Math.max(0.8, cam.zoom * 0.03), Math.max(0.5, cam.zoom * 0.016), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
