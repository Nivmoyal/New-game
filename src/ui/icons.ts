import { getBuilding, getUnit } from '../data';
import { Camera } from '../render/camera';
import { archetypeOf, drawStructure, paletteFor } from '../render/art/structures';
import { lookFor } from '../render/art/appearance';
import { drawPerson, type PersonStyle } from '../render/art/people';
import { drawVehicle } from '../render/art/vehicles';
import { shade } from '../render/iso';

/**
 * אייקונים לסרגל הפעולות, מצוירים מאותה אמנות כמו המשחק.
 *
 * קודם היו כאן אמוג'ים. אמוג'י נראה אחרת בכל מערכת הפעלה, אין לו קשר
 * למה שרואים על המפה, והוא מה שגרם לממשק להיראות חובבני. כאן כל כפתור
 * מקבל תמונה קטנה של המבנה או היחידה עצמם — אותו מבנה שייבנה, באותם
 * צבעים של האומה.
 *
 * המיקום לא מכוון ביד: הציור נעשה על קנבס גדול, נמדד התיחום האמיתי
 * של הפיקסלים, והתוצאה מועתקת ממורכזת ומוקטנת לגודל האייקון. כך שום
 * יחידה לא נחתכת ושום מבנה לא "שוחה" בפינה, בלי מספרי קסם לכל סוג.
 */

const cache = new Map<string, HTMLCanvasElement>();

/** מכפיל ציור-על: מצייר גדול וממזער, כדי לקבל קצוות חלקים. */
const SUPER = 3;
/** שוליים יחסיים סביב האייקון. */
const PAD = 0.07;

type Bounds = { x: number; y: number; w: number; h: number };

/** התיחום של הפיקסלים שאינם שקופים. */
function opaqueBounds(ctx: CanvasRenderingContext2D, size: number): Bounds | null {
  const data = ctx.getImageData(0, 0, size, size).data;
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] <= 12) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** מצייר על קנבס גדול, ומחזיר אייקון ממורכז בגודל המבוקש. */
function renderFitted(
  px: number,
  centre: { x: number; y: number },
  draw: (ctx: CanvasRenderingContext2D, cam: Camera) => void,
): HTMLCanvasElement {
  const big = Math.round(px * SUPER);
  const tmp = document.createElement('canvas');
  tmp.width = big;
  tmp.height = big;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  const cam = new Camera();
  cam.zoom = px * SUPER * 0.5;
  cam.setViewport(big, big);
  cam.x = centre.x;
  cam.y = centre.y;
  draw(tctx, cam);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const out = document.createElement('canvas');
  out.width = Math.round(px * dpr);
  out.height = Math.round(px * dpr);
  out.style.width = `${px}px`;
  out.style.height = `${px}px`;
  const octx = out.getContext('2d')!;
  const box = opaqueBounds(tctx, big);
  if (!box) return out;

  // שוליים צרים יותר לרוחב: דמות שמחזיקה כלי מושטת הצידה, ובלי זה
  // היא מתכווצת לגובה חצי אייקון רק בגלל הכלי.
  const availW = out.width * (1 - PAD);
  const availH = out.height * (1 - PAD * 2);
  const scale = Math.min(availW / box.w, availH / box.h);
  const dw = box.w * scale;
  const dh = box.h * scale;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(
    tmp,
    box.x, box.y, box.w, box.h,
    (out.width - dw) / 2, (out.height - dh) / 2, dw, dh,
  );
  return out;
}

/** אייקון מבנה: המבנה עצמו, בצבעי האומה. */
export function buildingIcon(defId: string, nationId: string, owner: string, px = 44): HTMLCanvasElement {
  const key = `b|${defId}|${nationId}|${owner}|${px}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const def = getBuilding(defId);
  const size = def.size;
  const canvas = renderFitted(px, { x: size / 2, y: size / 2 }, (ctx, cam) => {
    drawStructure(ctx, cam, archetypeOf(def), 0, 0, size, paletteFor(nationId, owner), {
      stage: 2,
      time: 0,
      seed: 3,
      icon: true,
      // חומה ושער מצוירים עם חיבור לשני הצדדים, אחרת הם נראים כעמוד בודד
      links: { n: false, e: true, s: false, w: true },
    });
  });
  cache.set(key, canvas);
  return canvas;
}

/** אייקון יחידה: הדמות או הרכב עצמם. */
export function unitIcon(defId: string, owner: string, px = 44): HTMLCanvasElement {
  const key = `u|${defId}|${owner}|${px}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const def = getUnit(defId);
  const look = lookFor(def);
  const canvas = renderFitted(px, { x: 0, y: 0 }, (ctx, cam) => {
    if (look.kind === 'vehicle') {
      drawVehicle(ctx, cam, look.vehicle, 0, 0, Math.PI * 0.75, owner, 0, 1);
    } else {
      const style: PersonStyle = {
        cloth: owner,
        accent: shade(owner, -0.35),
        skin: '#c89a6a',
        hat: look.style.hat,
        tool: look.style.tool,
        shield: look.style.shield,
      };
      // פונה אל הצופה: הכתפיים רחבות, הפנים נראות, והכלי לא נמתח הצידה
      drawPerson(ctx, cam, 0, 0, 0, style, 'idle', 0, Math.PI / 2, 1, false);
    }
  });
  cache.set(key, canvas);
  return canvas;
}

/** מנקה את המטמון (למשל כששחקן חדש נטען). */
export function clearIconCache(): void {
  cache.clear();
}
