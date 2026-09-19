import type { Vec2 } from '../core/types';

/**
 * מצלמה איזומטרית (מבט 2:1).
 *
 * אריח בעולם הוא ריבוע 1x1. על המסך הוא מעוין ברוחב `zoom` פיקסלים
 * ובגובה `zoom/2`. ציר Z (גובה) נמדד ביחידות אריח ומורם כלפי מעלה.
 *
 *        (wx, wy)                     צפון
 *            ◆              מערב  ◆       ◆  מזרח
 *                                     ◆
 *                                   דרום
 */
export class Camera {
  /** מרכז המצלמה בקואורדינטות אריחים */
  x = 0;
  y = 0;
  /** רוחב אריח בפיקסלים */
  zoom = 64;
  minZoom = 22;
  maxZoom = 150;
  viewWidth = 800;
  viewHeight = 600;
  mapWidth = 128;
  mapHeight = 128;

  setViewport(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.clamp();
  }

  setMapSize(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
    this.clamp();
  }

  /** עולם → מסך. z הוא גובה ביחידות אריח. */
  worldToScreen(wx: number, wy: number, z = 0): Vec2 {
    const dx = wx - this.x;
    const dy = wy - this.y;
    return {
      x: (dx - dy) * (this.zoom / 2) + this.viewWidth / 2,
      y: (dx + dy) * (this.zoom / 4) - z * (this.zoom / 2) + this.viewHeight / 2,
    };
  }

  /** מסך → עולם (על מישור הקרקע, z=0). */
  screenToWorld(sx: number, sy: number): Vec2 {
    const a = (sx - this.viewWidth / 2) / (this.zoom / 2); // dx - dy
    const b = (sy - this.viewHeight / 2) / (this.zoom / 4); // dx + dy
    return {
      x: this.x + (a + b) / 2,
      y: this.y + (b - a) / 2,
    };
  }

  /**
   * גבולות האריחים הנראים. בהיטל איזומטרי אזור המסך הוא מעוין בעולם,
   * ולכן לוקחים את תיבת התוחמת של ארבע פינות המסך.
   */
  visibleBounds(margin = 2) {
    const corners = [
      this.screenToWorld(0, 0),
      this.screenToWorld(this.viewWidth, 0),
      this.screenToWorld(0, this.viewHeight),
      this.screenToWorld(this.viewWidth, this.viewHeight),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      minX: Math.max(0, Math.floor(Math.min(...xs)) - margin),
      maxX: Math.min(this.mapWidth - 1, Math.ceil(Math.max(...xs)) + margin),
      minY: Math.max(0, Math.floor(Math.min(...ys)) - margin),
      maxY: Math.min(this.mapHeight - 1, Math.ceil(Math.max(...ys)) + margin),
    };
  }

  /**
   * מחיל על ההקשר את ההקרנה האיזומטרית כטרנספורמציה לינארית,
   * כך שאפשר לצייר תמונה שממופה ל"מרחב אריחים" ולקבל אותה מוטה
   * נכון — הרבה יותר זול מציור מעוין לכל אריח.
   */
  applyIsoTransform(ctx: CanvasRenderingContext2D, dpr = 1): void {
    const a = this.zoom / 2;
    const b = this.zoom / 4;
    const e = (this.y - this.x) * (this.zoom / 2) + this.viewWidth / 2;
    const f = -(this.x + this.y) * (this.zoom / 4) + this.viewHeight / 2;
    ctx.setTransform(a * dpr, b * dpr, -a * dpr, b * dpr, e * dpr, f * dpr);
  }

  /** הזזה לפי פיקסלים על המסך (גרירה) — מתורגמת לצירי העולם. */
  panScreen(dxPx: number, dyPx: number): void {
    const a = dxPx / (this.zoom / 2);
    const b = dyPx / (this.zoom / 4);
    this.x += (a + b) / 2;
    this.y += (b - a) / 2;
    this.clamp();
  }

  /** הזזה בצירי העולם (מקשי חצים). */
  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
    this.clamp();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    // מקבעים את הזום לצעדים שלמים: כך שכבות הקרקע המטמונות
    // מצוירות ביחס 1:1 בלי דגימה מחדש — ההבדל בביצועים גדול.
    const raw = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.zoom = Math.max(this.minZoom, Math.round(raw / 2) * 2);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  private clamp(): void {
    this.x = Math.max(-4, Math.min(this.mapWidth + 4, this.x));
    this.y = Math.max(-4, Math.min(this.mapHeight + 4, this.y));
  }
}
