import { describe, expect, it } from 'vitest';
import { generateMap, GameMap, TERRAIN_PASSABLE } from '../src/core/gamemap';
import { FogOfWar, FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE } from '../src/core/fog';
import { Rng, fbm } from '../src/core/rng';
import { findPath } from '../src/core/pathfinding';
import { RESOURCE_KINDS, tileCenter, toTile } from '../src/core/types';

describe('מחולל אקראיות', () => {
  it('אותו זרע נותן אותה סדרה', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it('זרעים שונים נותנים סדרות שונות', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('int נשאר בטווח', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const v = rng.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('רעש פרקטלי מחזיר ערכים בטווח 0..1', () => {
    const noise = fbm(99, 4);
    for (let i = 0; i < 100; i++) {
      const v = noise(i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('המרת קואורדינטות', () => {
  it('מרכז האריח חוזר לאותו אריח', () => {
    for (const [x, y] of [[0, 0], [5, 9], [127, 127]]) {
      const c = tileCenter(x, y);
      expect(toTile(c.x)).toBe(x);
      expect(toTile(c.y)).toBe(y);
    }
  });
});

describe('מפת המשחק', () => {
  it('נוצרת בגודל המבוקש (128x128 כברירת מחדל)', () => {
    const map = generateMap({ seed: 1, playerCount: 2 });
    expect(map.width).toBe(128);
    expect(map.height).toBe(128);
    expect(map.terrain.length).toBe(128 * 128);
  });

  it('אותו זרע מייצר אותה מפה', () => {
    const a = generateMap({ seed: 77, width: 48, height: 48 });
    const b = generateMap({ seed: 77, width: 48, height: 48 });
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.startPositions).toEqual(b.startPositions);
  });

  it('מכילה את כל סוגי המשאבים', () => {
    const map = generateMap({ seed: 5, width: 96, height: 96, playerCount: 2 });
    const kinds = new Set([...map.resources.values()].map((r) => r.kind));
    for (const k of RESOURCE_KINDS) expect(kinds.has(k)).toBe(true);
  });

  it('מכילה יערות, מכרות, שיחי פירות ומים', () => {
    const map = generateMap({ seed: 5, width: 96, height: 96, playerCount: 2 });
    const visuals = new Set([...map.resources.values()].map((r) => r.visual));
    expect(visuals.has('tree')).toBe(true);
    expect(visuals.has('berry')).toBe(true);
    expect(visuals.has('gold_mine')).toBe(true);
    expect(visuals.has('stone_mine')).toBe(true);
    let water = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (map.terrainAt(x, y) === 'water') water++;
    }
    expect(water).toBeGreaterThan(0);
  });

  it('נקודות פתיחה מרוחקות זו מזו ופנויות', () => {
    const map = generateMap({ seed: 9, width: 128, height: 128, playerCount: 4 });
    expect(map.startPositions).toHaveLength(4);
    for (const p of map.startPositions) {
      expect(map.isAreaFree(p.x - 2, p.y - 2, 5, 5)).toBe(true);
    }
    for (let i = 0; i < map.startPositions.length; i++) {
      for (let j = i + 1; j < map.startPositions.length; j++) {
        const a = map.startPositions[i];
        const b = map.startPositions[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);
      }
    }
  });

  it('לכל נקודת פתיחה יש משאבים בסביבה', () => {
    const map = generateMap({ seed: 21, width: 128, height: 128, playerCount: 2 });
    for (const start of map.startPositions) {
      const found = new Set<string>();
      for (let dy = -14; dy <= 14; dy++) {
        for (let dx = -14; dx <= 14; dx++) {
          const res = map.resourceAt(start.x + dx, start.y + dy);
          if (res) found.add(res.kind);
        }
      }
      expect(found.has('wood')).toBe(true);
      expect(found.has('food')).toBe(true);
      expect(found.has('gold')).toBe(true);
    }
  });

  it('קרקע לא עבירה חוסמת מעבר', () => {
    const map = new GameMap(8, 8, 1);
    map.setTerrain(3, 3, 'water');
    expect(TERRAIN_PASSABLE.water).toBe(false);
    expect(map.isBlocked(3, 3)).toBe(true);
    expect(map.isBlocked(2, 3)).toBe(false);
    expect(map.isBlocked(-1, 0)).toBe(true);
  });

  it('עצים חוסמים אבל שיחי פירות לא', () => {
    const map = new GameMap(8, 8, 1);
    map.addResource(2, 2, { kind: 'wood', amount: 100, visual: 'tree' });
    map.addResource(4, 4, { kind: 'food', amount: 100, visual: 'berry' });
    expect(map.isBlocked(2, 2)).toBe(true);
    expect(map.isBlocked(4, 4)).toBe(false);
  });

  it('כריתת עץ הופכת את האריח לעביר', () => {
    const map = new GameMap(8, 8, 1);
    map.setTerrain(2, 2, 'forest');
    map.addResource(2, 2, { kind: 'wood', amount: 10, visual: 'tree' });
    expect(map.isBlocked(2, 2)).toBe(true);
    map.harvest(2, 2, 10);
    expect(map.isBlocked(2, 2)).toBe(false);
    expect(map.terrainAt(2, 2)).toBe('grass');
  });

  it('מוצא אריח פנוי סמוך', () => {
    const map = new GameMap(8, 8, 1);
    map.setTerrain(4, 4, 'water');
    const free = map.findFreeTile(4, 4);
    expect(free).not.toBeNull();
    expect(map.isBlocked(free!.x, free!.y)).toBe(false);
  });

  it('בדיקת שטח פנוי לבנייה', () => {
    const map = new GameMap(10, 10, 1);
    expect(map.isAreaFree(2, 2, 3, 3)).toBe(true);
    map.setTerrain(3, 3, 'water');
    expect(map.isAreaFree(2, 2, 3, 3)).toBe(false);
    expect(map.isAreaFree(9, 9, 3, 3)).toBe(false);
  });

  it('ניתן לנווט בין נקודות הפתיחה', () => {
    const map = generateMap({ seed: 31, width: 96, height: 96, playerCount: 2 });
    const [a, b] = map.startPositions;
    const res = findPath(map, a, b, { maxNodes: 40000, allowPartial: false });
    expect(res.found).toBe(true);
  });
});

describe('ערפל מלחמה', () => {
  it('מתחיל מוסתר לגמרי', () => {
    const fog = new FogOfWar(16, 16);
    expect(fog.state(5, 5)).toBe(FOG_HIDDEN);
    expect(fog.exploredRatio()).toBe(0);
  });

  it('חשיפה הופכת אריחים לנראים', () => {
    const fog = new FogOfWar(16, 16);
    fog.reveal(8, 8, 3);
    expect(fog.state(8, 8)).toBe(FOG_VISIBLE);
    expect(fog.state(8, 10)).toBe(FOG_VISIBLE);
    expect(fog.state(15, 15)).toBe(FOG_HIDDEN);
  });

  it('אחרי שהיחידה עוזבת נשאר "נחקר"', () => {
    const fog = new FogOfWar(16, 16);
    fog.reveal(8, 8, 3);
    fog.clearVisible();
    expect(fog.state(8, 8)).toBe(FOG_EXPLORED);
    expect(fog.isExplored(8, 8)).toBe(true);
    expect(fog.isVisible(8, 8)).toBe(false);
  });

  it('חשיפה עגולה ולא מרובעת', () => {
    const fog = new FogOfWar(32, 32);
    fog.reveal(16, 16, 5);
    expect(fog.state(16 + 5, 16)).toBe(FOG_VISIBLE);
    expect(fog.state(16 + 4, 16 + 4)).toBe(FOG_HIDDEN);
  });

  it('revealAll חושף את כל המפה', () => {
    const fog = new FogOfWar(16, 16);
    fog.revealAll();
    expect(fog.exploredRatio()).toBe(1);
    expect(fog.state(0, 0)).toBe(FOG_VISIBLE);
  });

  it('שמירה וטעינה משחזרות את השטח הנחקר', () => {
    const fog = new FogOfWar(32, 32);
    fog.reveal(10, 10, 4);
    fog.reveal(25, 25, 3);
    const restored = FogOfWar.deserialize(32, 32, fog.serialize());
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        expect(restored.isExplored(x, y)).toBe(fog.isExplored(x, y));
      }
    }
  });

  it('מחוץ לגבולות תמיד מוסתר', () => {
    const fog = new FogOfWar(16, 16);
    fog.revealAll();
    expect(fog.state(-1, 5)).toBe(FOG_HIDDEN);
    expect(fog.state(100, 5)).toBe(FOG_HIDDEN);
  });
});
