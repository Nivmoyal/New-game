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

/**
 * גודל נתח בסיסי. הגודל בפועל נגזר מהזום: קנבס הנתח גדל בריבוע הזום,
 * ובזום קרוב נתח של 12 אריחים הוא תמונה של מיליון פיקסלים — צריבה
 * אחת כזו בולעת פריים שלם. נתח קטן יותר מפזר את אותה עבודה על כמה
 * פריימים, וזה ההבדל בין הזזת מפה חלקה לקפיצות.
 */
const CHUNK = 12;
/** רוחב היעד המבוקש לקנבס נתח, בפיקסלים. ממנו נגזר גודל הנתח. */
const CHUNK_PX_TARGET = 420;
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
/**
 * כמה נתחים מותר לצרוב בפריים אחד.
 * צריבת נתח היא עבודה כבדה (טשטוש, טקסטורות, תבליט, צמחייה), ובלי
 * התקציב הזה הזזת המפה צרבה את כל הטור החדש בפריים אחד — קפיצות של
 * 200-400 אלפיות שנראות כמו תקיעה.
 */
const BAKE_MS = 9;
/** טבעת נתחים מעבר למסך שנצרבת בזמן פנוי, כדי שההזזה תפגוש אותם מוכנים. */
const PREBAKE_MARGIN = 1;
/**
 * גג לזיכרון שהמטמון תופס, בפיקסלים (כ-4 בתים לפיקסל).
 * חסם על *מספר* נתחים לא מספיק: קנבס נתח גדל בריבוע הזום, ובזום קרוב
 * מאתיים נתחים הם מאות מגה-בייט. הזזה ממושכת על מפה גדולה מילאה כך
 * את הזיכרון עד שהדפדפן התחיל לחנוק את המשחק.
 */
const MAX_CACHE_PX = 16_000_000;

export class TerrainLayer {
  private chunks = new Map<string, Chunk>();
  private zoomBucket = 0;
  private wear: GroundWear | null = null;
  /** ממוצע נע של עלות צריבת נתח, לקביעת התקציב של הפריים הבא. */
  private avgBake = 6;
  /** גודל הנתח הנוכחי באריחים — נגזר מהזום. */
  private chunkSize = CHUNK;
  /**
   * שני קנבסים זמניים שמשמשים שוב ושוב לבניית תמונת הקרקע.
   * הקצאת קנבס חדש בכל צריבה יצרה עשרות מגה של זבל בשנייה בזמן הזזת
   * המפה, ואיסוף הזבל הוא בדיוק הקפיצות שהרגישו כמו תקיעה.
   */
  private scratch: HTMLCanvasElement | null = null;
  private scratchBlur: HTMLCanvasElement | null = null;

  private scratchCanvas(which: 'a' | 'b', size: number): HTMLCanvasElement {
    const cur = which === 'a' ? this.scratch : this.scratchBlur;
    if (cur && cur.width === size && cur.height === size) {
      cur.getContext('2d')!.clearRect(0, 0, size, size);
      return cur;
    }
    const made = document.createElement('canvas');
    made.width = size;
    made.height = size;
    if (which === 'a') this.scratch = made;
    else this.scratchBlur = made;
    return made;
  }

  /** מחבר את שכבת השחיקה — אריחים שנשחקו נצרבים כעפר. */
  attachWear(wear: GroundWear): void {
    this.wear = wear;
  }

