import { describe, expect, it } from 'vitest';
import { generateMap, landComponents } from '../src/core/gamemap';
import { findPath } from '../src/core/pathfinding';
import { allMapPresets, DEFAULT_MAP_PRESET, getMapPreset } from '../src/data';
import { RESOURCE_KINDS } from '../src/core/types';
import { World } from '../src/core/world';
import { AiManager } from '../src/ai/ai';

const PRESETS = allMapPresets();
const SEEDS = [1, 42, 777, 2024];

describe('נתוני תבניות המפה', () => {
  it('יש לפחות שמונה תבניות, כל אחת עם תיאור ונקודות מפתח', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const p of PRESETS) {
      expect(p.name.length, p.id).toBeGreaterThan(0);
      expect(p.emoji.length, p.id).toBeGreaterThan(0);
      expect(p.desc.length, p.id).toBeGreaterThan(20);
      expect(p.highlights.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.water, p.id).toBeGreaterThanOrEqual(0);
      expect(p.woodDensity, p.id).toBeGreaterThan(0);
      expect(p.mines, p.id).toBeGreaterThan(0);
      expect(['none', 'river', 'lakes', 'coast', 'oasis'], p.id).toContain(p.feature);
    }
  });

  it('לכל תבנית מזהה ייחודי ותבנית ברירת המחדל קיימת', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => getMapPreset(DEFAULT_MAP_PRESET)).not.toThrow();
    expect(() => getMapPreset('אין_כזו')).toThrow(/תבנית מפה לא מוכרת/);
  });
});

describe('יצירת מפה לפי תבנית', () => {
  it('כל תבנית נוצרת ושומרת את המזהה שלה', () => {
    for (const preset of PRESETS) {
      const map = generateMap({ seed: 5, width: 96, height: 96, preset: preset.id });
      expect(map.presetId, preset.id).toBe(preset.id);
      expect(map.width).toBe(96);
    }
  });

  it('אותו זרע ואותה תבנית מייצרים מפה זהה', () => {
    for (const preset of PRESETS) {
      const a = generateMap({ seed: 31, width: 64, height: 64, preset: preset.id });
      const b = generateMap({ seed: 31, width: 64, height: 64, preset: preset.id });
      expect(Array.from(a.terrain), preset.id).toEqual(Array.from(b.terrain));
      expect(a.startPositions, preset.id).toEqual(b.startPositions);
    }
  });

  it('תבניות שונות מייצרות מפות שונות מאותו זרע', () => {
    const green = generateMap({ seed: 77, width: 64, height: 64, preset: 'greenland' });
    const desert = generateMap({ seed: 77, width: 64, height: 64, preset: 'desert' });
    expect(Array.from(green.terrain)).not.toEqual(Array.from(desert.terrain));
  });

  it('כל התבניות מייצרות מפה עבירה עם ארבעת המשאבים', () => {
    for (const preset of PRESETS) {
      const map = generateMap({ seed: 9, width: 112, height: 112, preset: preset.id, playerCount: 2 });
      const kinds = new Set([...map.resources.values()].map((r) => r.kind));
      for (const k of RESOURCE_KINDS) expect(kinds.has(k), `${preset.id}: חסר ${k}`).toBe(true);
      const { sizes, largest } = landComponents(map);
      expect(sizes.get(largest)!, preset.id).toBeGreaterThan(112 * 112 * 0.1);
    }
  });

  it('מפות יבשות מייצרות פחות מים ממפות מים', () => {
    const countWater = (id: string) => {
      const map = generateMap({ seed: 13, width: 96, height: 96, preset: id });
      let n = 0;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) if (map.terrainAt(x, y) === 'water') n++;
      }
      return n;
    };
    expect(countWater('plains')).toBeLessThan(countWater('lakes'));
    expect(countWater('desert')).toBeLessThan(countWater('fjords'));
  });

  it('יער עד מכיל הרבה יותר עץ ממישורים פתוחים', () => {
    const wood = (id: string) => {
      const map = generateMap({ seed: 21, width: 96, height: 96, preset: id });
      return [...map.resources.values()].filter((r) => r.visual === 'tree').length;
    };
    expect(wood('deepforest')).toBeGreaterThan(wood('plains') * 2);
  });

  it('מדבר עשיר במכרות יותר ממפה מאוזנת', () => {
    const mines = (id: string) => {
      const map = generateMap({ seed: 8, width: 96, height: 96, preset: id });
      return [...map.resources.values()].filter(
        (r) => r.visual === 'gold_mine' || r.visual === 'stone_mine',
      ).length;
    };
    expect(mines('desert')).toBeGreaterThan(mines('greenland'));
  });

  it('מפת הנהר יוצרת רצועת מים חוצה עם מעברות', () => {
    const map = generateMap({ seed: 4, width: 96, height: 96, preset: 'river' });
    let water = 0;
    let shallow = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = map.terrainAt(x, y);
        if (t === 'water') water++;
        if (t === 'shallow') shallow++;
      }
    }
    expect(water).toBeGreaterThan(200);
    expect(shallow).toBeGreaterThan(100); // מעברות וגדות
  });
});

