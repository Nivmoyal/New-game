import { DEFAULT_MAP_PRESET, getMapPreset } from '../data';
import type { MapPresetDef } from '../data/schema';
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
  /** מזהה תבנית המפה (ראו src/data/maps.json) */
  preset?: string;
  /** דריסה ידנית של צפיפות היערות (0..1) */
  woodDensity?: number;
  /** דריסה ידנית של כמות המים (0..1) */
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
  /** מזהה תבנית המפה שממנה נוצרה. */
  presetId = 'greenland';
  /** אריחים שהשתנו מאז הקריאה האחרונה — לשכבת הציור המטמונה. */
  private dirtyTiles: Vec2[] = [];

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
    this.markDirty(x, y);
  }

  private markDirty(x: number, y: number): void {
    if (this.dirtyTiles.length < 4096) this.dirtyTiles.push({ x, y });
  }

  /** מחזיר את האריחים שהשתנו ומנקה את הרשימה. */
  consumeDirtyTiles(): Vec2[] {
    if (this.dirtyTiles.length === 0) return [];
    const out = this.dirtyTiles;
    this.dirtyTiles = [];
    return out;
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
      this.markDirty(x, y);
      if (res.visual === 'tree') this.setTerrain(x, y, 'grass');
    }
    return taken;
  }

  addResource(x: number, y: number, res: TileResource): void {
    if (!this.inBounds(x, y)) return;
    this.resources.set(this.idx(x, y), res);
    this.markDirty(x, y);
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
  const preset = getMapPreset(opts.preset ?? DEFAULT_MAP_PRESET);
  const waterAmount = opts.water ?? preset.water;
  const woodDensity = opts.woodDensity ?? preset.woodDensity;
  const playerCount = opts.playerCount ?? 2;

  const map = new GameMap(width, height, seed);
  const rng = new Rng(seed);
  const elevation = fbm(seed, 5);
  const moisture = fbm(seed + 1337, 4);
  const trees = fbm(seed + 4242, 3);

  const scale = 12 / Math.max(width, height);
  // רמת ההרים נגזרת מהתבנית: ערך נמוך = כמעט מישור, גבוה = רכסים
  const hillLine = 0.86 - 0.22 * preset.hills;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = elevation(x * scale * 4, y * scale * 4);
      const m = moisture(x * scale * 3, y * scale * 3) + preset.moisture;
      const waterLine = 0.28 * waterAmount;
      let t: Terrain;
      if (e < waterLine) t = 'water';
      else if (e < waterLine + 0.04) t = 'shallow';
      else if (e > hillLine) t = 'hill';
      else if (m < 0.35) t = 'sand';
      else if (m < 0.45) t = 'dirt';
      else t = 'grass';
      map.setTerrain(x, y, t);
    }
  }

  applyMapFeature(map, preset, rng);

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
  const mineClusters = Math.round(((width * height) / 900) * preset.mines);
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
  const berryClusters = Math.round(((width * height) / 1100) * preset.berries);
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
  const fishSpots = Math.round(((width * height) / 2000) * (0.5 + preset.water));
  for (let i = 0; i < fishSpots; i++) {
    const cx = rng.int(2, width - 3);
    const cy = rng.int(2, height - 3);
    if (map.terrainAt(cx, cy) !== 'water') continue;
    map.addResource(cx, cy, { kind: 'food', amount: 200, visual: 'fish' });
  }

  map.startPositions = pickStartPositions(map, playerCount, rng);
  map.presetId = preset.id;
  ensureStartingResources(map, rng);
  return map;
}

/**
 * בוחר נקודות פתיחה מרוחקות זו מזו על שטח פתוח.
 *
 * כל הנקודות נבחרות מתוך רכיב הקשירות הגדול ביותר של המפה, כך שתמיד
 * קיים מסלול יבשתי בין כל שני שחקנים — גם במפות עם הרבה מים כמו
 * "ארץ האגמים" ו"פיורדים צפוניים".
 *
 * המועמדים נסרקים בגריד קבוע (ולא בהגרלה), כי במפות עם יבשת בצורה
 * לא סדירה הגרלה נוטה להתרכז באזור אחד ולהצמיד שני שחקנים זה לזה.
 */