  invalidateTiles(tiles: Vec2[]): void {
    for (const t of tiles) {
      const size = this.chunkSize;
      const cx = Math.floor(t.x / size);
      const cy = Math.floor(t.y / size);
      this.chunks.delete(`${cx},${cy}`);
      // רק אריח שיושב על גבול הנתח משפיע על המיזוג אצל השכן.
      // ביטול גורף של תשעה נתחים בכל עץ שנכרת גרם לצריבה מחדש מתמדת.
      const lx = t.x - cx * size;
      const ly = t.y - cy * size;
      if (lx <= 1) this.chunks.delete(`${cx - 1},${cy}`);
      if (lx >= size - 2) this.chunks.delete(`${cx + 1},${cy}`);
      if (ly <= 1) this.chunks.delete(`${cx},${cy - 1}`);
      if (ly >= size - 2) this.chunks.delete(`${cx},${cy + 1}`);
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
      this.chunkSize = Math.max(5, Math.min(16, Math.round(CHUNK_PX_TARGET / bucket)));
      this.chunks.clear();
    }
    const size = this.chunkSize;

    const b = cam.visibleBounds(size);
    const cx0 = Math.floor(b.minX / size);
    const cx1 = Math.floor(b.maxX / size);
    const cy0 = Math.floor(b.minY / size);
    const cy1 = Math.floor(b.maxY / size);

    // תקציב זמן, לא מספר נתחים: נתח יקר מאשר לעצמו פריים שלם, ולכן
    // צורבים כל עוד ההערכה לנתח הבא נכנסת בתקציב — ולפחות נתח אחד,
    // כדי שהמפה תמיד תתקדם לעבר מצב צרוב.
    const start = performance.now();
    let baked = 0;
    const mayBake = (): boolean =>
      baked === 0 || performance.now() - start + this.avgBake <= BAKE_MS;
    const list: Array<{ depth: number; cx: number; cy: number; chunk: Chunk | null }> = [];
    const missed: Array<{ cx: number; cy: number }> = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.inMap(world, cx, cy)) continue;
        const key = `${cx},${cy}`;
        let chunk = this.chunks.get(key) ?? null;
        if (chunk && chunk.zoom !== bucket) chunk = null;
        if (!chunk && mayBake()) {
          baked++;
          chunk = this.bake(world, cx, cy, bucket, time);
          this.chunks.set(key, chunk);
        } else if (!chunk) {
          missed.push({ cx, cy });
        }
        list.push({ depth: cx + cy, cx, cy, chunk });
      }
    }
    list.sort((a, c) => a.depth - c.depth);

    for (const { cx, cy, chunk } of list) {
      if (!chunk) {
        // נתח שעוד לא נצרב — מילוי שטוח בצבע השולט, לפריים או שניים.
        // עדיף על חור שחור, וזול בהרבה מצריבה מלאה בתוך הפריים.
        this.drawFlat(ctx, cam, world, cx, cy);
        continue;
      }
      const p = cam.worldToScreen(chunk.center.x, chunk.center.y, 0);
      ctx.drawImage(
        chunk.canvas,
        Math.round(p.x - chunk.canvas.width / 2),
        Math.round(p.y - chunk.canvas.height / 2),
      );
    }

    // זמן פנוי: צורבים קדימה — קודם מה שחסר על המסך, אחר כך טבעת מסביבו,
    // כך שההזזה הבאה תפגוש נתחים מוכנים במקום לצרוב באמצע פריים.
    for (const m of missed) {
      if (!mayBake()) break;
      baked++;
      this.chunks.set(`${m.cx},${m.cy}`, this.bake(world, m.cx, m.cy, bucket, time));
    }
    for (let cy = cy0 - PREBAKE_MARGIN; cy <= cy1 + PREBAKE_MARGIN; cy++) {
      for (let cx = cx0 - PREBAKE_MARGIN; cx <= cx1 + PREBAKE_MARGIN; cx++) {
        if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) continue;
        if (!this.inMap(world, cx, cy)) continue;
        const key = `${cx},${cy}`;
        const have = this.chunks.get(key);
        if (have && have.zoom === bucket) continue;
        if (!mayBake()) return this.evict(cx0, cx1, cy0, cy1);
        baked++;
        this.chunks.set(key, this.bake(world, cx, cy, bucket, time));
      }
    }

    this.evict(cx0, cx1, cy0, cy1);
    void viewer;
  }

  private inMap(world: World, cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0) return false;
    return cx * this.chunkSize < world.map.width && cy * this.chunkSize < world.map.height;
  }

  /** מילוי שטוח לנתח שעוד לא נצרב: צבע הקרקע השולטת בו. */
  private drawFlat(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    world: World,
    cx: number,
    cy: number,
  ): void {
    const size = this.chunkSize;
    const x0 = cx * size;
    const y0 = cy * size;
    const counts = new Map<Terrain, number>();
    for (let y = y0; y < y0 + size; y += 3) {
      for (let x = x0; x < x0 + size; x += 3) {
        if (!world.map.inBounds(x, y)) continue;
        const t = world.map.terrainAt(x, y);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    let best: Terrain = 'water';
    let bestN = -1;
    for (const [t, n] of counts) {
      if (n > bestN) {
        bestN = n;
        best = t;
      }
    }
    if (bestN < 0) return;
    poly(ctx, tileDiamond(cam, x0, y0, size, size, 0), MATERIALS[best].base);
  }

  /** שומר את המטמון חסום בזיכרון: מפנה קודם את הנתחים הרחוקים מהמסך. */
  private evict(cx0: number, cx1: number, cy0: number, cy1: number): void {
    let px = 0;
    for (const c of this.chunks.values()) px += c.canvas.width * c.canvas.height;
    if (px <= MAX_CACHE_PX) return;
    const mx = (cx0 + cx1) / 2;
    const my = (cy0 + cy1) / 2;
    const far = [...this.chunks.entries()]
      .map(([key, c]) => {
        const [x, y] = key.split(',').map(Number);
        return { key, c, d: Math.abs(x - mx) + Math.abs(y - my) };
      })
      .sort((a, b) => b.d - a.d);
    for (let i = 0; i < far.length && px > MAX_CACHE_PX; i++) {
      // נתח שנמצא כרגע על המסך לא מפונה — אחרת הוא ייצרב מיד מחדש
      const { key, c, d } = far[i];
      if (d <= Math.max(cx1 - cx0, cy1 - cy0) / 2 + 1) continue;
      px -= c.canvas.width * c.canvas.height;
      this.chunks.delete(key);
    }
  }

  /**
   * בונה את תמונת הקרקע של הנתח במרחב האריחים, כולל מיזוג בין חומרים.
   * מוחזרת תמונה שבה אריח = GROUND_PX פיקסלים.
   */
  private bakeGround(world: World, x0: number, y0: number): HTMLCanvasElement {
    const tiles = this.chunkSize + PAD * 2;
    const size = tiles * GROUND_PX;
    const canvas = this.scratchCanvas('a', size);
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
      const blurred = this.scratchCanvas('b', size);
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
    // הטקסטורה נפרסת על ~0.8 אריח. גדול מזה והדשא נראה ככתמי הסוואה.
    const scale = (GROUND_PX * 0.8) / 52;
    ctx.scale(scale, scale);
    // תבנית אחת לכל סוג חומר, לא אחת לכל אריח: createPattern הוא יקר,
    // ו-256 קריאות לנתח היו הסיבה לקפיצות של מאות אלפיות בזמן הזזת המפה.
    const pats = new Map<Surface, CanvasPattern | null>();
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const wx = x0 - PAD + tx;
        const wy = y0 - PAD + ty;
        const t = world.map.inBounds(wx, wy) ? world.map.terrainAt(wx, wy) : 'water';
        const kind = GROUND_SURFACE[t];
        if (!kind) continue;
        let pat = pats.get(kind);
        if (pat === undefined) {
          pat = ctx.createPattern(surfaceTexture(kind, '#808080'), 'repeat');
          pats.set(kind, pat);
        }
        if (!pat) continue;
        ctx.fillStyle = pat;
        ctx.fillRect(
          (tx * GROUND_PX) / scale,
          (ty * GROUND_PX) / scale,
          GROUND_PX / scale,
          GROUND_PX / scale,
        );
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
    const t0 = performance.now();
    const chunk = this.bakeInner(world, cx, cy, zoom, time);
    this.avgBake = this.avgBake * 0.7 + (performance.now() - t0) * 0.3;
    return chunk;
  }

  private bakeInner(world: World, cx: number, cy: number, zoom: number, time: number): Chunk {
    const size = this.chunkSize;
    const center = { x: cx * size + size / 2, y: cy * size + size / 2 };
    const width = Math.ceil((size + 2) * zoom);
    const height = Math.ceil((size + 2) * zoom * 0.5 + 1.6 * zoom);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const local = new Camera();
    local.zoom = zoom;
    local.setViewport(width, height);
    local.x = center.x;
    local.y = center.y;

    const x0 = cx * size;
    const y0 = cy * size;
    const x1 = Math.min(world.map.width - 1, x0 + size - 1);
    const y1 = Math.min(world.map.height - 1, y0 + size - 1);

    // ===== הקרקע: תמונה ממוזגת שמוטה להיטל האיזומטרי =====
    const ground = this.bakeGround(world, x0, y0);
    ctx.save();
    local.applyIsoTransform(ctx);
    ctx.imageSmoothingEnabled = true;
    // סינון "נמוך" מספיק לטשטוש שכבר קיים בתמונה, וחוסך את רוב הזמן
    // של ההטיה האיזומטרית — השלב היקר ביותר בצריבת נתח.
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(ground, x0 - PAD, y0 - PAD, size + PAD * 2, size + PAD * 2);
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
        ctx.drawImage(ground, x0 - PAD, y0 - PAD, size + PAD * 2, size + PAD * 2);
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
