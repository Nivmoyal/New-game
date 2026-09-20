import type { BuildingDef } from '../../data/schema';
import type { Camera } from '../camera';
import {
  detailLevel, drawBox, drawCastShadow, drawColumn, drawDomeRoof, drawFacade, drawFlag,
  drawGableRoof, drawHipRoof, drawRoof, faceColors, mix, poly, shade, tileDiamond,
  type RoofStyle,
} from '../iso';
import { drawFarmField, tileHash } from './nature';

/**
 * מבנים תלת-ממדיים מצוירים פרוצדורלית.
 *
 * לכל תפקיד יש ארכיטיפ ציור משלו, כך שאפשר לזהות מבנה לפי הצללית
 * בלבד: לאורווה יש מכלאה וערמות חציר, למטווח יש מטרות קש, לנפחייה יש
 * ארובה ולהט מהכבשן, ולאוניברסיטה יש כיפה ועמודים. מבנה חדש שנוסף
 * ל-JSON מקבל ארכיטיפ סביר אוטומטית לפי תפקידו בנתונים.
 *
 * כל מבנה גם **מתפתח עם היישוב**: ככל שהשחקן מתקדם בשלבים המבנה
 * מתרומם, מקבל בסיס אבן, אגפים נוספים, ארובות ודגלים. זה אותו מבנה,
 * בגרסה עשירה יותר.
 */

export type Archetype =
  | 'townCenter'
  | 'house'
  | 'longhouse'
  | 'farm'
  | 'mill'
  | 'granary'
  | 'lumberCamp'
  | 'miningCamp'
  | 'barracks'
  | 'range'
  | 'stable'
  | 'siegeWorkshop'
  | 'blacksmith'
  | 'militaryBase'
  | 'tower'
  | 'waterTower'
  | 'wall'
  | 'gate'
  | 'castle'
  | 'market'
  | 'exchange'
  | 'temple'
  | 'university'
  | 'monument'
  | 'aqueduct'
  | 'factory'
  | 'highTech'
  | 'radar'
  | 'hospital'
  | 'port';

const BY_ID: Record<string, Archetype> = {
  house: 'house',
  farm: 'farm',
  mill: 'mill',
  eg_granary: 'granary',
  lumber_camp: 'lumberCamp',
  mining_camp: 'miningCamp',
  barracks: 'barracks',
  rm_castrum: 'barracks',
  il_military_base: 'militaryBase',
  archery_range: 'range',
  stable: 'stable',
  siege_workshop: 'siegeWorkshop',
  blacksmith: 'blacksmith',
  vk_forge: 'blacksmith',
  market: 'market',
  ar_bazaar: 'market',
  il_exchange: 'exchange',
  temple: 'temple',
  jp_shrine: 'temple',
  rm_forum: 'temple',
  academy: 'university',
  il_school: 'university',
  ar_wisdom_house: 'university',
  tower: 'tower',
  il_watertower: 'waterTower',
  wall: 'wall',
  gate: 'gate',
  fortress: 'castle',
  jp_castle: 'castle',
  il_dining_hall: 'longhouse',
  jp_dojo: 'longhouse',
  ar_caravanserai: 'longhouse',
  vk_longhouse: 'longhouse',
  vk_mead_hall: 'longhouse',
  il_factory: 'factory',
  il_hightech: 'highTech',
  il_airdefense: 'radar',
  il_hospital: 'hospital',
  rm_aqueduct: 'aqueduct',
  eg_obelisk: 'monument',
  eg_pyramid: 'monument',
  vk_harbor: 'port',
  dock: 'port',
};

export function archetypeOf(def: BuildingDef): Archetype {
  const direct = BY_ID[def.id];
  if (direct) return direct;
  if (def.gate) return 'gate';
  if (def.shore) return 'port';
  if (def.isTownCenter) return 'townCenter';
  if (def.attack && def.range) return 'tower';
  if (def.trains?.length) return 'barracks';
  if (def.popProvided) return 'house';
  if (def.dropOff) return 'mill';
  if (def.researches?.length) return 'university';
  if (def.trickle) return 'market';
  return 'house';
}

/** מרקם הקיר — קובע אם רואים נדבכי אבן, קרשים או טיח חלק. */
export type WallTexture = 'plaster' | 'stone' | 'wood' | 'mud';

export type StructurePalette = {
  wall: string;
  roof: string;
  trim: string;
  owner: string;
  /** השפה האדריכלית של האומה */
  roofStyle: RoofStyle;
  /** מרקם הקיר של האומה */
  texture: WallTexture;
};

/** לוחות צבע לפי אומה — נותן לכל צד מראה משלו. */
const NATION_PALETTE: Record<string, Omit<StructurePalette, 'owner'>> = {
  // טיח בהיר וגגות רעפי חרס
  israel: { wall: '#ded5c0', roof: '#a85a46', trim: '#93a0ab', roofStyle: 'gable', texture: 'plaster' },
  // גגות פגודה רחבים בשתי שכבות, קירות עץ בהירים
  japan: { wall: '#d9cdb5', roof: '#46505d', trim: '#89453c', roofStyle: 'pagoda', texture: 'wood' },
  // כיפות על גגות שטוחים וקירות חימר
  arabs: { wall: '#ddcaa3', roof: '#cbb489', trim: '#4b7c78', roofStyle: 'dome', texture: 'mud' },
  // רעפי חרס על גג ארבע-שיפועים, קירות שיש
  rome: { wall: '#e5ddcd', roof: '#a35a48', trim: '#c0ad82', roofStyle: 'hip', texture: 'stone' },
  // גגות שטוחים עם מעקה, אבן חול
  egypt: { wall: '#d4c097', roof: '#c2ae86', trim: '#4e7f96', roofStyle: 'flat', texture: 'stone' },
  // גגות דשא תלולים על קירות עץ
  vikings: { wall: '#836848', roof: '#57684b', trim: '#6e7e88', roofStyle: 'turf', texture: 'wood' },
};

/** לאילו שכנים החומה מתחברת. */
export type WallLinks = { n: boolean; e: boolean; s: boolean; w: boolean };

const NO_LINKS: WallLinks = { n: false, e: false, s: false, w: false };

export function paletteFor(nationId: string, ownerColor: string): StructurePalette {
  const p = NATION_PALETTE[nationId] ?? NATION_PALETTE.israel;
  return { ...p, owner: ownerColor };
}

/** גובה משוער לכל ארכיטיפ — משמש לחישוב אורך הצל המוטל. */
const SHADOW_HEIGHT: Record<Archetype, number> = {
  townCenter: 1.15, house: 0.7, longhouse: 0.78, farm: 0.3,
  mill: 0.9, granary: 0.95, lumberCamp: 0.5, miningCamp: 0.5,
  barracks: 0.8, range: 0.6, stable: 0.68, siegeWorkshop: 0.7,
  blacksmith: 0.85, militaryBase: 0.8,
  tower: 1.2, waterTower: 1.3, wall: 0.75, gate: 1.0, castle: 1.4,
  market: 0.6, exchange: 0.9, temple: 0.95, university: 1.05,
  monument: 1.2, aqueduct: 1.25, factory: 0.9, highTech: 1.1, radar: 0.85, hospital: 0.72, port: 0.62,
};

/** ארגומנטים משותפים לכל ארכיטיפ ציור. */
type Args = {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  /** תיבת המבנה הפנימית (אחרי שוליים) */
  x: number;
  y: number;
  s: number;
  /** טביעת הרגל המלאה */
  wx: number;
  wy: number;
  size: number;
  pal: StructurePalette;
  /** שלב הצמיחה של הבעלים (1..4) */
  stage: number;
  time: number;
  seed: number;
  links: WallLinks;
  gateOpen: boolean;
  waterSide: 'n' | 's' | 'e' | 'w';
};

/** רמת המבנה 1..4. */
function lvl(stage: number): number {
  return Math.max(1, Math.min(4, Math.round(stage)));
}

/** גובה שגדל עם השלב — אותו מבנה, גרסה מפוארת יותר. */
function grow(stage: number, base: number, step = 0.1): number {
  return base * (1 + (lvl(stage) - 1) * step);
}

/** האם לצייר פרטים קטנים (חביות, כלים) — מדולג בזום נמוך. */
function props(a: Args): boolean {
  return detailLevel(a.cam) >= 1;
}

// ===== עזרים משותפים =====

/**
 * מרקם הקיר והפתחים על תיבה שכבר צוירה.
 * מתרגם את מרקם האומה לנדבכים או לקרשים, ומוסיף חלונות ודלת.
 */
function facade(
  a: Args,
  x: number, y: number, w: number, d: number, h: number,
  wallColor: string,
  opts: { windows?: number; windowRows?: number; door?: boolean; lit?: boolean; seed?: number; baseZ?: number } = {},
): void {
  drawFacade(a.ctx, a.cam, x, y, w, d, h, wallColor, {
    courses: a.pal.texture === 'stone' ? 4 : a.pal.texture === 'mud' ? 3 : 0,
    planks: a.pal.texture === 'wood' ? Math.max(3, Math.round(w * 3.5)) : 0,
    seed: a.seed,
    ...opts,
  });
}

/**
 * רחבת עפר כבוש סביב המבנה — מקשרת אותו לקרקע.
 */
function apron(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, s: number, color: string): void {
  const earth = mix(color, '#6b5c46', 0.86);
  drawBox(ctx, cam, x - 0.1, y - 0.1, s + 0.2, s + 0.2, 0.025, faceColors(earth));
}

/**
 * צל מגע: כתם כהה רך בדיוק מתחת לגוף.
 * להבדיל מהצל המוטל (שנופל לכיוון השמש), זה מה שגורם למבנה
 * "לשבת" על הקרקע ולא לרחף מעליה.
 */
function contactShade(
  ctx: CanvasRenderingContext2D, cam: Camera,
  x: number, y: number, w: number, d: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.16;
  poly(ctx, tileDiamond(cam, x - 0.14, y - 0.14, w + 0.28, d + 0.28, 0.005), '#20180f');
  ctx.globalAlpha = 0.14;
  poly(ctx, tileDiamond(cam, x - 0.05, y - 0.05, w + 0.1, d + 0.1, 0.008), '#20180f');
  ctx.restore();
}

