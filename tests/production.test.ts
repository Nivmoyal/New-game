import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { getBuilding } from '../src/data';

function world(nationId = 'israel', branchChoices: Record<string, string> = { settlement: 'kibbutz' }) {
  return new World({
    seed: 777,
    map: { width: 64, height: 64 },
    revealAll: true,
    players: [{ id: 0, name: 'שחקן', nationId, branchChoices }],
  });
}

const RICH = { food: 9999, wood: 9999, stone: 9999, gold: 9999 };

function run(w: World, seconds: number, step = 1 / 20) {
  for (let i = 0; i < Math.round(seconds / step); i++) w.update(step);
}

describe('בנייה', () => {
  it('פועל בונה מבנה עד השלמה', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const worker = w.entitiesOf(0).find((e) => e.defId === 'il_worker')!;
    const tile = w.findPlacementNear('house', { x: tc.pos.x + 5, y: tc.pos.y + 5 }, 10)!;
    const site = w.startConstruction(0, 'house', tile, [worker.id]);
    expect(site).toBeTruthy();
    expect(site!.building!.complete).toBe(false);
    const capBefore = p.popCap;

    run(w, 60);
    expect(site!.building!.complete).toBe(true);
    expect(site!.hp).toBe(site!.maxHp);
    expect(p.popCap).toBe(capBefore + 5 + (p.modifiers.houseCapBonus ?? 0));
  });

  it('בנייה גובה משאבים והחזר בביטול', () => {
    const w = world();
    const p = w.player(0)!;
    const before = p.resources.wood;
    const tc = w.townCenterOf(0)!;
    const spot = w.findPlacementNear('house', { x: tc.pos.x + 6, y: tc.pos.y }, 10)!;
    const site = w.startConstruction(0, 'house', spot)!;
    expect(p.resources.wood).toBeLessThan(before);
    w.cancelConstruction(site.id);
    expect(p.resources.wood).toBe(before);
    expect(w.get(site.id)).toBeUndefined();
  });

  it('לא ניתן לבנות מבנה שלא נפתח', () => {
    const w = world();
    w.player(0)!.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const spot = w.findPlacementNear('barracks', { x: tc.pos.x + 8, y: tc.pos.y }, 12)!;
    expect(w.startConstruction(0, 'barracks', spot)).toBeNull();
  });

  it('לא ניתן לבנות על מים או על מבנה קיים', () => {
    const w = world();
    w.player(0)!.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const origin = { x: Math.round(tc.pos.x - 2), y: Math.round(tc.pos.y - 2) };
    expect(w.canPlaceBuilding(getBuilding('house'), origin)).toBe(false);
    w.map.setTerrain(5, 5, 'water');
    expect(w.canPlaceBuilding(getBuilding('house'), { x: 5, y: 5 })).toBe(false);
  });

  it('מגבלת מספר מבנים נאכפת', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const limit = getBuilding('il_watertower').limit!;
    let built = 0;
    for (let i = 0; i < limit + 3; i++) {
      const spot = w.findPlacementNear('il_watertower', { x: 12 + i * 4, y: 40 }, 8);
      if (!spot) continue;
      if (w.startConstruction(0, 'il_watertower', spot)) built++;
    }
    expect(built).toBe(limit);
  });

  it('תיקון מחזיר נקודות חיים למבנה', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    tc.hp = Math.round(tc.maxHp * 0.4);
    const worker = w.entitiesOf(0).find((e) => e.defId === 'il_worker')!;
    w.assignOrder(worker, { kind: 'repair', targetId: tc.id });
    run(w, 40);
    expect(tc.hp).toBeGreaterThan(tc.maxHp * 0.4);
  });
});

