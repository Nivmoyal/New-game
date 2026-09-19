import type { Vec2 } from '../core/types';
import type { World } from '../core/world';

/**
 * שחיקת קרקע — שבילי עפר שנוצרים מאליהם במקומות שהולכים בהם הרבה.
 *
 * כל יחידה שזזה שוחקת את האריח שמתחתיה. כשאריח עובר את הסף הוא נצבע
 * כעפר בשכבת הקרקע המטמונה. זה קורה פעם אחת לאריח, ולכן העלות היא
 * צריבה מחדש אחת של נתח — לא עבודה בכל פריים. כדי שכמה אריחים
 * שנשחקים יחד לא יגרמו לגל של צריבות, ההחלה מרוכזת ומוגבלת בקצב.
 *
 * זו שכבה חזותית בלבד: היא לא נשמרת במשחק שמור ולא משפיעה על מעבר.
 */

/** כמה שחיקה צריך אריח כדי להפוך לשביל. */
const THRESHOLD = 1;
/** קצב שחיקה ליחידה שזזה, לשנייה. */
const RATE = 1.1;
/** תקרה על מספר אריחי השביל — כדי שהמפה לא תהפוך כולה לעפר. */
const MAX_WORN = 1600;
/** כל כמה זמן מחילים אריחים שנשחקו. */
const FLUSH_INTERVAL = 0.4;
/** כמה אריחים מחילים בכל פעם. */
const MAX_PER_FLUSH = 24;

export class GroundWear {
  private level = new Float32Array(0);
  private worn = new Uint8Array(0);
  private width = 0;
  private height = 0;
  private queue: Vec2[] = [];
  private sinceFlush = 0;
  private wornCount = 0;

  reset(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.level = new Float32Array(width * height);
    this.worn = new Uint8Array(width * height);
    this.queue.length = 0;
    this.wornCount = 0;
    this.sinceFlush = 0;
  }

  isWorn(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.worn[y * this.width + x] === 1;
  }

  /**
   * צובר שחיקה מהיחידות שזזות ומחזיר את האריחים שיש לצרוב מחדש
   * (ריק ברוב הפריימים).
   */
  step(world: World, dt: number): Vec2[] {
    if (this.width !== world.map.width || this.height !== world.map.height) {
      this.reset(world.map.width, world.map.height);
    }
    if (this.wornCount < MAX_WORN) {
      const add = RATE * Math.min(dt, 0.1);
      for (const e of world.entities.values()) {
        if (!e.alive || e.kind !== 'unit' || !e.unit || e.unit.path.length === 0) continue;
        const x = Math.floor(e.pos.x);
        const y = Math.floor(e.pos.y);
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        const i = y * this.width + x;
        if (this.worn[i]) continue;
        this.level[i] += add;
        if (this.level[i] >= THRESHOLD) {
          this.worn[i] = 1;
          this.wornCount++;
          this.queue.push({ x, y });
        }
      }
    }

    this.sinceFlush += dt;
    if (this.queue.length === 0 || this.sinceFlush < FLUSH_INTERVAL) return [];
    this.sinceFlush = 0;
    return this.queue.splice(0, MAX_PER_FLUSH);
  }
}
