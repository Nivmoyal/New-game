import { describe, expect, it, beforeEach } from 'vitest';
import {
  armorAgainst,
  CLASS_MATCHUP,
  computeDamage,
  damageMultiplier,
  dps,
  hitsToKill,
  MIN_DAMAGE,
  statsOf,
  maxHpFor,
  type CombatStats,
} from '../src/core/combat';
import { createBuilding, createUnit, resetEntityIds } from '../src/core/entities';
import { Player } from '../src/core/player';
import { getBuilding, getUnit } from '../src/data';
import { World } from '../src/core/world';
import type { UnitClass } from '../src/core/types';

function stats(partial: Partial<CombatStats> & { cls: UnitClass }): CombatStats {
  return {
    attack: 10,
    attackType: 'melee',
    armor: 0,
    pierceArmor: 0,
    range: 1,
    cooldown: 1,
    bonusVs: {},
    maxHp: 100,
    speed: 2,
    los: 6,
    ...partial,
  };
}

describe('חישוב נזק', () => {
  it('שריון מפחית נזק', () => {
    const attacker = stats({ cls: 'infantry', attack: 10 });
    const soft = stats({ cls: 'infantry', armor: 0 });
    const armored = stats({ cls: 'infantry', armor: 4 });
    expect(computeDamage(attacker, armored)).toBeLessThan(computeDamage(attacker, soft));
  });

  it('נזק לעולם אינו יורד מתחת למינימום', () => {
    const attacker = stats({ cls: 'infantry', attack: 5 });
    const tank = stats({ cls: 'infantry', armor: 999 });
    expect(computeDamage(attacker, tank)).toBe(MIN_DAMAGE);
  });

  it('יחידה ללא תקיפה אינה גורמת נזק', () => {
    const medic = stats({ cls: 'worker', attack: 0 });
    expect(computeDamage(medic, stats({ cls: 'infantry' }))).toBe(0);
  });

  it('תקיפה חודרת נבלמת בשריון חודר', () => {
    const archer = stats({ cls: 'ranged', attack: 12, attackType: 'pierce' });
    const target = stats({ cls: 'infantry', armor: 10, pierceArmor: 0 });
    expect(armorAgainst(target, 'pierce')).toBe(0);
    expect(armorAgainst(target, 'melee')).toBe(10);
    expect(computeDamage(archer, target)).toBeGreaterThan(10);
  });

  it('מצור מתעלם מחצי מהשריון', () => {
    const siege = stats({ cls: 'siege', attack: 30, attackType: 'siege' });
    const target = stats({ cls: 'building', armor: 8 });
    expect(armorAgainst(target, 'siege')).toBe(4);
    expect(computeDamage(siege, target)).toBeCloseTo(30 * CLASS_MATCHUP.siege!.building! - 4, 2);
  });
});