describe('אימון יחידות', () => {
  it('תור אימון מייצר יחידה חדשה', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const before = w.entitiesOf(0).filter((e) => e.defId === 'il_worker').length;
    expect(w.enqueueTrain(tc.id, 'il_worker')).toBe(true);
    expect(tc.building!.trainQueue).toHaveLength(1);
    run(w, 20);
    expect(w.entitiesOf(0).filter((e) => e.defId === 'il_worker').length).toBe(before + 1);
    expect(tc.building!.trainQueue).toHaveLength(0);
  });

  it('אימון חסום כשהאוכלוסייה מלאה', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    p.popUsed = p.popCap;
    expect(w.enqueueTrain(tc.id, 'il_worker')).toBe(false);
    const notice = w.drainEvents().find((e) => e.type === 'notice');
    expect(notice).toBeTruthy();
  });

  it('אימון חסום בלי משאבים', () => {
    const w = world();
    w.player(0)!.resources = { food: 0, wood: 0, stone: 0, gold: 0 };
    const tc = w.townCenterOf(0)!;
    expect(w.enqueueTrain(tc.id, 'il_worker')).toBe(false);
  });

  it('לא ניתן לאמן יחידה שהמבנה אינו מאמן', () => {
    const w = world();
    w.player(0)!.resources = { ...RICH };
    w.player(0)!.unlockedUnits.add('il_infantry');
    const tc = w.townCenterOf(0)!;
    expect(w.enqueueTrain(tc.id, 'il_infantry')).toBe(false);
  });

  it('ביטול אימון מחזיר משאבים', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const before = p.resources.food;
    w.enqueueTrain(tc.id, 'il_worker');
    expect(p.resources.food).toBeLessThan(before);
    w.cancelTrain(tc.id, 0);
    expect(p.resources.food).toBe(before);
  });

  it('יחידה חדשה הולכת לנקודת הכינוס', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const rally = { x: tc.pos.x + 7, y: tc.pos.y + 7 };
    w.setRallyPoint(tc.id, rally);
    const before = new Set(w.entitiesOf(0).map((e) => e.id));
    w.enqueueTrain(tc.id, 'il_worker');
    run(w, 16);
    const fresh = w.entitiesOf(0).find((e) => !before.has(e.id) && e.defId === 'il_worker')!;
    expect(fresh).toBeTruthy();
    expect(['move', 'gather', 'idle']).toContain(fresh.order.kind);
    run(w, 20);
    expect(Math.hypot(fresh.pos.x - rally.x, fresh.pos.y - rally.y)).toBeLessThan(6);
  });

  it('נקודת כינוס על משאב שולחת לאסוף אותו', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const tile = w.findResourceTile(tc.pos, 'wood', 25)!;
    w.setRallyPoint(tc.id, { x: tile.x + 0.5, y: tile.y + 0.5 });
    const before = new Set(w.entitiesOf(0).map((e) => e.id));
    w.enqueueTrain(tc.id, 'il_worker');
    run(w, 16);
    const fresh = w.entitiesOf(0).find((e) => !before.has(e.id) && e.defId === 'il_worker')!;
    expect(fresh.order.kind).toBe('gather');
    expect(fresh.order.resource).toBe('wood');
  });
});

describe('מחקר', () => {
  it('מחקר מסתיים ומחיל את השפעתו', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    p.stage = 2;
    p.applyStageUnlocks(2);
    const tc = w.townCenterOf(0)!;
    const smith = w.placeNear('blacksmith', 0, { x: Math.round(tc.pos.x) + 7, y: Math.round(tc.pos.y) }, 10)!;
    expect(w.startResearch(smith.id, 'weapons_infantry')).toBe(true);
    expect(w.startResearch(smith.id, 'armor_infantry')).toBe(false); // תפוס
    run(w, 60);
    expect(p.researched.has('weapons_infantry')).toBe(true);
    expect(p.techBonuses.attack.infantry).toBe(2);
  });

  it('מחקר שלא נפתח נדחה', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const smith = w.placeNear('blacksmith', 0, { x: Math.round(tc.pos.x) + 7, y: Math.round(tc.pos.y) }, 10)!;
    expect(w.startResearch(smith.id, 'weapons_infantry')).toBe(false);
  });
});

