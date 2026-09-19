import type { BuildingDef } from '../../data/schema';
import type { Camera } from '../camera';
import {
  drawBox, drawColumn, drawFlag, drawGableRoof, drawHipRoof, drawRoof,
  faceColors, poly, shade, type RoofStyle,
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
  vk_forge: 'workshop',
};

export function archetypeOf(def: BuildingDef): Archetype {
  const direct = BY_ID[def.id];
  if (direct) return direct;
  if (def.isTownCenter) return 'townCenter';
  if (def.attack && def.range) return 'tower';
  if (def.trains?.length) return 'barracks';
  if (def.popProvided) return 'house';
  if (def.dropOff) return 'storage';
  if (def.researches?.length) return 'academy';
  if (def.trickle) return 'market';
  return 'house';
}

export type StructurePalette = {
  wall: string;
  roof: string;
  trim: string;
  owner: string;
  /** השפה האדריכלית של האומה */
  roofStyle: RoofStyle;
};

/** לוחות צבע לפי אומה — נותן לכל צד מראה משלו. */
const NATION_PALETTE: Record<string, Omit<StructurePalette, 'owner'>> = {
  // טיח בהיר וגגות רעפים אדומים
  israel: { wall: '#e8dfc8', roof: '#c0563a', trim: '#9aa7b4', roofStyle: 'gable' },
  // גגות פגודה רחבים בשתי שכבות, קירות עץ בהירים
  japan: { wall: '#e4d7bd', roof: '#3f4a5a', trim: '#8c3b32', roofStyle: 'pagoda' },
  // כיפות על גגות שטוחים וקירות חימר
  arabs: { wall: '#e6d3a8', roof: '#d8bd7a', trim: '#3f7d78', roofStyle: 'dome' },
  // רעפי חרס על גג ארבע-שיפועים, קירות שיש
  rome: { wall: '#eee7d8', roof: '#b4523c', trim: '#c9b37a', roofStyle: 'hip' },
  // גגות שטוחים עם מעקה, אבן חול
  egypt: { wall: '#ddc89a', roof: '#cbb277', trim: '#3f7d9c', roofStyle: 'flat' },
  // גגות דשא תלולים על קירות עץ
  vikings: { wall: '#8a6b47', roof: '#4f6b40', trim: '#6b7f8c', roofStyle: 'turf' },
};

export function paletteFor(nationId: string, ownerColor: string): StructurePalette {
  const p = NATION_PALETTE[nationId] ?? NATION_PALETTE.israel;
  return { ...p, owner: ownerColor };
}

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
  opts: { progress?: number; stage?: number; time?: number; seed?: number } = {},
): void {
  const progress = opts.progress ?? 1;
  const time = opts.time ?? 0;
  const seed = opts.seed ?? 0;

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
      drawWall(ctx, cam, wx, wy, size, pal);
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
      drawPort(ctx, cam, x, y, s, pal);
      break;
  }
}

// ===== בסיסים משותפים =====

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
  drawRoof(pal.roofStyle, ctx, cam, x, y, s, s, 0.4, 0.3, pal.roof, along);
  // דלת
  const d0 = cam.worldToScreen(x + s * 0.35, y + s, 0);
  const d1 = cam.worldToScreen(x + s * 0.65, y + s, 0);
  const d2 = cam.worldToScreen(x + s * 0.65, y + s, 0.26);
  const d3 = cam.worldToScreen(x + s * 0.35, y + s, 0.26);
  poly(ctx, [d0, d1, d2, d3], '#5a4026');
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

function drawWall(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  size: number,
  pal: StructurePalette,
): void {
  drawBox(ctx, cam, wx + 0.06, wy + 0.06, size - 0.12, size - 0.12, 0.62, faceColors(shade(pal.wall, -0.14)));
  for (let i = 0; i < 2; i++) {
    drawBox(ctx, cam, wx + 0.1 + i * 0.45, wy + 0.1, 0.32, size - 0.2, 0.14, faceColors(shade(pal.wall, -0.02)), 0.62);
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
  drawRoof(pal.roofStyle, ctx, cam, x, y, s, s * 0.6, 0.5, 0.22, pal.roof, true);
  // חלונות
  for (let i = 0; i < 4; i++) {
    const wx0 = x + s * (0.12 + i * 0.22);
    const a = cam.worldToScreen(wx0, y + s * 0.6, 0.18);
    const b = cam.worldToScreen(wx0 + s * 0.12, y + s * 0.6, 0.18);
    const c = cam.worldToScreen(wx0 + s * 0.12, y + s * 0.6, 0.4);
    const d = cam.worldToScreen(wx0, y + s * 0.6, 0.4);
    poly(ctx, [a, b, c, d], '#3c4a5c');
  }
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
  drawBox(ctx, cam, x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.5, 0.12, faceColors('#dfe4e8'), 0.55);
  // צלב
  const c = cam.worldToScreen(x + s * 0.5, y + s * 0.7, 0.38);
  const t = cam.zoom * 0.06;
  ctx.fillStyle = '#d64545';
  ctx.fillRect(c.x - t * 0.5, c.y - t * 1.5, t, t * 3);
  ctx.fillRect(c.x - t * 1.5, c.y - t * 0.5, t * 3, t);
  void pal;
}

function drawPort(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  s: number,
  pal: StructurePalette,
): void {
  drawBox(ctx, cam, x, y, s * 0.6, s * 0.6, 0.36, faceColors(pal.wall));
  drawRoof(pal.roofStyle, ctx, cam, x, y, s * 0.6, s * 0.6, 0.36, 0.24, pal.roof, true);
  // מזח
  drawBox(ctx, cam, x + s * 0.62, y + s * 0.1, s * 0.36, s * 0.8, 0.08, faceColors('#8a6b47'));
  for (let i = 0; i < 3; i++) {
    drawColumn(ctx, cam, x + s * 0.7 + i * 0.25, y + s * 0.85, 0.04, 0.3, '#6b4a2f');
  }
}
