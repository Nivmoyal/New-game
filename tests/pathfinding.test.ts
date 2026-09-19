import { describe, expect, it } from 'vitest';
import {
  findPath,
  formationOffsets,
  hasLineOfSight,
  MinHeap,
  octileDistance,
  rotateOffsets,
  smoothPath,
  type PathGrid,
} from '../src/core/pathfinding';

/** גריד בדיקה פשוט: '#' חסום, '.' פנוי, '~' איטי. */
function gridFrom(rows: string[]): PathGrid {
  const height = rows.length;
  const width = rows[0].length;
  return {
    width,
    height,
    isBlocked(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return true;
      return rows[y][x] === '#';
    },
    speedAt(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      return rows[y][x] === '~' ? 0.25 : 1;
    },
  };
}

describe('MinHeap', () => {
  it('מחזיר פריטים לפי סדר עדיפות עולה', () => {
    const heap = new MinHeap();
    const input = [5, 3, 9, 1, 7, 2, 8];
    input.forEach((v, i) => heap.push(i, v));
    const order: number[] = [];
    while (heap.size > 0) order.push(input[heap.pop()!]);
    expect(order).toEqual([1, 2, 3, 5, 7, 8, 9]);
  });

  it('מטפל בערמה ריקה', () => {
    const heap = new MinHeap();
    expect(heap.pop()).toBeUndefined();
    expect(heap.size).toBe(0);
  });
});

describe('A* pathfinding', () => {
  it('מוצא מסלול ישר בשטח פתוח', () => {
    const grid = gridFrom(['.....', '.....', '.....']);
    const res = findPath(grid, { x: 0, y: 1 }, { x: 4, y: 1 });
    expect(res.found).toBe(true);
    expect(res.path[res.path.length - 1]).toEqual({ x: 4, y: 1 });
    expect(res.path.length).toBe(4);
  });

  it('עוקף מכשול', () => {
    const grid = gridFrom([
      '..#..',
      '..#..',
      '..#..',
      '.....',
    ]);
    const res = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(res.found).toBe(true);
    // חייב לרדת מתחת לקיר
    expect(res.path.some((p) => p.y === 3)).toBe(true);
    for (const p of res.path) expect(grid.isBlocked(p.x, p.y)).toBe(false);
  });

  it('מחזיר "לא נמצא" כשהיעד מנותק לגמרי', () => {
    const grid = gridFrom([
      '..#..',
      '..#..',
      '..#..',
    ]);
    const res = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, { allowPartial: false });
    expect(res.found).toBe(false);
    expect(res.path.length).toBe(0);
  });

  it('מעדיף מסלול מהיר על פני מסלול קצר אך איטי', () => {
    const grid = gridFrom([
      '.~~~.',
      '.....',
      '.....',
    ]);
    const res = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(res.found).toBe(true);
    // השורה האיטית (y=0) אמורה להיות מעוקפת
    const slowTiles = res.path.filter((p) => p.y === 0 && p.x > 0 && p.x < 4);
    expect(slowTiles.length).toBe(0);
  });

  it('לא חותך פינות באלכסון', () => {
    const grid = gridFrom([
      '.#.',
      '#..',
      '...',
    ]);
    const res = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 });
    // מעבר אלכסוני מ-(0,0) ל-(1,1) חסום משני הצדדים
    expect(res.path[0]).not.toEqual({ x: 1, y: 1 });
  });

  it('מסלול לאותו אריח הוא ריק', () => {
    const grid = gridFrom(['...', '...']);
    const res = findPath(grid, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(res.found).toBe(true);
    expect(res.path).toEqual([]);
  });

  it('עוצר במרחק מבוקש מהיעד (stopDistance)', () => {
    const grid = gridFrom(['..........']);
    const res = findPath(grid, { x: 0, y: 0 }, { x: 9, y: 0 }, { stopDistance: 3 });
    expect(res.found).toBe(true);
    const last = res.path[res.path.length - 1];
    expect(9 - last.x).toBeLessThanOrEqual(3.01);
  });

  it('מגיע ליעד חסום (מבנה) כאשר מתבקש', () => {
    const grid = gridFrom(['....#']);
    const res = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(res.found).toBe(true);
    expect(res.path[res.path.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it('מכבד את תקציב הצמתים', () => {
    const rows = Array.from({ length: 60 }, () => '.'.repeat(60));
    const grid = gridFrom(rows);
    const res = findPath(grid, { x: 0, y: 0 }, { x: 59, y: 59 }, { maxNodes: 50 });
    expect(res.visited).toBeLessThanOrEqual(50);
  });

  it('עובד על מפה גדולה בזמן סביר', () => {
    const rows = Array.from({ length: 128 }, (_, y) =>
      Array.from({ length: 128 }, (_, x) => (x % 16 === 8 && y % 32 !== 0 ? '#' : '.')).join(''),
    );
    const grid = gridFrom(rows);
    const t0 = Date.now();
    const res = findPath(grid, { x: 1, y: 1 }, { x: 126, y: 126 });
    expect(res.found).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('החלקת מסלול וקו ראייה', () => {
  it('מקצר מסלול בשטח פתוח לנקודה אחת', () => {
    const grid = gridFrom(['.....', '.....', '.....']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 2 }).path;
    const smoothed = smoothPath(grid, { x: 0, y: 0 }, path);
    expect(smoothed.length).toBeLessThanOrEqual(path.length);
    expect(smoothed[smoothed.length - 1]).toEqual(path[path.length - 1]);
  });

  it('קו ראייה נחסם על ידי קיר', () => {
    const grid = gridFrom(['..#..']);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });
});

describe('פורמציות', () => {
  it('ריבוע מייצר היסט לכל יחידה', () => {
    const offsets = formationOffsets(9, 'box');
    expect(offsets).toHaveLength(9);
    const unique = new Set(offsets.map((o) => `${o.x},${o.y}`));
    expect(unique.size).toBe(9);
  });

  it('שורה פורסת את היחידות על ציר אחד', () => {
    const offsets = formationOffsets(5, 'line', 2);
    expect(offsets.every((o) => o.y === 0)).toBe(true);
    expect(offsets[0].x).toBeCloseTo(-4);
    expect(offsets[4].x).toBeCloseTo(4);
  });

  it('טריז בנוי בשורות גדלות', () => {
    const offsets = formationOffsets(6, 'wedge');
    expect(offsets).toHaveLength(6);
    expect(offsets[0].y).toBe(0);
  });

  it('פיזור לא יוצר כפילויות', () => {
    const offsets = formationOffsets(20, 'scatter');
    const unique = new Set(offsets.map((o) => `${o.x.toFixed(3)},${o.y.toFixed(3)}`));
    expect(unique.size).toBe(20);
  });

  it('סיבוב משמר מרחקים', () => {
    const offsets = formationOffsets(4, 'box');
    const rotated = rotateOffsets(offsets, Math.PI / 3);
    offsets.forEach((o, i) => {
      expect(Math.hypot(rotated[i].x, rotated[i].y)).toBeCloseTo(Math.hypot(o.x, o.y), 5);
    });
  });

  it('אפס יחידות מחזיר רשימה ריקה', () => {
    expect(formationOffsets(0)).toEqual([]);
  });
});

describe('מרחק אוקטילי', () => {
  it('מחשב מרחק אלכסוני נכון', () => {
    expect(octileDistance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBeCloseTo(3);
    expect(octileDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBeCloseTo(3 * Math.SQRT2);
  });
});
