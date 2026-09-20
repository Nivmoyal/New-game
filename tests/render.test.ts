import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import {
  detailLevel,
  drawCastShadow,
  drawCastShadowEllipse,
  drawFacade,
  facePoint,
  hexToRgb,
  mix,
  shade,
  shadowScreenOffset,
} from '../src/render/iso';
import { GroundWear } from '../src/render/groundwear';
import { drawGroundProps } from '../src/render/art/nature';
import {
  DIRECTIONS,
  angleOfDirection,
  directionIndex,
  screenAngleOf,
} from '../src/render/art/people';
import { archetypeOf, drawStructure, paletteFor } from '../src/render/art/structures';
import { lookFor, isVehicle, isMotorised } from '../src/render/art/appearance';
import { allNations, getBuilding, getNation, getUnit, DATA } from '../src/data';
import { Effects } from '../src/render/effects';
import { World } from '../src/core/world';

/** הקשר ציור מזויף — האפקטים נבדקים על הלוגיקה, לא על הפיקסלים. */
function fakeCtx(): CanvasRenderingContext2D {
  const noop = () => {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (_t, prop) => {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop: noop });
      }
      return typeof prop === 'string' ? noop : undefined;
    },
    set: () => true,
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

function cam2(): Camera {
  const c = new Camera();
  c.setViewport(800, 600);
  c.setMapSize(64, 64);
  c.zoom = 48;
  c.centerOn(20, 20);
  return c;
}

function cam(): Camera {
  const c = new Camera();
  c.setViewport(800, 600);
  c.setMapSize(128, 128);
  c.zoom = 64;
  c.centerOn(40, 30);
  return c;
}

