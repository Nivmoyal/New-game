import type { BuildingDef } from '../../data/schema';
import type { Camera } from '../camera';
import {
  drawBox, drawCastShadow, drawColumn, drawFacade, drawFlag, drawGableRoof, drawHipRoof,
  drawRoof, faceColors, poly, shade, type RoofStyle,
} from '../iso';
import { drawFarmField, tileHash } from './nature';

/**
 * מבנים תלת-ממדיים מצוירים פרוצדורלית.
 *
 * כל מבנה מורכב מתיבות, גגות ועמודים. ה"ארכיטיפ" נגזר מהנתונים
 * (תפקיד המבנה) ולא מרשימה קשיחה, כך שמבנה חדש שנוסף ל-JSON
 * מקבל מראה סביר אוטומטית.
 */

export type Archetype =
  | 'townCenter'
  | 'house'
  | 'longhouse'
  | 'farm'
  | 'storage'
  | 'barracks'
  | 'range'
  | 'stable'
  | 'workshop'
  | 'tower'
  | 'wall'
  | 'gate'
  | 'market'
  | 'temple'
  | 'academy'
  | 'castle'
  | 'monument'
  | 'factory'
  | 'radar'
  | 'hospital'
  | 'port';

const BY_ID: Record<string, Archetype> = {
  house: 'house',
  farm: 'farm',
  mill: 'storage',
  lumber_camp: 'storage',
  mining_camp: 'storage',
  barracks: 'barracks',
  archery_range: 'range',
  stable: 'stable',
  siege_workshop: 'workshop',
  blacksmith: 'workshop',
  market: 'market',
  temple: 'temple',
  academy: 'academy',
  tower: 'tower',
  wall: 'wall',
  gate: 'gate',
  fortress: 'castle',
  il_watertower: 'tower',
  il_dining_hall: 'longhouse',
  il_school: 'academy',
  il_factory: 'factory',
  il_military_base: 'barracks',
  il_airdefense: 'radar',
  il_hospital: 'hospital',
  il_exchange: 'market',
  il_hightech: 'factory',
  jp_castle: 'castle',
  jp_dojo: 'longhouse',
  jp_shrine: 'temple',
  ar_wisdom_house: 'academy',
  ar_bazaar: 'market',
  ar_caravanserai: 'longhouse',
  rm_forum: 'temple',
  rm_aqueduct: 'monument',
  rm_castrum: 'barracks',
  eg_granary: 'storage',
  eg_obelisk: 'monument',
  eg_pyramid: 'monument',
  vk_longhouse: 'longhouse',
  vk_mead_hall: 'longhouse',
  vk_harbor: 'port',
  dock: 'port',
  vk_forge: 'workshop',
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
  if (def.dropOff) return 'storage';
  if (def.researches?.length) return 'academy';
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
  // טיח בהיר וגגות רעפים אדומים
  israel: { wall: '#e8dfc8', roof: '#c0563a', trim: '#9aa7b4', roofStyle: 'gable', texture: 'plaster' },
  // גגות פגודה רחבים בשתי שכבות, קירות עץ בהירים
  japan: { wall: '#e4d7bd', roof: '#3f4a5a', trim: '#8c3b32', roofStyle: 'pagoda', texture: 'wood' },
  // כיפות על גגות שטוחים וקירות חימר
  arabs: { wall: '#e6d3a8', roof: '#d8bd7a', trim: '#3f7d78', roofStyle: 'dome', texture: 'mud' },
  // רעפי חרס על גג ארבע-שיפועים, קירות שיש
  rome: { wall: '#eee7d8', roof: '#b4523c', trim: '#c9b37a', roofStyle: 'hip', texture: 'stone' },
  // גגות שטוחים עם מעקה, אבן חול
  egypt: { wall: '#ddc89a', roof: '#cbb277', trim: '#3f7d9c', roofStyle: 'flat', texture: 'stone' },
  // גגות דשא תלולים על קירות עץ
  vikings: { wall: '#8a6b47', roof: '#4f6b40', trim: '#6b7f8c', roofStyle: 'turf', texture: 'wood' },
};

/** לאילו שכנים החומה מתחברת. */
export type WallLinks = { n: boolean; e: boolean; s: boolean; w: boolean };

const NO_LINKS: WallLinks = { n: false, e: false, s: false, w: false };

