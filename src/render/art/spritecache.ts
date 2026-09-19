import { Camera } from '../camera';
import { angleOfDirection, drawPerson, type Action, type PersonStyle } from './people';

/**
 * מטמון ספרייטים לדמויות.
 *
 * ציור דמות מורכב מ-12 פעולות מסלול (גוף, ראש, רגליים, זרועות, כלי).
 * עם מאה יחידות על המסך זה הופך לחנק. לכן כל שילוב של
 * (יחידה, פעולה, פריים, כיוון, צבע, זום) מצויר פעם אחת לקנבס קטן,
 * ומשם מועתק — העתקה היא הנתיב המהיר בקנבס.
 */

/**
 * מספר פריימים במחזור אנימציה. הורד מ-8 ל-6 כשעברנו לשמונה כיווני
 * פנייה, כדי שגודל המטמון (כיוונים × פריימים × פעולות) יישאר סביר.
 */
export const FRAMES = 6;

type Entry = { canvas: HTMLCanvasElement; groundX: number; groundY: number };

export class PersonSprites {
  private cache = new Map<string, Entry>();
  private order: string[] = [];
  private maxEntries = 1100;

  clear(): void {
    this.cache.clear();
    this.order.length = 0;
  }

  /**
   * מחזיר ספרייט מוכן. `styleKey` חייב לזהות באופן חד-חד-ערכי את
   * כל מה שמשפיע על המראה.
   */
  get(
    styleKey: string,
    zoom: number,
    style: PersonStyle,
    action: Action,
    frame: number,
    dir: number,
    scale: number,
    shadow = true,
  ): Entry {
    const key = `${styleKey}|${action}|${frame}|${dir}|${Math.round(zoom)}|${scale}|${shadow ? 1 : 0}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const w = Math.max(8, Math.ceil(zoom * 1.7 * scale));
    const h = Math.max(10, Math.ceil(zoom * 1.7 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    // מצלמה מקומית: נקודת הקרקע של הדמות ממוקמת בתחתית הספרייט
    const local = new Camera();
    local.zoom = zoom;
    local.setViewport(w, h);
    local.x = 0;
    local.y = 0;
    const groundX = w / 2;
    const groundY = h * 0.78;
    ctx.translate(0, groundY - h / 2);

    drawPerson(
      ctx, local,
      0, 0, 0,
      style,
      action,
      frame / FRAMES,
      angleOfDirection(dir),
      scale,
      // הצל נאפה לתוך הספרייט: הוא זהה לכל מופע, ולצייר אותו פעם
      // אחת לכל מפתח מטמון זול בהרבה מ-130 אליפסות מסובבות בכל פריים.
      shadow,
    );

    const entry: Entry = { canvas, groundX, groundY };
    this.cache.set(key, entry);
    this.order.push(key);
    if (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) this.cache.delete(oldest);
    }
    return entry;
  }
}
