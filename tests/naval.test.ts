import { describe, expect, it } from 'vitest';
import { TeamNavView, World } from '../src/core/world';
import { generateMap } from '../src/core/gamemap';
import { DATA, getBuilding, getUnit, allNations } from '../src/data';
import { AiController } from '../src/ai/ai';
import type { Vec2 } from '../src/core/types';

/** עולם על מפה עם ים אמיתי. */
function seaWorld(seed = 9, players = 1) {
  const list = [
    { id: 0, name: 'א', nationId: 'vikings', team: 0 },
    { id: 1, name: 'ב', nationId: 'israel', team: 1 },
  ].slice(0, players);
  return new World({
    seed,
    revealAll: true,
    map: { width: 96, height: 96, preset: 'fjords', seed },
    players: list,
  });
}

/** מוצא מקום חוקי לנמל, בסריקה על כל המפה. */
function dockSpot(world: World, defId = 'dock'): Vec2 | null {
  const def = getBuilding(defId);
  for (let y = 0; y < world.map.height - def.size; y++) {
    for (let x = 0; x < world.map.width - def.size; x++) {
      if (world.canPlaceBuilding(def, { x, y })) return { x, y };
    }
  }
  return null;
}

describe('מפות עם ים', () => {
  it('מפה ימית מקבלת דגה לפי שטח המים, ומפה יבשה לא', () => {
    const sea = generateMap({ seed: 4, width: 96, height: 96, playerCount: 2, preset: 'fjords' });
    const dry = generateMap({ seed: 4, width: 96, height: 96, playerCount: 2, preset: 'desert' });
    const countFish = (m: ReturnType<typeof generateMap>) => {
      let n = 0;
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          const r = m.resourceAt(x, y);
          if (r?.visual === 'fish') n++;
        }
      }
      return n;
    };
    expect(countFish(sea)).toBeGreaterThan(8);
    expect(countFish(dry)).toBe(0);
    // דגה תמיד על מים
    for (let y = 0; y < sea.height; y++) {
      for (let x = 0; x < sea.width; x++) {
        if (sea.resourceAt(x, y)?.visual !== 'fish') continue;
        expect(['water', 'shallow']).toContain(sea.terrainAt(x, y));
      }
    }
  });
});

