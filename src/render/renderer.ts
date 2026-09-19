import { getBuilding, getUnit } from '../data';
import { buildingOrigin, type Entity } from '../core/entities';
import { FOG_EXPLORED, FOG_HIDDEN } from '../core/fog';
import type { Player } from '../core/player';
import type { EntityId, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { Camera } from './camera';
import { drawBox, faceColors, poly, shade, tileDiamond } from './iso';
import { lookFor } from './art/appearance';
import { directionIndex, screenAngleOf, skinFor, type Action, type PersonStyle } from './art/people';
import { FRAMES, PersonSprites } from './art/spritecache';
import { drawResource } from './art/nature';
import { TerrainLayer } from './terrain';
import { GroundWear } from './groundwear';
import { Effects } from './effects';
import { archetypeOf, drawStructure, paletteFor, type WallLinks } from './art/structures';
import { drawVehicle } from './art/vehicles';

export type RenderState = {
  selected: Set<EntityId>;
  hovered: EntityId | null;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null;
  placing: { defId: string; valid: boolean; tile: Vec2 } | null;
  showHealthBars: boolean;
  pings: Array<{ pos: Vec2; time: number; color: string }>;
};

export class Renderer {
  readonly camera = new Camera();
  private ctx: CanvasRenderingContext2D;
  private terrain = new TerrainLayer();
  /** שבילי עפר שנשחקים במקומות שעוברים בהם הרבה. */
  private wear = new GroundWear();
  private lastFrameTime = -1;
  private people = new PersonSprites();
  /** אפקטים של קרב — יריות, פגיעות, פיצוצים ואבק. */
  readonly effects = new Effects();
  /** טקסטורת ערפל בגודל המפה — פיקסל לאריח. */
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogImage: ImageData | null = null;
  private fogStamp = -1;
  private lastSpriteZoom = -1;
  private vignette: HTMLCanvasElement | null = null;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('לא ניתן ליצור הקשר ציור דו-ממדי');
    this.ctx = ctx;
    this.terrain.attachWear(this.wear);
  }

  resize(width: number, height: number, dpr = 1): void {
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
    this.camera.setViewport(width, height);
  }

  /** מאלץ צריבה מחדש של כל שכבת הקרקע (מפה חדשה / טעינת משחק). */
  markTerrainDirty(): void {
    this.terrain.invalidateAll();
    this.wear.reset(0, 0);
  }

  render(world: World, viewer: Player, state: RenderState, now: number): void {
    const ctx = this.ctx;
    this.camera.setMapSize(world.map.width, world.map.height);
    ctx.fillStyle = '#0a1522';
    ctx.fillRect(0, 0, this.camera.viewWidth, this.camera.viewHeight);

    // אריחים שהשתנו (עץ שנכרת, מכרה שהתרוקן) מבטלים את הנתח שלהם
    if (this.lastSpriteZoom !== this.camera.zoom) {
      this.lastSpriteZoom = this.camera.zoom;
      this.people.clear();
    }
    const dirty = world.map.consumeDirtyTiles();
    if (dirty.length > 0) this.terrain.invalidateTiles(dirty);

    // שחיקת קרקע: אריח שעברו בו מספיק הופך לשביל עפר
    const dt = this.lastFrameTime < 0 ? 0 : Math.min(0.25, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    const worn = this.wear.step(world, dt);
    if (worn.length > 0) this.terrain.invalidateTiles(worn);

    // דיווחי הקרב מהסימולציה הופכים לחלקיקים
    for (const c of world.drainCombat()) {
      switch (c.type) {
        case 'shot':
          this.effects.shot(c.weapon, c.from, c.to, now);
          break;
        case 'hit':
          this.effects.impact(c.pos, now, c.heavy);
          break;
        case 'destroyed':
          if (c.building) this.effects.dust(c.pos, now);
          else this.effects.impact(c.pos, now, false);
          break;
        case 'work':
          this.effects.work(c.pos, now, c.kind === 'mine' ? '#d8d2c0' : '#c8a86a');
          break;
        case 'heal':
          this.effects.heal(c.pos, now);
          break;
      }
    }

    const bounds = this.camera.visibleBounds(3);
    this.terrain.render(ctx, this.camera, world, viewer, now);
    this.drawControlRadius(world, viewer);
    this.drawSceneObjects(world, viewer, state, bounds, now);
    this.drawPlacement(state);
    this.effects.render(ctx, this.camera, now);
    this.drawFog(world, viewer);
    this.drawVignette();
    this.drawPings(state, now);
    this.drawDragRect(state);
  }

  private drawControlRadius(world: World, viewer: Player): void {
    const tc = world.townCenterOf(viewer.id);
    if (!tc) return;
    const radius = viewer.currentStage().controlRadius;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = this.camera.worldToScreen(
        tc.pos.x + Math.cos(a) * radius,
        tc.pos.y + Math.sin(a) * radius,
        0,
      );
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ===== אובייקטים (משאבים + ישויות) ממוינים לפי עומק =====

  private drawSceneObjects(
    world: World,
    viewer: Player,
    state: RenderState,
    b: { minX: number; maxX: number; minY: number; maxY: number },
    now: number,
  ): void {
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];

    // עצים וסלעים נצרבים בשכבת הקרקע; רק דגים מונפשים בכל פריים
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (viewer.fog.state(x, y) === FOG_HIDDEN) continue;
        const res = world.map.resourceAt(x, y);
        if (!res || res.visual !== 'fish') continue;
        items.push({
          depth: x + y,
          draw: () => drawResource(this.ctx, this.camera, x, y, res, now),
        });
      }
    }

    // ישויות
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      if (e.pos.x < b.minX - 3 || e.pos.x > b.maxX + 3) continue;
      if (e.pos.y < b.minY - 3 || e.pos.y > b.maxY + 3) continue;
      if (!world.canSee(viewer.id, e)) continue;
      const depth =
        e.kind === 'building'
          ? e.pos.x + e.pos.y + (e.building?.size ?? 1) * 0.25
          : e.pos.x + e.pos.y;
      items.push({
        depth,
        draw: () =>
          e.kind === 'building'
            ? this.drawBuilding(world, e, state, now)
            : this.drawUnit(world, e, state, now),
      });
    }

    items.sort((a, b2) => a.depth - b2.depth);
    for (const item of items) item.draw();
  }

  private ownerColor(world: World, e: Entity): string {
    return world.player(e.owner)?.color ?? '#999';
  }

  private drawBuilding(world: World, e: Entity, state: RenderState, now: number): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const def = getBuilding(e.defId);
    const origin = buildingOrigin(e);
    const owner = world.player(e.owner);
    const pal = paletteFor(owner?.nation.id ?? 'israel', this.ownerColor(world, e));
    const size = e.building?.size ?? 1;
    const complete = e.building?.complete ?? true;

    // סימון בחירה על הקרקע
    if (state.selected.has(e.id)) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      const d = tileDiamond(cam, origin.x - 0.1, origin.y - 0.1, size + 0.2, size + 0.2, 0.03);
      ctx.beginPath();
      d.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    const arch = archetypeOf(def);
    const barrier = arch === 'wall' || arch === 'gate';
    drawStructure(ctx, cam, arch, origin.x, origin.y, size, pal, {
      progress: e.building?.progress ?? 1,
      stage: owner?.stage ?? 1,
      time: now,
      seed: e.id,
      links: barrier ? this.wallLinks(world, origin, e.owner) : undefined,
      gateOpen: arch === 'gate' ? this.gateOpen(world, e) : false,
    });

    const topZ = size * 0.55 + 0.6;
    if (!complete) {
      this.bar(origin.x + size / 2, origin.y + size / 2, topZ, e.building!.progress, '#60a5fa', size * 0.8);
    } else if (state.showHealthBars && (e.hp < e.maxHp || state.selected.has(e.id))) {
      const ratio = e.hp / e.maxHp;
      this.bar(origin.x + size / 2, origin.y + size / 2, topZ, ratio, healthColor(ratio), size * 0.8);
    }

    // פס התקדמות האימון מוצג רק כשהמבנה נבחר, כדי לא להעמיס על המסך
    if (e.building?.trainQueue.length && state.selected.has(e.id)) {
      const item = e.building.trainQueue[0];
      this.bar(
        origin.x + size / 2,
        origin.y + size / 2,
        topZ + 0.18,
        1 - item.remaining / item.total,
        '#38bdf8',
        size * 0.8,
      );
    }

    // נקודת כינוס
    if (e.building?.rally && state.selected.has(e.id)) {
      const from = cam.worldToScreen(e.pos.x, e.pos.y, 0.2);
      const to = cam.worldToScreen(e.building.rally.x, e.building.rally.y, 0.2);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
      poly(ctx, [
        { x: to.x, y: to.y - cam.zoom * 0.3 },
        { x: to.x + cam.zoom * 0.18, y: to.y - cam.zoom * 0.24 },
        { x: to.x, y: to.y - cam.zoom * 0.18 },
      ], '#fbbf24');
    }
  }

  private drawUnit(world: World, e: Entity, state: RenderState, now: number): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const def = getUnit(e.defId);
    const owner = world.player(e.owner);
    const color = this.ownerColor(world, e);
    const look = lookFor(def);

    // טבעת בחירה על הקרקע
    if (state.selected.has(e.id)) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      const p = cam.worldToScreen(e.pos.x, e.pos.y, 0.01);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, cam.zoom * 0.3, cam.zoom * 0.15, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (look.kind === 'vehicle') {
      drawVehicle(ctx, cam, look.vehicle, e.pos.x, e.pos.y, e.unit?.facing ?? 0, color, now);
    } else {
      const action = actionOf(e);
      const speed = action === 'walk' || action === 'carry' ? 3.4 : 2.2;
      const phase = ((now * 0.001 * speed + e.id * 0.37) % 1 + 1) % 1;
      const frame = Math.floor(phase * FRAMES) % FRAMES;
      const style: PersonStyle = {
        cloth: color,
        accent: shade(color, -0.35),
        skin: skinFor(e.id),
        hat: look.style.hat,
        tool: look.style.tool,
        shield: look.style.shield,
      };
      const dir = directionIndex(screenAngleOf(e.unit?.facing ?? 0));
      const scale = def.pop >= 2 ? 1.15 : 1;
      const sprite = this.people.get(
        `${e.defId}|${color}|${skinFor(e.id)}`,
        cam.zoom,
        style,
        action,
        frame,
        dir,
        scale,
        // יחידות אוויר לא מטילות צל בנקודת הקרקע שלהן
        def.class !== 'air',
      );
      const flying = def.class === 'air';
      const p = cam.worldToScreen(e.pos.x, e.pos.y, flying ? 1.1 : 0);
      ctx.drawImage(
        sprite.canvas,
        Math.round(p.x - sprite.groundX),
        Math.round(p.y - sprite.groundY),
      );
    }

    // פס חיים
    const ratio = e.hp / e.maxHp;
    const recentlyHit = world.time - e.lastDamaged < 4;
    if (state.showHealthBars && (state.selected.has(e.id) || (ratio < 1 && recentlyHit) || ratio < 0.999)) {
      this.bar(e.pos.x, e.pos.y, 0.95, ratio, healthColor(ratio), 0.62);
    }

    // מה הפועל נושא
    if (e.unit?.carrying && cam.zoom > 34) {
      const p = cam.worldToScreen(e.pos.x, e.pos.y, 1.05);
      const colors: Record<string, string> = {
        food: '#d2603f', wood: '#8a6a3f', stone: '#9aa0a6', gold: '#e3b53f',
      };
      ctx.fillStyle = colors[e.unit.carrying.kind] ?? '#aaa';
      ctx.fillRect(p.x - cam.zoom * 0.05, p.y - cam.zoom * 0.05, cam.zoom * 0.1, cam.zoom * 0.1);
    }
    void owner;
  }

  /** פס (חיים/התקדמות) מרחף מעל נקודה בעולם. */
  /** לאילו שכנים מתחברת חומה — חומה, שער או מגדל של אותו בעלים. */
  private wallLinks(world: World, origin: Vec2, owner: number): WallLinks {
    const at = (x: number, y: number): boolean => {
      const b = world.nav.barrierAt(x, y);
      return b !== undefined && b.owner === owner;
    };
    return {
      n: at(origin.x, origin.y - 1),
      s: at(origin.x, origin.y + 1),
      w: at(origin.x - 1, origin.y),
      e: at(origin.x + 1, origin.y),
    };
  }

  /** שער נפתח כשיחידה של בעליו (או של בן בריתו) נמצאת לידו. */
  private gateOpen(world: World, e: Entity): boolean {
    const mine = world.player(e.owner)?.team ?? e.owner;
    return world.near(e.pos, 2.2, (o) =>
      o.kind === 'unit' && (world.player(o.owner)?.team ?? o.owner) === mine,
    ).length > 0;
  }

  private bar(wx: number, wy: number, z: number, ratio: number, color: string, widthTiles: number): void {
    const ctx = this.ctx;
    const p = this.camera.worldToScreen(wx, wy, z);
    const w = widthTiles * this.camera.zoom * 0.5;
    const h = Math.max(3, this.camera.zoom * 0.06);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(p.x - w / 2, p.y - h, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(p.x - w / 2, p.y - h, w * Math.max(0, Math.min(1, ratio)), h);
  }

  // ===== הצבת מבנה =====

  private drawPlacement(state: RenderState): void {
    if (!state.placing) return;
    const def = getBuilding(state.placing.defId);
    const ctx = this.ctx;
    const cam = this.camera;
    const { tile } = state.placing;
    ctx.save();
    ctx.globalAlpha = 0.45;
    poly(ctx, tileDiamond(cam, tile.x, tile.y, def.size, def.size, 0.04),
      state.placing.valid ? '#22c55e' : '#ef4444');
    ctx.globalAlpha = 0.75;
    drawBox(ctx, cam, tile.x + 0.1, tile.y + 0.1, def.size - 0.2, def.size - 0.2, 0.3,
      faceColors(state.placing.valid ? '#7dd3a0' : '#f08a8a'));
    ctx.restore();
  }

  // ===== ערפל =====

  /**
   * ערפל מלחמה כטקסטורה.
   *
   * ציור מעוין לכל אריח עלה אלפי פוליגונים בפריים. כאן בונים תמונה
   * אחת ומציירים אותה דרך ההקרנה האיזומטרית.
   *
   * הטקסטורה נבנית ברזולוציה כפולה מגודל המפה ועם דגימה דו-לינארית,
   * כך שקצה הערפל יוצא רך — בלי להפעיל החלקה של הדפדפן בזמן הציור,
   * שהתבררה כיקרה מאוד (כ-15ms לפריים) כשמותחים טקסטורה על כל המסך.
   */
  private drawFog(world: World, viewer: Player): void {
    const { width, height } = world.map;
    const S = 3; // פיקסלים לאריח בטקסטורה
    const tw = width * S;
    const th = height * S;
    if (!this.fogCanvas || this.fogCanvas.width !== tw) {
      this.fogCanvas = document.createElement('canvas');
      this.fogCanvas.width = tw;
      this.fogCanvas.height = th;
      this.fogImage = this.fogCanvas.getContext('2d')!.createImageData(tw, th);
      this.fogStamp = -1;
    }

    if (viewer.fog.revision !== this.fogStamp) {
      this.fogStamp = viewer.fog.revision;
      // שדה עכירות לפי אריח: 0 = נראה, 0.45 = נחקר, 1 = מוסתר
      const field = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const st = viewer.fog.state(x, y);
          field[y * width + x] = st === 2 ? 0 : st === FOG_EXPLORED ? 0.45 : 1;
        }
      }
      const img = this.fogImage!;
      const data = img.data;
      for (let py = 0; py < th; py++) {
        const fy = py / S - 0.5;
        const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
        const y1 = Math.max(0, Math.min(height - 1, y0 + 1));
        const wy = Math.max(0, Math.min(1, fy - y0));
        for (let px = 0; px < tw; px++) {
          const fx = px / S - 0.5;
          const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
          const x1 = Math.max(0, Math.min(width - 1, x0 + 1));
          const wx = Math.max(0, Math.min(1, fx - x0));
          const a =
            field[y0 * width + x0] * (1 - wx) * (1 - wy) +
            field[y0 * width + x1] * wx * (1 - wy) +
            field[y1 * width + x0] * (1 - wx) * wy +
            field[y1 * width + x1] * wx * wy;
          const i = (py * tw + px) * 4;
          data[i] = 8;
          data[i + 1] = 13;
          data[i + 2] = 22;
          data[i + 3] = Math.round(Math.min(1, a) * 255);
        }
      }
      this.fogCanvas.getContext('2d')!.putImageData(img, 0, 0);
    }

    const ctx = this.ctx;
    ctx.save();
    this.camera.applyIsoTransform(ctx, this.dpr);
    // ללא החלקה של הדפדפן: הריכוך כבר נעשה בבניית הטקסטורה
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.fogCanvas, 0, 0, width, height);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * הצללת קצוות עדינה — מרכזת את המבט ומוסיפה עומק.
   * נצרבת פעם אחת: מילוי גרדיאנט על כל המסך בכל פריים עלה כ-10ms.
   */
  private drawVignette(): void {
    const { viewWidth: w, viewHeight: h } = this.camera;
    if (!this.vignette || this.vignette.width !== w || this.vignette.height !== h) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
      const g2 = c.getContext('2d')!;
      const g = g2.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(4,8,14,0.42)');
      g2.fillStyle = g;
      g2.fillRect(0, 0, w, h);
      this.vignette = c;
    }
    this.ctx.drawImage(this.vignette, 0, 0);
  }

  private drawPings(state: RenderState, now: number): void {
    const ctx = this.ctx;
    for (const ping of state.pings) {
      const age = (now - ping.time) / 700;
      if (age > 1) continue;
      const ctr = this.camera.worldToScreen(ping.pos.x, ping.pos.y, 0.02);
      ctx.save();
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = ping.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(ctr.x, ctr.y, (0.2 + age * 0.9) * this.camera.zoom, (0.1 + age * 0.45) * this.camera.zoom, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    state.pings = state.pings.filter((p) => now - p.time < 700);
  }

  private drawDragRect(state: RenderState): void {
    if (!state.dragRect) return;
    const { x0, y0, x1, y1 } = state.dragRect;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(125,211,252,0.15)';
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    ctx.fillRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }
}

/** ממפה את פקודת היחידה לאנימציה המתאימה. */
function actionOf(e: Entity): Action {
  const order = e.order.kind;
  if (order === 'gather') {
    const res = e.order.resource;
    if (res === 'wood') return 'chop';
    if (res === 'stone' || res === 'gold') return 'mine';
    return 'farm';
  }
  if (order === 'build' || order === 'repair') return 'build';
  if (order === 'attack' || order === 'hold') return 'fight';
  if (order === 'return') return 'carry';
  if (order === 'move' || order === 'attackMove') return 'walk';
  if (e.unit?.carrying) return 'carry';
  return 'idle';
}

function healthColor(ratio: number): string {
  if (ratio > 0.6) return '#4ade80';
  if (ratio > 0.3) return '#facc15';
  return '#f87171';
}
