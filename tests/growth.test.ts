import { describe, expect, it } from 'vitest';
import {
  beginStageTransition,
  cancelStageTransition,
  controlRadius,
  evaluateStageRequirements,
  tickStageTransition,
  transitionProgress,
} from '../src/core/growth';
import { Player } from '../src/core/player';
import { allNations, getNation, stageOf } from '../src/data';
import { World } from '../src/core/world';

function player(nationId = 'israel', branchChoices: Record<string, string> = {}) {
  return new Player({ id: 0, name: 'בדיקה', nationId, branchChoices }, 32, 32);
}

const RICH = { food: 99999, wood: 99999, stone: 99999, gold: 99999 };

describe('מבנה הנתונים של השלבים', () => {
  it('לכל אומה יש בדיוק 4 שלבי צמיחה ממוספרים 1..4', () => {
    for (const nation of allNations()) {
      expect(nation.stages.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    }
  });

  it('השלב הראשון אינו דורש דבר, והשאר כן', () => {
    for (const nation of allNations()) {
      expect(nation.stages[0].requires).toBeUndefined();
      for (const stage of nation.stages.slice(1)) {
        expect(stage.requires).toBeDefined();
        expect(stage.requires!.time).toBeGreaterThan(0);
      }
    }
  });

  it('רדיוס השליטה גדל בכל שלב', () => {
    for (const nation of allNations()) {
      for (let i = 1; i < nation.stages.length; i++) {
        expect(nation.stages[i].controlRadius).toBeGreaterThan(nation.stages[i - 1].controlRadius);
      }
    }
  });

  it('כל שלב פותח מבנים או יחידות', () => {
    for (const nation of allNations()) {
      for (const stage of nation.stages) {
        const u = stage.unlocks ?? {};
        const count =
          (u.buildings?.length ?? 0) + (u.units?.length ?? 0) + (u.techs?.length ?? 0);
        expect(count).toBeGreaterThan(0);
      }
    }
  });
});

describe('דרישות מעבר שלב', () => {
  it('מזהה חוסר במשאבים, באוכלוסייה ובמבנים', () => {
    // נקרא מהנתונים ולא ממספרים קשיחים, כדי שאיזון של עלויות השלבים
    // לא ישבור את הבדיקה.
    const req = stageOf(getNation('israel'), 2).requires!;
    const p = player();
    p.resources = { food: 0, wood: 0, stone: 0, gold: 0 };
    const status = evaluateStageRequirements(p, {}, 0);
    expect(status.nextStage).toBe(2);
    expect(status.ok).toBe(false);
    expect(status.missing.resources.food).toBe(req.resources!.food);
    expect(status.missing.population).toBe(req.population);
    expect(status.missing.buildings).toEqual([{ id: 'house', need: 2, have: 0 }]);
  });

  it('מאשר מעבר כשכל הדרישות מולאו', () => {
    const p = player();
    p.resources = { ...RICH };
    const status = evaluateStageRequirements(p, { house: 2 }, 24);
    expect(status.ok).toBe(true);
    expect(status.missing.buildings).toHaveLength(0);
  });

  it('אין שלב חמישי', () => {
    const p = player();
    p.stage = 4;
    const status = evaluateStageRequirements(p, {}, 100);
    expect(status.nextStage).toBeNull();
    expect(status.ok).toBe(false);
  });
});

describe('ביצוע המעבר', () => {
  it('גובה משאבים ומתקדם אחרי הזמן הנדרש', () => {
    const req = stageOf(getNation('israel'), 2).requires!;
    const p = player();
    p.resources = { food: 900, wood: 700, stone: 0, gold: 0 };
    expect(beginStageTransition(p, { house: 2 }, 12)).toBe(true);
    expect(p.resources.food).toBe(900 - req.resources!.food!);
    expect(p.resources.wood).toBe(700 - req.resources!.wood!);
    expect(p.stage).toBe(1);
    expect(transitionProgress(p)).toBe(0);

    for (let i = 0; i < 300; i++) tickStageTransition(p, 0.2);
    expect(p.stage).toBe(2);
    expect(p.transition).toBeNull();
  });

  it('מחזיר אירוע בסיום המעבר עם רשימת בחירות ממתינות', () => {
    const p = player('israel', { settlement: 'kibbutz' });
    p.stage = 2;
    p.resources = { ...RICH };
    beginStageTransition(p, { house: 4, barracks: 1 }, 25);
    let advanced = null;
    for (let i = 0; i < 2000 && !advanced; i++) advanced = tickStageTransition(p, 0.1);
    expect(advanced).not.toBeNull();
    expect(advanced!.stage.index).toBe(3);
    expect(advanced!.pendingBranches).toContain('army');
  });

  it('ביטול מעבר מחזיר את כל המשאבים', () => {
    const p = player();
    const before = { ...p.resources, food: 500, wood: 300 };
    p.resources = { ...before };
    beginStageTransition(p, { house: 2 }, 12);
    expect(cancelStageTransition(p)).toBe(true);
    expect(p.resources).toEqual(before);
    expect(p.transition).toBeNull();
  });

  it('לא ניתן להתחיל מעבר כפול', () => {
    const p = player();
    p.resources = { ...RICH };
    expect(beginStageTransition(p, { house: 2 }, 12)).toBe(true);
    expect(beginStageTransition(p, { house: 2 }, 12)).toBe(false);
  });

  it('מחקר מהיר מקצר את זמן המעבר', () => {
    const slow = player('israel', { settlement: 'moshav' });
    const fast = player('arabs');
    slow.resources = { ...RICH };
    fast.resources = { ...RICH };
    beginStageTransition(slow, { house: 2 }, 12);
    beginStageTransition(fast, { house: 2 }, 12);
    expect(fast.transition!.total).toBeLessThan(slow.transition!.total);
  });
});

describe('פתיחת תוכן עם השלבים', () => {
  it('מבנים ויחידות נפתחים בדיוק בשלב שלהם', () => {
    const p = player();
    // צבא בסיסי זמין כבר משלב 1 — קסרקטין ומגדל שמירה.
    // מה שנפתח בהמשך הוא היחידות המתקדמות, לא היכולת להתגונן.
    expect(p.canBuild('house')).toBe(true);
    expect(p.canBuild('barracks')).toBe(true);
    expect(p.canTrain('il_guard')).toBe(true);
    expect(p.canBuild('archery_range')).toBe(false);
    expect(p.canTrain('il_infantry')).toBe(false);

    p.resources = { ...RICH };
    beginStageTransition(p, { house: 2 }, 12);
    for (let i = 0; i < 1000; i++) tickStageTransition(p, 0.1);

    expect(p.stage).toBe(2);
    expect(p.canBuild('archery_range')).toBe(true);
    expect(p.canTrain('il_infantry')).toBe(true);
  });

  it('טכנולוגיה נחסמת עד לשלב המינימלי שלה', () => {
    const p = player();
    p.availableTechs.add('industry');
    expect(p.canResearch('industry')).toBe(false);
    p.stage = 4;
    expect(p.canResearch('industry')).toBe(true);
  });

  it('כל מבני הקצה של ישראל נפתחים בשלב העיר', () => {
    // אין יותר פיצול קיבוץ/מושב — היישוב הישראלי אחד, וכל המסלול פתוח לו
    const p = player('israel');
    expect(p.canBuild('il_factory')).toBe(false);
    const city = stageOf(getNation('israel'), 4);
    expect(city.unlocks?.buildings).toEqual(
      expect.arrayContaining(['il_factory', 'il_exchange', 'il_hightech']),
    );
    // וחדר האוכל, שקודם נפתח רק דרך בחירת הקיבוץ, נפתח עכשיו בשלב 2
    expect(stageOf(getNation('israel'), 2).unlocks?.buildings).toContain('il_dining_hall');
  });

  it('בחירת זרוע צבאית פותחת את היחידות שלה', () => {
    const p = player('israel');
    p.stage = 3;
    expect(p.canTrain('il_sniper')).toBe(false);
    p.chooseBranch('army', 'special');
    expect(p.canTrain('il_sniper')).toBe(true);
    expect(p.canTrain('il_commando')).toBe(true);
    expect(p.canTrain('il_tank')).toBe(false);
  });

  it('בונוסי האומה חלים כבר בתחילת המשחק', () => {
    const p = player('israel');
    expect(p.modifiers.houseCapBonus).toBe(1);
    expect(p.modifiers.researchSpeedMult).toBeCloseTo(1.15, 5);
  });
});

describe('מראה מרכז היישוב', () => {
  it('משתנה לפי שלב הצמיחה', () => {
    const p = player('israel');
    expect(p.centerAppearance().name).toBe(stageOf(getNation('israel'), 1).centerName);
    p.stage = 4;
    expect(p.centerAppearance().name).toBe(stageOf(getNation('israel'), 4).centerName);
  });

  it('אומה בלי בחירות משתמשת בשמות השלב', () => {
    const rome = player('rome');
    expect(rome.centerAppearance().name).toBe(stageOf(getNation('rome'), 1).centerName);
  });

  it('רדיוס השליטה עולה עם השלב', () => {
    const p = player();
    const r1 = controlRadius(p);
    p.stage = 4;
    expect(controlRadius(p)).toBeGreaterThan(r1);
  });
});

describe('מעבר שלב דרך העולם', () => {
  it('requestStageAdvance עובד עם ספירת מבנים אמיתית', () => {
    const world = new World({
      seed: 5,
      map: { width: 48, height: 48 },
      players: [{ id: 0, name: 'שחקן', nationId: 'israel', branchChoices: { settlement: 'kibbutz' } }],
    });
    const p = world.player(0)!;
    p.resources = { ...RICH };
    expect(world.requestStageAdvance(0)).toBe(false); // אין בתים ואין אוכלוסייה

    const tc = world.townCenterOf(0)!;
    world.placeNear('house', 0, { x: Math.round(tc.pos.x) + 4, y: Math.round(tc.pos.y) }, 8);
    world.placeNear('house', 0, { x: Math.round(tc.pos.x) - 5, y: Math.round(tc.pos.y) }, 8);
    for (let i = 0; i < 10; i++) world.spawnUnit('il_worker', 0, tc.pos);
    world.recomputePopulation();

    expect(world.requestStageAdvance(0)).toBe(true);
    for (let i = 0; i < 3000 && p.stage === 1; i++) world.update(1 / 30);
    expect(p.stage).toBe(2);
    expect(p.popCap).toBeGreaterThan(15);
  });
});