/** בסיס אבן נמוך — מופיע משלב 3, ומרים את המבנה כולו. */
function plinth(a: Args, x: number, y: number, w: number, d: number): number {
  if (lvl(a.stage) < 3) return 0;
  const h = 0.09;
  drawBox(a.ctx, a.cam, x - 0.06, y - 0.06, w + 0.12, d + 0.12, h, faceColors(mix(a.pal.wall, '#8d8478', 0.55)));
  return h;
}

/** תמרות עשן מארובה. */
function smoke(a: Args, x: number, y: number, z: number, scale = 1, puffs = 3): void {
  const t0 = (a.time * 0.0006) % 1;
  for (let i = 0; i < puffs; i++) {
    const t = (t0 + i / puffs) % 1;
    const p = a.cam.worldToScreen(x + t * 0.24 * scale, y - t * 0.2 * scale, z + t * 0.7 * scale);
    a.ctx.fillStyle = `rgba(196,198,202,${0.26 * (1 - t)})`;
    a.ctx.beginPath();
    a.ctx.arc(p.x, p.y, a.cam.zoom * (0.045 + t * 0.085) * scale, 0, Math.PI * 2);
    a.ctx.fill();
  }
}

/** ארגז / חבית. */
function crate(a: Args, x: number, y: number, s = 0.2, h = 0.16, color = '#8a6a3f'): void {
  drawBox(a.ctx, a.cam, x, y, s, s, h, faceColors(color));
}

/** ערמת בולי עץ שוכבים. */
function logPile(a: Args, x: number, y: number, len: number, rows = 2, alongX = true): void {
  for (let r = 0; r < rows; r++) {
    const n = rows - r;
    for (let i = 0; i < n; i++) {
      const off = (i + r * 0.5) * 0.13;
      if (alongX) {
        drawBox(a.ctx, a.cam, x, y + off, len, 0.12, 0.12, faceColors(r % 2 ? '#8a6a44' : '#7a5c3a'), r * 0.11);
      } else {
        drawBox(a.ctx, a.cam, x + off, y, 0.12, len, 0.12, faceColors(r % 2 ? '#8a6a44' : '#7a5c3a'), r * 0.11);
      }
    }
  }
}

/** ערמת חציר. */
function haystack(a: Args, x: number, y: number, r = 0.18): void {
  drawColumn(a.ctx, a.cam, x, y, r, 0.22, '#c8ad62');
  const p = a.cam.worldToScreen(x, y, 0.22);
  a.ctx.fillStyle = '#d8bd72';
  a.ctx.beginPath();
  a.ctx.ellipse(p.x, p.y, a.cam.zoom * r * 0.95, a.cam.zoom * r * 0.5, 0, 0, Math.PI * 2);
  a.ctx.fill();
}

/** גדר מוטות סביב מלבן. */
function fence(a: Args, x: number, y: number, w: number, d: number, h = 0.2, color = '#8a6b47'): void {
  const posts: Array<[number, number]> = [];
  const stepX = w / Math.max(1, Math.round(w / 0.45));
  const stepY = d / Math.max(1, Math.round(d / 0.45));
  for (let t = 0; t <= w + 1e-6; t += stepX) {
    posts.push([x + t, y], [x + t, y + d]);
  }
  for (let t = stepY; t <= d - stepY + 1e-6; t += stepY) {
    posts.push([x, y + t], [x + w, y + t]);
  }
  for (const [px, py] of posts) drawColumn(a.ctx, a.cam, px, py, 0.035, h, color);
  a.ctx.strokeStyle = shade(color, -0.1);
  a.ctx.lineWidth = Math.max(1, a.cam.zoom * 0.022);
  for (const z of [h * 0.55, h * 0.95]) {
    a.ctx.beginPath();
    const c = [
      a.cam.worldToScreen(x, y, z), a.cam.worldToScreen(x + w, y, z),
      a.cam.worldToScreen(x + w, y + d, z), a.cam.worldToScreen(x, y + d, z),
    ];
    c.forEach((p, i) => (i === 0 ? a.ctx.moveTo(p.x, p.y) : a.ctx.lineTo(p.x, p.y)));
    a.ctx.closePath();
    a.ctx.stroke();
  }
}

/** מתלה נשק: מוטות אנכיים בשורה. */
function weaponRack(a: Args, x: number, y: number, n: number, color = '#b9b3a4', tipColor = '#8d8577'): void {
  drawBox(a.ctx, a.cam, x - 0.04, y - 0.04, 0.08 + n * 0.11, 0.1, 0.1, faceColors('#6b4a2f'));
  for (let i = 0; i < n; i++) {
    const px = x + i * 0.11;
    drawColumn(a.ctx, a.cam, px, y, 0.018, 0.42, color, 0.08);
    const tip = a.cam.worldToScreen(px, y, 0.5);
    a.ctx.fillStyle = tipColor;
    a.ctx.beginPath();
    a.ctx.arc(tip.x, tip.y, Math.max(1, a.cam.zoom * 0.025), 0, Math.PI * 2);
    a.ctx.fill();
  }
}

/** מגן עגול תלוי על הקיר. */
function shieldOnWall(a: Args, x: number, y: number, z: number, color: string): void {
  const p = a.cam.worldToScreen(x, y, z);
  const r = a.cam.zoom * 0.085;
  a.ctx.fillStyle = color;
  a.ctx.beginPath();
  a.ctx.ellipse(p.x, p.y, r * 0.75, r, 0, 0, Math.PI * 2);
  a.ctx.fill();
  a.ctx.fillStyle = shade(color, -0.35);
  a.ctx.beginPath();
  a.ctx.ellipse(p.x, p.y, r * 0.26, r * 0.34, 0, 0, Math.PI * 2);
  a.ctx.fill();
}

// ===== ארכיטיפים: מגורים וכלכלה =====

function drawTownCenter(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.42));
  const body = a.s * 0.62;
  const ox = a.x + (a.s - body) / 2;
  const oy = a.y + (a.s - body) / 2;
  const base = plinth(a, ox, oy, body, body);
  const h = grow(a.stage, 0.6, 0.14);
  drawBox(a.ctx, a.cam, ox, oy, body, body, h, faceColors(pal.wall), base);
  facade(a, ox, oy, body, body, h, pal.wall, {
    windows: 2 + level, windowRows: level >= 3 ? 2 : 1, door: true, lit: true, baseZ: base,
  });
  drawRoof(pal.roofStyle, a.ctx, a.cam, ox, oy, body, body, base + h, 0.3 + level * 0.06, pal.roof);

  // אגפים נמוכים — היישוב "גדל" עם השלב
  const wing = a.s * 0.26;
  drawBox(a.ctx, a.cam, a.x, oy + body * 0.15, wing, body * 0.7, 0.34, faceColors(shade(pal.wall, -0.08)), base);
  drawGableRoof(a.ctx, a.cam, a.x, oy + body * 0.15, wing, body * 0.7, base + 0.34, 0.16, pal.roof, false);
  if (level >= 2) {
    drawBox(a.ctx, a.cam, a.x + a.s - wing, oy + body * 0.15, wing, body * 0.7, 0.34, faceColors(shade(pal.wall, -0.08)), base);
    drawGableRoof(a.ctx, a.cam, a.x + a.s - wing, oy + body * 0.15, wing, body * 0.7, base + 0.34, 0.16, pal.roof, false);
  }
  if (level >= 3) {
    drawColumn(a.ctx, a.cam, ox + body * 0.5, oy + body * 0.5, 0.16, 0.55, shade(pal.wall, 0.1), base + h);
  }
  drawFlag(a.ctx, a.cam, ox + body * 0.5, oy + body * 0.5, base + h + (level >= 3 ? 0.55 : 0.3), 0.5, pal.owner, a.time);
}

function drawSimpleHouse(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  const along = tileHash(Math.round(a.x), Math.round(a.y), a.seed) > 0.5;
  const base = plinth(a, a.x, a.y, a.s, a.s);
  const h = grow(a.stage, 0.4, 0.16);
  drawBox(a.ctx, a.cam, a.x, a.y, a.s, a.s, h, faceColors(pal.wall), base);
  facade(a, a.x, a.y, a.s, a.s, h, pal.wall, {
    windows: level >= 3 ? 3 : 2, windowRows: level >= 3 ? 2 : 1, door: true, lit: true, baseZ: base,
  });
  drawRoof(pal.roofStyle, a.ctx, a.cam, a.x, a.y, a.s, a.s, base + h, 0.28 + level * 0.03, pal.roof, along);
  // ארובה מעשנת מבית משלב 2
  if (level >= 2) {
    const cx = a.x + a.s * 0.72;
    const cy = a.y + a.s * 0.28;
    drawBox(a.ctx, a.cam, cx, cy, 0.14, 0.14, 0.3, faceColors(mix(pal.wall, '#7a6a5a', 0.6)), base + h);
    if (props(a)) smoke(a, cx + 0.07, cy + 0.07, base + h + 0.3, 0.7, 2);
  }
}

function drawLonghouse(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  const w = a.s;
  const d = a.s * 0.62;
  const oy = a.y + (a.s - d) / 2;
  const base = plinth(a, a.x, oy, w, d);
  const h = grow(a.stage, 0.36, 0.12);
  drawBox(a.ctx, a.cam, a.x, oy, w, d, h, faceColors(pal.wall), base);
  facade(a, a.x, oy, w, d, h, pal.wall, { windows: 2 + level, door: true, lit: true, baseZ: base });
  drawRoof(pal.roofStyle, a.ctx, a.cam, a.x, oy, w, d, base + h, 0.42, pal.roof, true);
  // עמודי תמך
  for (let i = 0; i <= 3; i++) {
    drawColumn(a.ctx, a.cam, a.x + (i / 3) * w, oy + d + 0.06, 0.04, 0.4, '#6b4a2f', base);
  }
  if (props(a) && level >= 2) {
    crate(a, a.x + w * 0.08, oy + d + 0.16, 0.18, 0.14);
    haystack(a, a.x + w * 0.85, oy + d + 0.25, 0.14);
  }
}

