import type { Terrain, TileResource } from '../core/types';

/**
 * שכבת "אמנות": כרגע גרפיקה פרוצדורלית + אמוג'י כ-placeholder.
 * כדי להחליף בספרייטים אמיתיים — ממלאים את SPRITE_SHEET
 * במיפוי מזהה → תמונה, והפונקציה drawSprite תשתמש בה אוטומטית.
 */

export type SpriteSource = { image: CanvasImageSource; sx: number; sy: number; sw: number; sh: number };

/** מיפוי אופציונלי מזהה ישות → ספרייט. ריק = אמוג'י. */
export const SPRITE_SHEET = new Map<string, SpriteSource>();

export function registerSprite(id: string, sprite: SpriteSource): void {
  SPRITE_SHEET.set(id, sprite);
}

export const TERRAIN_COLORS: Record<Terrain, [string, string]> = {
  grass: ['#4b7f3a', '#5c9647'],
  dirt: ['#7a6338', '#8b7142'],
  sand: ['#c8b273', '#d6c184'],
  forest: ['#2f5a23', '#376a2a'],
  water: ['#1d4e79', '#245f92'],
  shallow: ['#2f7ba8', '#3b90bf'],
  hill: ['#6f7a52', '#7d8a5e'],
  rock: ['#6b6b6b', '#7d7d7d'],
};

export const RESOURCE_EMOJI: Record<TileResource['visual'], string> = {
  tree: '🌲',
  berry: '🫐',
  stone_mine: '🪨',
  gold_mine: '🪙',
  farm: '🌾',
  fish: '🐟',
};

export const RESOURCE_COLORS: Record<string, string> = {
  food: '#e05c5c',
  wood: '#8b5a2b',
  stone: '#9aa0a6',
  gold: '#e3b53f',
};

export const RESOURCE_ICONS: Record<string, string> = {
  food: '🍖',
  wood: '🪵',
  stone: '🪨',
  gold: '🪙',
};

/** גיוון דטרמיניסטי לפי אריח — מונע מפה "שטוחה". */
export function tileShade(x: number, y: number): number {
  const h = Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0;
  return (h % 1000) / 1000;
}

/** מצייר אמוג'י ממורכז. */
export function drawEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
  size: number,
): void {
  ctx.font = `${size}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y);
}

/** מצייר ספרייט אם קיים, אחרת אמוג'י. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  id: string,
  emoji: string,
  x: number,
  y: number,
  size: number,
): void {
  const sprite = SPRITE_SHEET.get(id);
  if (sprite) {
    ctx.drawImage(
      sprite.image,
      sprite.sx,
      sprite.sy,
      sprite.sw,
      sprite.sh,
      x - size / 2,
      y - size / 2,
      size,
      size,
    );
    return;
  }
  drawEmoji(ctx, emoji, x, y, size);
}

/** מצייר מלבן מעוגל (ל-HUD ולסימוני בחירה). */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** צל פשוט מתחת ליחידה. */
export function drawShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** פס התקדמות/חיים. */
export function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  color: string,
  background = 'rgba(0,0,0,0.55)',
): void {
  ctx.fillStyle = background;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** צבע פס חיים לפי אחוז. */
export function healthColor(ratio: number): string {
  if (ratio > 0.6) return '#4ade80';
  if (ratio > 0.3) return '#facc15';
  return '#f87171';
}
