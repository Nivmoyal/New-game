import { getBuilding } from '../data';
import { buildingOrigin, type Entity } from '../core/entities';
import type { EntityId, Vec2 } from '../core/types';
import type { World } from '../core/world';
import type { Camera } from '../render/camera';

export type InputCallbacks = {
  onSelect: (ids: EntityId[], additive: boolean) => void;
  onCommandAt: (world: Vec2, target: Entity | undefined, queue: boolean) => void;
  onPlaceBuilding: (tile: Vec2, queue: boolean) => void;
  onCancelPlacement: () => void;
  onMinimapNav: (world: Vec2) => void;
  onMinimapCommand: (world: Vec2) => void;
  onHotkey: (key: string, ctrl: boolean, shift: boolean) => void;
  onHover: (world: Vec2, target: Entity | undefined) => void;
};

/**
 * שליטה: עכבר (בחירה בגרירה, פקודות בקליק ימני), מקלדת ומגע.
 * במגע: נגיעה קצרה = בחירה, נגיעה ארוכה = פקודה, שתי אצבעות = זום והזזה.
 */
export class InputController {
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private panning = false;
  private lastPan = { x: 0, y: 0 };
  /** מצב מקשי מצלמה */
  private keys = new Set<string>();
  private pointerPos = { x: 0, y: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private longPressTimer: number | null = null;
  private touchMoved = false;
  edgeScroll = true;
  scrollSpeed = 1;
  /** האם ההצבה של מבנה פעילה (משפיע על קליק שמאלי) */
  placing = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private getWorld: () => World | null,
    private cb: InputCallbacks,
  ) {
    this.attach();
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    c.addEventListener('touchstart', this.onTouchStart, { passive: false });
    c.addEventListener('touchmove', this.onTouchMove, { passive: false });
    c.addEventListener('touchend', this.onTouchEnd, { passive: false });
    c.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  dispose(): void {
    const c = this.canvas;
    c.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    c.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    c.removeEventListener('touchstart', this.onTouchStart);
    c.removeEventListener('touchmove', this.onTouchMove);
    c.removeEventListener('touchend', this.onTouchEnd);
    c.removeEventListener('touchcancel', this.onTouchEnd);
  }

  private localPos(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  // ===== עכבר =====

  private onMouseDown = (ev: MouseEvent): void => {
    const p = this.localPos(ev);
    if (ev.button === 0) {
      if (this.placing) {
        const w = this.camera.screenToWorld(p.x, p.y);
        this.cb.onPlaceBuilding(this.placementTile(w), ev.shiftKey);
        return;
      }
      this.dragStart = p;
      this.dragging = false;
      this.dragRect = null;
    } else if (ev.button === 2) {
      if (this.placing) {
        this.cb.onCancelPlacement();
        return;
      }
      const world = this.camera.screenToWorld(p.x, p.y);
      this.cb.onCommandAt(world, this.entityAt(world), ev.shiftKey);
    } else if (ev.button === 1) {
      this.panning = true;
      this.lastPan = p;
      ev.preventDefault();
    }
  };

  private onMouseMove = (ev: MouseEvent): void => {
    const p = this.localPos(ev);
    this.pointerPos = p;
    if (this.panning) {
      this.camera.pan(
        -(p.x - this.lastPan.x) / this.camera.zoom,
        -(p.y - this.lastPan.y) / this.camera.zoom,
      );
      this.lastPan = p;
      return;
    }
    if (this.dragStart) {
      const dist = Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y);
      if (dist > 5) this.dragging = true;
      if (this.dragging) {
        this.dragRect = { x0: this.dragStart.x, y0: this.dragStart.y, x1: p.x, y1: p.y };
      }
    }
    const world = this.camera.screenToWorld(p.x, p.y);
    this.cb.onHover(world, this.entityAt(world));
  };

  private onMouseUp = (ev: MouseEvent): void => {
    if (ev.button === 1) this.panning = false;
    if (ev.button !== 0 || !this.dragStart) return;
    const p = this.localPos(ev);
    if (this.dragging && this.dragRect) {
      this.cb.onSelect(this.entitiesInRect(this.dragRect), ev.shiftKey);
    } else {
      const world = this.camera.screenToWorld(p.x, p.y);
      const hit = this.entityAt(world);
      if (hit && ev.altKey) {
        // Alt+קליק — בחירת כל היחידות מאותו סוג במסך
        this.cb.onSelect(this.sameTypeOnScreen(hit), ev.shiftKey);
      } else {
        this.cb.onSelect(hit ? [hit.id] : [], ev.shiftKey);
      }
    }
    this.dragStart = null;
    this.dragging = false;
    this.dragRect = null;
  };

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const p = this.localPos(ev);
    this.camera.zoomAt(p.x, p.y, ev.deltaY > 0 ? 0.88 : 1.14);
  };

