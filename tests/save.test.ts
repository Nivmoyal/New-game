import { describe, expect, it } from 'vitest';
import { deserializeWorld, serializeWorld, SAVE_VERSION } from '../src/core/save';
import { World } from '../src/core/world';
import { AiManager } from '../src/ai/ai';

function buildWorld() {
  const world = new World({
    seed: 2024,
    map: { width: 64, height: 64 },
    players: [
      { id: 0, name: 'שחקן', nationId: 'israel', branchChoices: { settlement: 'moshav' } },
      { id: 1, name: 'מחשב', nationId: 'arabs', isAI: true, difficulty: 'hard' },
    ],
  });
  return world;
}

describe('שמירה וטעינה', () => {
  it('משחזר עולם זהה: משאבים, ישויות ומצב מפה', () => {
    const world = buildWorld();
    const ai = new AiManager(world);
    for (let i = 0; i < 1200; i++) {
      world.update(1 / 20);
      ai.update(world, 1 / 20);
    }
    const save = serializeWorld(world, 0, 'בדיקה');
    expect(save.version).toBe(SAVE_VERSION);

    const { world: restored, localPlayerId } = deserializeWorld(
      JSON.parse(JSON.stringify(save)),
    );
    expect(localPlayerId).toBe(0);
    expect(restored.players).toHaveLength(2);
    expect(restored.time).toBeCloseTo(world.time, 3);

    for (const p of world.players) {
      const rp = restored.player(p.id)!;
      expect(rp.resources).toEqual(p.resources);
      expect(rp.stage).toBe(p.stage);
      expect(rp.nation.id).toBe(p.nation.id);
      expect(rp.branchChoices).toEqual(p.branchChoices);
      expect([...rp.unlockedBuildings].sort()).toEqual([...p.unlockedBuildings].sort());
      expect(rp.popCap).toBe(p.popCap);
      expect(rp.popUsed).toBe(p.popUsed);
    }

    const before = [...world.entities.values()].filter((e) => e.alive);
    const after = [...restored.entities.values()].filter((e) => e.alive);
    expect(after.length).toBe(before.length);

    for (const e of before) {
      const r = restored.get(e.id)!;
      expect(r).toBeTruthy();
      expect(r.defId).toBe(e.defId);
      expect(r.owner).toBe(e.owner);
      expect(r.hp).toBeCloseTo(e.hp, 3);
      expect(r.pos.x).toBeCloseTo(e.pos.x, 5);
    }
  });

  it('שומר את מצב המשאבים במפה (עצים שנכרתו)', () => {
    const world = buildWorld();
    const tile = world.findResourceTile({ x: 32, y: 32 }, 'wood', 40)!;
    world.map.harvest(tile.x, tile.y, 60);
    const remaining = world.map.resourceAt(tile.x, tile.y)!.amount;
    const restored = deserializeWorld(serializeWorld(world, 0)).world;
    expect(restored.map.resourceAt(tile.x, tile.y)!.amount).toBeCloseTo(remaining, 2);
  });

  it('שומר טכנולוגיות שנחקרו ואת השפעתן', () => {
    const world = buildWorld();
    const p = world.player(0)!;
    p.stage = 2;
    p.availableTechs.add('weapons_infantry');
    p.completeResearch('weapons_infantry');
    const restored = deserializeWorld(serializeWorld(world, 0)).world;
    const rp = restored.player(0)!;
    expect(rp.researched.has('weapons_infantry')).toBe(true);
    expect(rp.techBonuses.attack.infantry).toBe(2);
  });

  it('שומר את השטח שנחקר (ערפל מלחמה)', () => {
    const world = buildWorld();
    for (let i = 0; i < 40; i++) world.update(1 / 20);
    const ratio = world.player(0)!.fog.exploredRatio();
    expect(ratio).toBeGreaterThan(0);
    const restored = deserializeWorld(serializeWorld(world, 0)).world;
    expect(restored.player(0)!.fog.exploredRatio()).toBeGreaterThanOrEqual(ratio - 0.001);
  });

  it('העולם המשוחזר ממשיך לרוץ בלי שגיאות', () => {
    const world = buildWorld();
    for (let i = 0; i < 300; i++) world.update(1 / 20);
    const restored = deserializeWorld(serializeWorld(world, 0)).world;
    const ai = new AiManager(restored);
    expect(() => {
      for (let i = 0; i < 600; i++) {
        restored.update(1 / 20);
        ai.update(restored, 1 / 20);
      }
    }).not.toThrow();
  });

  it('דוחה גרסת שמירה לא תואמת', () => {
    const world = buildWorld();
    const save = serializeWorld(world, 0);
    save.version = 999;
    expect(() => deserializeWorld(save)).toThrow(/גרסת שמירה/);
  });
});