describe('ניווט ימי', () => {
  it('מבט ימי הוא היפוך של היבשתי: מים פתוחים, יבשה חסומה', () => {
    const world = seaWorld();
    const land = new TeamNavView(world.nav, () => true, false);
    const sea = new TeamNavView(world.nav, () => true, true);
    let checked = 0;
    for (let y = 1; y < world.map.height - 1 && checked < 400; y++) {
      for (let x = 1; x < world.map.width - 1 && checked < 400; x++) {
        const water = world.nav.isWater(x, y);
        if (water) {
          expect(sea.isBlocked(x, y)).toBe(false);
          expect(land.isBlocked(x, y)).toBe(true);
          checked++;
        } else if (world.map.terrainAt(x, y) === 'grass' && !world.nav.isOccupied(x, y)) {
          expect(sea.isBlocked(x, y)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('נמל וספינות', () => {
  it('נמל נבנה רק על חוף של גוף מים אמיתי', () => {
    const world = seaWorld();
    const dock = getBuilding('dock');
    const spot = dockSpot(world);
    expect(spot).not.toBeNull();
    expect(world.canPlaceBuilding(dock, spot!)).toBe(true);

    // הרחק מהמים — אין נמל
    let inland: Vec2 | null = null;
    for (let y = 2; y < world.map.height - 4 && !inland; y++) {
      for (let x = 2; x < world.map.width - 4 && !inland; x++) {
        if (!world.canPlaceBuilding({ ...dock, shore: false }, { x, y })) continue;
        let nearWater = false;
        for (let dy = -2; dy <= 4; dy++) {
          for (let dx = -2; dx <= 4; dx++) if (world.nav.isWater(x + dx, y + dy)) nearWater = true;
        }
        if (!nearWater) inland = { x, y };
      }
    }
    expect(inland).not.toBeNull();
    expect(world.canPlaceBuilding(dock, inland!)).toBe(false);
  });

  it('ספינה נולדת במים ולא נדחפת לחוף', () => {
    const world = seaWorld();
    const spot = dockSpot(world)!;
    const dock = world.spawnBuilding('dock', 0, spot, true)!;
    const player = world.player(0)!;
    player.unlockedUnits.add('fishing_boat');
    player.resources.wood = 5000;
    expect(world.enqueueTrain(dock.id, 'fishing_boat')).toBe(true);
    for (let i = 0; i < 40 * 30; i++) {
      world.update(1 / 30);
      const boat = world.entitiesOf(0).find((e) => e.defId === 'fishing_boat');
      if (boat) {
        expect(world.nav.isWater(Math.floor(boat.pos.x), Math.floor(boat.pos.y))).toBe(true);
        return;
      }
    }
    throw new Error('הסירה לא נבנתה');
  });

  it('סירת דיג דגה ומחזירה אוכל לנמל', () => {
    const world = seaWorld(11);
    const spot = dockSpot(world)!;
    const dock = world.spawnBuilding('dock', 0, spot, true)!;
    const player = world.player(0)!;
    const boatPos = { x: dock.pos.x, y: dock.pos.y };
    // ממקמים סירה ליד הנמל, במים
    let placed = null;
    for (let r = 1; r <= 6 && !placed; r++) {
      for (let dy = -r; dy <= r && !placed; dy++) {
        for (let dx = -r; dx <= r && !placed; dx++) {
          const x = Math.floor(boatPos.x) + dx;
          const y = Math.floor(boatPos.y) + dy;
          if (world.nav.isWater(x, y)) placed = world.spawnUnit('fishing_boat', 0, { x: x + 0.5, y: y + 0.5 });
        }
      }
    }
    expect(placed).toBeTruthy();
    const tile = world.findResourceTile(placed!.pos, 'food', 40, true);
    expect(tile).not.toBeNull();
    world.assignOrder(placed!, { kind: 'gather', tile: tile!, resource: 'food' });
    const before = player.resources.food;
    for (let i = 0; i < 240 * 30; i++) world.update(1 / 30);
    expect(player.resources.food).toBeGreaterThan(before);
  });

  it('פקודת דגה תקפה רק לספינה, ופקודת יבשה רק ליחידה יבשתית', () => {
    const world = seaWorld(13);
    const worker = world.entitiesOf(0).find((e) => e.kind === 'unit' && getUnit(e.defId).gatherRate)!;
    let fish: Vec2 | null = null;
    for (let y = 0; y < world.map.height && !fish; y++) {
      for (let x = 0; x < world.map.width && !fish; x++) {
        if (world.map.resourceAt(x, y)?.visual === 'fish') fish = { x, y };
      }
    }
    expect(fish).not.toBeNull();
    world.assignOrder(worker, { kind: 'gather', tile: fish!, resource: 'food' });
    expect(worker.order.kind).not.toBe('gather');

    const spot = dockSpot(world)!;
    world.spawnBuilding('dock', 0, spot, true);
    let boat = null;
    for (let r = 1; r <= 6 && !boat; r++) {
      for (let dy = -r; dy <= r && !boat; dy++) {
        for (let dx = -r; dx <= r && !boat; dx++) {
          const x = spot.x + dx;
          const y = spot.y + dy;
          if (world.nav.isWater(x, y)) boat = world.spawnUnit('fishing_boat', 0, { x: x + 0.5, y: y + 0.5 });
        }
      }
    }
    const berry = world.findResourceTile(boat!.pos, 'food', 40, false);
    if (berry) {
      world.assignOrder(boat!, { kind: 'gather', tile: berry, resource: 'food' });
      expect(boat!.order.kind).not.toBe('gather');
    }
  });

  it('כל האומות מקבלות נמל וספינות בשלב 2', () => {
    for (const nation of allNations()) {
      const stage2 = nation.stages.find((s) => s.index === 2)!;
      const buildings = stage2.unlocks?.buildings ?? [];
      const units = stage2.unlocks?.units ?? [];
      const hasDock = buildings.includes('dock') || nation.stages.some((s) =>
        (s.unlocks?.buildings ?? []).some((b) => getBuilding(b).shore),
      );
      expect(hasDock, nation.id).toBe(true);
      expect(units.some((u) => getUnit(u).class === 'ship' && getUnit(u).gatherRate), nation.id).toBe(true);
      expect(units.some((u) => getUnit(u).class === 'ship' && !getUnit(u).gatherRate), nation.id).toBe(true);
    }
  });
});

describe('AI במפה ימית', () => {
  it('בונה נמל ומפעיל צי דיג', () => {
    const world = seaWorld(21, 2);
    const ai = [new AiController(0, 'normal'), new AiController(1, 'normal')];
    for (let i = 0; i < 600 * 10; i++) {
      world.update(1 / 10);
      for (const a of ai) a.update(world, 1 / 10);
      if (i % 600 === 0) {
        const docks = world.entitiesOf(0).filter((e) => e.kind === 'building' && getBuilding(e.defId).shore && e.building?.complete);
        const boats = world.entitiesOf(0).filter((e) => e.alive && e.kind === 'unit' && getUnit(e.defId).class === 'ship');
        if (docks.length > 0 && boats.length > 0) break;
      }
    }
    const docks = world.entitiesOf(0).filter((e) => e.alive && e.kind === 'building' && getBuilding(e.defId).shore);
    const boats = world.entitiesOf(0).filter((e) => e.alive && e.kind === 'unit' && getUnit(e.defId).class === 'ship');
    expect(docks.length, 'נמל').toBeGreaterThan(0);
    expect(boats.length, 'ספינות').toBeGreaterThan(0);
  });
});

void DATA;