  // ===== מקלדת =====

  private onKeyDown = (ev: KeyboardEvent): void => {
    if ((ev.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(ev.key.toLowerCase());
    this.cb.onHotkey(ev.key, ev.ctrlKey || ev.metaKey, ev.shiftKey);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(ev.key)) {
      ev.preventDefault();
    }
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(ev.key.toLowerCase());
  };

  /** תנועת מצלמה מתמשכת — נקרא בכל פריים. */
  updateCamera(dt: number): void {
    const speed = (24 / this.camera.zoom) * 14 * this.scrollSpeed * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= speed;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx += speed;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy -= speed;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy += speed;

    if (this.edgeScroll && !this.panning) {
      const margin = 24;
      const { x, y } = this.pointerPos;
      if (x >= 0 && x < margin) dx -= speed;
      if (x > this.camera.viewWidth - margin && x <= this.camera.viewWidth) dx += speed;
      if (y >= 0 && y < margin) dy -= speed;
      if (y > this.camera.viewHeight - margin && y <= this.camera.viewHeight) dy += speed;
    }
    if (dx !== 0 || dy !== 0) this.camera.pan(dx, dy);
  }

  // ===== מגע =====

  private onTouchStart = (ev: TouchEvent): void => {
    ev.preventDefault();
    for (const t of Array.from(ev.changedTouches)) {
      this.touches.set(t.identifier, this.localPos(t));
    }
    this.touchMoved = false;
    if (this.touches.size === 1) {
      const [only] = [...this.touches.values()];
      this.dragStart = only;
      this.pointerPos = only;
      if (this.longPressTimer) window.clearTimeout(this.longPressTimer);
      this.longPressTimer = window.setTimeout(() => {
        if (this.touchMoved) return;
        const world = this.camera.screenToWorld(only.x, only.y);
        if (this.placing) this.cb.onPlaceBuilding(this.placementTile(world), false);
        else this.cb.onCommandAt(world, this.entityAt(world), false);
        this.dragStart = null;
        if (navigator.vibrate) navigator.vibrate(18);
      }, 420);
    } else if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.cancelLongPress();
      this.dragStart = null;
      this.dragRect = null;
    }
  };