describe('מצלמה איזומטרית', () => {
  it('המרה הלוך ושוב בין עולם למסך משמרת את הנקודה', () => {
    const c = cam();
    for (const [x, y] of [[40, 30], [0, 0], [127, 127], [12.5, 88.25]]) {
      const s = c.worldToScreen(x, y, 0);
      const back = c.screenToWorld(s.x, s.y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('מרכז המצלמה ממופה למרכז התצוגה', () => {
    const c = cam();
    const s = c.worldToScreen(40, 30, 0);
    expect(s.x).toBeCloseTo(400, 6);
    expect(s.y).toBeCloseTo(300, 6);
  });

  it('אריח הוא מעוין ברוחב zoom ובגובה חצי מזה', () => {
    const c = cam();
    const o = c.worldToScreen(40, 30, 0);
    const right = c.worldToScreen(41, 30, 0); // +x → ימינה-מטה
    const left = c.worldToScreen(40, 31, 0); // +y → שמאלה-מטה
    expect(right.x - o.x).toBeCloseTo(c.zoom / 2, 6);
    expect(right.y - o.y).toBeCloseTo(c.zoom / 4, 6);
    expect(left.x - o.x).toBeCloseTo(-c.zoom / 2, 6);
    expect(left.y - o.y).toBeCloseTo(c.zoom / 4, 6);
  });

  it('גובה מרים את הנקודה כלפי מעלה בלבד', () => {
    const c = cam();
    const ground = c.worldToScreen(40, 30, 0);
    const up = c.worldToScreen(40, 30, 1);
    expect(up.x).toBeCloseTo(ground.x, 6);
    expect(ground.y - up.y).toBeCloseTo(c.zoom / 2, 6);
  });

  it('גבולות הראייה מכסים את פינות המסך', () => {
    const c = cam();
    const b = c.visibleBounds(0);
    for (const [sx, sy] of [[0, 0], [800, 0], [0, 600], [800, 600]]) {
      const w = c.screenToWorld(sx, sy);
      if (w.x >= 0 && w.x <= 127) expect(w.x).toBeGreaterThanOrEqual(b.minX - 1);
      if (w.y >= 0 && w.y <= 127) expect(w.y).toBeGreaterThanOrEqual(b.minY - 1);
    }
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
  });

  it('גרירה על המסך מזיזה את העולם בכיוון ההפוך', () => {
    const c = cam();
    const before = c.worldToScreen(40, 30, 0);
    c.panScreen(100, 0);
    const after = c.worldToScreen(40, 30, 0);
    expect(after.x).toBeCloseTo(before.x - 100, 4);
  });

  it('זום סביב נקודה משמר את הנקודה שמתחת לסמן', () => {
    const c = cam();
    const anchor = { x: 250, y: 180 };
    const worldBefore = c.screenToWorld(anchor.x, anchor.y);
    c.zoomAt(anchor.x, anchor.y, 1.5);
    const worldAfter = c.screenToWorld(anchor.x, anchor.y);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 1);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 1);
  });

  it('הזום מקובע לצעדים שלמים ונשאר בטווח', () => {
    const c = cam();
    for (let i = 0; i < 40; i++) c.zoomAt(400, 300, 0.9);
    expect(c.zoom).toBeGreaterThanOrEqual(c.minZoom);
    expect(c.zoom % 2).toBe(0);
    for (let i = 0; i < 60; i++) c.zoomAt(400, 300, 1.2);
    expect(c.zoom).toBeLessThanOrEqual(c.maxZoom);
  });
});

describe('עזרי צבע', () => {
  it('מפרק גם hex וגם rgb — פלט של shade חוזר לתוך shade', () => {
    expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('rgb(12,34,56)')).toEqual({ r: 12, g: 34, b: 56 });
    // הצללה כפולה חייבת להישאר צבע חוקי (באג שגרם למשטחים שחורים)
    const once = shade('#e6d3a8', -0.42);
    const twice = shade(once, -0.3);
    expect(twice).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(twice).not.toContain('NaN');
  });

  it('צבע לא חוקי נופל לאפור במקום ל-NaN', () => {
    expect(hexToRgb('לא-צבע')).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('הבהרה והכהיה פועלות לכיוונים הנכונים', () => {
    expect(hexToRgb(shade('#808080', 0.5)).r).toBeGreaterThan(128);
    expect(hexToRgb(shade('#808080', -0.5)).r).toBeLessThan(128);
  });

  it('מיזוג צבעים נותן ביניים', () => {
    expect(hexToRgb(mix('#000000', '#ffffff', 0.5)).r).toBeCloseTo(128, -1);
  });
});

describe('מראה מבנים ויחידות', () => {
  it('לכל מבנה בנתונים יש ארכיטיפ ציור', () => {
    for (const id of Object.keys(DATA.buildings)) {
      expect(() => archetypeOf(getBuilding(id)), id).not.toThrow();
      expect(archetypeOf(getBuilding(id)), id).toBeTruthy();
    }
  });

  it('מרכזי יישוב, מגדלים וחומות מזוהים נכון', () => {
    expect(archetypeOf(getBuilding('il_tc'))).toBe('townCenter');
    expect(archetypeOf(getBuilding('tower'))).toBe('tower');
    expect(archetypeOf(getBuilding('wall'))).toBe('wall');
    expect(archetypeOf(getBuilding('farm'))).toBe('farm');
    expect(archetypeOf(getBuilding('il_airdefense'))).toBe('radar');
  });

  it('לכל יחידה יש מראה — דמות או רכב', () => {
    for (const id of Object.keys(DATA.units)) {
      const look = lookFor(getUnit(id));
      expect(['person', 'vehicle'], id).toContain(look.kind);
      if (look.kind === 'person') expect(look.style.tool, id).toBeTruthy();
    }
  });

  it('כלי הרכב של ישראל מצוירים כרכבים', () => {
    for (const id of ['il_tank', 'il_apc', 'il_scout', 'il_drone', 'il_flak']) {
      expect(isVehicle(id), id).toBe(true);
      expect(lookFor(getUnit(id)).kind).toBe('vehicle');
    }
    expect(isVehicle('il_infantry')).toBe(false);
  });

  it('חיילי ישראל נושאים רובה ולא חרב', () => {
    for (const id of ['il_infantry', 'il_golani', 'il_commando', 'il_sniper']) {
      const look = lookFor(getUnit(id));
      expect(look.kind).toBe('person');
      if (look.kind === 'person') expect(look.style.tool, id).toBe('rifle');
    }
  });
});

describe('שמות צה"ל לזרוע הישראלית', () => {
  it('טנק מרכבה, נגמ"ש נמר וכיפת ברזל', () => {
    expect(getUnit('il_tank').name).toContain('מרכבה');
    expect(getUnit('il_apc').name).toContain('נמר');
    expect(getBuilding('il_airdefense').name).toBe('כיפת ברזל');
  });
});

describe('שפה אדריכלית לכל אומה', () => {
  it('לכל אומה סגנון גג וצבעים משלה', () => {
    const styles = new Map<string, string>();
    for (const n of allNations()) {
      const pal = paletteFor(n.id, '#ffffff');
      expect(pal.wall, n.id).toMatch(/^#/);
      expect(pal.roof, n.id).toMatch(/^#/);
      styles.set(n.id, pal.roofStyle);
    }
    // לפחות ארבעה סגנונות שונים בין שש האומות
    expect(new Set(styles.values()).size).toBeGreaterThanOrEqual(4);
    expect(styles.get('japan')).toBe('pagoda');
    expect(styles.get('arabs')).toBe('dome');
    expect(styles.get('egypt')).toBe('flat');
    expect(styles.get('vikings')).toBe('turf');
    expect(styles.get('rome')).toBe('hip');
  });

  it('אומה לא מוכרת נופלת לברירת מחדל במקום לקרוס', () => {
    expect(() => paletteFor('אין_כזו', '#fff')).not.toThrow();
    expect(paletteFor('אין_כזו', '#fff').roofStyle).toBeTruthy();
  });
});

describe('התפתחות טכנולוגית של ישראל', () => {
  it('המשחק מתחיל עם סייר רכוב ולא עם רכב ממונע', () => {
    const israel = getNation('israel');
    expect(israel.startingUnits).toContain('il_horse_scout');
    expect(israel.startingUnits).not.toContain('il_scout');
    for (const id of israel.startingUnits ?? []) {
      expect(isMotorised(id), `${id} ממונע בתחילת המשחק`).toBe(false);
    }
  });

  it('כלי רכב ממונעים נפתחים רק משלב 3', () => {
    const israel = getNation('israel');
    for (const stage of israel.stages) {
      for (const id of stage.unlocks?.units ?? []) {
        if (isMotorised(id)) {
          expect(stage.index, `${id} נפתח בשלב ${stage.index}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
    // גם יחידות הענפים הממונעות שייכות לשלב 3 ומעלה
    const army = (israel.branches ?? []).find((b) => b.id === 'army')!;
    expect(army.atStage).toBeGreaterThanOrEqual(3);
  });

  it('הסייר הרכוב מצויר כרוכב על סוס', () => {
    const look = lookFor(getUnit('il_horse_scout'));
    expect(look.kind).toBe('vehicle');
    if (look.kind === 'vehicle') expect(look.vehicle).toBe('horse');
    expect(isMotorised('il_horse_scout')).toBe(false);
  });

  it('כל הפרשים בכל האומות רכובים', () => {
    for (const id of Object.keys(DATA.units)) {
      const def = getUnit(id);
      if (def.class !== 'cavalry') continue;
      const look = lookFor(def);
      expect(look.kind, id).toBe('vehicle');
    }
  });
});

describe('אפקטים של קרב', () => {
  it('ירייה נוצרת ומתפוגגת אחרי זמן החיים שלה', () => {
    const fx = new Effects();
    const now = 1000;
    fx.shot('arrow', { x: 0, y: 0 }, { x: 5, y: 0 }, now);
    expect(fx.count).toBe(1);
    const ctx = fakeCtx();
    const cam = cam2();
    fx.render(ctx, cam, now + 50);
    expect(fx.count).toBe(1);
    fx.render(ctx, cam, now + 60_000);
    expect(fx.count).toBe(0);
  });

  it('פגיעה כבדה מוסיפה פיצוץ וענני עשן', () => {
    const fx = new Effects();
    fx.impact({ x: 2, y: 2 }, 0, true);
    expect(fx.count).toBeGreaterThan(1);
  });

  it('מספר האפקטים חסום כדי לא להעמיס', () => {
    const fx = new Effects();
    for (let i = 0; i < 2000; i++) fx.work({ x: i, y: i }, 0);
    expect(fx.count).toBeLessThanOrEqual(400);
  });

  it('קרב אמיתי מייצר דיווחי ירי ופגיעה', () => {
    const world = new World({
      seed: 21,
      map: { width: 48, height: 48 },
      revealAll: true,
      players: [
        { id: 0, name: 'א', nationId: 'israel', team: 0 },
        { id: 1, name: 'ב', nationId: 'japan', team: 1 },
      ],
    });
    const shooter = world.spawnUnit('il_rifleman', 0, { x: 24, y: 24 })!;
    const target = world.spawnUnit('jp_ashigaru', 1, { x: 27, y: 24 })!;
    world.assignOrder(shooter, { kind: 'attack', targetId: target.id });
    let shots = 0;
    let hits = 0;
    for (let i = 0; i < 600 && target.alive; i++) {
      world.update(1 / 30);
      for (const c of world.drainCombat()) {
        if (c.type === 'shot') shots++;
        if (c.type === 'hit') hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(0);
  });

  it('איסוף משאבים מייצר ניצוצות עבודה', () => {
    const world = new World({
      seed: 22,
      map: { width: 48, height: 48 },
      players: [{ id: 0, name: 'א', nationId: 'israel', branchChoices: { settlement: 'kibbutz' } }],
    });
    const tc = world.townCenterOf(0)!;
    const worker = world.entitiesOf(0).find((e) => e.defId === 'il_worker')!;
    const tile = world.findResourceTile(tc.pos, 'wood', 25)!;
    world.assignOrder(worker, { kind: 'gather', tile, resource: 'wood' });
    let work = 0;
    for (let i = 0; i < 2000; i++) {
      world.update(1 / 30);
      for (const c of world.drainCombat()) if (c.type === 'work') work++;
    }
    expect(work).toBeGreaterThan(0);
  });
});

/** הקשר ציור שמתעד קודקודים וקריאות מילוי — לבדיקת גאומטריית הצללים. */
function recordCtx() {
  const pts: { x: number; y: number }[] = [];
  let fills = 0;
  let ellipses = 0;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    translate() {},
    rotate() {},
    moveTo(x: number, y: number) {
      pts.push({ x, y });
    },
    lineTo(x: number, y: number) {
      pts.push({ x, y });
    },
    ellipse() {
      ellipses++;
    },
    arc() {
      ellipses++;
    },
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    rect() {},
    fillRect() {
      fills++;
    },
    strokeRect() {},
    clip() {},
    scale() {},
    setTransform() {},
    drawImage() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
    fill() {
      fills++;
    },
    stroke() {},
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    pts,
    get fills() {
      return fills;
    },
    get ellipses() {
      return ellipses;
    },
  };
}

describe('כיווני פנייה', () => {
  it('זווית המסך תואמת את ההיטל האיזומטרי בפועל', () => {
    const cam = cam2();
    for (let i = 0; i < 16; i++) {
      const facing = (i / 16) * Math.PI * 2;
      const a = cam.worldToScreen(10, 10, 0);
      const b = cam.worldToScreen(10 + Math.cos(facing), 10 + Math.sin(facing), 0);
      const actual = Math.atan2(b.y - a.y, b.x - a.x);
      const expected = screenAngleOf(facing);
      // הפרש זוויתי מחזורי
      const diff = Math.abs(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)));
      expect(diff).toBeLessThan(1e-9);
    }
  });

  it('שמונה כיווני עולם שונים ממופים לשמונה אינדקסים שונים', () => {
    const seen = new Set<number>();
    for (let i = 0; i < DIRECTIONS; i++) {
      // כיווני העולם מוסטים ב-45° כדי ליפול במרכזי הסקטורים של המסך
      const facing = (i / DIRECTIONS) * Math.PI * 2 + Math.PI / 4;
      seen.add(directionIndex(screenAngleOf(facing)));
    }
    expect(seen.size).toBe(DIRECTIONS);
  });

  it('מיפוי הכיוונים מחזורי ויציב בהלוך-ושוב', () => {
    for (let d = 0; d < DIRECTIONS; d++) {
      expect(directionIndex(angleOfDirection(d))).toBe(d);
      expect(directionIndex(angleOfDirection(d) + Math.PI * 2)).toBe(d);
      expect(directionIndex(angleOfDirection(d) - Math.PI * 2)).toBe(d);
    }
    expect(directionIndex(-0.001)).toBe(0);
    expect(directionIndex(Math.PI * 2 - 0.001)).toBe(0);
  });
});

describe('צללים מוטלים', () => {
  it('הצל נופל שמאלה-מטה על המסך', () => {
    const cam = cam2();
    const off = shadowScreenOffset(cam);
    expect(off.x).toBeLessThan(0);
    expect(off.y).toBeGreaterThan(0);
  });

  it('גוף ללא גובה אינו מטיל צל', () => {
    const r = recordCtx();
    drawCastShadow(r.ctx, cam2(), 10, 10, 1, 1, 0);
    expect(r.fills).toBe(0);
  });

  it('הצל מתארך מעבר לטביעת הרגל בכיוון השמש', () => {
    const cam = cam2();
    const foot = recordCtx();
    drawCastShadow(foot.ctx, cam, 10, 10, 2, 2, 0.05);
    const tall = recordCtx();
    drawCastShadow(tall.ctx, cam, 10, 10, 2, 2, 1.4);
    expect(tall.fills).toBe(1);
    const minX = (pts: { x: number }[]) => Math.min(...pts.map((p) => p.x));
    const maxY = (pts: { y: number }[]) => Math.max(...pts.map((p) => p.y));
    expect(minX(tall.pts)).toBeLessThan(minX(foot.pts));
    expect(maxY(tall.pts)).toBeGreaterThan(maxY(foot.pts));
    // גוף גבוה יותר מטיל צל ארוך יותר
    const taller = recordCtx();
    drawCastShadow(taller.ctx, cam, 10, 10, 2, 2, 2.8);
    expect(minX(taller.pts)).toBeLessThan(minX(tall.pts));
  });

  it('צל הדמות מצויר כאליפסה מסובבת', () => {
    const r = recordCtx();
    drawCastShadowEllipse(r.ctx, cam2(), 10, 10, 0.22, 0.8);
    expect(r.ellipses).toBe(1);
    expect(r.fills).toBe(1);
  });
});

describe('פירוט פני שטח', () => {
  it('רמת הפירוט עולה עם הזום', () => {
    const cam = cam2();
    cam.zoom = 20;
    expect(detailLevel(cam)).toBe(0);
    cam.zoom = 40;
    expect(detailLevel(cam)).toBe(1);
    cam.zoom = 70;
    expect(detailLevel(cam)).toBe(2);
  });

  it('נקודה על פאה: u רץ לאורך הפאה ו-v מהקרקע לגג', () => {
    const cam = cam2();
    const ground = facePoint(cam, 10, 10, 2, 2, 1, 'left', 0, 0);
    const top = facePoint(cam, 10, 10, 2, 2, 1, 'left', 0, 1);
    // v=1 הוא גובה המבנה — גבוה יותר על המסך
    expect(top.y).toBeLessThan(ground.y);
    expect(top.x).toBeCloseTo(ground.x, 6);
    // u=1 על הפאה השמאלית הוא הפינה בקצה ציר x
    const far = facePoint(cam, 10, 10, 2, 2, 1, 'left', 1, 0);
    expect(far).toEqual(cam.worldToScreen(12, 12, 0));
    // הפאה הימנית רצה לאורך ציר y
    expect(facePoint(cam, 10, 10, 2, 2, 1, 'right', 1, 0)).toEqual(cam.worldToScreen(12, 12, 0));
  });

  it('בזום נמוך לא מצוירים פרטי קיר כלל', () => {
    const cam = cam2();
    cam.zoom = 20;
    const r = recordCtx();
    drawFacade(r.ctx, cam, 10, 10, 2, 2, 0.5, '#e8dfc8', { windows: 3, door: true, courses: 4 });
    expect(r.fills).toBe(0);
  });

  it('בזום גבוה מצוירים חלונות בשתי הפאות ודלת אחת', () => {
    const cam = cam2();
    cam.zoom = 70;
    const plain = recordCtx();
    drawFacade(plain.ctx, cam, 10, 10, 2, 2, 0.5, '#e8dfc8', { windows: 2 });
    // שני חלונות בכל פאה, וכל חלון מקבל גם אדן ברמת פירוט 2
    expect(plain.fills).toBe(8);
    const withDoor = recordCtx();
    drawFacade(withDoor.ctx, cam, 10, 10, 2, 2, 0.5, '#e8dfc8', { windows: 2, door: true });
    expect(withDoor.fills).toBe(10);
  });

  it('לכל אומה יש מרקם קיר משלה', () => {
    const textures = new Set(allNations().map((n) => paletteFor(n.id, '#fff').texture));
    expect(textures.size).toBeGreaterThan(1);
    expect(paletteFor('vikings', '#fff').texture).toBe('wood');
    expect(paletteFor('rome', '#fff').texture).toBe('stone');
  });

  it('פרטי קרקע לא מצוירים על מים או על שביל שנשחק', () => {
    const cam = cam2();
    cam.zoom = 70;
    const water = recordCtx();
    drawGroundProps(water.ctx, cam, 10, 10, 'water', false);
    expect(water.fills + water.pts.length).toBe(0);
    const worn = recordCtx();
    drawGroundProps(worn.ctx, cam, 10, 10, 'grass', true);
    expect(worn.fills + worn.pts.length).toBe(0);
  });
});

describe('שחיקת קרקע', () => {
  it('אריח שעוברים בו מספיק הופך לשביל, ורק פעם אחת', () => {
    const world = new World({
      seed: 31,
      map: { width: 48, height: 48 },
      players: [{ id: 0, name: 'א', nationId: 'israel', branchChoices: { settlement: 'kibbutz' } }],
    });
    const tc = world.townCenterOf(0)!;
    const worker = world.entitiesOf(0).find((e) => e.defId === 'il_worker')!;
    const a = { x: tc.pos.x + 6, y: tc.pos.y + 6 };
    const b = { x: tc.pos.x - 2, y: tc.pos.y - 2 };

    // מעבר יחיד לא שוחק אריח — שביל נוצר רק מתנועה חוזרת על אותו קו
    const wear = new GroundWear();
    const worn: string[] = [];
    for (let trip = 0; trip < 8; trip++) {
      world.assignOrder(worker, { kind: 'move', target: trip % 2 === 0 ? a : b });
      for (let i = 0; i < 300; i++) {
        world.update(1 / 30);
        for (const t of wear.step(world, 1 / 30)) worn.push(`${t.x},${t.y}`);
        if (worker.unit!.path.length === 0 && i > 5) break;
      }
    }
    expect(worn.length).toBeGreaterThan(0);
    // אין כפילויות — אריח נשחק פעם אחת בלבד
    expect(new Set(worn).size).toBe(worn.length);
    const [x, y] = worn[0].split(',').map(Number);
    expect(wear.isWorn(x, y)).toBe(true);
    expect(wear.isWorn(0, 0)).toBe(false);
    // מחוץ לגבולות המפה אינו קורס
    expect(wear.isWorn(-1, 5)).toBe(false);
    expect(wear.isWorn(999, 5)).toBe(false);
  });

  it('יחידה שעומדת במקום אינה שוחקת את הקרקע', () => {
    const world = new World({
      seed: 32,
      map: { width: 32, height: 32 },
      players: [{ id: 0, name: 'א', nationId: 'israel', branchChoices: { settlement: 'kibbutz' } }],
    });
    const wear = new GroundWear();
    let worn = 0;
    for (let i = 0; i < 200; i++) {
      world.update(1 / 30);
      worn += wear.step(world, 1 / 30).length;
    }
    expect(worn).toBe(0);
  });
});

describe('זהות חזותית למבנים', () => {
  it('לכל תפקיד יש ארכיטיפ ציור משלו — אין שני תפקידים שונים שנראים אותו דבר', () => {
    const arch = (id: string) => archetypeOf(getBuilding(id));
    // כלכלה: טחנה, מחנה עצים ומחנה כרייה היו זהים בעבר
    expect(arch('mill')).not.toBe(arch('lumber_camp'));
    expect(arch('lumber_camp')).not.toBe(arch('mining_camp'));
    expect(arch('mill')).not.toBe(arch('mining_camp'));
    expect(arch('eg_granary')).not.toBe(arch('mill'));
    // צבא: חי"ר, קשתים, פרשים, מצור ונפחייה — כל אחד בנפרד
    const military = ['barracks', 'archery_range', 'stable', 'siege_workshop', 'blacksmith']
      .map(arch);
    expect(new Set(military).size).toBe(military.length);
    // מוסדות
    expect(arch('academy')).toBe('university');
    expect(arch('il_school')).toBe('university');
    expect(arch('academy')).not.toBe(arch('temple'));
    expect(arch('il_exchange')).not.toBe(arch('market'));
    expect(arch('il_factory')).not.toBe(arch('il_hightech'));
    expect(arch('il_watertower')).not.toBe(arch('tower'));
    expect(arch('rm_aqueduct')).not.toBe(arch('eg_obelisk'));
    expect(arch('il_military_base')).not.toBe(arch('barracks'));
  });

  it('כל מבנה בנתונים מקבל ארכיטיפ מוכר', () => {
    const known = new Set<string>();
    for (const id of Object.keys(DATA.buildings)) known.add(archetypeOf(getBuilding(id)));
    // לפחות 25 מראות שונים בפועל
    expect(known.size).toBeGreaterThanOrEqual(25);
  });

  it('ציור מבנה בכל שלב לא זורק שגיאה ומשנה את התוצאה', () => {
    const cam = cam2();
    cam.zoom = 70;
    const pal = paletteFor('israel', '#4a76c2');
    for (const id of Object.keys(DATA.buildings)) {
      const def = getBuilding(id);
      const a = archetypeOf(def);
      const counts: number[] = [];
      for (const stage of [1, 2, 3, 4]) {
        const r = recordCtx();
        expect(() => {
          drawStructure(r.ctx, cam, a, 10, 10, def.size, pal, {
            stage, time: 500, seed: 2, icon: true,
            links: { n: false, e: true, s: false, w: true },
          });
        }, `${id} שלב ${stage}`).not.toThrow();
        counts.push(r.fills + r.pts.length);
      }
      // המבנה מתפתח: שלב 4 מצויר מעשיר יותר משלב 1
      expect(counts[3], `${id} אמור להתפתח עם השלב`).toBeGreaterThanOrEqual(counts[0]);
      expect(counts[0], `${id} אמור להיות מצויר בכלל`).toBeGreaterThan(0);
    }
  });
});
