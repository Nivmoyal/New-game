import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTrickle,
  carryCapacity,
  computePopCap,
  computePopUsed,
  gatherRateFor,
  hasPopSpace,
  missingResources,
  totalResources,
} from '../src/core/economy';
import { createBuilding, createUnit, resetEntityIds } from '../src/core/entities';
import { Player, BASE_POP_CAP } from '../src/core/player';
import { getBuilding, getUnit } from '../src/data';
import { World } from '../src/core/world';

function makePlayer(nationId = 'israel', branchChoices: Record<string, string> = {}) {
  return new Player({ id: 0, name: 'בדיקה', nationId, branchChoices }, 32, 32);
}

describe('משאבים בסיסיים', () => {
  beforeEach(() => resetEntityIds(1));

  it('שחקן מתחיל עם משאבי פתיחה', () => {
    const p = makePlayer();
    expect(p.resources.food).toBe(300);
    expect(p.resources.wood).toBe(250);
    expect(totalResources(p.resources)).toBe(850);
  });

  it('הוצאה מורידה משאבים ונכשלת כשאין מספיק', () => {
    const p = makePlayer();
    expect(p.spend({ food: 100 })).toBe(true);
    expect(p.resources.food).toBe(200);
    expect(p.spend({ food: 9999 })).toBe(false);
    expect(p.resources.food).toBe(200);
  });

  it('החזר מחזיר משאבים', () => {
    const p = makePlayer();
    p.spend({ wood: 100 });
    p.refund({ wood: 100 });
    expect(p.resources.wood).toBe(250);
  });

  it('מחשב מחסור נכון', () => {
    const p = makePlayer();
    const missing = missingResources(p.resources, { food: 500, wood: 100, gold: 400 });
    expect(missing).toEqual({ food: 200, gold: 250 });
  });

  it('איסוף נרשם בסטטיסטיקה', () => {
    const p = makePlayer();
    p.add('wood', 30);
    expect(p.resources.wood).toBe(280);
    expect(p.stats.gathered.wood).toBe(30);
  });
});

describe('קצב איסוף', () => {
  it('משתמש בקצב הבסיסי של היחידה כשאין בונוס אומה', () => {
    const p = makePlayer('japan');
    const base = getUnit('jp_worker').gatherRate!.wood!;
    expect(gatherRateFor('jp_worker', 'wood', p)).toBeCloseTo(base, 5);
  });

  it('היישוב הישראלי נותן +10% לכל המשאבים', () => {
    const p = makePlayer('israel');
    const base = getUnit('il_worker').gatherRate!.wood!;
    expect(gatherRateFor('il_worker', 'wood', p)).toBeCloseTo(base * 1.1, 5);
  });

  it('בונוס אומה על משאב אחד לא משפיע על השאר', () => {
    const egypt = makePlayer('egypt');
    const food = getUnit('eg_worker').gatherRate!.food!;
    const wood = getUnit('eg_worker').gatherRate!.wood!;
    expect(gatherRateFor('eg_worker', 'food', egypt)).toBeCloseTo(food * 1.15, 5);
    expect(gatherRateFor('eg_worker', 'wood', egypt)).toBeCloseTo(wood, 5);
  });

  it('טכנולוגיה מכפילה את קצב האיסוף', () => {
    const p = makePlayer();
    const before = gatherRateFor('il_worker', 'gold', p);
    p.availableTechs.add('coinage');
    p.stage = 2;
    p.completeResearch('coinage');
    expect(gatherRateFor('il_worker', 'gold', p)).toBeCloseTo(before * 1.25, 5);
  });

  it('לוחם אינו יכול לאסוף', () => {
    const p = makePlayer();
    expect(gatherRateFor('il_infantry', 'wood', p)).toBe(0);
  });

  it('קיבולת נשיאה נקראת מהנתונים', () => {
    expect(carryCapacity('il_worker')).toBe(12);
    expect(carryCapacity('eg_worker')).toBe(14);
    expect(carryCapacity('il_infantry')).toBe(0);
  });
});