describe('פקודות ופורמציות', () => {
  it('פקודת תנועה קבוצתית מפזרת את היחידות', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const u = w.spawnUnit('il_worker', 0, { x: tc.pos.x + 3, y: tc.pos.y + 3 });
      if (u) ids.push(u.id);
    }
    const target = { x: tc.pos.x + 10, y: tc.pos.y + 10 };
    w.issueCommand(ids, { kind: 'move', target });
    run(w, 25);
    const units = ids.map((id) => w.get(id)!).filter(Boolean);
    // כולם הגיעו לסביבת היעד אך לא לאותה נקודה בדיוק
    for (const u of units) {
      expect(Math.hypot(u.pos.x - target.x, u.pos.y - target.y)).toBeLessThan(6);
    }
    const positions = new Set(units.map((u) => `${u.pos.x.toFixed(1)},${u.pos.y.toFixed(1)}`));
    expect(positions.size).toBeGreaterThan(1);
  });

  it('פקודה בתור מתבצעת אחרי הקודמת', () => {
    const w = world();
    const tc = w.townCenterOf(0)!;
    const u = w.spawnUnit('il_scout', 0, { x: tc.pos.x + 2, y: tc.pos.y })!;
    const first = { x: tc.pos.x + 5, y: tc.pos.y };
    const second = { x: tc.pos.x + 5, y: tc.pos.y + 6 };
    w.assignOrder(u, { kind: 'move', target: first });
    w.assignOrder(u, { kind: 'move', target: second }, true);
    expect(u.queue).toHaveLength(1);
    run(w, 30);
    expect(Math.hypot(u.pos.x - second.x, u.pos.y - second.y)).toBeLessThan(3);
  });

  it('פקודה חכמה בוחרת פעולה לפי היעד', () => {
    const w = world();
    const p = w.player(0)!;
    p.resources = { ...RICH };
    const tc = w.townCenterOf(0)!;
    const worker = w.entitiesOf(0).find((e) => e.defId === 'il_worker')!;
    const tile = w.findResourceTile(tc.pos, 'wood', 25)!;
    expect(w.smartOrder(worker, { x: tile.x + 0.5, y: tile.y + 0.5 }).kind).toBe('gather');
    expect(w.smartOrder(worker, { x: tc.pos.x, y: tc.pos.y }, tc).kind).toBe('move');
    tc.hp = tc.maxHp / 2;
    expect(w.smartOrder(worker, { x: tc.pos.x, y: tc.pos.y }, tc).kind).toBe('repair');
  });

  it('עצירה מבטלת את הפקודה הנוכחית', () => {
    const w = world();
    const tc = w.townCenterOf(0)!;
    const u = w.spawnUnit('il_scout', 0, { x: tc.pos.x + 2, y: tc.pos.y })!;
    w.assignOrder(u, { kind: 'move', target: { x: tc.pos.x + 15, y: tc.pos.y } });
    run(w, 1);
    w.issueCommand([u.id], { kind: 'idle' });
    expect(u.order.kind).toBe('idle');
    expect(u.unit!.path).toHaveLength(0);
  });
});

describe('ניקיון ומוות', () => {
  it('הריסת מבנה משחררת את האריחים למעבר', () => {
    const w = world();
    w.player(0)!.resources = { ...RICH };
    const tile = { x: 20, y: 40 };
    const site = w.placeNear('house', 0, tile, 6)!;
    const origin = { x: Math.round(site.pos.x - 1), y: Math.round(site.pos.y - 1) };
    expect(w.nav.isOccupied(origin.x, origin.y)).toBe(true);
    w.kill(site);
    expect(w.nav.isOccupied(origin.x, origin.y)).toBe(false);
  });

  it('אוכלוסייה מתעדכנת אחרי מוות', () => {
    const w = world();
    const p = w.player(0)!;
    const before = p.popUsed;
    const unit = w.entitiesOf(0).find((e) => e.kind === 'unit')!;
    w.kill(unit);
    expect(p.popUsed).toBeLessThan(before);
    expect(p.stats.unitsLost).toBe(1);
  });

  it('משחק מסתיים כשכל היחידות של שחקן נהרסו', () => {
    const w = new World({
      seed: 3,
      map: { width: 48, height: 48 },
      players: [
        { id: 0, name: 'א', nationId: 'israel', team: 0 },
        { id: 1, name: 'ב', nationId: 'japan', team: 1 },
      ],
    });
    for (const e of w.entitiesOf(1)) w.kill(e);
    run(w, 2);
    expect(w.player(1)!.defeated).toBe(true);
    expect(w.gameOver?.winnerTeam).toBe(0);
  });
});