function drawFarm(a: Args): void {
  const { pal, wx, wy, size } = a;
  drawFarmField(a.ctx, a.cam, wx + 0.05, wy + 0.05, size - 0.1, size - 0.1, 0.7);
  fence(a, wx + 0.05, wy + 0.05, size - 0.1, size - 0.1, 0.16);
  // אסם קטן בפינה
  const bx = wx + size * 0.62;
  const by = wy + size * 0.62;
  const bs = size * 0.3;
  drawBox(a.ctx, a.cam, bx, by, bs, bs, 0.24, faceColors(pal.wall));
  facade(a, bx, by, bs, bs, 0.24, pal.wall, { door: true });
  drawGableRoof(a.ctx, a.cam, bx, by, bs, bs, 0.24, 0.18, pal.roof);
  if (props(a)) haystack(a, wx + size * 0.2, wy + size * 0.82, 0.13);
}

function drawMill(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  const base = plinth(a, a.x, a.y, a.s * 0.7, a.s * 0.7);
  // ממגורה עגולה עם כובע חרוטי — צללית שאי אפשר לבלבל
  const cx = a.x + a.s * 0.34;
  const cy = a.y + a.s * 0.36;
  const r = a.s * 0.26;
  const h = grow(a.stage, 0.6, 0.12);
  drawColumn(a.ctx, a.cam, cx, cy, r, h, pal.wall, base);
  const apex = a.cam.worldToScreen(cx, cy, base + h + 0.3);
  const rim: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    rim.push(a.cam.worldToScreen(cx + Math.cos(ang) * (r + 0.06), cy + Math.sin(ang) * (r + 0.06), base + h));
  }
  for (let i = 0; i < 10; i++) {
    poly(a.ctx, [rim[i], rim[i + 1], apex], shade(pal.roof, i < 5 ? -0.28 : 0.08));
  }
  // סככת טחינה נמוכה לידה
  drawBox(a.ctx, a.cam, a.x + a.s * 0.62, a.y + a.s * 0.5, a.s * 0.38, a.s * 0.42, 0.3, faceColors(shade(pal.wall, -0.1)), base);
  drawGableRoof(a.ctx, a.cam, a.x + a.s * 0.62, a.y + a.s * 0.5, a.s * 0.38, a.s * 0.42, base + 0.3, 0.16, pal.roof, false);
  if (props(a)) {
    // אבן ריחיים ושקי תבואה
    const p = a.cam.worldToScreen(a.x + a.s * 0.25, a.y + a.s * 0.85, 0.04);
    a.ctx.fillStyle = '#9a958c';
    a.ctx.beginPath();
    a.ctx.ellipse(p.x, p.y, a.cam.zoom * 0.17, a.cam.zoom * 0.09, 0, 0, Math.PI * 2);
    a.ctx.fill();
    crate(a, a.x + a.s * 0.55, a.y + a.s * 0.9, 0.16, 0.13, '#c8b27a');
    if (level >= 3) crate(a, a.x + a.s * 0.75, a.y + a.s * 0.92, 0.16, 0.13, '#b8a066');
  }
}

function drawGranary(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  const base = plinth(a, a.x, a.y, a.s, a.s * 0.8);
  // שלוש ממגורות גבוהות בשורה — הצללית של אסם
  const silos = 2 + (level >= 3 ? 1 : 0);
  for (let i = 0; i < silos; i++) {
    const cx = a.x + a.s * (0.24 + i * 0.28);
    const cy = a.y + a.s * 0.62;
    const r = a.s * 0.15;
    const h = grow(a.stage, 0.95, 0.1) * (i === 1 ? 1.12 : 1);
    drawColumn(a.ctx, a.cam, cx, cy, r, h, mix(pal.wall, '#cdbb92', 0.5), base);
    const top = a.cam.worldToScreen(cx, cy, base + h);
    a.ctx.fillStyle = shade(pal.roof, -0.05);
    a.ctx.beginPath();
    a.ctx.ellipse(top.x, top.y, a.cam.zoom * r * 1.05, a.cam.zoom * r * 0.56, 0, 0, Math.PI * 2);
    a.ctx.fill();
  }
  // סככת פריקה — מאחורי הממגורות, כדי שהן ישלטו בצללית
  drawBox(a.ctx, a.cam, a.x, a.y, a.s, a.s * 0.22, 0.26, faceColors(shade(pal.wall, -0.12)), base);
  drawGableRoof(a.ctx, a.cam, a.x, a.y, a.s, a.s * 0.22, base + 0.26, 0.14, pal.roof, true);
  if (props(a)) {
    crate(a, a.x + a.s * 0.12, a.y + a.s * 0.9, 0.17, 0.14, '#c8b27a');
    crate(a, a.x + a.s * 0.34, a.y + a.s * 0.92, 0.17, 0.14, '#bda872');
  }
}

function drawLumberCamp(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  // סככה פתוחה: גג על עמודים, בלי קירות מלאים
  const sw = a.s * 0.56;
  const sd = a.s * 0.5;
  const sx = a.x + a.s * 0.04;
  const sy = a.y + a.s * 0.06;
  for (const [px, py] of [[sx, sy], [sx + sw, sy], [sx, sy + sd], [sx + sw, sy + sd]]) {
    drawColumn(a.ctx, a.cam, px, py, 0.05, 0.4, '#6b4a2f');
  }
  drawBox(a.ctx, a.cam, sx - 0.05, sy - 0.05, sw + 0.1, sd + 0.1, 0.06, faceColors(shade(pal.wall, -0.2)), 0.4);
  drawGableRoof(a.ctx, a.cam, sx - 0.05, sy - 0.05, sw + 0.1, sd + 0.1, 0.46, 0.2, shade(pal.roof, -0.1), true);
  // ערמות בולי עץ — הסימן המזהה
  logPile(a, a.x + a.s * 0.66, a.y + a.s * 0.08, a.s * 0.3, 2 + (level >= 3 ? 1 : 0), false);
  logPile(a, a.x + a.s * 0.1, a.y + a.s * 0.72, a.s * 0.4, 2, true);
  if (props(a)) {
    // גזע עם גרזן נעוץ
    const stx = a.x + a.s * 0.62;
    const sty = a.y + a.s * 0.78;
    drawColumn(a.ctx, a.cam, stx, sty, 0.13, 0.18, '#7a5c3a');
    const h1 = a.cam.worldToScreen(stx - 0.02, sty, 0.18);
    const h2 = a.cam.worldToScreen(stx + 0.16, sty - 0.1, 0.34);
    a.ctx.strokeStyle = '#6b4a2f';
    a.ctx.lineWidth = Math.max(1, a.cam.zoom * 0.03);
    a.ctx.beginPath();
    a.ctx.moveTo(h1.x, h1.y);
    a.ctx.lineTo(h2.x, h2.y);
    a.ctx.stroke();
    a.ctx.fillStyle = '#b9b3a4';
    a.ctx.beginPath();
    a.ctx.arc(h2.x, h2.y, Math.max(1.5, a.cam.zoom * 0.04), 0, Math.PI * 2);
    a.ctx.fill();
  }
}

function drawMiningCamp(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  // סככת מכרה עם פתח כהה
  const sw = a.s * 0.5;
  const sd = a.s * 0.46;
  drawBox(a.ctx, a.cam, a.x, a.y, sw, sd, 0.36, faceColors(mix(pal.wall, '#8f8a80', 0.4)));
  facade(a, a.x, a.y, sw, sd, 0.36, pal.wall, { door: true });
  drawGableRoof(a.ctx, a.cam, a.x, a.y, sw, sd, 0.36, 0.16, shade(pal.roof, -0.18), true);
  // ערמות עפרה
  for (let i = 0; i < 2 + (level >= 3 ? 1 : 0); i++) {
    const ox = a.x + a.s * (0.58 + (i % 2) * 0.22);
    const oy = a.y + a.s * (0.2 + i * 0.26);
    const p = a.cam.worldToScreen(ox, oy, 0);
    a.ctx.fillStyle = i % 2 ? '#8a8276' : '#7d766a';
    a.ctx.beginPath();
    a.ctx.ellipse(p.x, p.y - a.cam.zoom * 0.05, a.cam.zoom * 0.16, a.cam.zoom * 0.1, 0, 0, Math.PI * 2);
    a.ctx.fill();
    if (props(a)) {
      a.ctx.fillStyle = i % 2 ? '#d8b24a' : '#b9b3a4';
      for (let k = 0; k < 3; k++) {
        const q = a.cam.worldToScreen(ox - 0.08 + k * 0.08, oy - 0.04, 0.06);
        a.ctx.beginPath();
        a.ctx.arc(q.x, q.y, Math.max(1, a.cam.zoom * 0.028), 0, Math.PI * 2);
        a.ctx.fill();
      }
    }
  }
  // קרונית על מסילה
  if (props(a)) {
    const cx = a.x + a.s * 0.18;
    const cy = a.y + a.s * 0.78;
    a.ctx.strokeStyle = '#6b6259';
    a.ctx.lineWidth = Math.max(1, a.cam.zoom * 0.02);
    for (const off of [-0.07, 0.07]) {
      const p1 = a.cam.worldToScreen(cx - 0.3, cy + off, 0.01);
      const p2 = a.cam.worldToScreen(cx + 0.45, cy + off, 0.01);
      a.ctx.beginPath();
      a.ctx.moveTo(p1.x, p1.y);
      a.ctx.lineTo(p2.x, p2.y);
      a.ctx.stroke();
    }
    drawBox(a.ctx, a.cam, cx, cy - 0.1, 0.26, 0.2, 0.16, faceColors('#6f665c'), 0.03);
  }
}

// ===== ארכיטיפים: צבא =====

