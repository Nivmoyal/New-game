import { describe, expect, it } from 'vitest';
import { AiController, AiManager } from '../src/ai/ai';
import { AI_PROFILES, DIFFICULTY_ORDER } from '../src/ai/difficulty';
import { availableByRole, roleOf } from '../src/ai/roles';
import { getBuilding } from '../src/data';
import { World } from '../src/core/world';
import type { Difficulty } from '../src/core/types';

function aiWorld(difficulty: Difficulty = 'normal', seed = 42) {
  const world = new World({
    seed,
    map: { width: 80, height: 80 },
    players: [
      { id: 0, name: 'שחקן', nationId: 'israel', branchChoices: { settlement: 'kibbutz' } },
      { id: 1, name: 'מחשב', nationId: 'japan', isAI: true, difficulty },
    ],
  });
  return { world, ai: new AiManager(world) };
}

function run(world: World, ai: AiManager, seconds: number, step = 1 / 20) {
  const iterations = Math.round(seconds / step);
  for (let i = 0; i < iterations; i++) {
    world.update(step);
    ai.update(world, step);
  }
}

describe('סיווג מבנים לפי תפקיד', () => {
  it('מזהה נכון את התפקידים מהנתונים', () => {
    expect(roleOf(getBuilding('il_tc'))).toBe('townCenter');
    expect(roleOf(getBuilding('house'))).toBe('house');
    expect(roleOf(getBuilding('barracks'))).toBe('military');
    expect(roleOf(getBuilding('tower'))).toBe('defense');
    expect(roleOf(getBuilding('lumber_camp'))).toBe('dropOff');
    expect(roleOf(getBuilding('farm'))).toBe('farm');
    expect(roleOf(getBuilding('blacksmith'))).toBe('research');
    expect(roleOf(getBuilding('wall'))).toBe('wall');
  });

  it('מחזיר מבנים זמינים לפי תפקיד', () => {
    const houses = availableByRole(['house', 'barracks', 'tower'], 'house');
    expect(houses.map((h) => h.id)).toEqual(['house']);
  });
});

describe('רמות קושי', () => {
  it('ארבע רמות, כל אחת אגרסיבית יותר מקודמתה', () => {
    expect(DIFFICULTY_ORDER).toHaveLength(4);
    for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
      const prev = AI_PROFILES[DIFFICULTY_ORDER[i - 1]];
      const cur = AI_PROFILES[DIFFICULTY_ORDER[i]];
      expect(cur.aggression).toBeGreaterThan(prev.aggression);
      expect(cur.waveSize[0]).toBeGreaterThanOrEqual(prev.waveSize[0]);
      expect(cur.thinkInterval).toBeLessThan(prev.thinkInterval);
      expect(cur.workerTarget[0]).toBeGreaterThan(prev.workerTarget[0]);
    }
  });
});

describe('התנהגות ה-AI', () => {
  it('שולח פועלים לאסוף משאבים מיד', () => {
    const { world, ai } = aiWorld('normal');
    run(world, ai, 6);
    const workers = world.entitiesOf(1).filter((e) => e.defId === 'jp_worker');
    const gathering = workers.filter(
      (w) => w.order.kind === 'gather' || w.order.kind === 'return' || w.order.kind === 'build',
    );
    expect(gathering.length).toBeGreaterThan(0);
  });

  it('אוסף משאבים ומגדיל את המלאי', () => {
    const { world, ai } = aiWorld('normal');
    const p = world.player(1)!;
    run(world, ai, 120);
    const gathered = p.stats.gathered.wood + p.stats.gathered.food;
    expect(gathered).toBeGreaterThan(0);
  });

  it('מאמן פועלים נוספים', () => {
    const { world, ai } = aiWorld('hard');
    const before = world.entitiesOf(1).filter((e) => e.defId === 'jp_worker').length;
    run(world, ai, 150);
    const after = world.entitiesOf(1).filter((e) => e.defId === 'jp_worker').length;
    expect(after).toBeGreaterThan(before);
  });

  it('בונה מבנים חדשים', () => {
    const { world, ai } = aiWorld('hard');
    run(world, ai, 180);
    const buildings = world.entitiesOf(1).filter((e) => e.kind === 'building');
    expect(buildings.length).toBeGreaterThan(1);
    expect(world.player(1)!.stats.buildingsBuilt).toBeGreaterThan(1);
  });

  it('מתקדם בשלבי הצמיחה', () => {
    const { world, ai } = aiWorld('insane');
    run(world, ai, 600, 1 / 12);
    expect(world.player(1)!.stage).toBeGreaterThanOrEqual(2);
  });

  it('בוחר ענף (סוג צבא) כשנפתח', () => {
    const { world, ai } = aiWorld('normal');
    const p = world.player(1)!;
    p.stage = 3;
    p.recomputeModifiers();
    run(world, ai, 10);
    expect(Object.keys(p.branchChoices)).toContain('clan');
  });

  it('מגיב להתקפה על הבסיס', () => {
    const { world, ai } = aiWorld('normal');
    run(world, ai, 30);
    const aiTc = world.townCenterOf(1)!;
    const attacker = world.spawnUnit('il_infantry', 0, {
      x: aiTc.pos.x + 6,
      y: aiTc.pos.y,
    })!;
    world.assignOrder(attacker, { kind: 'attack', targetId: aiTc.id });
    run(world, ai, 25);
    const defenders = world
      .entitiesOf(1)
      .filter((e) => e.kind === 'unit' && (e.order.kind === 'attack' || e.order.kind === 'attackMove'));
    expect(defenders.length).toBeGreaterThan(0);
  });

  it('שולח גל התקפה לעבר האויב', () => {
    const { world, ai } = aiWorld('insane');
    const p = world.player(1)!;
    p.resources = { food: 5000, wood: 5000, stone: 3000, gold: 3000 };
    run(world, ai, 420, 1 / 12);
    const army = world
      .entitiesOf(1)
      .filter((e) => e.kind === 'unit' && e.defId !== 'jp_worker');
    expect(army.length).toBeGreaterThan(0);
    // ה-AI אמור ללחוץ על השחקן: או שיחידותיו בדרך, או שכבר גרם נזק
    const advancing = army.filter(
      (u) => u.order.kind === 'attackMove' || u.order.kind === 'attack',
    );
    const human = world.player(0)!;
    const pressured =
      advancing.length > 0 ||
      human.stats.unitsLost > 0 ||
      world.townCenterOf(0) === null ||
      p.stats.kills > 0;
    expect(pressured).toBe(true);
  });

  it('לא נתקע ולא זורק שגיאות לאורך משחק ארוך', () => {
    const world = new World({
      seed: 101,
      map: { width: 96, height: 96 },
      players: [
        { id: 0, name: 'מחשב א', nationId: 'arabs', isAI: true, difficulty: 'hard' },
        { id: 1, name: 'מחשב ב', nationId: 'rome', isAI: true, difficulty: 'normal' },
        { id: 2, name: 'מחשב ג', nationId: 'egypt', isAI: true, difficulty: 'easy' },
      ],
    });
    const ai = new AiManager(world);
    expect(() => run(world, ai, 600, 1 / 10)).not.toThrow();
    for (const p of world.players) {
      expect(p.popUsed).toBeGreaterThan(0);
      expect(Number.isFinite(p.resources.food)).toBe(true);
    }
  });

  it('מידע ניפוי שגיאות זמין', () => {
    const c = new AiController(1, 'hard');
    expect(c.debugInfo().difficulty).toBe('hard');
  });
});

