import type { Vec2 } from './types';

/**
 * A* על גריד עם 8 כיוונים, משקולות קרקע והימנעות מפינות.
 * הממשק מופשט (isBlocked/cost) כדי שנוכל לבדוק אותו בלי תלות במפה אמיתית.
 */
export interface PathGrid {
  width: number;
  height: number;
  isBlocked(x: number, y: number): boolean;
  /** מקדם מהירות באריח (0 = חסום). גבוה יותר = מהיר יותר. */
  speedAt(x: number, y: number): number;
}

/** ערמה בינארית מינימלית — מונעת מיון מחדש בכל צעד. */
export class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number | undefined {
    if (this.ids.length === 0) return undefined;
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export type PathOptions = {
  /** מספר צמתים מרבי לבדיקה לפני ויתור (מגן על ביצועים במפה 128x128). */
  maxNodes?: number;
  /** אם היעד חסום — לך לאריח הקרוב ביותר אליו. */
  allowPartial?: boolean;
  /** עצירה כשמגיעים למרחק הזה מהיעד (לתקיפה מטווח / איסוף). */
  stopDistance?: number;
};

export type PathResult = {
  path: Vec2[];
  found: boolean;
  /** נבדקו כמה צמתים — שימושי לבדיקות ביצועים. */
  visited: number;
};

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ax - ay + Math.SQRT2 * ay : ay - ax + Math.SQRT2 * ax;
}

/** מוצא מסלול מ-start ל-goal. מחזיר רשימת אריחים (לא כולל נקודת ההתחלה). */
export function findPath(
  grid: PathGrid,
  start: Vec2,
  goal: Vec2,
  opts: PathOptions = {},
): PathResult {
  const maxNodes = opts.maxNodes ?? 12000;
  const stopDistance = opts.stopDistance ?? 0;
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);

  if (sx === gx && sy === gy) return { path: [], found: true, visited: 0 };
  if (sx < 0 || sy < 0 || sx >= grid.width || sy >= grid.height) {
    return { path: [], found: false, visited: 0 };
  }

  const size = grid.width * grid.height;
  const gScore = new Float32Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();

  const startIdx = sy * grid.width + sx;
  const goalIdx = gy * grid.width + gx;
  gScore[startIdx] = 0;
  open.push(startIdx, octile(gx - sx, gy - sy));

  let visited = 0;
  let bestIdx = startIdx;
  let bestH = octile(gx - sx, gy - sy);
  const goalReachable = !grid.isBlocked(gx, gy);

  while (open.size > 0 && visited < maxNodes) {
    const current = open.pop()!;
    if (closed[current]) continue;
    closed[current] = 1;
    visited++;

    const cx = current % grid.width;
    const cy = (current / grid.width) | 0;
    const h = octile(gx - cx, gy - cy);

    if (current === goalIdx || (stopDistance > 0 && h <= stopDistance)) {
      return { path: reconstruct(cameFrom, current, grid.width), found: true, visited };
    }
    if (h < bestH) {
      bestH = h;
      bestIdx = current;
    }

    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const nIdx = ny * grid.width + nx;
      if (closed[nIdx]) continue;
      const isGoal = nIdx === goalIdx;
      if (grid.isBlocked(nx, ny) && !(isGoal && !goalReachable)) continue;
      // מניעת "חיתוך פינות" באלכסון
      if (dx !== 0 && dy !== 0) {
        if (grid.isBlocked(cx + dx, cy) || grid.isBlocked(cx, cy + dy)) continue;
      }
      const speed = Math.max(0.05, grid.speedAt(nx, ny));
      const tentative = gScore[current] + cost / speed;
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = current;
        open.push(nIdx, tentative + octile(gx - nx, gy - ny));
      }
    }
  }

  if (opts.allowPartial !== false && bestIdx !== startIdx) {
    return { path: reconstruct(cameFrom, bestIdx, grid.width), found: false, visited };
  }
  return { path: [], found: false, visited };
}

function reconstruct(cameFrom: Int32Array, end: number, width: number): Vec2[] {
  const path: Vec2[] = [];
  let cur = end;
  while (cur !== -1) {
    path.push({ x: cur % width, y: (cur / width) | 0 });
    cur = cameFrom[cur];
  }
  path.pop(); // מסירים את נקודת ההתחלה
  return path.reverse();
}

/**
 * החלקת מסלול: מוותרים על נקודות ביניים כשיש קו ראייה ישיר.
 * מקטין "זיגזג" של אריחים ונותן תנועה טבעית יותר.
 */
export function smoothPath(grid: PathGrid, start: Vec2, path: Vec2[]): Vec2[] {
  if (path.length <= 1) return path;
  const out: Vec2[] = [];
  let anchor = start;
  let i = 0;
  while (i < path.length) {
    let furthest = i;
    for (let j = path.length - 1; j > i; j--) {
      if (hasLineOfSight(grid, anchor, path[j])) {
        furthest = j;
        break;
      }
    }
    out.push(path[furthest]);
    anchor = path[furthest];
    i = furthest + 1;
  }
  return out;
}

/** בדיקת קו ראייה בגריד (Bresenham עם בדיקת אלכסונים). */
export function hasLineOfSight(grid: PathGrid, a: Vec2, b: Vec2): boolean {
  let x0 = Math.floor(a.x);
  let y0 = Math.floor(a.y);
  const x1 = Math.floor(b.x);
  const y1 = Math.floor(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  while (guard++ < 4096) {
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    let movedX = false;
    let movedY = false;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
      movedX = true;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
      movedY = true;
    }
    if (grid.isBlocked(x0, y0)) return false;
    if (movedX && movedY) {
      if (grid.isBlocked(x0 - sx, y0) && grid.isBlocked(x0, y0 - sy)) return false;
    }
  }
  return false;
}

/** מרחק אוקטילי — היוריסטיקה ציבורית לשימוש ב-AI ובבדיקות. */
export const octileDistance = (a: Vec2, b: Vec2): number => octile(b.x - a.x, b.y - a.y);

/**
 * פורמציות בסיסיות: מחשב יעדי משנה לכל יחידה בקבוצה
 * כדי שלא ידרכו זו על זו באותה נקודה.
 */
export type FormationKind = 'box' | 'line' | 'wedge' | 'scatter';

export function formationOffsets(
  count: number,
  kind: FormationKind = 'box',
  spacing = 1.2,
): Vec2[] {
  const offsets: Vec2[] = [];
  if (count <= 0) return offsets;
  switch (kind) {
    case 'line': {
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) offsets.push({ x: (i - half) * spacing, y: 0 });
      break;
    }
    case 'wedge': {
      let row = 0;
      let placed = 0;
      while (placed < count) {
        const inRow = row + 1;
        for (let i = 0; i < inRow && placed < count; i++, placed++) {
          offsets.push({ x: (i - (inRow - 1) / 2) * spacing, y: row === 0 ? 0 : -row * spacing });
        }
        row++;
      }
      break;
    }
    case 'scatter': {
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399963; // זווית הזהב
        const radius = spacing * Math.sqrt(i) * 0.9;
        offsets.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
      break;
    }
    case 'box':
    default: {
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        offsets.push({
          x: (c - (cols - 1) / 2) * spacing,
          y: (r - (rows - 1) / 2) * spacing,
        });
      }
      break;
    }
  }
  return offsets;
}

/** מסובב היסטים לכיוון התנועה (כך שהחזית תמיד קדימה). */
export function rotateOffsets(offsets: Vec2[], angle: number): Vec2[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return offsets.map((o) => ({ x: o.x * cos - o.y * sin, y: o.x * sin + o.y * cos }));
}