export function paletteFor(nationId: string, ownerColor: string): StructurePalette {
  const p = NATION_PALETTE[nationId] ?? NATION_PALETTE.israel;
  return { ...p, owner: ownerColor };
}

/**
 * מצייר מבנה. (wx,wy) היא פינת שמאל-עליון בעולם, `size` צד המבנה באריחים.
 * `progress` (0..1) מצייר אתר בנייה עם פיגומים כשהוא קטן מ-1.
 */
/** גובה משוער לכל ארכיטיפ — משמש לחישוב אורך הצל המוטל. */
const SHADOW_HEIGHT: Record<Archetype, number> = {
  townCenter: 1.15, house: 0.7, longhouse: 0.78, farm: 0.3, storage: 0.55,
  barracks: 0.75, range: 0.62, stable: 0.68, workshop: 0.72, tower: 1.2,
  wall: 0.75, gate: 1.0, market: 0.6, temple: 0.95, academy: 0.78, castle: 1.4,
  monument: 1.2, factory: 0.9, radar: 0.85, hospital: 0.72, port: 0.62,
};

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
  } = {},
): void {
  const progress = opts.progress ?? 1;
  const time = opts.time ?? 0;
  const seed = opts.seed ?? 0;

  // צל מוטל על הקרקע — מה שגורם למבנה "לשבת" בעולם ולא לרחף
  const shadowH = (SHADOW_HEIGHT[arch] ?? 0.7) * (progress < 1 ? 0.45 : 1);
  drawCastShadow(ctx, cam, wx + size * 0.1, wy + size * 0.1, size * 0.8, size * 0.8, shadowH);

  if (progress < 1) {
    drawConstructionSite(ctx, cam, wx, wy, size, pal, progress);
    return;
  }

  const m = size * 0.1; // שוליים
  const x = wx + m;
  const y = wy + m;
  const s = size - m * 2;

  switch (arch) {
    case 'townCenter':
      drawTownCenter(ctx, cam, x, y, s, pal, opts.stage ?? 1, time);
      break;
    case 'house':
      drawSimpleHouse(ctx, cam, x, y, s, pal, seed);
      break;
    case 'longhouse':
      drawLonghouse(ctx, cam, x, y, s, pal);
      break;
    case 'farm':
      drawFarm(ctx, cam, wx, wy, size, pal);
      break;
    case 'storage':
      drawStorage(ctx, cam, x, y, s, pal);
      break;
    case 'barracks':
      drawBarracks(ctx, cam, x, y, s, pal, time);
      break;
    case 'range':
      drawRange(ctx, cam, x, y, s, pal);
      break;
    case 'stable':
      drawStable(ctx, cam, x, y, s, pal);
      break;
    case 'workshop':
      drawWorkshop(ctx, cam, x, y, s, pal, time);
      break;
    case 'tower':
      drawTower(ctx, cam, x, y, s, pal, time);
      break;
    case 'wall':
      drawWall(ctx, cam, wx, wy, size, pal, opts.links ?? NO_LINKS, opts.stage ?? 1);
      break;
    case 'gate':
      drawGate(ctx, cam, wx, wy, size, pal, opts.links ?? NO_LINKS, opts.gateOpen ?? false, opts.stage ?? 1);
      break;
    case 'market':
      drawMarket(ctx, cam, x, y, s, pal);
      break;
    case 'temple':
      drawTemple(ctx, cam, x, y, s, pal);
      break;
    case 'academy':
      drawAcademy(ctx, cam, x, y, s, pal);
      break;
    case 'castle':
      drawCastle(ctx, cam, x, y, s, pal, time);
      break;
    case 'monument':
      drawMonument(ctx, cam, x, y, s, pal);
      break;
    case 'factory':
      drawFactory(ctx, cam, x, y, s, pal, time);
      break;
    case 'radar':
      drawRadar(ctx, cam, x, y, s, pal, time);
      break;
    case 'hospital':
      drawHospital(ctx, cam, x, y, s, pal);
      break;
    case 'port':
      drawPort(ctx, cam, x, y, s, pal, opts.waterSide ?? 'e');
      break;
  }
}

// ===== בסיסים משותפים =====

/**
 * מרקם הקיר והפתחים על תיבה שכבר צוירה.
 * מתרגם את מרקם האומה לנדבכים או לקרשים, ומוסיף חלונות ודלת.
 */