describe('יחסי חוזק בין סוגי יחידות', () => {
  it('חי"ר חזק מול פרשים', () => {
    const inf = stats({ cls: 'infantry' });
    expect(damageMultiplier(inf, stats({ cls: 'cavalry' }))).toBeGreaterThan(1);
  });

  it('פרשים חזקים מול לוחמי טווח', () => {
    const cav = stats({ cls: 'cavalry' });
    expect(damageMultiplier(cav, stats({ cls: 'ranged' }))).toBeGreaterThan(1);
  });

  it('לוחמי טווח חזקים מול חי"ר', () => {
    const ranged = stats({ cls: 'ranged' });
    expect(damageMultiplier(ranged, stats({ cls: 'infantry' }))).toBeGreaterThan(1);
  });

  it('המשולש סגור: כל סוג חזק מול אחד וחלש מול אחר', () => {
    const inf = stats({ cls: 'infantry' });
    const cav = stats({ cls: 'cavalry' });
    const ranged = stats({ cls: 'ranged' });
    expect(damageMultiplier(inf, cav)).toBeGreaterThan(damageMultiplier(inf, ranged));
    expect(damageMultiplier(cav, ranged)).toBeGreaterThan(damageMultiplier(cav, inf));
    expect(damageMultiplier(ranged, inf)).toBeGreaterThan(damageMultiplier(ranged, cav));
  });

  it('מצור מצטיין נגד מבנים וחלש מול פרשים', () => {
    const siege = stats({ cls: 'siege' });
    expect(damageMultiplier(siege, stats({ cls: 'building' }))).toBeGreaterThan(1.5);
    expect(damageMultiplier(siege, stats({ cls: 'cavalry' }))).toBeLessThan(1);
  });

  it('יחידות קרקע מתקשות מול יחידות אוויריות', () => {
    const inf = stats({ cls: 'infantry' });
    expect(damageMultiplier(inf, stats({ cls: 'air' }))).toBeLessThan(1);
  });

  it('נ"מ קוטל יחידות אוויריות', () => {
    const flak = statsOf(
      createUnit(getUnit('il_flak'), 0, { x: 0, y: 0 }),
      undefined,
    );
    const drone = statsOf(createUnit(getUnit('il_drone'), 1, { x: 0, y: 0 }), undefined);
    const infantry = statsOf(createUnit(getUnit('il_infantry'), 1, { x: 0, y: 0 }), undefined);
    expect(computeDamage(flak, drone)).toBeGreaterThan(computeDamage(flak, infantry));
  });

  it('בונוס ספציפי מוכפל בבונוס הכללי', () => {
    const spear = stats({ cls: 'infantry', bonusVs: { cavalry: 2 } });
    const generic = stats({ cls: 'infantry' });
    const cav = stats({ cls: 'cavalry' });
    expect(damageMultiplier(spear, cav)).toBeCloseTo(damageMultiplier(generic, cav) * 2, 5);
  });
});

describe('מדדי קרב', () => {
  it('מחשב כמה מכות צריך להרוג', () => {
    const a = stats({ cls: 'infantry', attack: 10 });
    const d = stats({ cls: 'infantry', maxHp: 100, armor: 0 });
    expect(hitsToKill(a, d)).toBe(Math.ceil(100 / computeDamage(a, d)));
  });

  it('אינסוף מכות כשאין נזק', () => {
    const a = stats({ cls: 'worker', attack: 0 });
    expect(hitsToKill(a, stats({ cls: 'infantry' }))).toBe(Infinity);
  });

  it('נזק לשנייה מתחשב בקצב התקיפה', () => {
    const fast = stats({ cls: 'infantry', attack: 10, cooldown: 1 });
    const slow = stats({ cls: 'infantry', attack: 10, cooldown: 2 });
    const target = stats({ cls: 'infantry' });
    expect(dps(fast, target)).toBeCloseTo(dps(slow, target) * 2, 5);
  });
});