/**
 * האם אפשר להקים יישוב באריח הזה.
 *
 * לא דורשים שהשטח יהיה פנוי כבר עכשיו — ensureStartingResources ממילא
 * מנקה 7x7 סביב כל נקודת פתיחה (כורת עצים ומפנה סלעים). מה שכן חייב
 * להתקיים הוא שאין שם מים: אותם אי אפשר "לנקות" בלי לייבש אגם.
 */
function isStartViable(map: GameMap, cx: number, cy: number): boolean {
  for (let dy = -START_CLEAR_RADIUS; dy <= START_CLEAR_RADIUS; dy++) {
    for (let dx = -START_CLEAR_RADIUS; dx <= START_CLEAR_RADIUS; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!map.inBounds(x, y)) return false;
      const t = map.terrainAt(x, y);
      if (t === 'water' || t === 'shallow') return false;
    }
  }
  return true;
}

export function pickStartPositions(map: GameMap, count: number, rng: Rng): Vec2[] {
  void rng;
  const margin = Math.round(Math.min(map.width, map.height) * 0.1) + 5;
  const { labels, largest } = landComponents(map);
  const onMainland = (x: number, y: number) => labels[y * map.width + x] === largest;

  // סריקה בגריד; הצעד גדל במפות גדולות כדי להחזיק את מספר המועמדים סביר
  const stride = Math.max(2, Math.round(Math.max(map.width, map.height) / 48));
  const candidates: Vec2[] = [];
  for (let y = margin; y < map.height - margin; y += stride) {
    for (let x = margin; x < map.width - margin; x += stride) {
      if (!onMainland(x, y)) continue;
      if (!isStartViable(map, x, y)) continue;
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) {
    // גיבוי אחרון: פינות (מפה קטנה מאוד או חסומה במיוחד)
    return Array.from({ length: count }, (_, i) => ({
      x: i % 2 === 0 ? margin : map.width - margin - 1,
      y: i < 2 ? margin : map.height - margin - 1,
    }));
  }
  if (candidates.length <= count) {
    return Array.from({ length: count }, (_, i) => candidates[i % candidates.length]);
  }

  const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  // מתחילים מהזוג הרחוק ביותר, וממשיכים בגרידי max-min
  let first = candidates[0];
  let second = candidates[1];
  let bestPair = -1;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const d = dist2(candidates[i], candidates[j]);
      if (d > bestPair) {
        bestPair = d;
        first = candidates[i];
        second = candidates[j];
      }
    }
  }

  const chosen: Vec2[] = count === 1 ? [first] : [first, second];
  while (chosen.length < count) {
    let best = candidates[0];
    let bestDist = -1;
    for (const c of candidates) {
      let nearest = Infinity;
      for (const p of chosen) nearest = Math.min(nearest, dist2(p, c));
      if (nearest > bestDist) {
        bestDist = nearest;
        best = c;
      }
    }
    chosen.push(best);
  }
  return chosen.slice(0, count);
}

/**
 * מוודא שלכל נקודת פתיחה יש עץ, פירות, זהב ואבן בטווח סביר.
 *
 * שני מעברים בכוונה: קודם מנקים את השטח סביב *כל* נקודות הפתיחה,
 * ורק אחר כך שותלים. אחרת שתילה של שחקן אחד הייתה חוסמת את שטח
 * הבנייה של שחקן אחר, וניקוי של שחקן מאוחר היה מוחק משאבי פתיחה
 * שכבר נשתלו עבור קודמו.
 */
const START_CLEAR_RADIUS = 3;
/** שום משאב לא נשתל קרוב מזה לנקודת פתיחה כלשהי. */
const START_KEEP_CLEAR = 4;