function drawBarracks(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.45));
  const w = a.s;
  const d = a.s * 0.6;
  const base = plinth(a, a.x, a.y, w, d);
  const h = grow(a.stage, 0.46, 0.12);
  drawBox(a.ctx, a.cam, a.x, a.y, w, d, h, faceColors(pal.wall), base);
  facade(a, a.x, a.y, w, d, h, pal.wall, { windows: 3, door: true, lit: true, baseZ: base });
  drawRoof(pal.roofStyle, a.ctx, a.cam, a.x, a.y, w, d, base + h, 0.26, pal.roof, true);

  // מגני חי"ר תלויים על הקיר — הסימן המזהה של קסרקטין
  const shields = 2 + (level >= 3 ? 1 : 0);
  for (let i = 0; i < shields; i++) {
    shieldOnWall(a, a.x + w * (0.22 + i * 0.28), a.y + d, base + h * 0.62, pal.owner);
  }
  // מגרש מסדרים: מתלה חניתות ודגל
  if (props(a)) {
    weaponRack(a, a.x + w * 0.16, a.y + a.s * 0.86, 3 + level, '#c3bdae');
    crate(a, a.x + w * 0.72, a.y + a.s * 0.84, 0.2, 0.16);
  }
  drawFlag(a.ctx, a.cam, a.x + w * 0.04, a.y + a.s * 0.94, 0, 0.8, pal.owner, a.time);
}

function drawRange(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  // סככה פתוחה לחיצים
  const sw = a.s * 0.5;
  const sd = a.s * 0.56;
  drawBox(a.ctx, a.cam, a.x, a.y, sw, sd, grow(a.stage, 0.34, 0.1), faceColors(pal.wall));
  facade(a, a.x, a.y, sw, sd, 0.34, pal.wall, { windows: 1, door: true });
  drawGableRoof(a.ctx, a.cam, a.x - 0.04, a.y - 0.04, sw + 0.08, sd + 0.08, 0.34, 0.22, pal.roof, false);

  // מטרות קש — הסימן המזהה של מטווח
  for (let i = 0; i < 2 + (level >= 3 ? 1 : 0); i++) {
    const tx = a.x + a.s * 0.82;
    const ty = a.y + a.s * (0.16 + i * 0.32);
    drawColumn(a.ctx, a.cam, tx, ty, 0.05, 0.36, '#6b4a2f');
    const c = a.cam.worldToScreen(tx, ty, 0.46);
    for (const [r, col] of [[0.1, '#d9c88a'], [0.07, '#e8ddb4'], [0.035, '#b8443a']] as const) {
      a.ctx.fillStyle = col;
      a.ctx.beginPath();
      a.ctx.arc(c.x, c.y, a.cam.zoom * r, 0, Math.PI * 2);
      a.ctx.fill();
    }
  }
  // אשפת חיצים
  if (props(a)) {
    const qx = a.x + a.s * 0.18;
    const qy = a.y + a.s * 0.82;
    drawColumn(a.ctx, a.cam, qx, qy, 0.1, 0.2, '#7a5c3a');
    for (let i = 0; i < 5; i++) {
      const p1 = a.cam.worldToScreen(qx - 0.05 + i * 0.025, qy, 0.2);
      const p2 = a.cam.worldToScreen(qx - 0.1 + i * 0.05, qy - 0.06, 0.46);
      a.ctx.strokeStyle = '#c3bdae';
      a.ctx.lineWidth = Math.max(0.8, a.cam.zoom * 0.015);
      a.ctx.beginPath();
      a.ctx.moveTo(p1.x, p1.y);
      a.ctx.lineTo(p2.x, p2.y);
      a.ctx.stroke();
    }
  }
}

function drawStable(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  // אורווה: תאים פתוחים עם דלתות חצי-גובה
  const w = a.s * 0.62;
  const d = a.s * 0.56;
  const base = plinth(a, a.x, a.y, w, d);
  const h = grow(a.stage, 0.4, 0.1);
  drawBox(a.ctx, a.cam, a.x, a.y, w, d, h, faceColors(pal.wall), base);
  drawRoof(pal.roofStyle, a.ctx, a.cam, a.x, a.y, w, d, base + h, 0.26, pal.roof, true);
  // דלתות תא כפולות לאורך החזית
  const stalls = 2 + (level >= 3 ? 1 : 0);
  for (let i = 0; i < stalls; i++) {
    const sx = a.x + w * (0.12 + i * 0.32);
    poly(a.ctx, [
      a.cam.worldToScreen(sx, a.y + d, base),
      a.cam.worldToScreen(sx + w * 0.2, a.y + d, base),
      a.cam.worldToScreen(sx + w * 0.2, a.y + d, base + h * 0.55),
      a.cam.worldToScreen(sx, a.y + d, base + h * 0.55),
    ], '#5e4228');
    poly(a.ctx, [
      a.cam.worldToScreen(sx, a.y + d, base + h * 0.6),
      a.cam.worldToScreen(sx + w * 0.2, a.y + d, base + h * 0.6),
      a.cam.worldToScreen(sx + w * 0.2, a.y + d, base + h * 0.9),
      a.cam.worldToScreen(sx, a.y + d, base + h * 0.9),
    ], '#3a2c1c');
  }
  // מכלאה עם חציר ושוקת — הסימן המזהה
  fence(a, a.x + a.s * 0.68, a.y + a.s * 0.05, a.s * 0.3, a.s * 0.9, 0.22);
  if (props(a)) {
    haystack(a, a.x + a.s * 0.82, a.y + a.s * 0.22, 0.14);
    drawBox(a.ctx, a.cam, a.x + a.s * 0.74, a.y + a.s * 0.62, 0.3, 0.14, 0.1, faceColors('#7a5c3a'));
    if (level >= 2) haystack(a, a.x + a.s * 0.2, a.y + a.s * 0.86, 0.12);
  }
}

function drawSiegeWorkshop(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  // מסגרת עץ פתוחה — לא בניין סגור
  const w = a.s * 0.72;
  const d = a.s * 0.6;
  for (const [px, py] of [[a.x, a.y], [a.x + w, a.y], [a.x, a.y + d], [a.x + w, a.y + d]]) {
    drawColumn(a.ctx, a.cam, px, py, 0.06, 0.52, '#6b4a2f');
  }
  drawBox(a.ctx, a.cam, a.x - 0.06, a.y - 0.06, w + 0.12, d + 0.12, 0.07, faceColors(shade(pal.wall, -0.25)), 0.52);
  drawGableRoof(a.ctx, a.cam, a.x - 0.06, a.y - 0.06, w + 0.12, d + 0.12, 0.59, 0.2, shade(pal.roof, -0.12), true);
  // קיר אחורי חלקי בלבד
  poly(a.ctx, [
    a.cam.worldToScreen(a.x, a.y, 0),
    a.cam.worldToScreen(a.x + w, a.y, 0),
    a.cam.worldToScreen(a.x + w, a.y, 0.4),
    a.cam.worldToScreen(a.x, a.y, 0.4),
  ], shade(pal.wall, -0.3));

  // מכונת מצור בבנייה: זרוע, גלגלים וקורות
  const mx = a.x + w * 0.35;
  const my = a.y + d * 0.55;
  drawBox(a.ctx, a.cam, mx, my, 0.5, 0.26, 0.12, faceColors('#7a5c3a'));
  for (const off of [0, 0.22]) {
    const c = a.cam.worldToScreen(mx + 0.08 + off, my + 0.3, 0.1);
    a.ctx.fillStyle = '#5e4228';
    a.ctx.beginPath();
    a.ctx.arc(c.x, c.y, a.cam.zoom * 0.09, 0, Math.PI * 2);
    a.ctx.fill();
    a.ctx.fillStyle = '#8a6a44';
    a.ctx.beginPath();
    a.ctx.arc(c.x, c.y, a.cam.zoom * 0.04, 0, Math.PI * 2);
    a.ctx.fill();
  }
  const armA = a.cam.worldToScreen(mx + 0.12, my + 0.12, 0.14);
  const armB = a.cam.worldToScreen(mx + 0.52, my + 0.12, 0.62 + level * 0.04);
  a.ctx.strokeStyle = '#6b4a2f';
  a.ctx.lineWidth = Math.max(1.5, a.cam.zoom * 0.05);
  a.ctx.beginPath();
  a.ctx.moveTo(armA.x, armA.y);
  a.ctx.lineTo(armB.x, armB.y);
  a.ctx.stroke();
  if (props(a)) {
    logPile(a, a.x + a.s * 0.06, a.y + a.s * 0.82, a.s * 0.45, 2, true);
  }
}

function drawBlacksmith(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  const w = a.s * 0.72;
  const d = a.s * 0.62;
  const base = plinth(a, a.x, a.y, w, d);
  const h = grow(a.stage, 0.42, 0.1);
  drawBox(a.ctx, a.cam, a.x, a.y, w, d, h, faceColors(shade(pal.wall, -0.12)), base);
  facade(a, a.x, a.y, w, d, h, shade(pal.wall, -0.12), { windows: 1, baseZ: base });
  drawGableRoof(a.ctx, a.cam, a.x, a.y, w, d, base + h, 0.2, shade(pal.roof, -0.15), true);

  // פתח כבשן לוהט — הסימן המזהה של נפחייה
  const fx = a.x + w * 0.3;
  poly(a.ctx, [
    a.cam.worldToScreen(fx, a.y + d, base),
    a.cam.worldToScreen(fx + w * 0.3, a.y + d, base),
    a.cam.worldToScreen(fx + w * 0.3, a.y + d, base + h * 0.6),
    a.cam.worldToScreen(fx, a.y + d, base + h * 0.6),
  ], '#2a1c12');
  const glow = 0.55 + 0.45 * Math.sin(a.time * 0.004);
  poly(a.ctx, [
    a.cam.worldToScreen(fx + w * 0.05, a.y + d, base + 0.02),
    a.cam.worldToScreen(fx + w * 0.25, a.y + d, base + 0.02),
    a.cam.worldToScreen(fx + w * 0.25, a.y + d, base + h * 0.4),
    a.cam.worldToScreen(fx + w * 0.05, a.y + d, base + h * 0.4),
  ], `rgba(${Math.round(210 + glow * 40)}, ${Math.round(90 + glow * 60)}, 40, 0.9)`);

  // ארובה עם עשן
  const cx = a.x + w * 0.82;
  const cy = a.y + d * 0.25;
  drawBox(a.ctx, a.cam, cx, cy, 0.16, 0.16, grow(a.stage, 0.6, 0.12), faceColors('#7a6a5a'), base);
  if (props(a)) smoke(a, cx + 0.08, cy + 0.08, base + grow(a.stage, 0.6, 0.12), 0.9, 3);

  if (props(a)) {
    // סדן וחבית מים
    const ax = a.x + a.s * 0.2;
    const ay = a.y + a.s * 0.85;
    drawBox(a.ctx, a.cam, ax, ay, 0.22, 0.14, 0.12, faceColors('#5c5850'));
    crate(a, a.x + a.s * 0.55, a.y + a.s * 0.88, 0.18, 0.18, '#6f5a3f');
    if (level >= 3) weaponRack(a, a.x + a.s * 0.74, a.y + a.s * 0.86, 3, '#c3bdae');
  }
}