describe('סטטיסטיקות מהנתונים', () => {
  beforeEach(() => resetEntityIds(1));

  it('טכנולוגיה מוסיפה תקיפה ליחידות הרלוונטיות בלבד', () => {
    const p = new Player({ id: 0, name: 'p', nationId: 'israel' }, 32, 32);
    const inf = createUnit(getUnit('il_infantry'), 0, { x: 0, y: 0 });
    const archer = createUnit(getUnit('il_rifleman'), 0, { x: 0, y: 0 });
    const beforeInf = statsOf(inf, p).attack;
    const beforeArcher = statsOf(archer, p).attack;
    p.stage = 2;
    p.availableTechs.add('weapons_infantry');
    p.completeResearch('weapons_infantry');
    expect(statsOf(inf, p).attack).toBeCloseTo(beforeInf + 2, 5);
    expect(statsOf(archer, p).attack).toBeCloseTo(beforeArcher, 5);
  });

  it('בחירת זרוע "שריון" נותנת שריון לכל היחידות', () => {
    const plain = new Player({ id: 0, name: 'a', nationId: 'israel' }, 32, 32);
    const armored = new Player(
      { id: 1, name: 'b', nationId: 'israel', branchChoices: { army: 'armor' } },
      32,
      32,
    );
    armored.stage = 3;
    armored.recomputeModifiers();
    const unit = createUnit(getUnit('il_infantry'), 0, { x: 0, y: 0 });
    expect(statsOf(unit, armored).armor).toBe(statsOf(unit, plain).armor + 1);
  });

  it('בונוס מבנים של יפן מגדיל נקודות חיים', () => {
    const jp = new Player({ id: 0, name: 'jp', nationId: 'japan' }, 32, 32);
    const il = new Player({ id: 1, name: 'il', nationId: 'israel' }, 32, 32);
    expect(maxHpFor('tower', 'building', jp)).toBeGreaterThan(maxHpFor('tower', 'building', il));
  });

  it('מגדל שמירה יורה בחצים ולא במגע', () => {
    const p = new Player({ id: 0, name: 'p', nationId: 'israel' }, 32, 32);
    const tower = createBuilding(getBuilding('tower'), 0, { x: 0, y: 0 }, true);
    const s = statsOf(tower, p);
    expect(s.attackType).toBe('pierce');
    expect(s.range).toBeGreaterThan(5);
    expect(s.cls).toBe('building');
  });
});

describe('קרב בעולם', () => {
  it('שתי יחידות אויב נלחמות עד מוות', () => {
    const world = new World({
      seed: 11,
      map: { width: 32, height: 32 },
      revealAll: true,
      players: [
        { id: 0, name: 'א', nationId: 'israel' },
        { id: 1, name: 'ב', nationId: 'japan' },
      ],
    });
    const a = world.spawnUnit('il_infantry', 0, { x: 15, y: 15 })!;
    const b = world.spawnUnit('jp_ashigaru', 1, { x: 17, y: 15 })!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    world.assignOrder(a, { kind: 'attack', targetId: b.id });
    for (let i = 0; i < 3000 && a.alive && b.alive; i++) world.update(1 / 30);
    expect(b.alive).toBe(false);
    expect(a.alive).toBe(true);
    expect(world.player(0)!.stats.kills).toBeGreaterThan(0);
  });

  it('יחידה בהמתנה תוקפת אויב שנכנס לטווח ראייה', () => {
    const world = new World({
      seed: 12,
      map: { width: 64, height: 64 },
      revealAll: true,
      players: [
        { id: 0, name: 'א', nationId: 'israel' },
        { id: 1, name: 'ב', nationId: 'japan' },
      ],
    });
    // מקום נייטרלי הרחק מנקודות הפתיחה של שני השחקנים
    const spot = { x: 32, y: 32 };
    const guard = world.spawnUnit('il_infantry', 0, spot)!;
    const enemy = world.spawnUnit('jp_worker', 1, { x: guard.pos.x + 2, y: guard.pos.y })!;
    for (let i = 0; i < 60; i++) world.update(1 / 30);
    expect(guard.order.kind).toBe('attack');
    const target = world.get(guard.order.targetId)!;
    expect(target.owner).toBe(1);
    expect(target.id).toBe(enemy.id);
  });

  it('מצור הורס מבנה מהר יותר מחי"ר', () => {
    const world = new World({
      seed: 13,
      map: { width: 40, height: 40 },
      revealAll: true,
      players: [
        { id: 0, name: 'א', nationId: 'rome' },
        { id: 1, name: 'ב', nationId: 'japan' },
      ],
    });
    const p1 = world.player(1)!;
    p1.unlockedBuildings.add('house');
    const target = world.placeNear('house', 1, { x: 20, y: 20 }, 6)!;
    const ram = world.spawnUnit('rm_ram', 0, { x: 24, y: 20 })!;
    const hpStart = target.hp;
    world.assignOrder(ram, { kind: 'attack', targetId: target.id });
    for (let i = 0; i < 600 && target.alive; i++) world.update(1 / 30);
    expect(target.hp).toBeLessThan(hpStart);
  });
});
