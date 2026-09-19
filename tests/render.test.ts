import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import { hexToRgb, mix, shade } from '../src/render/iso';
import { archetypeOf } from '../src/render/art/structures';
import { lookFor, isVehicle } from '../src/render/art/appearance';
import { getBuilding, getUnit, DATA } from '../src/data';

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