describe('קשירות: תמיד אפשר להגיע מיריב ליריב', () => {
  it('בכל תבנית, בכל זרע ובכל מספר שחקנים', () => {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        for (const players of [2, 3, 4]) {
          const map = generateMap({
            seed,
            width: 112,
            height: 112,
            preset: preset.id,
            playerCount: players,
          });
          expect(map.startPositions, preset.id).toHaveLength(players);
          const label = `${preset.id} seed=${seed} players=${players}`;
          for (let i = 1; i < map.startPositions.length; i++) {
            const res = findPath(map, map.startPositions[0], map.startPositions[i], {
              maxNodes: 120000,
              allowPartial: false,
            });
            expect(res.found, label).toBe(true);
          }
        }
      }
    }
  });

  it('לכל נקודת פתיחה יש עץ, אוכל וזהב בסביבה', () => {
    for (const preset of PRESETS) {
      const map = generateMap({ seed: 55, width: 112, height: 112, preset: preset.id, playerCount: 4 });
      for (const start of map.startPositions) {
        const found = new Set<string>();
        for (let dy = -14; dy <= 14; dy++) {
          for (let dx = -14; dx <= 14; dx++) {
            const res = map.resourceAt(start.x + dx, start.y + dy);
            if (res) found.add(res.kind);
          }
        }
        for (const k of ['wood', 'food', 'gold']) {
          expect(found.has(k), `${preset.id}: חסר ${k} ליד נקודת פתיחה`).toBe(true);
        }
      }
    }
  });

  it('נקודות הפתיחה נמצאות על שטח פנוי ומרוחקות זו מזו', () => {
    for (const preset of PRESETS) {
      const map = generateMap({ seed: 66, width: 128, height: 128, preset: preset.id, playerCount: 4 });
      for (const p of map.startPositions) {
        expect(map.isAreaFree(p.x - 2, p.y - 2, 5, 5), preset.id).toBe(true);
      }
      for (let i = 0; i < map.startPositions.length; i++) {
        for (let j = i + 1; j < map.startPositions.length; j++) {
          const a = map.startPositions[i];
          const b = map.startPositions[j];
          expect(Math.hypot(a.x - b.x, a.y - b.y), preset.id).toBeGreaterThan(18);
        }
      }
    }
  });
});

describe('רכיבי קשירות', () => {
  it('מזהה את היבשת הגדולה ביותר', () => {
    const map = generateMap({ seed: 3, width: 64, height: 64, preset: 'lakes' });
    const { labels, largest, sizes } = landComponents(map);
    expect(sizes.size).toBeGreaterThan(0);
    expect(sizes.get(largest)).toBe(Math.max(...sizes.values()));
    for (const start of map.startPositions) {
      expect(labels[start.y * map.width + start.x]).toBe(largest);
    }
  });
});

describe('משחק מלא על תבניות שונות', () => {
  it('רץ בלי שגיאות על כל תבנית עם AI', () => {
    for (const preset of PRESETS) {
      const world = new World({
        seed: 12,
        map: { width: 80, height: 80, preset: preset.id },
        players: [
          { id: 0, name: 'א', nationId: 'vikings', isAI: true, difficulty: 'normal', team: 0 },
          { id: 1, name: 'ב', nationId: 'israel', isAI: true, difficulty: 'normal', branchChoices: { settlement: 'kibbutz' }, team: 1 },
        ],
      });
      const ai = new AiManager(world);
      expect(() => {
        for (let i = 0; i < 1200; i++) {
          world.update(1 / 20);
          ai.update(world, 1 / 20);
        }
      }, preset.id).not.toThrow();
      for (const p of world.players) {
        expect(p.stats.gathered.food + p.stats.gathered.wood, `${preset.id} / ${p.nation.id}`).toBeGreaterThan(0);
      }
    }
  });
});
