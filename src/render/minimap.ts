import { buildingOrigin } from '../core/entities';
import { FOG_EXPLORED, FOG_HIDDEN } from '../core/fog';
import type { Player } from '../core/player';
import type { Vec2 } from '../core/types';
import type { World } from '../core/world';
import type { Camera } from './camera';
import { TERRAIN_COLORS } from './sprites';

/** מיני-מפה: שכבת קרקע מצוירת מראש + ישויות וערפל בזמן אמת. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private dirty = true;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('לא ניתן ליצור הקשר ציור למיני-מפה');
    this.ctx = ctx;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** ממיר קליק על המיני-מפה לקואורדינטות עולם. */
  toWorld(world: World, px: number, py: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (px / rect.width) * world.map.width,
      y: (py / rect.height) * world.map.height,
    };
  }

  render(world: World, viewer: Player, camera: Camera): void {
    const { width, height } = this.canvas;
    if (!this.terrain || this.dirty) this.bake(world);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.terrain!, 0, 0, width, height);

    const sx = width / world.map.width;
    const sy = height / world.map.height;

    // ישויות
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      if (!world.canSee(viewer.id, e)) continue;
      const owner = world.player(e.owner);
      const isMine = e.owner === viewer.id;
      const isAlly = owner && owner.team === viewer.team;
      ctx.fillStyle = isMine ? '#ffffff' : isAlly ? '#22d3ee' : (owner?.color ?? '#f87171');
      if (e.kind === 'building') {
        const o = buildingOrigin(e);
        const size = e.building?.size ?? 1;
        ctx.fillRect(o.x * sx, o.y * sy, Math.max(2, size * sx), Math.max(2, size * sy));
      } else {
        ctx.fillRect(e.pos.x * sx - 1, e.pos.y * sy - 1, Math.max(2, sx), Math.max(2, sy));
      }
    }

    // ערפל
    ctx.save();
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const s = viewer.fog.state(x, y);
        if (s === 2) continue;
        ctx.fillStyle = s === FOG_EXPLORED ? 'rgba(8,12,20,0.4)' : 'rgba(5,8,14,0.92)';
        ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
    ctx.restore();

    // מלבן התצוגה
    const halfW = camera.viewWidth / 2 / camera.zoom;
    const halfH = camera.viewHeight / 2 / camera.zoom;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      (camera.x - halfW) * sx,
      (camera.y - halfH) * sy,
      halfW * 2 * sx,
      halfH * 2 * sy,
    );
  }

  private bake(world: World): void {
    const canvas = document.createElement('canvas');
    canvas.width = world.map.width;
    canvas.height = world.map.height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const res = world.map.resourceAt(x, y);
        let hex = TERRAIN_COLORS[world.map.terrainAt(x, y)][0];
        if (res) {
          hex =
            res.kind === 'wood'
              ? '#2f6b2a'
              : res.kind === 'gold'
                ? '#d8b23c'
                : res.kind === 'stone'
                  ? '#9aa0a6'
                  : '#d06060';
        }
        const i = (y * canvas.width + x) * 4;
        img.data[i] = parseInt(hex.slice(1, 3), 16);
        img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
        img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.terrain = canvas;
    this.dirty = false;
    void FOG_HIDDEN;
  }
}
