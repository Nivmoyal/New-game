import type { Player } from '../core/player';
import type { Terrain, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { Camera } from './camera';
import { poly, shade, tileDiamond } from './iso';
import { drawGroundProps, drawResource } from './art/nature';
import { grainTexture, MATERIALS } from './art/textures';
import { surfaceTexture, type Surface } from './art/surfaces';
import type { GroundWear } from './groundwear';

/** גובה תבליט לכל סוג קרקע (ביחידות אריח). */
export const TERRAIN_HEIGHT: Record<Terrain, number> = {
  water: -0.1,
  shallow: -0.04,
  sand: 0,
  dirt: 0,
  grass: 0,
  forest: 0.02,
  hill: 0.38,
  rock: 0.12,
};

/**
 * מבנה החומר של כל סוג קרקע.
 * הטקסטורה נוצרת סביב אפור ניטרלי ומוטבעת במצב `overlay`, כך שהיא
 * מוסיפה מבנה (גושי דשא, חצץ, כתמי חול) בלי לשנות את גוון הקרקע
 * שהתקבל מהמיזוג בין החומרים.
 */
const GROUND_SURFACE: Partial<Record<Terrain, Surface>> = {
  grass: 'turf',
  forest: 'turf',
  hill: 'turf',
  rock: 'rubble',
  sand: 'leather',
  dirt: 'leather',
};

const CHUNK = 12;
/** פיקסלים לאריח בתמונת הקרקע (במרחב האריחים, לפני ההטיה). */
const GROUND_PX = 26;
/** שוליים בתמונת הקרקע — נדרשים כדי שהמיזוג בקצה הנתח יהיה רציף. */
const PAD = 2;

type Chunk = { canvas: HTMLCanvasElement; center: Vec2; zoom: number };

/**
 * שכבת קרקע מטמונה.
 *
 * הקרקע נבנית קודם **במרחב האריחים** — שם היא פשוט רשת ריבועים, ולכן
 * קל למרוח מעבר חלק בין חומרים (טשטוש קצר) ולהוסיף טקסטורה. רק אחר כך
 * התמונה מוטה להיטל האיזומטרי בהעתקה אחת. כך נעלמים ה"מעוינים
 * השטוחים" עם הקצוות החדים, ובמקומם מתקבל שטח רציף.
 *
 * הכול נצרב לנתחים של 12x12 אריחים ונצרב מחדש רק כשהזום משתנה או
 * כשאריח בנתח משתנה (עץ שנכרת, מכרה שהתרוקן).
 */
export class TerrainLayer {
  private chunks = new Map<string, Chunk>();
  private zoomBucket = 0;
  private wear: GroundWear | null = null;

  /** מחבר את שכבת השחיקה — אריחים שנשחקו נצרבים כעפר. */
  attachWear(wear: GroundWear): void {
    this.wear = wear;
  }

  invalidateTiles(tiles: Vec2[]): void {
    for (const t of tiles) {
      const cx = Math.floor(t.x / CHUNK);
      const cy = Math.floor(t.y / CHUNK);
      this.chunks.delete(`${cx},${cy}`);
      // רק אריח שיושב על גבול הנתח משפיע על המיזוג אצל השכן.
      // ביטול גורף של תשעה נתחים בכל עץ שנכרת גרם לצריבה מחדש מתמדת.
      const lx = t.x - cx * CHUNK;
      const ly = t.y - cy * CHUNK;
      if (lx <= 1) this.chunks.delete(`${cx - 1},${cy}`);
      if (lx >= CHUNK - 2) this.chunks.delete(`${cx + 1},${cy}`);
      if (ly <= 1) this.chunks.delete(`${cx},${cy - 1}`);
      if (ly >= CHUNK - 2) this.chunks.delete(`${cx},${cy + 1}`);
    }
  }

  invalidateAll(): void {
    this.chunks.clear();
  }

  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    world: World,
    viewer: Player,
    time: number,
  ): void {
    const bucket = Math.max(1, Math.round(cam.zoom));
    if (bucket !== this.zoomBucket) {
      this.zoomBucket = bucket;
      this.chunks.clear();
    }

    const b = cam.visibleBounds(CHUNK);
    const cx0 = Math.floor(b.minX / CHUNK);
    const cx1 = Math.floor(b.maxX / CHUNK);
    const cy0 = Math.floor(b.minY / CHUNK);
    const cy1 = Math.floor(b.maxY / CHUNK);

    const list: Array<{ depth: number; chunk: Chunk }> = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cy < 0) continue;
        if (cx * CHUNK >= world.map.width || cy * CHUNK >= world.map.height) continue;
        const key = `${cx},${cy}`;
        let chunk = this.chunks.get(key);
        if (!chunk || chunk.zoom !== bucket) {
          chunk = this.bake(world, cx, cy, bucket, time);
          this.chunks.set(key, chunk);
        }
        list.push({ depth: cx + cy, chunk });
      }
    }
    list.sort((a, c) => a.depth - c.depth);

    for (const { chunk } of list) {
      const p = cam.worldToScreen(chunk.center.x, chunk.center.y, 0);
      ctx.drawImage(
        chunk.canvas,
        Math.round(p.x - chunk.canvas.width / 2),
        Math.round(p.y - chunk.canvas.height / 2),
      );
    }
    void viewer;
  }

  /**
   * בונה את תמונת הקרקע של הנתח במרחב האריחים, כולל מיזוג בין חומרים.
   * מוחזרת תמונה שבה אריח = GROUND_PX פיקסלים.
   */
  private bakeGround(world: World, x0: number, y0: number): HTMLCanvasElement {
    const tiles = CHUNK + PAD * 2;
    const size = tiles * GROUND_PX;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // שלב א׳: כל אריח נצבע בחומר שלו
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const wx = x0 - PAD + tx;
        const wy = y0 - PAD + ty;
        const t = world.map.inBounds(wx, wy) ? world.map.terrainAt(wx, wy) : 'water';
        ctx.fillStyle = MATERIALS[t].base;
        ctx.fillRect(tx * GROUND_PX, ty * GROUND_PX, GROUND_PX, GROUND_PX);
        // שביל שנשחק — נצבע כאן, לפני הטשטוש, כך שהקצה שלו מתרכך מעצמו
        if (this.wear?.isWorn(wx, wy)) {
          ctx.save();
          ctx.globalAlpha = 0.62;
          ctx.fillStyle = MATERIALS.dirt.base;
          ctx.fillRect(tx * GROUND_PX, ty * GROUND_PX, GROUND_PX, GROUND_PX);
          ctx.restore();
        }
      }
    }

    // שלב ב׳: טשטוש קצר ממזג את הגבולות בין חומרים
    try {
      const blurred = document.createElement('canvas');
      blurred.width = size;
      blurred.height = size;
      const bctx = blurred.getContext('2d')!;
      // טשטוש שממזג את הגבול בין חומרים. ערך נמוך מדי השאיר "שטיח
      // טלאים" של מעוינים בגוונים שונים; זה מספיק כדי שהמעבר ייראה
      // כשטח אחד, ועדיין לא מורח חומר לתוך שכנו.
      bctx.filter = `blur(${Math.max(2, Math.round(GROUND_PX * 0.3))}px)`;
      bctx.drawImage(canvas, 0, 0);
      bctx.filter = 'none';
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(blurred, 0, 0);
    } catch {
      // דפדפן בלי ctx.filter — נשארים עם גבולות חדים
    }

    // שלב ג׳: מבנה החומר לכל אריח — אחרי הטשטוש, כדי שיישאר חד.
    // המיזוג בשלב ב׳ כבר איחד את הגוונים; כאן רק מוסיפים מרקם.
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.34;
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const wx = x0 - PAD + tx;
        const wy = y0 - PAD + ty;
        const t = world.map.inBounds(wx, wy) ? world.map.terrainAt(wx, wy) : 'water';
        const kind = GROUND_SURFACE[t];
        if (!kind) continue;
        const pat = ctx.createPattern(surfaceTexture(kind, '#808080'), 'repeat');
        if (!pat) continue;
        ctx.save();
        // הטקסטורה נפרסת על ~0.8 אריח. גדול מזה והדשא נראה ככתמי הסוואה.
        const scale = (GROUND_PX * 0.8) / 52;
        ctx.translate(tx * GROUND_PX, ty * GROUND_PX);
        ctx.scale(scale, scale);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, GROUND_PX / scale, GROUND_PX / scale);
        ctx.restore();
      }
    }
    ctx.restore();

    // שלב ד׳: גרעיניות ניטרלית דקה מעל הכול
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.globalCompositeOperation = 'overlay';
    const pattern = ctx.createPattern(grainTexture(96), 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.restore();

    return canvas;
  }

  private bake(world: World, cx: number, cy: number, zoom: number, time: number): Chunk {
    const center = { x: cx * CHUNK + CHUNK / 2, y: cy * CHUNK + CHUNK / 2 };
    const width = Math.ceil((CHUNK + 2) * zoom);
    const height = Math.ceil((CHUNK + 2) * zoom * 0.5 + 1.6 * zoom);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const local = new Camera();
    local.zoom = zoom;
    local.setViewport(width, height);
    local.x = center.x;
    local.y = center.y;

    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(world.map.width - 1, x0 + CHUNK - 1);
    const y1 = Math.min(world.map.height - 1, y0 + CHUNK - 1);

    // ===== הקרקע: תמונה ממוזגת שמוטה להיטל האיזומטרי =====
    const ground = this.bakeGround(world, x0, y0);
    ctx.save();
    local.applyIsoTransform(ctx);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ground, x0 - PAD, y0 - PAD, CHUNK + PAD * 2, CHUNK + PAD * 2);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // ===== תבליט: גבעות וסלעים מקבלים דפנות ופסגה מוגבהת =====
    for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
      const from = Math.max(x0, sum - y1);
      const to = Math.min(x1, sum - y0);
      for (let x = from; x <= to; x++) {
        const y = sum - x;
        const t = world.map.terrainAt(x, y);
        const h = TERRAIN_HEIGHT[t];
        if (h <= 0.05) continue;
        const mat = MATERIALS[t];
        // גובה השכן; דופן מצוירת רק היכן שהשכן נמוך יותר, אחרת נוצרות
        // "מדרגות" כהות באמצע רמה אחידה
        const heightAt = (tx: number, ty: number): number =>
          world.map.inBounds(tx, ty) ? TERRAIN_HEIGHT[world.map.terrainAt(tx, ty)] : 0;
        const south = heightAt(x, y + 1);
        const east = heightAt(x + 1, y);

        if (south < h - 0.02) {
          poly(ctx, [
            local.worldToScreen(x, y + 1, south),
            local.worldToScreen(x + 1, y + 1, south),
            local.worldToScreen(x + 1, y + 1, h),
            local.worldToScreen(x, y + 1, h),
          ], shade(mat.dark, -0.22));
        }
        if (east < h - 0.02) {
          poly(ctx, [
            local.worldToScreen(x + 1, y, east),
            local.worldToScreen(x + 1, y + 1, east),
            local.worldToScreen(x + 1, y + 1, h),
            local.worldToScreen(x + 1, y, h),
          ], shade(mat.dark, -0.05));
        }

        // הפסגה: אותה תמונת קרקע, מוזזת כלפי מעלה בגובה הצוק
        ctx.save();
        const top = tileDiamond(local, x, y, 1, 1, h);
        ctx.beginPath();
        top.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.clip();
        local.applyIsoTransform(ctx);
        // הזזה של (-h,-h) במרחב האריחים = הרמה של h*zoom/2 פיקסלים במסך
        ctx.translate(-h, -h);
        ctx.drawImage(ground, x0 - PAD, y0 - PAD, CHUNK + PAD * 2, CHUNK + PAD * 2);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    // ===== עצים, סלעים ושיחים — סטטיים, נצרבים יחד עם הקרקע =====
    for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
      const from = Math.max(x0, sum - y1);
      const to = Math.min(x1, sum - y0);
      for (let x = from; x <= to; x++) {
        const y = sum - x;
        const res = world.map.resourceAt(x, y);
        if (!res) {
          drawGroundProps(ctx, local, x, y, world.map.terrainAt(x, y), this.wear?.isWorn(x, y) ?? false);
          continue;
        }
        if (res.visual === 'fish') continue;
        drawResource(ctx, local, x, y, res, time);
      }
    }

    return { canvas, center, zoom };
  }
}
