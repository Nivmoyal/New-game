import { describe, expect, it } from 'vitest';
import {
  allNations,
  applyCostMult,
  branchesAtStage,
  DATA,
  findBranchOption,
  getBuilding,
  getNation,
  getTech,
  getUnit,
  mergeModifiers,
} from '../src/data';
import { RESOURCE_KINDS, type UnitClass } from '../src/core/types';

const ALL_CLASSES: UnitClass[] = ['worker', 'infantry', 'ranged', 'cavalry', 'siege', 'air', 'ship', 'building'];

describe('שלמות הנתונים', () => {
  it('כל ההפניות בין קבצי הנתונים תקינות', () => {
    const problems: string[] = [];
    for (const nation of allNations()) {
      if (!DATA.units[nation.worker]) problems.push(`${nation.id}: פועל ${nation.worker}`);
      if (!DATA.buildings[nation.townCenter]) problems.push(`${nation.id}: מרכז ${nation.townCenter}`);
      for (const id of nation.startingUnits ?? []) {
        if (!DATA.units[id]) problems.push(`${nation.id}: יחידת פתיחה ${id}`);
      }
      for (const id of nation.startingBuildings ?? []) {
        if (!DATA.buildings[id]) problems.push(`${nation.id}: מבנה פתיחה ${id}`);
      }
      for (const stage of nation.stages) {
        for (const id of stage.unlocks?.buildings ?? []) {
          if (!DATA.buildings[id]) problems.push(`${nation.id}/${stage.index}: מבנה ${id}`);
        }
        for (const id of stage.unlocks?.units ?? []) {
          if (!DATA.units[id]) problems.push(`${nation.id}/${stage.index}: יחידה ${id}`);
        }
        for (const id of stage.unlocks?.techs ?? []) {
          if (!DATA.techs[id]) problems.push(`${nation.id}/${stage.index}: טכנולוגיה ${id}`);
        }
      }
      for (const branch of nation.branches ?? []) {
        for (const opt of branch.options) {
          for (const id of opt.unlocks?.buildings ?? []) {
            if (!DATA.buildings[id]) problems.push(`${nation.id}/${opt.id}: מבנה ${id}`);
          }
          for (const id of opt.unlocks?.units ?? []) {
            if (!DATA.units[id]) problems.push(`${nation.id}/${opt.id}: יחידה ${id}`);
          }
        }
      }
    }
    for (const [id, b] of Object.entries(DATA.buildings)) {
      for (const u of b.trains ?? []) if (!DATA.units[u]) problems.push(`${id} מאמן ${u}`);
      for (const t of b.researches ?? []) if (!DATA.techs[t]) problems.push(`${id} חוקר ${t}`);
    }
    expect(problems).toEqual([]);
  });

  it('לכל יחידה שדות חוקיים', () => {
    for (const [id, u] of Object.entries(DATA.units)) {
      expect(u.id, id).toBe(id);
      expect(u.name.length, id).toBeGreaterThan(0);
      expect(u.emoji.length, id).toBeGreaterThan(0);
      expect(ALL_CLASSES, id).toContain(u.class);
      expect(u.hp, id).toBeGreaterThan(0);
      expect(u.pop, id).toBeGreaterThan(0);
      expect(u.speed, id).toBeGreaterThan(0);
      expect(u.trainTime, id).toBeGreaterThan(0);
      expect(u.los, id).toBeGreaterThan(0);
      expect(u.armor, id).toBeGreaterThanOrEqual(0);
      const cost = Object.values(u.cost).reduce<number>((s, v) => s + (v ?? 0), 0);
      expect(cost, id).toBeGreaterThan(0);
      for (const k of Object.keys(u.cost)) expect(RESOURCE_KINDS, id).toContain(k);
    }
  });

  it('לכל מבנה שדות חוקיים', () => {
    for (const [id, b] of Object.entries(DATA.buildings)) {
      expect(b.id, id).toBe(id);
      expect(b.size, id).toBeGreaterThanOrEqual(1);
      expect(b.hp, id).toBeGreaterThan(0);
      expect(b.buildTime, id).toBeGreaterThan(0);
      if (b.attack) expect(b.range, id).toBeGreaterThan(0);
      for (const k of Object.keys(b.cost)) expect(RESOURCE_KINDS, id).toContain(k);
    }
  });

  it('לכל טכנולוגיה יש השפעה אחת לפחות', () => {
    for (const [id, t] of Object.entries(DATA.techs)) {
      expect(t.effects.length, id).toBeGreaterThan(0);
      expect(t.researchTime, id).toBeGreaterThan(0);
    }
  });

  it('שש אומות לפחות, כל אחת עם תיאור, יתרונות ודגל', () => {
    const nations = allNations();
    expect(nations.length).toBeGreaterThanOrEqual(6);
    for (const n of nations) {
      expect(n.desc.length).toBeGreaterThan(20);
      expect(n.bonuses.length).toBeGreaterThanOrEqual(3);
      expect(n.flag.length).toBeGreaterThan(0);
      expect(n.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('כל אומה יכולה לאמן פועל ולבנות מרכז יישוב', () => {
    for (const n of allNations()) {
      const tc = getBuilding(n.townCenter);
      expect(tc.isTownCenter).toBe(true);
      expect(tc.trains).toContain(n.worker);
      expect(getUnit(n.worker).gatherRate).toBeDefined();
      expect(getUnit(n.worker).canBuild).toBe(true);
    }
  });

  it('לכל אומה יש נתיב יחידות לכל סוג לחימה עיקרי', () => {
    for (const n of allNations()) {
      const unlocked = new Set<string>();
      for (const s of n.stages) for (const u of s.unlocks?.units ?? []) unlocked.add(u);
      for (const b of n.branches ?? []) {
        for (const o of b.options) for (const u of o.unlocks?.units ?? []) unlocked.add(u);
      }
      const classes = new Set([...unlocked].map((id) => getUnit(id).class));
      expect(classes.has('infantry'), n.id).toBe(true);
      expect(classes.has('ranged'), n.id).toBe(true);
      expect(classes.has('cavalry') || classes.has('siege'), n.id).toBe(true);
    }
  });

  it('לישראל יש בחירת קיבוץ/מושב לפני המשחק ובחירת צבא בשלב 3', () => {
    const israel = getNation('israel');
    const settlement = branchesAtStage(israel, 1);
    expect(settlement).toHaveLength(1);
    expect(settlement[0].options.map((o) => o.id).sort()).toEqual(['kibbutz', 'moshav']);

    const army = branchesAtStage(israel, 3);
    expect(army).toHaveLength(1);
    expect(army[0].options).toHaveLength(4);
    expect(army[0].options.map((o) => o.id)).toEqual(
      expect.arrayContaining(['infantry', 'armor', 'special', 'airdefense']),
    );
  });

  it('המבנים הייחודיים של ישראל קיימים בנתונים', () => {
    for (const id of [
      'il_watertower',
      'il_dining_hall',
      'il_school',
      'il_military_base',
      'il_airdefense',
      'il_hospital',
      'il_exchange',
    ]) {
      expect(() => getBuilding(id)).not.toThrow();
    }
  });

  it('שמות שלבי הצמיחה של ישראל תואמים לבקשה', () => {
    const israel = getNation('israel');
    const kibbutz = findBranchOption(israel, 'settlement', 'kibbutz')!;
    const moshav = findBranchOption(israel, 'settlement', 'moshav')!;
    expect(kibbutz.centerNames![0]).toBe('קיבוץ');
    expect(moshav.centerNames![0]).toBe('מושב');
    expect(israel.stages[1].name).toBe('יישוב גדול');
    expect(israel.stages[2].name).toBe('עיירה');
    expect(israel.stages[3].name).toBe('עיר');
  });

  it('לאומת הויקינגים מסלול צמיחה מלא, יחידות ומבנים ייחודיים', () => {
    const vikings = getNation('vikings');
    expect(vikings.stages.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(vikings.stages.map((s) => s.name)).toEqual([
      'חוות חוף',
      'כפר לונגהאוס',
      'עיירת נמל',
      'עיר סוחרים',
    ]);
    expect(getUnit(vikings.worker).canBuild).toBe(true);
    expect(getBuilding(vikings.townCenter).isTownCenter).toBe(true);
    for (const id of ['vk_longhouse', 'vk_mead_hall', 'vk_harbor', 'vk_forge']) {
      expect(() => getBuilding(id)).not.toThrow();
    }
    // בונדי זול ומהיר לאימון יותר מחי"ר רגיל של אומה אחרת
    const bondi = getUnit('vk_bondi');
    const ashigaru = getUnit('jp_ashigaru');
    expect(bondi.trainTime).toBeLessThanOrEqual(ashigaru.trainTime);
    // בונוס הסיור של האומה
    expect(vikings.modifiers?.losBonus).toBe(2);
  });

  it('לויקינגים יש בחירת ענף בשלב 3 עם שתי דרכים', () => {
    const vikings = getNation('vikings');
    const branches = branchesAtStage(vikings, 3);
    expect(branches).toHaveLength(1);
    expect(branches[0].id).toBe('north');
    expect(branches[0].options.map((o) => o.id).sort()).toEqual(['traders', 'warriors']);
    for (const opt of branches[0].options) {
      expect(opt.highlights.length).toBeGreaterThanOrEqual(3);
      expect(opt.desc.length).toBeGreaterThan(10);
    }
  });

  it('כל מבנה שמאמן יחידות מאמן יחידות של יותר מאומה אחת או ייחודי לאומה', () => {
    // מוודא שהיחידות של הויקינגים באמת ניתנות לאימון איפשהו
    const trainable = new Set<string>();
    for (const b of Object.values(DATA.buildings)) {
      for (const u of b.trains ?? []) trainable.add(u);
    }
    for (const id of Object.keys(DATA.units)) {
      if (!id.startsWith('vk_')) continue;
      expect(trainable.has(id), `${id} לא ניתן לאימון באף מבנה`).toBe(true);
    }
  });

  it('שגיאה ברורה על מזהה לא מוכר', () => {
    expect(() => getUnit('אין_כזה')).toThrow(/יחידה לא מוכרת/);
    expect(() => getBuilding('אין_כזה')).toThrow(/מבנה לא מוכר/);
    expect(() => getTech('אין_כזה')).toThrow(/טכנולוגיה לא מוכרת/);
    expect(() => getNation('אין_כזה')).toThrow(/אומה לא מוכרת/);
  });
});

describe('מודיפיקטורים', () => {
  it('מכפלות מוכפלות ותוספות מסוכמות', () => {
    const merged = mergeModifiers(
      { gatherMult: { all: 1.2 }, houseCapBonus: 2, buildingCostMult: 0.9 },
      { gatherMult: { all: 1.1, food: 1.5 }, houseCapBonus: 3, buildingCostMult: 0.8 },
    );
    expect(merged.gatherMult!.all).toBeCloseTo(1.32, 5);
    expect(merged.gatherMult!.food).toBeCloseTo(1.5, 5);
    expect(merged.houseCapBonus).toBe(5);
    expect(merged.buildingCostMult).toBeCloseTo(0.72, 5);
  });

  it('מיזוג ריק מחזיר ברירות מחדל נייטרליות', () => {
    const merged = mergeModifiers(undefined, undefined);
    expect(merged.buildingCostMult).toBe(1);
    expect(merged.houseCapBonus).toBe(0);
  });

  it('מכפיל עלות מעגל כלפי מעלה ואינו יורד מתחת לאפס', () => {
    expect(applyCostMult({ wood: 30, food: 55 }, 0.85)).toEqual({ wood: 26, food: 47 });
    expect(applyCostMult({ wood: 30 }, 0)).toEqual({ wood: 0 });
  });
});