function drawMilitaryBase(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, '#7d7466');
  // מבנה בטון נמוך וארוך
  const w = a.s;
  const d = a.s * 0.5;
  const h = grow(a.stage, 0.5, 0.08);
  const concrete = mix(pal.wall, '#9aa0a2', 0.65);
  drawBox(a.ctx, a.cam, a.x, a.y, w, d, h, faceColors(concrete));
  drawFacade(a.ctx, a.cam, a.x, a.y, w, d, h, concrete, { windows: 4, windowRows: level >= 3 ? 2 : 1, lit: true, seed: a.seed });
  drawBox(a.ctx, a.cam, a.x + 0.06, a.y + 0.06, w - 0.12, d - 0.12, 0.08, faceColors(shade(concrete, -0.12)), h);
  // מוט אנטנה
  const ax = a.x + w * 0.88;
  const ay = a.y + d * 0.3;
  drawColumn(a.ctx, a.cam, ax, ay, 0.03, 0.8 + level * 0.1, '#8b9095', h);
  drawFlag(a.ctx, a.cam, a.x + w * 0.08, a.y + a.s * 0.9, 0, 0.75, pal.owner, a.time);
  // גדר היקפית ומחסום
  fence(a, a.x - 0.05, a.y + a.s * 0.58, a.s + 0.1, a.s * 0.36, 0.24, '#8b9095');
  if (props(a)) {
    drawBox(a.ctx, a.cam, a.x + a.s * 0.3, a.y + a.s * 0.72, 0.5, 0.26, 0.18, faceColors('#6f7a5f'));
    drawBox(a.ctx, a.cam, a.x + a.s * 0.36, a.y + a.s * 0.74, 0.28, 0.2, 0.14, faceColors('#5e6a50'), 0.18);
  }
}

// ===== ארכיטיפים: הגנה =====

function drawTower(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  const cx = a.x + a.s / 2;
  const cy = a.y + a.s / 2;
  const r = Math.max(0.22, a.s * 0.34);
  const h = grow(a.stage, 0.95, 0.12);
  // בסיס רחב יותר — מגדל אמיתי מתחדד כלפי מעלה
  drawColumn(a.ctx, a.cam, cx, cy, r * 1.12, 0.16, mix(pal.wall, '#8d8478', 0.5));
  drawColumn(a.ctx, a.cam, cx, cy, r, h, pal.wall, 0.16);
  // חפיר עליון (שיננים)
  const merlons = 8;
  for (let i = 0; i < merlons; i++) {
    const ang = (i / merlons) * Math.PI * 2;
    drawBox(
      a.ctx, a.cam,
      cx + Math.cos(ang) * r * 0.92 - 0.05, cy + Math.sin(ang) * r * 0.92 - 0.05,
      0.1, 0.1, 0.16, faceColors(shade(pal.wall, -0.1)), 0.16 + h,
    );
  }
  // אשנבי ירי
  if (detailLevel(a.cam) >= 1) {
    for (const [dx, dy] of [[0, 1], [1, 0]] as const) {
      const p = a.cam.worldToScreen(cx + dx * r * 0.95, cy + dy * r * 0.95, 0.16 + h * 0.62);
      a.ctx.fillStyle = '#2f2820';
      a.ctx.fillRect(p.x - a.cam.zoom * 0.02, p.y - a.cam.zoom * 0.07, a.cam.zoom * 0.04, a.cam.zoom * 0.13);
    }
  }
  if (level >= 3) {
    // גגון חרוטי משלב 3
    const apex = a.cam.worldToScreen(cx, cy, 0.16 + h + 0.5);
    const rim: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      rim.push(a.cam.worldToScreen(cx + Math.cos(ang) * (r + 0.05), cy + Math.sin(ang) * (r + 0.05), 0.16 + h + 0.16));
    }
    for (let i = 0; i < 10; i++) poly(a.ctx, [rim[i], rim[i + 1], apex], shade(pal.roof, i < 5 ? -0.3 : 0.06));
  }
  drawFlag(a.ctx, a.cam, cx, cy, 0.16 + h + (level >= 3 ? 0.5 : 0.16), 0.4, pal.owner, a.time);
}

function drawWaterTower(a: Args): void {
  const { pal } = a;
  const cx = a.x + a.s / 2;
  const cy = a.y + a.s / 2;
  const legH = grow(a.stage, 0.8, 0.1);
  const r = a.s * 0.26;
  // ארבע רגליים
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    drawColumn(a.ctx, a.cam, cx + dx * r * 0.7, cy + dy * r * 0.7, 0.04, legH, mix(pal.trim, '#8b9095', 0.6));
  }
  // מכל מים: גליל גבוה וצר עם כיפה — צללית של מגדל מים, לא של שולחן
  const tankR = r * 0.78;
  const tankH = grow(a.stage, 0.62, 0.08);
  drawColumn(a.ctx, a.cam, cx, cy, tankR, tankH, mix(pal.wall, '#c8ccd0', 0.55), legH);
  // חישוק מתכת סביב המכל
  a.ctx.strokeStyle = shade(pal.trim, -0.1);
  a.ctx.lineWidth = Math.max(1, a.cam.zoom * 0.022);
  for (const t of [0.3, 0.7]) {
    const ring: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      ring.push(a.cam.worldToScreen(cx + Math.cos(ang) * tankR, cy + Math.sin(ang) * tankR, legH + tankH * t));
    }
    a.ctx.beginPath();
    ring.forEach((p, i) => (i === 0 ? a.ctx.moveTo(p.x, p.y) : a.ctx.lineTo(p.x, p.y)));
    a.ctx.stroke();
  }
  drawDomeRoof(a.ctx, a.cam, cx, cy, tankR * 1.05, legH + tankH, 0.22, shade(pal.trim, 0.05));
  // סולם
  if (detailLevel(a.cam) >= 1) {
    a.ctx.strokeStyle = '#8b9095';
    a.ctx.lineWidth = Math.max(0.8, a.cam.zoom * 0.016);
    for (const off of [-0.05, 0.05]) {
      const p1 = a.cam.worldToScreen(cx + r * 0.75 + off * 0, cy + r * 0.75, 0);
      const p2 = a.cam.worldToScreen(cx + r * 0.75, cy + r * 0.75, legH + 0.1);
      a.ctx.beginPath();
      a.ctx.moveTo(p1.x + off * a.cam.zoom, p1.y);
      a.ctx.lineTo(p2.x + off * a.cam.zoom, p2.y);
      a.ctx.stroke();
    }
  }
  drawFlag(a.ctx, a.cam, cx, cy, legH + tankH + 0.22, 0.3, pal.owner, a.time);
}

function drawCastle(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.45));
  const kx = a.x + a.s * 0.12;
  const ky = a.y + a.s * 0.12;
  const ks = a.s * 0.76;
  const h = grow(a.stage, 0.8, 0.08);
  drawBox(a.ctx, a.cam, kx, ky, ks, ks, h, faceColors(pal.wall));
  facade(a, kx, ky, ks, ks, h, pal.wall, { windows: 3, windowRows: 2, door: true });
  drawRoof(pal.roofStyle, a.ctx, a.cam, kx, ky, ks, ks, h, 0.3, pal.roof);
  // ארבעה צריחים
  const corners: Array<[number, number]> = [
    [a.x + 0.1, a.y + 0.1],
    [a.x + a.s - 0.1, a.y + 0.1],
    [a.x + a.s - 0.1, a.y + a.s - 0.1],
    [a.x + 0.1, a.y + a.s - 0.1],
  ];
  for (const [cx, cy] of corners) {
    const th = h + 0.25 + level * 0.05;
    drawColumn(a.ctx, a.cam, cx, cy, 0.2, th, shade(pal.wall, -0.06));
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      drawBox(a.ctx, a.cam, cx + Math.cos(ang) * 0.17 - 0.04, cy + Math.sin(ang) * 0.17 - 0.04, 0.08, 0.08, 0.12,
        faceColors(shade(pal.wall, -0.12)), th);
    }
    if (level >= 3) drawHipRoof(a.ctx, a.cam, cx - 0.22, cy - 0.22, 0.44, 0.44, th + 0.12, 0.3, pal.roof, 0.04);
  }
  drawFlag(a.ctx, a.cam, a.x + a.s * 0.5, a.y + a.s * 0.5, h + 0.3, 0.55, pal.owner, a.time);
}

// ===== ארכיטיפים: אזרחי =====

function drawMarket(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.4));
  // מחסן קטן
  drawBox(a.ctx, a.cam, a.x, a.y, a.s * 0.44, a.s * 0.44, 0.34, faceColors(pal.wall));
  facade(a, a.x, a.y, a.s * 0.44, a.s * 0.44, 0.34, pal.wall, { windows: 1, door: true });
  drawGableRoof(a.ctx, a.cam, a.x, a.y, a.s * 0.44, a.s * 0.44, 0.34, 0.2, pal.roof);
  // דוכנים עם סוככים צבעוניים — הסימן המזהה של שוק
  const awnings = ['#b3614c', '#4f7ba8', '#b39a4c'];
  const stalls = 2 + level;
  for (let i = 0; i < stalls; i++) {
    const sx = a.x + a.s * (i % 2 === 0 ? 0.54 : 0.06);
    const sy = a.y + a.s * (0.5 + Math.floor(i / 2) * 0.24);
    for (const dx of [0, 0.3]) {
      drawColumn(a.ctx, a.cam, sx + dx, sy, 0.03, 0.3, '#6b4a2f');
      drawColumn(a.ctx, a.cam, sx + dx, sy + 0.24, 0.03, 0.3, '#6b4a2f');
    }
    poly(a.ctx, [
      a.cam.worldToScreen(sx - 0.05, sy - 0.05, 0.34),
      a.cam.worldToScreen(sx + 0.35, sy - 0.05, 0.34),
      a.cam.worldToScreen(sx + 0.35, sy + 0.29, 0.3),
      a.cam.worldToScreen(sx - 0.05, sy + 0.29, 0.3),
    ], awnings[i % awnings.length]);
    if (props(a)) crate(a, sx + 0.06, sy + 0.06, 0.16, 0.12, '#9a7a4a');
  }
}

