import type { Vec2 } from '../core/types';

/** מצלמה: המרה בין קואורדינטות עולם (אריחים) לקואורדינטות מסך (פיקסלים). */
export class Camera {
  /** מרכז המצלמה בקואורדינטות אריחים */
  x = 0;
  y = 0;
  /** פיקסלים לאריח */
  zoom = 32;
  minZoom = 8;
  maxZoom = 72;
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

  worldToScreen(wx: number, wy: number): Vec2 {
    return {
      x: (wx - this.x) * this.zoom + this.viewWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewHeight / 2,
    };
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: (sx - this.viewWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewHeight / 2) / this.zoom + this.y,
    };
  }

  /** גבולות התצוגה בקואורדינטות עולם, עם שוליים. */
  visibleBounds(margin = 1) {
    const halfW = this.viewWidth / 2 / this.zoom;
    const halfH = this.viewHeight / 2 / this.zoom;
    return {
      minX: Math.max(0, Math.floor(this.x - halfW - margin)),
      maxX: Math.min(this.mapWidth - 1, Math.ceil(this.x + halfW + margin)),
      minY: Math.max(0, Math.floor(this.y - halfH - margin)),
      maxY: Math.min(this.mapHeight - 1, Math.ceil(this.y + halfH + margin)),
    };
  }

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

  /** זום סביב נקודת מסך (גלגלת עכבר / צביטה במגע). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  private clamp(): void {
    const halfW = this.viewWidth / 2 / this.zoom;
    const halfH = this.viewHeight / 2 / this.zoom;
    if (halfW * 2 >= this.mapWidth) this.x = this.mapWidth / 2;
    else this.x = Math.max(halfW, Math.min(this.mapWidth - halfW, this.x));
    if (halfH * 2 >= this.mapHeight) this.y = this.mapHeight / 2;
    else this.y = Math.max(halfH, Math.min(this.mapHeight - halfH, this.y));
  }
}