function ensureStartingResources(map: GameMap, rng: Rng): void {
  // מעבר ראשון: ניקוי שטח הבנייה סביב כל נקודות הפתיחה
  for (const pos of map.startPositions) {
    for (let dy = -START_CLEAR_RADIUS; dy <= START_CLEAR_RADIUS; dy++) {
      for (let dx = -START_CLEAR_RADIUS; dx <= START_CLEAR_RADIUS; dx++) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (!map.inBounds(x, y)) continue;
        map.resources.delete(map.idx(x, y));
        if (!TERRAIN_PASSABLE[map.terrainAt(x, y)]) map.setTerrain(x, y, 'grass');
      }
    }
  }

  // מעבר שני: שתילת משאבי הפתיחה, בלי לחדור לשטח של אף שחקן
  const starts = map.startPositions;
  for (const pos of starts) {
    plantCluster(map, rng, starts, pos, 6, 9, 8, (x, y) => {
      map.setTerrain(x, y, 'forest');
      map.addResource(x, y, { kind: 'wood', amount: 120, visual: 'tree' });
    });
    plantCluster(map, rng, starts, pos, 5, 8, 5, (x, y) => {
      map.addResource(x, y, { kind: 'food', amount: 150, visual: 'berry' });
    });
    plantCluster(map, rng, starts, pos, 7, 11, 4, (x, y) => {
      map.setTerrain(x, y, 'rock');
      map.addResource(x, y, { kind: 'gold', amount: 300, visual: 'gold_mine' });
    });
    plantCluster(map, rng, starts, pos, 8, 12, 4, (x, y) => {
      map.setTerrain(x, y, 'rock');
      map.addResource(x, y, { kind: 'stone', amount: 350, visual: 'stone_mine' });
    });
  }
}

/** האם האריח קרוב מדי לנקודת פתיחה כלשהי. */
function tooCloseToAnyStart(starts: Vec2[], x: number, y: number): boolean {
  return starts.some(
    (s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) <= START_KEEP_CLEAR,
  );
}

/**
 * שותל אשכול משאבים סביב נקודת פתיחה.
 *
 * מנסה כמה כיוונים ורדיוסים: במפות חופיות או מיוערות הכיוון הראשון
 * עלול ליפול בתוך המים או על שטח תפוס, ובלי הניסיונות החוזרים היו
 * נוצרות נקודות פתיחה בלי זהב או בלי עץ.
 */
function plantCluster(
  map: GameMap,
  rng: Rng,
  starts: Vec2[],
  center: Vec2,
  minR: number,
  maxR: number,
  count: number,
  place: (x: number, y: number) => void,
): void {
  let placed = 0;
  const maxBases = 16;

  for (let base = 0; base < maxBases && placed < count; base++) {
    // ככל שמתקשים, מרחיבים את טווח החיפוש
    const spread = 1 + Math.floor(base / 4);
    const angle = rng.float(0, Math.PI * 2);
    const r = rng.float(minR, maxR + base * 0.5);
    const bx = Math.round(center.x + Math.cos(angle) * r);
    const by = Math.round(center.y + Math.sin(angle) * r);

    for (let attempt = 0; attempt < count * 8 && placed < count; attempt++) {
      const x = bx + rng.int(-spread - 1, spread + 1);
      const y = by + rng.int(-spread - 1, spread + 1);
      if (!map.inBounds(x, y)) continue;
      const t = map.terrainAt(x, y);
      if (t === 'water' || t === 'shallow') continue;
      if (map.resourceAt(x, y)) continue;
      if (tooCloseToAnyStart(starts, x, y)) continue;
      place(x, y);
      placed++;
    }
  }
}

/**
 * תכונות גאוגרפיות מיוחדות לכל תבנית מפה.
 * נחרטות אחרי שכבת הקרקע הבסיסית ולפני פיזור המשאבים.
 */
function applyMapFeature(map: GameMap, preset: MapPresetDef, rng: Rng): void {
  switch (preset.feature) {
    case 'river':
      carveRiver(map, rng);
      break;
    case 'lakes':
      carveLakes(map, rng);
      break;
    case 'coast':
      carveCoast(map, rng);
      break;
    case 'oasis':
      carveOases(map, rng);
      break;
    case 'none':
    default:
      break;
  }
}