describe('אוכלוסייה', () => {
  beforeEach(() => resetEntityIds(1));

  it('תקרה בסיסית ללא מבנים', () => {
    const p = makePlayer();
    expect(computePopCap(p, [])).toBe(BASE_POP_CAP);
  });

  it('בתים מגדילים את התקרה', () => {
    const p = makePlayer('japan');
    const houses = [0, 1].map(() => createBuilding(getBuilding('house'), 0, { x: 1, y: 1 }, true));
    expect(computePopCap(p, houses)).toBe(BASE_POP_CAP + 10);
  });

  it('בית ביישוב ישראלי מכיל אדם אחד יותר', () => {
    const p = makePlayer('israel');
    const houses = [createBuilding(getBuilding('house'), 0, { x: 1, y: 1 }, true)];
    expect(computePopCap(p, houses)).toBe(BASE_POP_CAP + 5 + 1);
  });

  it('מבנה שלא הושלם אינו סופר', () => {
    const p = makePlayer();
    const site = createBuilding(getBuilding('house'), 0, { x: 1, y: 1 }, false);
    expect(computePopCap(p, [site])).toBe(BASE_POP_CAP);
  });

  it('שלבי צמיחה מוסיפים לתקרה', () => {
    const p = makePlayer();
    const capStage1 = computePopCap(p, []);
    p.stage = 2;
    expect(computePopCap(p, [])).toBe(capStage1 + 5);
    p.stage = 4;
    expect(computePopCap(p, [])).toBe(capStage1 + 35);
  });

  it('סופר אוכלוסייה בשימוש כולל תור אימון', () => {
    const p = makePlayer();
    const units = [createUnit(getUnit('il_worker'), 0, { x: 1, y: 1 })];
    const barracks = createBuilding(getBuilding('barracks'), 0, { x: 4, y: 4 }, true);
    barracks.building!.trainQueue.push({ unitId: 'il_tank', remaining: 5, total: 5 });
    expect(computePopUsed(p, [...units, barracks])).toBe(1 + getUnit('il_tank').pop);
  });

  it('בודק מקום פנוי לאוכלוסייה', () => {
    const p = makePlayer();
    p.popUsed = 4;
    p.popCap = 5;
    expect(hasPopSpace(p, 1)).toBe(true);
    expect(hasPopSpace(p, 2)).toBe(false);
  });
});

describe('זרימת משאבים פסיבית', () => {
  beforeEach(() => resetEntityIds(1));

  it('חווה מייצרת אוכל לאורך זמן', () => {
    const p = makePlayer();
    const farm = createBuilding(getBuilding('farm'), 0, { x: 1, y: 1 }, true);
    const before = p.resources.food;
    for (let i = 0; i < 100; i++) applyTrickle(p, farm, 0.1);
    expect(p.resources.food).toBeGreaterThan(before);
    expect(p.resources.food - before).toBeCloseTo(4, 0);
  });

  it('מבנה לא מושלם אינו מייצר', () => {
    const p = makePlayer();
    const farm = createBuilding(getBuilding('farm'), 0, { x: 1, y: 1 }, false);
    const before = p.resources.food;
    for (let i = 0; i < 100; i++) applyTrickle(p, farm, 0.1);
    expect(p.resources.food).toBe(before);
  });

  it('בונוס מסחר מגדיל זהב מהשוק', () => {
    const plain = makePlayer('japan');
    const trader = makePlayer('arabs');
    const marketA = createBuilding(getBuilding('market'), 0, { x: 1, y: 1 }, true);
    const marketB = createBuilding(getBuilding('market'), 0, { x: 1, y: 1 }, true);
    for (let i = 0; i < 200; i++) {
      applyTrickle(plain, marketA, 0.1);
      applyTrickle(trader, marketB, 0.1);
    }
    expect(trader.resources.gold).toBeGreaterThan(plain.resources.gold);
  });
});

describe('מחזור איסוף מלא בעולם אמיתי', () => {
  it('פועל אוסף עץ ומחזיר אותו למרכז היישוב', () => {
    const world = new World({
      seed: 7,
      map: { width: 48, height: 48 },
      players: [{ id: 0, name: 'שחקן', nationId: 'israel', branchChoices: { settlement: 'kibbutz' } }],
    });
    const player = world.player(0)!;
    const tc = world.townCenterOf(0)!;
    expect(tc).toBeTruthy();
    const worker = world.entitiesOf(0).find((e) => e.defId === 'il_worker')!;
    const tile = world.findResourceTile(tc.pos, 'wood', 25);
    expect(tile).not.toBeNull();

    const woodBefore = player.resources.wood;
    world.assignOrder(worker, { kind: 'gather', tile: tile!, resource: 'wood' });
    for (let i = 0; i < 2400; i++) world.update(1 / 30);

    expect(player.resources.wood).toBeGreaterThan(woodBefore);
    expect(player.stats.gathered.wood).toBeGreaterThan(0);
  });

  it('משאב מתרוקן ולא יורד מתחת לאפס', () => {
    const world = new World({
      seed: 3,
      map: { width: 32, height: 32 },
      players: [{ id: 0, name: 'שחקן', nationId: 'japan' }],
    });
    const tile = world.findResourceTile({ x: 16, y: 16 }, 'wood', 30)!;
    const total = world.map.resourceAt(tile.x, tile.y)!.amount;
    const taken = world.map.harvest(tile.x, tile.y, total + 500);
    expect(taken).toBe(total);
    expect(world.map.resourceAt(tile.x, tile.y)).toBeUndefined();
    expect(world.map.harvest(tile.x, tile.y, 10)).toBe(0);
  });
});