function facade(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number, y: number, w: number, d: number, h: number,
  pal: StructurePalette,
  wallColor: string,
  opts: { windows?: number; windowRows?: number; door?: boolean; lit?: boolean; seed?: number; baseZ?: number } = {},
): void {
  drawFacade(ctx, cam, x, y, w, d, h, wallColor, {
    courses: pal.texture === 'stone' ? 4 : pal.texture === 'mud' ? 3 : 0,
    planks: pal.texture === 'wood' ? Math.max(3, Math.round(w * 3.5)) : 0,
    ...opts,
  });
}

function platform(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, s: number, color: string): void {
  drawBox(ctx, cam, x - 0.08, y - 0.08, s + 0.16, s + 0.16, 0.06, faceColors(color));
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
  platform(ctx, cam, wx + 0.1, wy + 0.1, size - 0.2, '#6b5a44');
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

// ===== ארכיטיפים =====

function drawTownCenter(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  stage: number,
  time: number,
): void {
  platform(ctx, cam, x, y, s, shade(pal.wall, -0.42));
  const body = s * 0.62;
  const ox = x + (s - body) / 2;
  const oy = y + (s - body) / 2;
  const h = 0.55 + stage * 0.16;
  drawBox(ctx, cam, ox, oy, body, body, h, faceColors(pal.wall));
  facade(ctx, cam, ox, oy, body, body, h, pal, pal.wall, {
    windows: 3, windowRows: stage >= 3 ? 2 : 1, door: true, lit: true, seed: stage * 7,
  });
  drawRoof(pal.roofStyle, ctx, cam, ox, oy, body, body, h, 0.32 + stage * 0.06, pal.roof);

  // אגפים נמוכים משני הצדדים — היישוב "גדל" עם השלב
  const wing = s * 0.26;
  drawBox(ctx, cam, x, oy + body * 0.15, wing, body * 0.7, 0.34, faceColors(shade(pal.wall, -0.08)));
  drawGableRoof(ctx, cam, x, oy + body * 0.15, wing, body * 0.7, 0.34, 0.16, pal.roof, false);
  if (stage >= 2) {
    drawBox(ctx, cam, x + s - wing, oy + body * 0.15, wing, body * 0.7, 0.34, faceColors(shade(pal.wall, -0.08)));
    drawGableRoof(ctx, cam, x + s - wing, oy + body * 0.15, wing, body * 0.7, 0.34, 0.16, pal.roof, false);
  }
  if (stage >= 3) {
    drawColumn(ctx, cam, ox + body * 0.5, oy + body * 0.5, 0.16, h + 0.55, shade(pal.wall, 0.1));
  }
  drawFlag(ctx, cam, ox + body * 0.5, oy + body * 0.5, h + (stage >= 3 ? 0.55 : 0.3), 0.5, pal.owner, time);
}

function drawSimpleHouse(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  seed: number,
): void {
  const along = tileHash(Math.round(x), Math.round(y), seed) > 0.5;
  drawBox(ctx, cam, x, y, s, s, 0.4, faceColors(pal.wall));
  facade(ctx, cam, x, y, s, s, 0.4, pal, pal.wall, { windows: 2, door: true, lit: true, seed });
  drawRoof(pal.roofStyle, ctx, cam, x, y, s, s, 0.4, 0.3, pal.roof, along);
}

function drawLonghouse(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  const w = s;
  const d = s * 0.62;
  const oy = y + (s - d) / 2;
  drawBox(ctx, cam, x, oy, w, d, 0.36, faceColors(pal.wall));
  facade(ctx, cam, x, oy, w, d, 0.36, pal, pal.wall, { windows: 3, door: true, lit: true, seed: 3 });
  drawRoof(pal.roofStyle, ctx, cam, x, oy, w, d, 0.36, 0.42, pal.roof, true);
  // עמודי תמך
  for (let i = 0; i <= 3; i++) {
    drawColumn(ctx, cam, x + (i / 3) * w, oy + d + 0.06, 0.04, 0.4, '#6b4a2f');
  }
}

function drawFarm(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  size: number,
  pal: StructurePalette,
): void {
  drawFarmField(ctx, cam, wx + 0.05, wy + 0.05, size - 0.1, size - 0.1, 0.7);
  // גדר
  ctx.strokeStyle = '#8a6b47';
  ctx.lineWidth = Math.max(1, cam.zoom * 0.03);
  const corners = [
    cam.worldToScreen(wx + 0.05, wy + 0.05, 0.12),
    cam.worldToScreen(wx + size - 0.05, wy + 0.05, 0.12),
    cam.worldToScreen(wx + size - 0.05, wy + size - 0.05, 0.12),
    cam.worldToScreen(wx + 0.05, wy + size - 0.05, 0.12),
  ];
  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  // אסם קטן בפינה
  drawBox(ctx, cam, wx + size * 0.62, wy + size * 0.62, size * 0.3, size * 0.3, 0.24, faceColors(pal.wall));
  facade(ctx, cam, wx + size * 0.62, wy + size * 0.62, size * 0.3, size * 0.3, 0.24, pal, pal.wall, { door: true });
  drawGableRoof(ctx, cam, wx + size * 0.62, wy + size * 0.62, size * 0.3, size * 0.3, 0.24, 0.18, pal.roof);
}

function drawStorage(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  drawBox(ctx, cam, x, y, s * 0.72, s * 0.72, 0.32, faceColors(pal.wall));
  facade(ctx, cam, x, y, s * 0.72, s * 0.72, 0.32, pal, pal.wall, { windows: 1, door: true, seed: 5 });
  drawRoof(pal.roofStyle, ctx, cam, x, y, s * 0.72, s * 0.72, 0.32, 0.22, pal.roof);
  // ערימות וחביות
  drawBox(ctx, cam, x + s * 0.76, y + s * 0.1, s * 0.2, s * 0.2, 0.14, faceColors('#8a6a3f'));
  drawBox(ctx, cam, x + s * 0.76, y + s * 0.45, s * 0.2, s * 0.2, 0.2, faceColors('#9a7a4a'));
}

function drawBarracks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  time: number,
): void {
  platform(ctx, cam, x, y, s, shade(pal.wall, -0.45));
  drawBox(ctx, cam, x, y, s, s * 0.66, 0.46, faceColors(pal.wall));
  facade(ctx, cam, x, y, s, s * 0.66, 0.46, pal, pal.wall, { windows: 3, door: true, lit: true, seed: 9 });
  drawRoof(pal.roofStyle, ctx, cam, x, y, s, s * 0.66, 0.46, 0.26, pal.roof, true);
  // מגרש מסדרים + מתלה נשק
  for (let i = 0; i < 3; i++) {
    drawColumn(ctx, cam, x + s * (0.2 + i * 0.3), y + s * 0.85, 0.04, 0.3, '#6b4a2f');
  }
  drawFlag(ctx, cam, x + s * 0.06, y + s * 0.9, 0, 0.8, pal.owner, time);
}

