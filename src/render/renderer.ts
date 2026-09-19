import { getBuilding, getUnit } from '../data';
import { buildingOrigin, type Entity } from '../core/entities';
import { FOG_EXPLORED, FOG_HIDDEN } from '../core/fog';
import type { Player } from '../core/player';
import type { EntityId, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { Camera } from './camera';
import {
  drawBar,
  drawEmoji,
  drawShadow,
  drawSprite,
  healthColor,
  RESOURCE_EMOJI,
  roundRect,
  TERRAIN_COLORS,
  tileShade,
} from './sprites';

export type RenderState = {
  selected: Set<EntityId>;
  hovered: EntityId | null;
  /** מלבן בחירה בגרירה (בקואורדינטות מסך) */
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null;
  /** מבנה בהצבה */
  placing: { defId: string; valid: boolean; tile: Vec2 } | null;
  showHealthBars: boolean;
  /** סימוני פקודה זמניים */
  pings: Array<{ pos: Vec2; time: number; color: string }>;
};

export class Renderer {
  readonly camera = new Camera();
  private ctx: CanvasRenderingContext2D;
  /** שכבת קרקע מצוירת מראש — מצוירת מחדש רק כשהמפה משתנה */
  private terrainCanvas: HTMLCanvasElement | null = null;
  private terrainDirty = true;
  private tilePixels = 16;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('לא ניתן ליצור הקשר ציור דו-ממדי');
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr = 1): void {
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setViewport(width, height);
  }

  markTerrainDirty(): void {
    this.terrainDirty = true;
  }

  /** מצייר את כל השכבות. */
  render(world: World, viewer: Player, state: RenderState, now: number): void {
    const ctx = this.ctx;
    this.camera.setMapSize(world.map.width, world.map.height);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, this.camera.viewWidth, this.camera.viewHeight);

    this.drawTerrain(world);
    this.drawResources(world, viewer);
    this.drawControlRadius(world, viewer);
    this.drawEntities(world, viewer, state, now);
    this.drawPlacement(world, state);
    this.drawFog(world, viewer);
    this.drawPings(state, now);
    this.drawDragRect(state);
  }

  // ===== קרקע =====

  private drawTerrain(world: World): void {
    if (!this.terrainCanvas || this.terrainDirty) this.bakeTerrain(world);
    const cam = this.camera;
    const canvas = this.terrainCanvas!;
    const scale = cam.zoom / this.tilePixels;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = cam.zoom < this.tilePixels;
    const topLeft = cam.worldToScreen(0, 0);
    ctx.drawImage(
      canvas,
      topLeft.x,
      topLeft.y,
      canvas.width * scale,
      canvas.height * scale,
    );
  }

  private bakeTerrain(world: World): void {
    const px = this.tilePixels;
    const canvas = document.createElement('canvas');
    canvas.width = world.map.width * px;
    canvas.height = world.map.height * px;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const t = world.map.terrainAt(x, y);
        const [a, b] = TERRAIN_COLORS[t];
        ctx.fillStyle = tileShade(x, y) > 0.5 ? a : b;
        ctx.fillRect(x * px, y * px, px, px);
      }
    }
    // קו חוף עדין
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const t = world.map.terrainAt(x, y);
        if (t !== 'shallow') continue;
        ctx.fillRect(x * px, y * px, px, 2);
      }
    }
    this.terrainCanvas = canvas;
    this.terrainDirty = false;
  }

  // ===== משאבים =====

  private drawResources(world: World, viewer: Player): void {
    const cam = this.camera;
    const bounds = cam.visibleBounds();
    const size = Math.max(8, cam.zoom * 0.85);
    const ctx = this.ctx;
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const res = world.map.resourceAt(x, y);
        if (!res) continue;
        if (viewer.fog.state(x, y) === FOG_HIDDEN) continue;
        const p = cam.worldToScreen(x + 0.5, y + 0.5);
        if (cam.zoom < 10) {
          ctx.fillStyle = res.kind === 'wood' ? '#2f6b2a' : res.kind === 'gold' ? '#d8b23c' : '#8d8d8d';
          ctx.fillRect(p.x - cam.zoom / 2, p.y - cam.zoom / 2, cam.zoom, cam.zoom);
          continue;
        }
        drawSprite(ctx, `res_${res.visual}`, RESOURCE_EMOJI[res.visual], p.x, p.y, size);
      }
    }
  }

  /** רדיוס השליטה של היישוב — מעגל מקווקו סביב מרכז היישוב. */
  private drawControlRadius(world: World, viewer: Player): void {
    const tc = world.townCenterOf(viewer.id);
    if (!tc) return;
    const radius = viewer.currentStage().controlRadius;
    const center = this.camera.worldToScreen(tc.pos.x, tc.pos.y);
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * this.camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ===== ישויות =====

  private drawEntities(world: World, viewer: Player, state: RenderState, now: number): void {
    const cam = this.camera;
    const bounds = cam.visibleBounds(4);
    const visible: Entity[] = [];
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      if (e.pos.x < bounds.minX - 2 || e.pos.x > bounds.maxX + 2) continue;
      if (e.pos.y < bounds.minY - 2 || e.pos.y > bounds.maxY + 2) continue;
      if (!world.canSee(viewer.id, e)) continue;
      visible.push(e);
    }
    // מבנים קודם, אחר כך יחידות (כדי שיחידות יופיעו מעל)
    visible.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'building' ? -1 : 1;
      return a.pos.y - b.pos.y;
    });

    for (const e of visible) {
      if (e.kind === 'building') this.drawBuilding(world, e, viewer, state);
      else this.drawUnit(world, e, viewer, state, now);
    }
  }

  private ownerColor(world: World, e: Entity): string {
    return world.player(e.owner)?.color ?? '#999';
  }

  private drawBuilding(world: World, e: Entity, viewer: Player, state: RenderState): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const def = getBuilding(e.defId);
    const origin = buildingOrigin(e);
    const tl = cam.worldToScreen(origin.x, origin.y);
    const size = def.size * cam.zoom;
    const owner = world.player(e.owner);
    const color = this.ownerColor(world, e);
    const complete = e.building?.complete ?? true;

    ctx.save();
    ctx.globalAlpha = complete ? 1 : 0.55;
    ctx.fillStyle = 'rgba(20,25,35,0.55)';
    roundRect(ctx, tl.x + 1, tl.y + 1, size - 2, size - 2, Math.min(8, size / 5));
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, cam.zoom / 12);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // מרכז יישוב מציג את המראה של השלב הנוכחי
    let emoji = def.emoji;
    if (def.isTownCenter && owner) emoji = owner.centerAppearance().emoji;
    if (complete) {
      drawSprite(ctx, e.defId, emoji, tl.x + size / 2, tl.y + size / 2, size * 0.68);
    } else {
      drawEmoji(ctx, '🚧', tl.x + size / 2, tl.y + size / 2, size * 0.5);
      drawBar(
        ctx,
        tl.x + size * 0.1,
        tl.y + size - 8,
        size * 0.8,
        5,
        e.building!.progress,
        '#60a5fa',
      );
    }
    ctx.restore();

    if (state.selected.has(e.id)) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      roundRect(ctx, tl.x - 2, tl.y - 2, size + 4, size + 4, 6);
      ctx.stroke();
    }

    const hurt = e.hp < e.maxHp;
    if (state.showHealthBars && (hurt || state.selected.has(e.id)) && complete) {
      drawBar(ctx, tl.x + 2, tl.y - 7, size - 4, 5, e.hp / e.maxHp, healthColor(e.hp / e.maxHp));
    }

    // תור אימון
    if (e.building?.trainQueue.length && e.owner === viewer.id) {
      const item = e.building.trainQueue[0];
      drawBar(
        ctx,
        tl.x + 2,
        tl.y + size + 2,
        size - 4,
        4,
        1 - item.remaining / item.total,
        '#38bdf8',
      );
    }
    if (e.building?.research && e.owner === viewer.id) {
      drawBar(
        ctx,
        tl.x + 2,
        tl.y + size + 8,
        size - 4,
        4,
        1 - e.building.research.remaining / e.building.research.total,
        '#c084fc',
      );
    }
    // נקודת כינוס
    if (e.building?.rally && state.selected.has(e.id)) {
      const from = cam.worldToScreen(e.pos.x, e.pos.y);
      const to = cam.worldToScreen(e.building.rally.x, e.building.rally.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
      drawEmoji(ctx, '🚩', to.x, to.y, 18);
    }
  }

  private drawUnit(
    world: World,
    e: Entity,
    viewer: Player,
    state: RenderState,
    now: number,
  ): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const def = getUnit(e.defId);
    const p = cam.worldToScreen(e.pos.x, e.pos.y);
    const size = Math.max(8, cam.zoom * 0.8);
    const color = this.ownerColor(world, e);
    const flying = def.class === 'air';

    if (flying) {
      drawShadow(ctx, p.x, p.y + cam.zoom * 0.45, size * 0.3, size * 0.15);
    } else {
      drawShadow(ctx, p.x, p.y + size * 0.3, size * 0.28, size * 0.12);
    }

    // טבעת בעלות
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, cam.zoom / 14);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(p.x, p.y + size * 0.28, size * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const bob = e.unit ? Math.sin(now * 0.006 + e.id) * (cam.zoom * 0.02) : 0;
    const lunge = e.unit ? e.unit.attackAnim * cam.zoom * 0.12 : 0;
    const dx = e.unit ? Math.cos(e.unit.facing) * lunge : 0;
    const dy = e.unit ? Math.sin(e.unit.facing) * lunge : 0;
    drawSprite(
      ctx,
      e.defId,
      def.emoji,
      p.x + dx,
      p.y - (flying ? cam.zoom * 0.35 : 0) + bob + dy,
      size,
    );

    // מה הפועל נושא
    if (e.unit?.carrying && cam.zoom > 18) {
      const icons: Record<string, string> = { food: '🍖', wood: '🪵', stone: '🪨', gold: '🪙' };
      drawEmoji(ctx, icons[e.unit.carrying.kind] ?? '📦', p.x + size * 0.35, p.y - size * 0.35, size * 0.35);
    }

    if (state.selected.has(e.id)) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + size * 0.3, size * 0.42, size * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const ratio = e.hp / e.maxHp;
    const recentlyHit = world.time - e.lastDamaged < 4;
    if (state.showHealthBars && (ratio < 1 || state.selected.has(e.id)) && (recentlyHit || state.selected.has(e.id) || ratio < 0.99)) {
      drawBar(ctx, p.x - size * 0.4, p.y - size * 0.55, size * 0.8, 4, ratio, healthColor(ratio));
    }
    void viewer;
  }

  // ===== הצבת מבנה =====

  private drawPlacement(world: World, state: RenderState): void {
    if (!state.placing) return;
    const def = getBuilding(state.placing.defId);
    const cam = this.camera;
    const ctx = this.ctx;
    const tl = cam.worldToScreen(state.placing.tile.x, state.placing.tile.y);
    const size = def.size * cam.zoom;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = state.placing.valid ? '#22c55e' : '#ef4444';
    ctx.fillRect(tl.x, tl.y, size, size);
    ctx.globalAlpha = 0.95;
    drawEmoji(ctx, def.emoji, tl.x + size / 2, tl.y + size / 2, size * 0.6);
    ctx.restore();
    void world;
  }

  // ===== ערפל מלחמה =====

  private drawFog(world: World, viewer: Player): void {
    const cam = this.camera;
    const ctx = this.ctx;
    const bounds = cam.visibleBounds(1);
    const z = cam.zoom;
    ctx.save();
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const s = viewer.fog.state(x, y);
        if (s === 2) continue;
        const p = cam.worldToScreen(x, y);
        ctx.fillStyle = s === FOG_EXPLORED ? 'rgba(8,12,20,0.45)' : 'rgba(5,8,14,0.96)';
        ctx.fillRect(p.x, p.y, z + 1, z + 1);
      }
    }
    ctx.restore();
    void world;
  }

  // ===== סימונים =====

  private drawPings(state: RenderState, now: number): void {
    const ctx = this.ctx;
    for (const ping of state.pings) {
      const age = (now - ping.time) / 600;
      if (age > 1) continue;
      const p = this.camera.worldToScreen(ping.pos.x, ping.pos.y);
      ctx.save();
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = ping.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + age * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    state.pings = state.pings.filter((p) => now - p.time < 600);
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
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}