describe('אומת הויקינגים', () => {
  it('משחקת משחק שלם מול ישראל ומתקדמת בשלבים', () => {
    const world = new World({
      seed: 2211,
      map: { width: 96, height: 96, preset: 'fjords' },
      players: [
        { id: 0, name: 'ויקינגים', nationId: 'vikings', isAI: true, difficulty: 'hard', team: 0 },
        {
          id: 1,
          name: 'ישראל',
          nationId: 'israel',
          isAI: true,
          difficulty: 'normal',
          branchChoices: { settlement: 'moshav' },
          team: 1,
        },
      ],
    });
    const ai = new AiManager(world);
    for (let i = 0; i < 600 * 12; i++) {
      world.update(1 / 12);
      ai.update(world, 1 / 12);
      if (world.gameOver) break;
    }
    const vikings = world.player(0)!;
    expect(vikings.stats.gathered.wood).toBeGreaterThan(0);
    expect(vikings.stats.buildingsBuilt).toBeGreaterThan(0);
    expect(vikings.stage).toBeGreaterThanOrEqual(2);
  });

  it('הלונגהאוס הוא מבנה מגורים גדול, לא מבנה אימון', () => {
    const world = new World({
      seed: 4,
      map: { width: 64, height: 64 },
      players: [{ id: 0, name: 'ויקינגים', nationId: 'vikings' }],
    });
    const p = world.player(0)!;
    expect(p.canTrain('vk_bondi')).toBe(true);
    expect(p.canBuild('vk_longhouse')).toBe(true);
    expect(p.canTrain('vk_huscarl')).toBe(false); // נפתח רק בשלב 3

    p.resources = { food: 9999, wood: 9999, stone: 9999, gold: 9999 };
    const tc = world.townCenterOf(0)!;
    const spot = world.findPlacementNear('vk_longhouse', { x: tc.pos.x + 6, y: tc.pos.y }, 14)!;
    const capBefore = p.popCap;
    const hall = world.placeNear('vk_longhouse', 0, spot, 6)!;
    expect(hall).toBeTruthy();
    // הלונגהאוס מוסיף מקום לאנשים (popProvided) מיד עם השלמתו
    expect(p.popCap).toBe(capBefore + getBuilding('vk_longhouse').popProvided!);
    // הלונגהאוס נותן מקום לאנשים אבל אינו מאמן — אימון נעשה בקסרקטין
    expect(getBuilding('vk_longhouse').trains).toBeUndefined();
    expect(world.enqueueTrain(hall.id, 'vk_bondi')).toBe(false);
    expect(getBuilding('barracks').trains).toContain('vk_bondi');
  });

  it('הלונגהאוס מסווג כבית ולא כמבנה צבא (כדי שה-AI לא יציף יחידות)', () => {
    expect(roleOf(getBuilding('vk_longhouse'))).toBe('house');
    expect(roleOf(getBuilding('vk_mead_hall'))).toBe('house');
    expect(roleOf(getBuilding('vk_harbor'))).toBe('economy');
  });

  it('בחירת "דרך הסוחרים" פותחת נמל ומחזקת מסחר', () => {
    const world = new World({
      seed: 5,
      map: { width: 64, height: 64 },
      players: [{ id: 0, name: 'ויקינגים', nationId: 'vikings' }],
    });
    const p = world.player(0)!;
    p.stage = 3;
    p.applyStageUnlocks(3);
    const before = p.modifiers.tradeGoldMult ?? 1;
    p.chooseBranch('north', 'traders');
    expect(p.canBuild('vk_harbor')).toBe(true);
    expect(p.modifiers.tradeGoldMult).toBeGreaterThan(before);
  });
});