/** נהר מתפתל שחוצה את המפה, עם כמה מעברות רדודות. */
function carveRiver(map: GameMap, rng: Rng): void {
  const vertical = rng.chance(0.5);
  const length = vertical ? map.height : map.width;
  const across = vertical ? map.width : map.height;
  const wobble = fbm(map.seed + 9001, 3);
  let center = across / 2;
  const halfWidth = Math.max(2, Math.round(across * 0.035));

  // מעברות: קטעים שבהם הנהר רדוד ואפשר לעבור אותו
  const fordCount = 3;
  const fords = Array.from({ length: fordCount }, (_, i) =>
    Math.round(((i + 1) * length) / (fordCount + 1) + rng.int(-4, 4)),
  );

  for (let i = 0; i < length; i++) {
    center = across / 2 + (wobble(i * 0.06, 0) - 0.5) * across * 0.3;
    const isFord = fords.some((f) => Math.abs(i - f) <= 2);
    for (let d = -halfWidth; d <= halfWidth; d++) {
      const pos = Math.round(center + d);
      const x = vertical ? pos : i;
      const y = vertical ? i : pos;
      if (!map.inBounds(x, y)) continue;
      map.resources.delete(map.idx(x, y));
      const edge = Math.abs(d) >= halfWidth - 1;
      map.setTerrain(x, y, isFord ? 'shallow' : edge ? 'shallow' : 'water');
    }
  }
}

/** מספר אגמים עגולים גדולים שמפצלים את המפה. */
function carveLakes(map: GameMap, rng: Rng): void {
  const count = Math.max(3, Math.round((map.width * map.height) / 2600));
  for (let i = 0; i < count; i++) {
    const cx = rng.int(8, map.width - 9);
    const cy = rng.int(8, map.height - 9);
    const radius = rng.int(4, Math.max(5, Math.round(map.width * 0.07)));
    for (let dy = -radius - 1; dy <= radius + 1; dy++) {
      for (let dx = -radius - 1; dx <= radius + 1; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius + 1) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        map.resources.delete(map.idx(x, y));
        map.setTerrain(x, y, d > radius - 0.8 ? 'shallow' : 'water');
      }
    }
  }
}

/** חוף משונן עם מפרצים — שולי המפה הופכים לים. */
function carveCoast(map: GameMap, rng: Rng): void {
  const noise = fbm(map.seed + 7777, 4);
  const depth = Math.max(4, Math.round(Math.min(map.width, map.height) * 0.14));
  const side = rng.int(0, 3);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const along = side === 0 || side === 1 ? x : y;
      const into = side === 0 ? y : side === 1 ? map.height - 1 - y : side === 2 ? x : map.width - 1 - x;
      const edge = depth * (0.35 + noise(along * 0.09, 0) * 1.3);
      if (into < edge) {
        map.resources.delete(map.idx(x, y));
        map.setTerrain(x, y, into < edge - 1.5 ? 'water' : 'shallow');
      }
    }
  }
}

/** נאות מדבר: כתמי דשא ומים קטנים בתוך החולות. */
function carveOases(map: GameMap, rng: Rng): void {
  const count = Math.max(4, Math.round((map.width * map.height) / 2200));
  for (let i = 0; i < count; i++) {
    const cx = rng.int(6, map.width - 7);
    const cy = rng.int(6, map.height - 7);
    const radius = rng.int(3, 6);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        if (map.terrainAt(x, y) === 'hill') continue;
        map.setTerrain(x, y, d < radius * 0.28 ? 'water' : 'grass');
      }
    }
  }
}

/**
 * מסמן לכל אריח עביר את מספר רכיב הקשירות שלו (BFS על 8 שכנים).
 * מוחזר גם מזהה הרכיב הגדול ביותר — "היבשת הראשית".
 */
export function landComponents(map: GameMap): {
  labels: Int32Array;
  largest: number;
  sizes: Map<number, number>;
} {
  const labels = new Int32Array(map.width * map.height).fill(-1);
  const sizes = new Map<number, number>();
  const queue = new Int32Array(map.width * map.height);
  let next = 0;

  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1) continue;
    const sx = start % map.width;
    const sy = (start / map.width) | 0;
    if (map.isBlocked(sx, sy)) continue;

    const id = next++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    let size = 0;

    while (head < tail) {
      const cur = queue[head++];
      size++;
      const cx = cur % map.width;
      const cy = (cur / map.width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!map.inBounds(nx, ny)) continue;
          const n = ny * map.width + nx;
          if (labels[n] !== -1) continue;
          if (map.isBlocked(nx, ny)) continue;
          labels[n] = id;
          queue[tail++] = n;
        }
      }
    }
    sizes.set(id, size);
  }

  let largest = -1;
  let best = -1;
  for (const [id, size] of sizes) {
    if (size > best) {
      best = size;
      largest = id;
    }
  }
  return { labels, largest, sizes };
}
