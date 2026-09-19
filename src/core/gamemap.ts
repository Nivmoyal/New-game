import { fbm, Rng } from './rng';
import type { Terrain, TileResource, Vec2 } from './types';

export const TERRAIN_PASSABLE: Record<Terrain, boolean> = {
  grass: true,
  dirt: true,
  sand: true,
  forest: false,
  water: false,
  shallow: true,
  hill: true,
  rock: false,
};

/** מקדם מהירות תנועה לכל סוג קרקע. */
export const TERRAIN_SPEED: Record<Terrain, number> = {
  grass: 1,
  dirt: 1,
  sand: 0.9,
  forest: 0.35,
  water: 0,
  shallow: 0.6,
  hill: 0.8,
  rock: 0,
};

export type MapOptions = {
  width?: number;
  height?: number;
  seed?: number;
  /** כמה יערות (0..1) */
  woodDensity?: number;
  /** כמות מים (0..1) */
  water?: number;
  playerCount?: number;
};

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly terrain: Uint8Array;
  /** משאבים לפי אינדקס אריח. */
  readonly resources = new Map<number, TileResource>();
  /** נקודות פתיחה מוצעות לשחקנים. */
  startPositions: Vec2[] = [];

  private static readonly TERRAIN_ORDER: Terrain[] = [
    'grass',
    'dirt',
    'sand',
    'forest',
    'water',
    'shallow',
    'hill',
    'rock',
  ];

  constructor(width = 128, height = 128, seed = 1) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.terrain = new Uint8Array(width * height);
    this.terrain.fill(GameMap.TERRAIN_ORDER.indexOf('grass'));
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  terrainAt(x: number, y: number): Terrain {
    if (!this.inBounds(x, y)) return 'rock';
    return GameMap.TERRAIN_ORDER[this.terrain[this.idx(x, y)]];
  }

  setTerrain(x: number, y: number, t: Terrain): void {
    if (!this.inBounds(x, y)) return;
    this.terrain[this.idx(x, y)] = GameMap.TERRAIN_ORDER.indexOf(t);
  }

  /** אריח חסום למעבר (קרקע או משאב עומד כמו עץ/מכרה). */
  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    if (!TERRAIN_PASSABLE[this.terrainAt(x, y)]) return true;
    const res = this.resources.get(this.idx(x, y));
    if (res && res.visual !== 'berry' && res.visual !== 'farm' && res.visual !== 'fish') return true;
    return false;
  }

  speedAt(x: number, y: number): number {
    return TERRAIN_SPEED[this.terrainAt(x, y)];
  }

  resourceAt(x: number, y: number): TileResource | undefined {
    return this.resources.get(this.idx(x, y));
  }

  /** מוריד כמות ממשאב; מחזיר את הכמות שנלקחה בפועל. מסיר משאב שהתרוקן. */
  harvest(x: number, y: number, amount: number): number {
    const key = this.idx(x, y);
    const res = this.resources.get(key);
    if (!res) return 0;
    const taken = Math.min(amount, res.amount);
    res.amount -= taken;
    if (res.amount <= 0) {
      this.resources.delete(key);
      if (res.visual === 'tree') this.setTerrain(x, y, 'grass');
    }
    return taken;
  }

  addResource(x: number, y: number, res: TileResource): void {
    if (!this.inBounds(x, y)) return;
    this.resources.set(this.idx(x, y), res);
  }

  /** מוצא אריח פנוי קרוב לנקודה (BFS בספירלה). */
  findFreeTile(x: number, y: number, maxRadius = 12): Vec2 | null {
    const sx = Math.floor(x);
    const sy = Math.floor(y);
    if (!this.isBlocked(sx, sy)) return { x: sx, y: sy };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = sx + dx;
          const ny = sy + dy;
          if (this.inBounds(nx, ny) && !this.isBlocked(nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  /** בודק ששטח מלבני פנוי לבנייה. */
  isAreaFree(x: number, y: number, w: number, h: number): boolean {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this.inBounds(tx, ty)) return false;
        if (this.isBlocked(tx, ty)) return false;
        if (this.terrainAt(tx, ty) === 'shallow') return false;
      }
    }
    return true;
  }
}