  private onTouchMove = (ev: TouchEvent): void => {
    ev.preventDefault();
    const previous = new Map(this.touches);
    for (const t of Array.from(ev.changedTouches)) {
      this.touches.set(t.identifier, this.localPos(t));
    }
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDist > 0) this.camera.zoomAt(mid.x, mid.y, dist / this.pinchDist);
      this.pinchDist = dist;
      // הזזה בשתי אצבעות
      const prev = [...previous.values()];
      if (prev.length === 2) {
        const prevMid = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
        this.camera.pan(
          -(mid.x - prevMid.x) / this.camera.zoom,
          -(mid.y - prevMid.y) / this.camera.zoom,
        );
      }
      return;
    }
    if (this.touches.size === 1 && this.dragStart) {
      const p = [...this.touches.values()][0];
      const dist = Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y);
      if (dist > 8) {
        this.touchMoved = true;
        this.cancelLongPress();
        this.dragging = true;
        this.dragRect = { x0: this.dragStart.x, y0: this.dragStart.y, x1: p.x, y1: p.y };
      }
    }
  };

  private onTouchEnd = (ev: TouchEvent): void => {
    ev.preventDefault();
    this.cancelLongPress();
    const ended = [...this.touches.values()];
    for (const t of Array.from(ev.changedTouches)) this.touches.delete(t.identifier);

    if (this.dragging && this.dragRect) {
      this.cb.onSelect(this.entitiesInRect(this.dragRect), false);
    } else if (this.dragStart && ended.length === 1 && !this.touchMoved) {
      const p = this.dragStart;
      const world = this.camera.screenToWorld(p.x, p.y);
      if (this.placing) {
        this.cb.onPlaceBuilding(this.placementTile(world), false);
      } else {
        const hit = this.entityAt(world);
        this.cb.onSelect(hit ? [hit.id] : [], false);
      }
    }
    if (this.touches.size === 0) {
      this.dragStart = null;
      this.dragging = false;
      this.dragRect = null;
      this.pinchDist = 0;
    }
  };

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  // ===== שאילתות =====

  /** פינת ההצבה של מבנה כך שהעכבר במרכזו. */
  placementTile(world: Vec2, defId?: string): Vec2 {
    const size = defId ? getBuilding(defId).size : 1;
    return { x: Math.round(world.x - size / 2), y: Math.round(world.y - size / 2) };
  }

  entityAt(worldPos: Vec2): Entity | undefined {
    const world = this.getWorld();
    if (!world) return undefined;
    let best: Entity | undefined;
    let bestScore = Infinity;
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      if (e.kind === 'building') {
        const o = buildingOrigin(e);
        const size = e.building?.size ?? 1;
        if (
          worldPos.x >= o.x &&
          worldPos.x < o.x + size &&
          worldPos.y >= o.y &&
          worldPos.y < o.y + size
        ) {
          const score = 10 + size;
          if (score < bestScore) {
            bestScore = score;
            best = e;
          }
        }
      } else {
        const d = Math.hypot(e.pos.x - worldPos.x, e.pos.y - worldPos.y);
        const radius = Math.max(0.45, 16 / this.camera.zoom);
        if (d < radius && d < bestScore) {
          bestScore = d;
          best = e;
        }
      }
    }
    return best;
  }

  private entitiesInRect(rect: { x0: number; y0: number; x1: number; y1: number }): EntityId[] {
    const world = this.getWorld();
    if (!world) return [];
    const a = this.camera.screenToWorld(Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1));
    const b = this.camera.screenToWorld(Math.max(rect.x0, rect.x1), Math.max(rect.y0, rect.y1));
    const out: EntityId[] = [];
    for (const e of world.entities.values()) {
      if (!e.alive || e.kind !== 'unit') continue;
      if (e.pos.x < a.x || e.pos.x > b.x || e.pos.y < a.y || e.pos.y > b.y) continue;
      out.push(e.id);
    }
    // אם לא נבחרו יחידות — אולי מבנה יחיד בתוך המלבן
    if (out.length === 0) {
      for (const e of world.entities.values()) {
        if (!e.alive || e.kind !== 'building') continue;
        if (e.pos.x < a.x || e.pos.x > b.x || e.pos.y < a.y || e.pos.y > b.y) continue;
        out.push(e.id);
        break;
      }
    }
    return out;
  }

  private sameTypeOnScreen(reference: Entity): EntityId[] {
    const world = this.getWorld();
    if (!world) return [];
    const bounds = this.camera.visibleBounds();
    const out: EntityId[] = [];
    for (const e of world.entities.values()) {
      if (!e.alive || e.defId !== reference.defId || e.owner !== reference.owner) continue;
      if (e.pos.x < bounds.minX || e.pos.x > bounds.maxX) continue;
      if (e.pos.y < bounds.minY || e.pos.y > bounds.maxY) continue;
      out.push(e.id);
    }
    return out;
  }

  /** האם היחידה יכולה לקבל פקודות מהשחקן. */
  static isCommandable(e: Entity, ownerId: number): boolean {
    return e.owner === ownerId;
  }
}