function drawRange(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  drawBox(ctx, cam, x, y, s * 0.55, s * 0.6, 0.38, faceColors(pal.wall));
  facade(ctx, cam, x, y, s * 0.55, s * 0.6, 0.38, pal, pal.wall, { windows: 1, door: true, seed: 13 });
  drawGableRoof(ctx, cam, x, y, s * 0.55, s * 0.6, 0.38, 0.22, pal.roof, false);
  // מטרות קש
  for (let i = 0; i < 2; i++) {
    const tx = x + s * 0.78;
    const ty = y + s * (0.25 + i * 0.42);
    drawColumn(ctx, cam, tx, ty, 0.05, 0.36, '#6b4a2f');
    const c = cam.worldToScreen(tx, ty, 0.44);
    ctx.fillStyle = '#d9c88a';
    ctx.beginPath();
    ctx.arc(c.x, c.y, cam.zoom * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8443a';
    ctx.beginPath();
    ctx.arc(c.x, c.y, cam.zoom * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStable(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  drawBox(ctx, cam, x, y, s * 0.68, s * 0.7, 0.4, faceColors(pal.wall));
  facade(ctx, cam, x, y, s * 0.68, s * 0.7, 0.4, pal, pal.wall, { windows: 2, door: true, seed: 17 });
  drawRoof(pal.roofStyle, ctx, cam, x, y, s * 0.68, s * 0.7, 0.4, 0.28, pal.roof, true);
  // מכלאה
  ctx.strokeStyle = '#8a6b47';
  ctx.lineWidth = Math.max(1, cam.zoom * 0.035);
  const pen = [
    cam.worldToScreen(x + s * 0.72, y + s * 0.05, 0.18),
    cam.worldToScreen(x + s, y + s * 0.05, 0.18),
    cam.worldToScreen(x + s, y + s * 0.95, 0.18),
    cam.worldToScreen(x + s * 0.72, y + s * 0.95, 0.18),
  ];
  ctx.beginPath();
  pen.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

function drawWorkshop(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  time: number,
): void {
  drawBox(ctx, cam, x, y, s * 0.8, s * 0.72, 0.42, faceColors(shade(pal.wall, -0.12)));
  facade(ctx, cam, x, y, s * 0.8, s * 0.72, 0.42, pal, shade(pal.wall, -0.12), {
    windows: 2, door: true, lit: true, seed: 21,
  });
  drawGableRoof(ctx, cam, x, y, s * 0.8, s * 0.72, 0.42, 0.2, shade(pal.roof, -0.15), true);
  // ארובה עם עשן
  drawColumn(ctx, cam, x + s * 0.72, y + s * 0.2, 0.09, 0.85, '#7a6a5a');
  const smoke = (time * 0.0006) % 1;
  for (let i = 0; i < 3; i++) {
    const t = (smoke + i / 3) % 1;
    const p = cam.worldToScreen(x + s * 0.72 + t * 0.25, y + s * 0.2 - t * 0.2, 0.85 + t * 0.7);
    ctx.fillStyle = `rgba(200,200,200,${0.3 * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cam.zoom * (0.05 + t * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTower(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  time: number,
): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = Math.max(0.22, s * 0.36);
  drawColumn(ctx, cam, cx, cy, r, 1.0, pal.wall);
  // חפיר עליון (שיננים)
  const merlons = 8;
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * Math.PI * 2;
    const mx = cx + Math.cos(a) * r * 0.92;
    const my = cy + Math.sin(a) * r * 0.92;
    drawBox(ctx, cam, mx - 0.05, my - 0.05, 0.1, 0.1, 0.16, faceColors(shade(pal.wall, -0.1)), 1.0);
  }
  drawFlag(ctx, cam, cx, cy, 1.16, 0.4, pal.owner, time);
}

/**
 * חומה שמתחברת לשכנותיה.
 *
 * במקום קובייה בודדת לכל אריח, כל אריח מצייר עמוד מרכזי וזרועות
 * לכיוון כל שכן — חומה, שער או מגדל של אותו בעלים. כך קו חומה נראה
 * כקו אחד רציף, ופינה נראית כפינה.
 *
 * הסדר חשוב: הזרועות הרחוקות (צפון ומערב) קודם, אחר כך העמוד שמסתיר
 * את התפר, ורק אז הזרועות הקרובות — אחרת התפרים נראים.
 */
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

/**
 * שער: שני עמודי צד, משקוף, ושתי כנפיים שנפתחות כשיחידה ידידותית מתקרבת.
 * הציר נקבע לפי החומה שמתחברת אליו.
 */
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

function drawMarket(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  platform(ctx, cam, x, y, s, shade(pal.wall, -0.4));
  drawBox(ctx, cam, x, y, s * 0.5, s * 0.5, 0.34, faceColors(pal.wall));
  facade(ctx, cam, x, y, s * 0.5, s * 0.5, 0.34, pal, pal.wall, { windows: 1, door: true, seed: 25 });
  drawGableRoof(ctx, cam, x, y, s * 0.5, s * 0.5, 0.34, 0.2, pal.roof);
  // דוכנים עם סוככים צבעוניים
  const awnings = ['#c85f4a', '#4a86c8', '#c8a94a'];
  for (let i = 0; i < 3; i++) {
    const sx = x + s * 0.56;
    const sy = y + s * (0.08 + i * 0.3);
    for (const dx of [0, 0.3]) {
      drawColumn(ctx, cam, sx + dx, sy, 0.03, 0.3, '#6b4a2f');
      drawColumn(ctx, cam, sx + dx, sy + 0.24, 0.03, 0.3, '#6b4a2f');
    }
    poly(ctx, [
      cam.worldToScreen(sx - 0.05, sy - 0.05, 0.34),
      cam.worldToScreen(sx + 0.35, sy - 0.05, 0.34),
      cam.worldToScreen(sx + 0.35, sy + 0.29, 0.3),
      cam.worldToScreen(sx - 0.05, sy + 0.29, 0.3),
    ], awnings[i % awnings.length]);
  }
}

function drawTemple(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  platform(ctx, cam, x, y, s, shade(pal.wall, -0.3));
  const body = s * 0.7;
  const ox = x + (s - body) / 2;
  const oy = y + (s - body) / 2;
  // עמודים בחזית
  for (let i = 0; i <= 3; i++) {
    drawColumn(ctx, cam, ox + (i / 3) * body, oy + body + 0.04, 0.06, 0.55, shade(pal.wall, 0.12), 0.06);
  }
  drawBox(ctx, cam, ox, oy, body, body, 0.55, faceColors(pal.wall), 0.06);
  facade(ctx, cam, ox, oy, body, body, 0.55, pal, pal.wall, { baseZ: 0.06, door: true });
  drawRoof(pal.roofStyle, ctx, cam, ox, oy, body, body, 0.61, 0.3, pal.trim);
}

function drawAcademy(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  drawBox(ctx, cam, x, y, s, s * 0.6, 0.5, faceColors(pal.wall));
  facade(ctx, cam, x, y, s, s * 0.6, 0.5, pal, pal.wall, {
    windows: 4, windowRows: 2, door: true, lit: true, seed: 29,
  });
  drawRoof(pal.roofStyle, ctx, cam, x, y, s, s * 0.6, 0.5, 0.22, pal.roof, true);
  // כיפת ידע
  drawColumn(ctx, cam, x + s * 0.5, y + s * 0.3, 0.16, 0.9, shade(pal.trim, 0.1));
}

function drawCastle(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  time: number,
): void {
  platform(ctx, cam, x, y, s, shade(pal.wall, -0.45));
  drawBox(ctx, cam, x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76, 0.75, faceColors(pal.wall));
  facade(ctx, cam, x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76, 0.75, pal, pal.wall, {
    windows: 3, windowRows: 2, door: true, seed: 33,
  });
  drawRoof(pal.roofStyle, ctx, cam, x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76, 0.75, 0.3, pal.roof);
  // ארבעה צריחים
  const corners: Array<[number, number]> = [
    [x + 0.1, y + 0.1],
    [x + s - 0.1, y + 0.1],
    [x + s - 0.1, y + s - 0.1],
    [x + 0.1, y + s - 0.1],
  ];
  for (const [cx, cy] of corners) {
    drawColumn(ctx, cam, cx, cy, 0.2, 1.05, shade(pal.wall, -0.06));
    drawHipRoof(ctx, cam, cx - 0.22, cy - 0.22, 0.44, 0.44, 1.05, 0.34, pal.roof, 0.04);
  }
  drawFlag(ctx, cam, x + s * 0.5, y + s * 0.5, 1.05, 0.55, pal.owner, time);
}

function drawMonument(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  platform(ctx, cam, x, y, s, shade(pal.wall, -0.35));
  // פירמידה מדורגת
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const inset = t * s * 0.42;
    drawBox(
      ctx, cam,
      x + inset, y + inset,
      s - inset * 2, s - inset * 2,
      0.22,
      faceColors(shade(pal.wall, -t * 0.12)),
      0.06 + i * 0.22,
    );
  }
}

function drawFactory(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  time: number,
): void {
  drawBox(ctx, cam, x, y, s, s * 0.72, 0.52, faceColors(shade(pal.trim, -0.1)));
  drawFacade(ctx, cam, x, y, s, s * 0.72, 0.52, shade(pal.trim, -0.1), {
    windows: 5, windowRows: 2, lit: true, seed: 37,
  });
  // גג משוני (sawtooth)
  for (let i = 0; i < 3; i++) {
    const sx = x + (i / 3) * s;
    const w = s / 3;
    poly(ctx, [
      cam.worldToScreen(sx, y, 0.52),
      cam.worldToScreen(sx + w, y, 0.52),
      cam.worldToScreen(sx + w, y + s * 0.72, 0.52),
      cam.worldToScreen(sx, y + s * 0.72, 0.52),
    ], shade('#6b7785', -0.05));
    poly(ctx, [
      cam.worldToScreen(sx, y, 0.52),
      cam.worldToScreen(sx, y + s * 0.72, 0.52),
      cam.worldToScreen(sx, y + s * 0.72, 0.72),
      cam.worldToScreen(sx, y, 0.72),
    ], '#8fa3b8');
  }
  drawColumn(ctx, cam, x + s * 0.88, y + s * 0.2, 0.1, 1.2, '#7a6a5a');
  const smoke = (time * 0.0005) % 1;
  for (let i = 0; i < 4; i++) {
    const t = (smoke + i / 4) % 1;
    const p = cam.worldToScreen(x + s * 0.88 + t * 0.3, y + s * 0.2 - t * 0.25, 1.2 + t * 0.9);
    ctx.fillStyle = `rgba(190,195,205,${0.28 * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cam.zoom * (0.06 + t * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  time: number,
): void {
  drawBox(ctx, cam, x, y, s, s * 0.6, 0.3, faceColors('#5c6470'));
  // מכולת שיגור עם תאי טילים
  drawBox(ctx, cam, x + s * 0.1, y + s * 0.1, s * 0.55, s * 0.4, 0.34, faceColors(shade(pal.trim, -0.2)), 0.3);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const c = cam.worldToScreen(x + s * (0.18 + i * 0.16), y + s * (0.18 + j * 0.16), 0.66);
      ctx.fillStyle = '#2b3138';
      ctx.beginPath();
      ctx.arc(c.x, c.y, cam.zoom * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // צלחת מכ"ם מסתובבת
  const cx = x + s * 0.8;
  const cy = y + s * 0.3;
  drawColumn(ctx, cam, cx, cy, 0.05, 0.75, '#6b7380');
  const spin = time * 0.0016;
  const dish = cam.worldToScreen(cx, cy, 0.8);
  ctx.save();
  ctx.translate(dish.x, dish.y);
  ctx.scale(1, 0.5);
  ctx.rotate(spin);
  ctx.fillStyle = '#c3cbd4';
  ctx.beginPath();
  ctx.ellipse(0, 0, cam.zoom * 0.16, cam.zoom * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHospital(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  drawBox(ctx, cam, x, y, s, s * 0.7, 0.55, faceColors('#f2f4f6'));
  drawFacade(ctx, cam, x, y, s, s * 0.7, 0.55, '#f2f4f6', {
    windows: 4, windowRows: 2, lit: true, door: true, seed: 41,
  });
  drawBox(ctx, cam, x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.5, 0.12, faceColors('#dfe4e8'), 0.55);
  // צלב
  const c = cam.worldToScreen(x + s * 0.5, y + s * 0.7, 0.38);
  const t = cam.zoom * 0.06;
  ctx.fillStyle = '#d64545';
  ctx.fillRect(c.x - t * 0.5, c.y - t * 1.5, t, t * 3);
  ctx.fillRect(c.x - t * 1.5, c.y - t * 0.5, t * 3, t);
  void pal;
}

/**
 * נמל. המזח מופנה אל המים — אחרת הוא נראה כמו רציף שנבנה על הדשא.
 */
function drawPort(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
  waterSide: 'n' | 's' | 'e' | 'w',
): void {
  // מחסן הנמל יושב בצד ההפוך למים
  const b = s * 0.58;
  const house = {
    n: { x: x + (s - b) / 2, y: y + s - b },
    s: { x: x + (s - b) / 2, y },
    e: { x, y: y + (s - b) / 2 },
    w: { x: x + s - b, y: y + (s - b) / 2 },
  }[waterSide];
  // המזח נמתח אל המים
  const pier = {
    n: { x: x + s * 0.2, y, w: s * 0.6, d: s * 0.36 },
    s: { x: x + s * 0.2, y: y + s * 0.64, w: s * 0.6, d: s * 0.36 },
    e: { x: x + s * 0.64, y: y + s * 0.2, w: s * 0.36, d: s * 0.6 },
    w: { x, y: y + s * 0.2, w: s * 0.36, d: s * 0.6 },
  }[waterSide];

  const pierFirst = waterSide === 'n' || waterSide === 'w';
  const drawPier = () => {
    drawBox(ctx, cam, pier.x, pier.y, pier.w, pier.d, 0.1, faceColors('#8a6b47'));
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.3;
      const px = waterSide === 'n' || waterSide === 's' ? pier.x + pier.w * t : pier.x + pier.w * 0.85;
      const py = waterSide === 'n' || waterSide === 's' ? pier.y + pier.d * 0.85 : pier.y + pier.d * t;
      drawColumn(ctx, cam, px, py, 0.045, 0.34, '#6b4a2f');
    }
  };

  if (pierFirst) drawPier();
  drawBox(ctx, cam, house.x, house.y, b, b, 0.38, faceColors(pal.wall));
  facade(ctx, cam, house.x, house.y, b, b, 0.38, pal, pal.wall, { windows: 1, door: true, seed: 45 });
  drawRoof(pal.roofStyle, ctx, cam, house.x, house.y, b, b, 0.38, 0.26, pal.roof, true);
  if (!pierFirst) drawPier();
}