/** יוצר מפה פרוצדורלית עם יערות, מכרות, שיחי פירות ומים. */
export function generateMap(opts: MapOptions = {}): GameMap {
  const width = opts.width ?? 128;
  const height = opts.height ?? 128;
  const seed = opts.seed ?? 12345;
  const waterAmount = opts.water ?? 0.5;
  const woodDensity = opts.woodDensity ?? 0.5;
  const playerCount = opts.playerCount ?? 2;

  const map = new GameMap(width, height, seed);
  const rng = new Rng(seed);
  const elevation = fbm(seed, 5);
  const moisture = fbm(seed + 1337, 4);
  const trees = fbm(seed + 4242, 3);

  const scale = 12 / Math.max(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = elevation(x * scale * 4, y * scale * 4);
      const m = moisture(x * scale * 3, y * scale * 3);
      const waterLine = 0.28 * waterAmount;
      let t: Terrain;
      if (e < waterLine) t = 'water';
      else if (e < waterLine + 0.04) t = 'shallow';
      else if (e > 0.76) t = 'hill';
      else if (m < 0.35) t = 'sand';
      else if (m < 0.45) t = 'dirt';
      else t = 'grass';
      map.setTerrain(x, y, t);
    }
  }

  // יערות
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = map.terrainAt(x, y);
      if (t !== 'grass' && t !== 'dirt') continue;
      const f = trees(x * scale * 6, y * scale * 6);
      if (f > 1 - 0.45 * woodDensity) {
        map.setTerrain(x, y, 'forest');
        map.addResource(x, y, { kind: 'wood', amount: 120, visual: 'tree' });
      }
    }
  }

  // מכרות אבן וזהב — אשכולות
  const mineClusters = Math.round((width * height) / 900);
  for (let i = 0; i < mineClusters; i++) {
    const kind = rng.chance(0.5) ? 'stone' : 'gold';
    const cx = rng.int(4, width - 5);
    const cy = rng.int(4, height - 5);
    if (map.isBlocked(cx, cy)) continue;
    const size = rng.int(3, 6);
    for (let k = 0; k < size; k++) {
      const x = cx + rng.int(-2, 2);
      const y = cy + rng.int(-2, 2);
      if (!map.inBounds(x, y)) continue;
      const t = map.terrainAt(x, y);
      if (t === 'water' || t === 'shallow' || t === 'forest') continue;
      map.setTerrain(x, y, 'rock');
      map.addResource(x, y, {
        kind: kind === 'stone' ? 'stone' : 'gold',
        amount: kind === 'stone' ? 350 : 300,
        visual: kind === 'stone' ? 'stone_mine' : 'gold_mine',
      });
    }
  }

  // שיחי פירות
  const berryClusters = Math.round((width * height) / 1100);
  for (let i = 0; i < berryClusters; i++) {
    const cx = rng.int(3, width - 4);
    const cy = rng.int(3, height - 4);
    for (let k = 0; k < rng.int(3, 6); k++) {
      const x = cx + rng.int(-2, 2);
      const y = cy + rng.int(-2, 2);
      if (!map.inBounds(x, y)) continue;
      const t = map.terrainAt(x, y);
      if (t !== 'grass' && t !== 'dirt' && t !== 'sand') continue;
      if (map.resourceAt(x, y)) continue;
      map.addResource(x, y, { kind: 'food', amount: 150, visual: 'berry' });
    }
  }

  // דגים במים רדודים
  for (let i = 0; i < Math.round((width * height) / 2000); i++) {
    const cx = rng.int(2, width - 3);
    const cy = rng.int(2, height - 3);
    if (map.terrainAt(cx, cy) !== 'water') continue;
    map.addResource(cx, cy, { kind: 'food', amount: 200, visual: 'fish' });
  }

  map.startPositions = pickStartPositions(map, playerCount, rng);
  ensureStartingResources(map, rng);
  return map;
}

/** בוחר נקודות פתיחה מרוחקות זו מזו על שטח פתוח. */
export function pickStartPositions(map: GameMap, count: number, rng: Rng): Vec2[] {
  const margin = Math.round(Math.min(map.width, map.height) * 0.12) + 6;
  const candidates: Vec2[] = [];
  for (let attempt = 0; attempt < 4000 && candidates.length < count * 12; attempt++) {
    const x = rng.int(margin, map.width - margin - 1);
    const y = rng.int(margin, map.height - margin - 1);
    if (map.isAreaFree(x - 3, y - 3, 7, 7)) candidates.push({ x, y });
  }
  if (candidates.length === 0) {
    // fallback: פינות
    return Array.from({ length: count }, (_, i) => ({
      x: i % 2 === 0 ? margin : map.width - margin,
      y: i < 2 ? margin : map.height - margin,
    }));
  }
  const chosen: Vec2[] = [candidates[0]];
  while (chosen.length < count) {
    let best = candidates[0];
    let bestDist = -1;
    for (const c of candidates) {
      const d = Math.min(...chosen.map((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2));
      if (d > bestDist) {
        bestDist = d;
        best = c;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

/** מוודא שלכל נקודת פתיחה יש עץ, פירות וזהב בטווח סביר. */
function ensureStartingResources(map: GameMap, rng: Rng): void {
  for (const pos of map.startPositions) {
    // שטח נקי סביב המרכז
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (!map.inBounds(x, y)) continue;
        map.resources.delete(map.idx(x, y));
        if (!TERRAIN_PASSABLE[map.terrainAt(x, y)]) map.setTerrain(x, y, 'grass');
      }
    }
    plantCluster(map, rng, pos, 6, 9, 8, (x, y) => {
      map.setTerrain(x, y, 'forest');
      map.addResource(x, y, { kind: 'wood', amount: 120, visual: 'tree' });
    });
    plantCluster(map, rng, pos, 5, 8, 5, (x, y) => {
      map.addResource(x, y, { kind: 'food', amount: 150, visual: 'berry' });
    });
    plantCluster(map, rng, pos, 7, 11, 4, (x, y) => {
      map.setTerrain(x, y, 'rock');
      map.addResource(x, y, { kind: 'gold', amount: 300, visual: 'gold_mine' });
    });
    plantCluster(map, rng, pos, 8, 12, 4, (x, y) => {
      map.setTerrain(x, y, 'rock');
      map.addResource(x, y, { kind: 'stone', amount: 350, visual: 'stone_mine' });
    });
  }
}

function plantCluster(
  map: GameMap,
  rng: Rng,
  center: Vec2,
  minR: number,
  maxR: number,
  count: number,
  place: (x: number, y: number) => void,
): void {
  const angle = rng.float(0, Math.PI * 2);
  const r = rng.float(minR, maxR);
  const bx = Math.round(center.x + Math.cos(angle) * r);
  const by = Math.round(center.y + Math.sin(angle) * r);
  let placed = 0;
  for (let attempt = 0; attempt < count * 8 && placed < count; attempt++) {
    const x = bx + rng.int(-2, 2);
    const y = by + rng.int(-2, 2);
    if (!map.inBounds(x, y)) continue;
    if (map.terrainAt(x, y) === 'water' || map.terrainAt(x, y) === 'shallow') continue;
    if (map.resourceAt(x, y)) continue;
    place(x, y);
    placed++;
  }
}