function drawExchange(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.4));
  const w = a.s * 0.82;
  const d = a.s * 0.6;
  const ox = a.x + (a.s - w) / 2;
  const oy = a.y + (a.s - d) / 2;
  const base = plinth(a, ox, oy, w, d) + 0.1;
  // מדרגות חזית
  drawBox(a.ctx, a.cam, ox, oy + d, w, 0.18, 0.06, faceColors(mix(pal.wall, '#a49a8c', 0.5)));
  drawBox(a.ctx, a.cam, ox + 0.06, oy + d + 0.04, w - 0.12, 0.12, 0.12, faceColors(mix(pal.wall, '#b0a698', 0.5)));
  const h = grow(a.stage, 0.62, 0.1);
  drawBox(a.ctx, a.cam, ox, oy, w, d, h, faceColors(pal.wall), base);
  drawFacade(a.ctx, a.cam, ox, oy, w, d, h, pal.wall, { windows: 3, windowRows: 2, lit: true, courses: 5, seed: a.seed, baseZ: base });
  // שורת עמודים בחזית — מסחר קלאסי
  for (let i = 0; i <= 4; i++) {
    drawColumn(a.ctx, a.cam, ox + (i / 4) * w, oy + d + 0.02, 0.055, h * 0.95, shade(pal.wall, 0.12), base);
  }
  drawFlatRoofSlab(a, ox - 0.05, oy - 0.05, w + 0.1, d + 0.12, base + h, pal.trim);
  // גמלון משולש
  poly(a.ctx, [
    a.cam.worldToScreen(ox, oy + d, base + h + 0.08),
    a.cam.worldToScreen(ox + w, oy + d, base + h + 0.08),
    a.cam.worldToScreen(ox + w / 2, oy + d, base + h + 0.3),
  ], shade(pal.trim, -0.1));
  if (level >= 3) {
    // שעון על הגמלון
    const c = a.cam.worldToScreen(ox + w / 2, oy + d, base + h + 0.17);
    a.ctx.fillStyle = '#f0ece0';
    a.ctx.beginPath();
    a.ctx.arc(c.x, c.y, a.cam.zoom * 0.06, 0, Math.PI * 2);
    a.ctx.fill();
    a.ctx.strokeStyle = '#3a3128';
    a.ctx.lineWidth = Math.max(0.8, a.cam.zoom * 0.012);
    a.ctx.beginPath();
    a.ctx.moveTo(c.x, c.y);
    a.ctx.lineTo(c.x, c.y - a.cam.zoom * 0.04);
    a.ctx.stroke();
  }
}

/** גג שטוח עם מעקה — משמש לבורסה ולמבנים קלאסיים. */
function drawFlatRoofSlab(a: Args, x: number, y: number, w: number, d: number, z: number, color: string): void {
  drawBox(a.ctx, a.cam, x, y, w, d, 0.08, faceColors(color), z);
}

function drawTemple(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.3));
  const body = a.s * 0.7;
  const ox = a.x + (a.s - body) / 2;
  const oy = a.y + (a.s - body) / 2;
  // פודיום מדורג
  drawBox(a.ctx, a.cam, ox - 0.12, oy - 0.12, body + 0.24, body + 0.24, 0.07, faceColors(mix(pal.wall, '#a89e90', 0.5)));
  drawBox(a.ctx, a.cam, ox - 0.06, oy - 0.06, body + 0.12, body + 0.12, 0.07, faceColors(mix(pal.wall, '#b4aa9c', 0.5)), 0.07);
  const base = 0.14;
  const h = grow(a.stage, 0.55, 0.1);
  // עמודים בחזית
  for (let i = 0; i <= 3 + (level >= 3 ? 1 : 0); i++) {
    const n = 3 + (level >= 3 ? 1 : 0);
    drawColumn(a.ctx, a.cam, ox + (i / n) * body, oy + body + 0.08, 0.07, h + 0.06, shade(pal.wall, 0.16), base);
  }
  drawBox(a.ctx, a.cam, ox, oy, body, body, h, faceColors(pal.wall), base);
  facade(a, ox, oy, body, body, h, pal.wall, { baseZ: base, door: true });
  drawRoof(pal.roofStyle, a.ctx, a.cam, ox - 0.1, oy - 0.1, body + 0.2, body + 0.2, base + h, 0.34, pal.roof);
  if (level >= 4) drawFlag(a.ctx, a.cam, ox + body / 2, oy + body / 2, base + h + 0.34, 0.4, pal.owner, a.time);
}

function drawUniversity(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.38));
  const w = a.s;
  const d = a.s * 0.56;
  const base = plinth(a, a.x, a.y, w, d);
  const h = grow(a.stage, 0.56, 0.12);
  // אגף ראשי דו-קומתי
  drawBox(a.ctx, a.cam, a.x, a.y, w, d, h, faceColors(pal.wall), base);
  facade(a, a.x, a.y, w, d, h, pal.wall, { windows: 4, windowRows: 2, door: true, lit: true, baseZ: base });
  drawRoof(pal.roofStyle, a.ctx, a.cam, a.x, a.y, w, d, base + h, 0.2, pal.roof, true);
  // אכסדרה: שורת עמודים לאורך החזית — הסימן המזהה של מוסד לימודים
  const cols = 4 + level;
  for (let i = 0; i <= cols; i++) {
    drawColumn(a.ctx, a.cam, a.x + (i / cols) * w, a.y + d + 0.1, 0.05, h * 0.78, shade(pal.wall, 0.14), base);
  }
  drawBox(a.ctx, a.cam, a.x - 0.04, a.y + d + 0.04, w + 0.08, 0.14, 0.07, faceColors(shade(pal.trim, 0.05)), base + h * 0.78);
  // כיפת מצפה כוכבים במרכז
  const cx = a.x + w * 0.5;
  const cy = a.y + d * 0.45;
  drawColumn(a.ctx, a.cam, cx, cy, a.s * 0.16, 0.3, shade(pal.wall, 0.06), base + h);
  drawDomeRoof(a.ctx, a.cam, cx, cy, a.s * 0.17, base + h + 0.3, 0.32 + level * 0.03, pal.trim);
  if (level >= 4) {
    drawFlag(a.ctx, a.cam, cx, cy, base + h + 0.62, 0.36, pal.owner, a.time);
  }
}

// ===== ארכיטיפים: מונומנטים ותעשייה =====

function drawMonument(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, shade(pal.wall, -0.35));
  const steps = 4 + level;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const inset = t * a.s * 0.42;
    drawBox(
      a.ctx, a.cam,
      a.x + inset, a.y + inset,
      a.s - inset * 2, a.s - inset * 2,
      0.2,
      faceColors(shade(pal.wall, -t * 0.16)),
      0.06 + i * 0.2,
    );
  }
  if (level >= 3) {
    // כיפת זהב קטנה בפסגה
    const cx = a.x + a.s / 2;
    const cy = a.y + a.s / 2;
    drawDomeRoof(a.ctx, a.cam, cx, cy, a.s * 0.12, 0.06 + steps * 0.2, 0.2, mix(pal.trim, '#d8bd72', 0.5));
  }
}

/** אמת מים: שורת קשתות אבן עם תעלה למעלה. */
function drawAqueduct(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  const stone = mix(pal.wall, '#b0a89a', 0.45);
  const w = a.s;
  const d = a.s * 0.3;
  const oy = a.y + (a.s - d) / 2;
  const h = grow(a.stage, 0.75, 0.1);
  const bays = 3 + (level >= 3 ? 1 : 0);
  const pierW = w / (bays * 2 + 1);
  // עמודי הקשתות
  for (let i = 0; i <= bays; i++) {
    const px = a.x + i * (w - pierW) / bays;
    drawBox(a.ctx, a.cam, px, oy, pierW, d, h, faceColors(stone));
  }
  // הקשתות עצמן — טריז כהה בין העמודים
  for (let i = 0; i < bays; i++) {
    const x0 = a.x + i * (w - pierW) / bays + pierW;
    const x1 = a.x + (i + 1) * (w - pierW) / bays;
    poly(a.ctx, [
      a.cam.worldToScreen(x0, oy + d, h * 0.25),
      a.cam.worldToScreen(x1, oy + d, h * 0.25),
      a.cam.worldToScreen(x1, oy + d, h * 0.72),
      a.cam.worldToScreen((x0 + x1) / 2, oy + d, h * 0.86),
      a.cam.worldToScreen(x0, oy + d, h * 0.72),
    ], shade(stone, -0.45));
  }
  // התעלה שעל גבי הקשתות
  drawBox(a.ctx, a.cam, a.x - 0.05, oy - 0.05, w + 0.1, d + 0.1, 0.16, faceColors(shade(stone, 0.05)), h);
  drawBox(a.ctx, a.cam, a.x, oy + d * 0.28, w, d * 0.44, 0.08, faceColors('#4b7ea6'), h + 0.14);
  if (level >= 3) {
    // מעקה קטן לאורך התעלה
    for (let i = 0; i <= 6; i++) {
      drawBox(a.ctx, a.cam, a.x + (i / 6) * w - 0.04, oy - 0.05, 0.08, 0.08, 0.1, faceColors(shade(stone, -0.05)), h + 0.16);
    }
  }
}

