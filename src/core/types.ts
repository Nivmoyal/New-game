/** טיפוסים משותפים לכל מערכות המשחק. */

export type ResourceKind = 'food' | 'wood' | 'stone' | 'gold';

export const RESOURCE_KINDS: ResourceKind[] = ['food', 'wood', 'stone', 'gold'];

export type Resources = Record<ResourceKind, number>;

export function emptyResources(): Resources {
  return { food: 0, wood: 0, stone: 0, gold: 0 };
}

export function makeResources(partial: Partial<Resources>): Resources {
  return { ...emptyResources(), ...partial };
}

/** סוגי יחידות — משפיעים על יחסי החוזק בקרב. */
export type UnitClass =
  | 'worker'    // פועל
  | 'infantry'  // חי"ר
  | 'ranged'    // לוחמי טווח
  | 'cavalry'   // פרשים / שריון
  | 'siege'     // מצור
  | 'air'       // אווירי
  | 'building'; // מבנה (מטרה בלבד)

export type Vec2 = { x: number; y: number };

export type PlayerId = number;

/** מזהה ישות. 0 אינו חוקי. */
export type EntityId = number;

export type Terrain =
  | 'grass'
  | 'dirt'
  | 'sand'
  | 'forest'
  | 'water'
  | 'shallow'
  | 'hill'
  | 'rock';

/** משאב הנמצא על אריח במפה. */
export type TileResource = {
  kind: ResourceKind;
  amount: number;
  /** סוג ויזואלי: עץ, מכרה אבן, מכרה זהב, שיח פירות... */
  visual: 'tree' | 'stone_mine' | 'gold_mine' | 'berry' | 'farm' | 'fish';
};

export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';

export type DiplomacyStance = 'ally' | 'enemy' | 'neutral';

export type GameSpeed = 0.5 | 1 | 1.5 | 2 | 3;

export type Command =
  | { type: 'move'; target: Vec2; formation?: boolean }
  | { type: 'attack'; targetId: EntityId }
  | { type: 'attackMove'; target: Vec2 }
  | { type: 'gather'; targetId: EntityId }
  | { type: 'build'; targetId: EntityId }
  | { type: 'repair'; targetId: EntityId }
  | { type: 'deliver'; targetId: EntityId }
  | { type: 'hold' }
  | { type: 'stop' };

/**
 * המרה ממיקום בעולם (שבר) לאינדקס אריח.
 * מרכז אריח (x,y) הוא (x+0.5, y+0.5), ולכן floor — לא round.
 */
export function toTile(v: number): number {
  return Math.floor(v);
}

export function tileOf(p: Vec2): Vec2 {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

/** מרכז האריח בקואורדינטות עולם. */
export function tileCenter(x: number, y: number): Vec2 {
  return { x: x + 0.5, y: y + 0.5 };
}
