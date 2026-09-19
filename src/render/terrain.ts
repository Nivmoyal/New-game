import type { Player } from '../core/player';
import type { Terrain, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { Camera } from './camera';
import { drawBox, poly, shade, tileDiamond } from './iso';
import { drawResource, tileHash } from './art/nature';

/** גובה תבליט לכל סוג קרקע (ביחידות אריח). */
export const TERRAIN_HEIGHT: Record<Terrain, number> = {
  water: -0.12,
  shallow: -0.05,
  sand: 0,
  dirt: 0,
  grass: 0,
  forest: 0.02,
  hill: 0.34,
  rock: 0.12,
};

/**
 * לוח צבעי הקרקע. הגוונים קרובים זה לזה בכוונה: המפה מכילה הרבה
 * כתמי אדמה וחול מפוזרים, ובניגודיות גבוהה הם נראו כרעש מנוקד.
 */
export const TERRAIN_BASE: Record<Terrain, string> = {
  grass: '#5f9145',
  dirt: '#6f8347',
  sand: '#b4ab74',
  forest: '#4a7d3a',
  water: '#2a6ea8',
  shallow: '#4a9ac4',
  hill: '#77874f',
  rock: '#8d949c',
};

const CHUNK = 12;

type Chunk = { canvas: HTMLCanvasElement; center: Vec2; zoom: number };

/**
 * שכבת קרקע מטמונה.
 *
 * הקרקע והעצים/הסלעים כמעט ואינם משתנים, אבל ציורם עולה אלפי
 * פוליגונים בכל פריים. לכן הם נצרבים לקנבסים לפי "נתחים" של
 * 12x12 אריחים, ונצרבים מחדש רק כשהזום משתנה או כשאריח בנתח משתנה
 * (עץ שנכרת, מכרה שהתרוקן).
 */
export class TerrainLayer {
  private chunks = new Map<string, Chunk>();
  private zoomBucket = 0;

  /** מבטל נתחים שהושפעו מאריחים שהשתנו. */
  invalidateTiles(tiles: Vec2[]): void {
    for (const t of tiles) {
      const key = `${Math.floor(t.x / CHUNK)},${Math.floor(t.y / CHUNK)}`;
      this.chunks.delete(key);
    }
  }

  invalidateAll(): void {
    this.chunks.clear();
  }

  /** מצייר את כל הנתחים הנראים. */
  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    world: World,
    viewer: Player,
    time: number,
  ): void {
    // הזום כבר מקובע לצעדים שלמים במצלמה, ולכן הנתח נצרב בדיוק
    // ברזולוציה שבה הוא מצויר — בלי דגימה מחדש.
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

    // ציור לפי עומק כדי שתבליט ההרים יכסה נכון בין נתחים
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
      const w = chunk.canvas.width;
      const h = chunk.canvas.height;
      // עיגול לפיקסל שלם: drawImage לא מדורג הוא הנתיב המהיר
      ctx.drawImage(chunk.canvas, Math.round(p.x - w / 2), Math.round(p.y - h / 2));
    }
    void viewer;
  }

  /** צורב נתח אחד לקנבס נפרד. */
  private bake(world: World, cx: number, cy: number, zoom: number, time: number): Chunk {
    const center = { x: cx * CHUNK + CHUNK / 2, y: cy * CHUNK + CHUNK / 2 };
    // שוליים מדויקים: עץ גבוה מגיע ל~1.5 אריח מעל הקרקע, והר מוסיף 0.34.
    // שוליים גדולים מזה מנפחים את שטח ההעתקה בכל פריים.
    const width = Math.ceil((CHUNK + 2) * zoom);
    const height = Math.ceil((CHUNK + 2) * zoom * 0.5 + 1.4 * zoom);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // מצלמה מקומית עם אותה הקרנה, ממורכזת על הנתח
    const local = new Camera();
    local.zoom = zoom;
    local.setViewport(width, height);
    local.x = center.x;
    local.y = center.y;

    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(world.map.width - 1, x0 + CHUNK - 1);
    const y1 = Math.min(world.map.height - 1, y0 + CHUNK - 1);

    for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
      const from = Math.max(x0, sum - y1);
      const to = Math.min(x1, sum - y0);
      for (let x = from; x <= to; x++) {
        const y = sum - x;
        const t = world.map.terrainAt(x, y);
        const h = TERRAIN_HEIGHT[t];
        const v = tileHash(x, y, 1);
        const color = shade(TERRAIN_BASE[t], (v - 0.5) * 0.07);
        if (h > 0.02) {
          drawBox(ctx, local, x, y, 1, 1, h, {
            top: color,
            right: shade(color, -0.16),
            left: shade(color, -0.32),
          });
        } else {
          poly(ctx, tileDiamond(local, x, y, 1, 1, h), color);
        }
        if (zoom > 42 && (t === 'grass' || t === 'sand') && v > 0.88) {
          const p = local.worldToScreen(x + 0.5, y + 0.5, h);
          ctx.fillStyle = shade(color, t === 'grass' ? -0.18 : 0.12);
          ctx.fillRect(p.x - zoom * 0.03, p.y - zoom * 0.01, zoom * 0.06, zoom * 0.02);
        }
      }
    }

    // עצים, סלעים ושיחים — סטטיים, ולכן נצרבים יחד עם הקרקע
    for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
      const from = Math.max(x0, sum - y1);
      const to = Math.min(x1, sum - y0);
      for (let x = from; x <= to; x++) {
        const y = sum - x;
        const res = world.map.resourceAt(x, y);
        if (!res || res.visual === 'fish') continue;
        drawResource(ctx, local, x, y, res, time);
      }
    }

    return { canvas, center, zoom };
  }
}