function drawFactory(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, '#7d7466');
  const w = a.s;
  const d = a.s * 0.68;
  const h = grow(a.stage, 0.5, 0.08);
  const wallColor = mix(pal.trim, '#8d8f92', 0.5);
  drawBox(a.ctx, a.cam, a.x, a.y, w, d, h, faceColors(wallColor));
  drawFacade(a.ctx, a.cam, a.x, a.y, w, d, h, wallColor, {
    windows: 5, windowRows: 2, lit: true, seed: a.seed,
  });
  // גג משוני (sawtooth) — הצללית הקלאסית של מפעל
  const bays = 3 + (level >= 3 ? 1 : 0);
  for (let i = 0; i < bays; i++) {
    const sx = a.x + (i / bays) * w;
    const bw = w / bays;
    poly(a.ctx, [
      a.cam.worldToScreen(sx, a.y, h),
      a.cam.worldToScreen(sx + bw, a.y, h),
      a.cam.worldToScreen(sx + bw, a.y + d, h),
      a.cam.worldToScreen(sx, a.y + d, h),
    ], shade('#6b7785', -0.05));
    poly(a.ctx, [
      a.cam.worldToScreen(sx, a.y, h),
      a.cam.worldToScreen(sx, a.y + d, h),
      a.cam.worldToScreen(sx, a.y + d, h + 0.2),
      a.cam.worldToScreen(sx, a.y, h + 0.2),
    ], '#8fa3b8');
  }
  // ארובות
  const stacks = level >= 3 ? 2 : 1;
  for (let i = 0; i < stacks; i++) {
    const cx = a.x + w * (0.84 - i * 0.16);
    const cy = a.y + d * 0.22;
    const ch = grow(a.stage, 0.9, 0.12) - i * 0.14;
    drawColumn(a.ctx, a.cam, cx, cy, 0.1, ch, '#7a6a5a', h);
    if (props(a)) smoke(a, cx, cy, h + ch, 1.1, 4);
  }
  if (props(a)) {
    crate(a, a.x + a.s * 0.1, a.y + a.s * 0.82, 0.22, 0.18, '#6f7a5f');
    crate(a, a.x + a.s * 0.34, a.y + a.s * 0.84, 0.22, 0.18, '#5e6a50');
  }
}

function drawHighTech(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, '#7d7466');
  const w = a.s * 0.8;
  const d = a.s * 0.58;
  const ox = a.x + (a.s - w) / 2;
  const oy = a.y + (a.s - d) / 2;
  // מגדל זכוכית — קומות עם פסי חלונות
  const floors = 2 + level;
  const fh = grow(a.stage, 0.24, 0.05);
  const glass = mix(pal.trim, '#5f7a8c', 0.6);
  for (let i = 0; i < floors; i++) {
    const inset = i * 0.02;
    drawBox(a.ctx, a.cam, ox + inset, oy + inset, w - inset * 2, d - inset * 2, fh, faceColors(glass), i * fh);
    drawFacade(a.ctx, a.cam, ox + inset, oy + inset, w - inset * 2, d - inset * 2, fh, glass, {
      windows: 4, windowRows: 1, lit: true, seed: a.seed + i, baseZ: i * fh,
    });
  }
  const top = floors * fh;
  drawBox(a.ctx, a.cam, ox + 0.06, oy + 0.06, w - 0.12, d - 0.12, 0.07, faceColors(shade(glass, -0.2)), top);
  // אנטנה מהבהבת
  const cx = ox + w * 0.5;
  const cy = oy + d * 0.5;
  drawColumn(a.ctx, a.cam, cx, cy, 0.025, 0.4, '#9aa0a5', top + 0.07);
  const blink = 0.5 + 0.5 * Math.sin(a.time * 0.005);
  const p = a.cam.worldToScreen(cx, cy, top + 0.47);
  a.ctx.fillStyle = `rgba(226, 92, 76, ${0.35 + blink * 0.6})`;
  a.ctx.beginPath();
  a.ctx.arc(p.x, p.y, Math.max(1.2, a.cam.zoom * 0.035), 0, Math.PI * 2);
  a.ctx.fill();
}

function drawRadar(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  drawBox(a.ctx, a.cam, a.x, a.y, a.s, a.s * 0.6, 0.3, faceColors('#5c6470'));
  // מכולת שיגור עם תאי טילים
  drawBox(a.ctx, a.cam, a.x + a.s * 0.1, a.y + a.s * 0.1, a.s * 0.55, a.s * 0.4, 0.34, faceColors(shade(pal.trim, -0.2)), 0.3);
  const rows = level >= 3 ? 3 : 2;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < rows; j++) {
      const c = a.cam.worldToScreen(a.x + a.s * (0.18 + i * 0.16), a.y + a.s * (0.18 + j * 0.13), 0.66);
      a.ctx.fillStyle = '#2b3138';
      a.ctx.beginPath();
      a.ctx.arc(c.x, c.y, a.cam.zoom * 0.035, 0, Math.PI * 2);
      a.ctx.fill();
    }
  }
  // צלחת מכ"ם מסתובבת
  const cx = a.x + a.s * 0.8;
  const cy = a.y + a.s * 0.3;
  drawColumn(a.ctx, a.cam, cx, cy, 0.05, 0.75 + level * 0.05, '#6b7380');
  const dish = a.cam.worldToScreen(cx, cy, 0.8 + level * 0.05);
  a.ctx.save();
  a.ctx.translate(dish.x, dish.y);
  a.ctx.scale(1, 0.5);
  a.ctx.rotate(a.time * 0.0016);
  a.ctx.fillStyle = '#c3cbd4';
  a.ctx.beginPath();
  a.ctx.ellipse(0, 0, a.cam.zoom * 0.16, a.cam.zoom * 0.07, 0, 0, Math.PI * 2);
  a.ctx.fill();
  a.ctx.restore();
}

function drawHospital(a: Args): void {
  const { pal } = a;
  const level = lvl(a.stage);
  apron(a.ctx, a.cam, a.x, a.y, a.s, '#8a8378');
  const w = a.s;
  const d = a.s * 0.66;
  const h = grow(a.stage, 0.55, 0.1);
  drawBox(a.ctx, a.cam, a.x, a.y, w, d, h, faceColors('#eceef0'));
  drawFacade(a.ctx, a.cam, a.x, a.y, w, d, h, '#eceef0', {
    windows: 4, windowRows: level >= 3 ? 2 : 1, lit: true, door: true, seed: a.seed,
  });
  drawBox(a.ctx, a.cam, a.x + 0.1, a.y + 0.1, w - 0.2, d - 0.2, 0.1, faceColors('#d9dee2'), h);
  // צלב אדום על החזית
  const c = a.cam.worldToScreen(a.x + w * 0.5, a.y + d, h * 0.72);
  const t = a.cam.zoom * 0.055;
  a.ctx.fillStyle = '#c4453f';
  a.ctx.fillRect(c.x - t * 0.5, c.y - t * 1.5, t, t * 3);
  a.ctx.fillRect(c.x - t * 1.5, c.y - t * 0.5, t * 3, t);
  // מרפסת כניסה
  drawBox(a.ctx, a.cam, a.x + w * 0.3, a.y + d, w * 0.4, 0.22, 0.06, faceColors('#cfd5d9'), h * 0.6);
  for (const px of [a.x + w * 0.32, a.x + w * 0.66]) {
    drawColumn(a.ctx, a.cam, px, a.y + d + 0.16, 0.035, h * 0.6, '#c3c9cd');
  }
  if (level >= 3) drawFlag(a.ctx, a.cam, a.x + w * 0.06, a.y + a.s * 0.92, 0, 0.6, pal.owner, a.time);
}

function drawPort(a: Args): void {
  const { pal, waterSide } = a;
  const level = lvl(a.stage);
  const s = a.s;
  // מחסן הנמל יושב בצד ההפוך למים
  const b = s * 0.58;
  const house = {
    n: { x: a.x + (s - b) / 2, y: a.y + s - b },
    s: { x: a.x + (s - b) / 2, y: a.y },
    e: { x: a.x, y: a.y + (s - b) / 2 },
    w: { x: a.x + s - b, y: a.y + (s - b) / 2 },
  }[waterSide];
  const pier = {
    n: { x: a.x + s * 0.2, y: a.y, w: s * 0.6, d: s * 0.36 },
    s: { x: a.x + s * 0.2, y: a.y + s * 0.64, w: s * 0.6, d: s * 0.36 },
    e: { x: a.x + s * 0.64, y: a.y + s * 0.2, w: s * 0.36, d: s * 0.6 },
    w: { x: a.x, y: a.y + s * 0.2, w: s * 0.36, d: s * 0.6 },
  }[waterSide];

  const pierFirst = waterSide === 'n' || waterSide === 'w';
  const drawPier = (): void => {
    drawBox(a.ctx, a.cam, pier.x, pier.y, pier.w, pier.d, 0.1, faceColors('#8a6b47'));
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.3;
      const px = waterSide === 'n' || waterSide === 's' ? pier.x + pier.w * t : pier.x + pier.w * 0.85;
      const py = waterSide === 'n' || waterSide === 's' ? pier.y + pier.d * 0.85 : pier.y + pier.d * t;
      drawColumn(a.ctx, a.cam, px, py, 0.045, 0.34, '#6b4a2f');
    }
    if (props(a)) {
      crate(a, pier.x + pier.w * 0.15, pier.y + pier.d * 0.15, 0.18, 0.15, '#8a6a3f');
      if (level >= 3) crate(a, pier.x + pier.w * 0.5, pier.y + pier.d * 0.2, 0.18, 0.15, '#7a5c3a');
    }
  };

  if (pierFirst) drawPier();
  const hh = grow(a.stage, 0.38, 0.1);
  drawBox(a.ctx, a.cam, house.x, house.y, b, b, hh, faceColors(pal.wall));
  facade(a, house.x, house.y, b, b, hh, pal.wall, { windows: 1, door: true, lit: true });
  drawRoof(pal.roofStyle, a.ctx, a.cam, house.x, house.y, b, b, hh, 0.26, pal.roof, true);
  if (!pierFirst) drawPier();
}

// ===== טבלת הציור והשיגור =====

const DRAW: Record<Archetype, (a: Args) => void> = {
  townCenter: drawTownCenter,
  house: drawSimpleHouse,
  longhouse: drawLonghouse,
  farm: drawFarm,
  mill: drawMill,
  granary: drawGranary,
  lumberCamp: drawLumberCamp,
  miningCamp: drawMiningCamp,
  barracks: drawBarracks,
  range: drawRange,
  stable: drawStable,
  siegeWorkshop: drawSiegeWorkshop,
  blacksmith: drawBlacksmith,
  militaryBase: drawMilitaryBase,
  tower: drawTower,
  waterTower: drawWaterTower,
  wall: (a) => drawWall(a.ctx, a.cam, a.wx, a.wy, a.size, a.pal, a.links, a.stage),
  gate: (a) => drawGate(a.ctx, a.cam, a.wx, a.wy, a.size, a.pal, a.links, a.gateOpen, a.stage),
  castle: drawCastle,
  market: drawMarket,
  exchange: drawExchange,
  temple: drawTemple,
  university: drawUniversity,
  monument: drawMonument,
  aqueduct: drawAqueduct,
  factory: drawFactory,
  highTech: drawHighTech,
  radar: drawRadar,
  hospital: drawHospital,
  port: drawPort,
};

/**
 * מצייר מבנה. (wx,wy) היא פינת שמאל-עליון בעולם, `size` צד המבנה באריחים.
 * `progress` (0..1) מצייר אתר בנייה עם פיגומים כשהוא קטן מ-1.
 */
export function drawStructure(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  arch: Archetype,
  wx: number,
  wy: number,
  size: number,
  pal: StructurePalette,
  opts: {
    progress?: number;
    stage?: number;
    time?: number;
    seed?: number;
    /** חיבור לשכנים — חומה מתחברת לחומה, לשער ולמגדל */
    links?: WallLinks;
    /** שער פתוח כשיחידה ידידותית לידו */
    gateOpen?: boolean;
    /** לאיזה כיוון נמצאים המים — הנמל מפנה את המזח לשם */
    waterSide?: 'n' | 's' | 'e' | 'w';
    /** ציור לאייקון: בלי צל ובלי הצללת מגע, שלא ייראו כמצע אפור */
    icon?: boolean;
  } = {},
): void {
  const progress = opts.progress ?? 1;

  if (!opts.icon) {
    // צל מוטל + צל מגע — מה שגורם למבנה לשבת בעולם ולא לרחף
    const shadowH = (SHADOW_HEIGHT[arch] ?? 0.7) * (progress < 1 ? 0.45 : 1);
    drawCastShadow(ctx, cam, wx + size * 0.1, wy + size * 0.1, size * 0.8, size * 0.8, shadowH);
    if (arch !== 'farm' && arch !== 'wall' && arch !== 'gate') {
      contactShade(ctx, cam, wx + size * 0.12, wy + size * 0.12, size * 0.76, size * 0.76);
    }
  }

  if (progress < 1) {
    drawConstructionSite(ctx, cam, wx, wy, size, pal, progress);
    return;
  }

  const m = size * 0.1; // שוליים
  const args: Args = {
    ctx,
    cam,
    x: wx + m,
    y: wy + m,
    s: size - m * 2,
    wx,
    wy,
    size,
    pal,
    stage: opts.stage ?? 1,
    time: opts.time ?? 0,
    seed: opts.seed ?? 0,
    links: opts.links ?? NO_LINKS,
    gateOpen: opts.gateOpen ?? false,
    waterSide: opts.waterSide ?? 'e',
  };
  DRAW[arch](args);
}

// ===== חומה, שער ואתר בנייה =====

function drawWall(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  size: number,
  pal: StructurePalette,
  links: WallLinks,
  stage: number,
): void {
  const stone = stage >= 3;
  const h = stone ? 0.7 : 0.52;
  const t = size * 0.34;
  const cx = wx + size / 2;
  const cy = wy + size / 2;
  const body = stone ? shade(pal.wall, -0.16) : '#8a6b47';
  const cap = stone ? shade(pal.wall, -0.02) : '#7a5d3e';

  const arm = (dir: 'n' | 's' | 'e' | 'w') => {
    if (dir === 'n') drawBox(ctx, cam, cx - t / 2, wy, t, size / 2, h, faceColors(body));
    if (dir === 's') drawBox(ctx, cam, cx - t / 2, cy, t, size / 2, h, faceColors(body));
    if (dir === 'w') drawBox(ctx, cam, wx, cy - t / 2, size / 2, t, h, faceColors(body));
    if (dir === 'e') drawBox(ctx, cam, cx, cy - t / 2, size / 2, t, h, faceColors(body));
  };

  if (links.n) arm('n');
  if (links.w) arm('w');
  // עמוד מרכזי — קיים תמיד, וגם מהווה את כל החומה כשאין שכנים
  drawBox(ctx, cam, cx - t * 0.62, cy - t * 0.62, t * 1.24, t * 1.24, h + 0.04, faceColors(cap));
  if (links.e) arm('e');
  if (links.s) arm('s');

  if (stone) {
    // שיננים על העמוד
    for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      drawBox(
        ctx, cam,
        cx + ox * t * 0.5 - 0.06, cy + oy * t * 0.5 - 0.06, 0.12, 0.12, 0.12,
        faceColors(shade(pal.wall, -0.06)), h + 0.04,
      );
    }
  } else {
    // גדר יתדות: ראשי בולים שמבצבצים מעל קו החומה
    const stakes: Array<[number, number]> = [];
    for (const t2 of [0.18, 0.36]) {
      if (links.n) stakes.push([cx, wy + size * t2]);
      if (links.s) stakes.push([cx, wy + size * (1 - t2)]);
      if (links.w) stakes.push([wx + size * t2, cy]);
      if (links.e) stakes.push([wx + size * (1 - t2), cy]);
    }
    for (const [sx, sy] of stakes) {
      drawBox(ctx, cam, sx - 0.06, sy - 0.06, 0.12, 0.12, 0.1, faceColors('#6f5436'), h);
    }
  }
}
function drawGate(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  size: number,
  pal: StructurePalette,
  links: WallLinks,
  open: boolean,
  stage: number,
): void {
  // אם החומה עוברת בציר x, השער נפתח בציר y (ולהפך)
  const alongX = links.w || links.e || !(links.n || links.s);
  const cx = wx + size / 2;
  const cy = wy + size / 2;
  const stone = stage >= 3;
  const h = stone ? 0.86 : 0.7;
  const pillar = stone ? shade(pal.wall, -0.22) : '#7a5d3e';
  const leaf = '#6b4a2f';
  const t = size * 0.3;

  // עמודי הצד — על שני קצות ציר החומה
  const piers: Array<[number, number]> = alongX
    ? [[wx, cy - t / 2], [wx + size - t, cy - t / 2]]
    : [[cx - t / 2, wy], [cx - t / 2, wy + size - t]];
  drawBox(ctx, cam, piers[0][0], piers[0][1], t, t, h, faceColors(pillar));

  // כנפיים: סגורות חוצות את המעבר, פתוחות מקופלות אל העמודים
  const half = size * 0.5 - t * 0.5;
  if (open) {
    if (alongX) {
      drawBox(ctx, cam, wx + t * 0.2, cy - t * 0.2, t * 0.7, t * 0.3, h * 0.78, faceColors(leaf));
      drawBox(ctx, cam, wx + size - t * 0.9, cy - t * 0.2, t * 0.7, t * 0.3, h * 0.78, faceColors(leaf));
    } else {
      drawBox(ctx, cam, cx - t * 0.2, wy + t * 0.2, t * 0.3, t * 0.7, h * 0.78, faceColors(leaf));
      drawBox(ctx, cam, cx - t * 0.2, wy + size - t * 0.9, t * 0.3, t * 0.7, h * 0.78, faceColors(leaf));
    }
  } else if (alongX) {
    drawBox(ctx, cam, wx + t * 0.6, cy - 0.07, half, 0.14, h * 0.78, faceColors(leaf));
    drawBox(ctx, cam, cx, cy - 0.07, half, 0.14, h * 0.78, faceColors(leaf));
  } else {
    drawBox(ctx, cam, cx - 0.07, wy + t * 0.6, 0.14, half, h * 0.78, faceColors(leaf));
    drawBox(ctx, cam, cx - 0.07, cy, 0.14, half, h * 0.78, faceColors(leaf));
  }

  drawBox(ctx, cam, piers[1][0], piers[1][1], t, t, h, faceColors(pillar));

  // משקוף מעל המעבר
  if (alongX) {
    drawBox(ctx, cam, wx, cy - t / 2, size, t, 0.14, faceColors(stone ? shade(pal.wall, -0.06) : '#8a6b47'), h);
  } else {
    drawBox(ctx, cam, cx - t / 2, wy, t, size, 0.14, faceColors(stone ? shade(pal.wall, -0.06) : '#8a6b47'), h);
  }
}
function drawConstructionSite(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  size: number,
  pal: StructurePalette,
  progress: number,
): void {
  apron(ctx, cam, wx + 0.1, wy + 0.1, size - 0.2, '#6b5a44');
  const h = 0.25 + progress * 0.7;
  drawBox(ctx, cam, wx + 0.2, wy + 0.2, size - 0.4, size - 0.4, h * 0.5, faceColors(shade(pal.wall, -0.2)));
  // פיגומים
  ctx.strokeStyle = '#a07b4a';
  ctx.lineWidth = Math.max(1, cam.zoom * 0.035);
  const corners = [
    [wx + 0.15, wy + 0.15],
    [wx + size - 0.15, wy + 0.15],
    [wx + size - 0.15, wy + size - 0.15],
    [wx + 0.15, wy + size - 0.15],
  ];
  for (const [cx, cy] of corners) {
    const a = cam.worldToScreen(cx, cy, 0);
    const b = cam.worldToScreen(cx, cy, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const z of [h * 0.5, h]) {
    ctx.beginPath();
    corners.forEach(([cx, cy], i) => {
      const p = cam.worldToScreen(cx, cy, z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
}
