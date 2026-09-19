import type { BuildingDef, UnitDef } from '../data/schema';
import type { EntityId, PlayerId, ResourceKind, UnitClass, Vec2 } from './types';

export type OrderKind =
  | 'idle'
  | 'move'
  | 'attack'
  | 'attackMove'
  | 'gather'
  | 'return'
  | 'build'
  | 'repair'
  | 'heal'
  | 'hold';

export type Order = {
  kind: OrderKind;
  /** יעד במרחב (לתנועה) */
  target?: Vec2;
  /** ישות יעד (תקיפה/בנייה/פריקה) */
  targetId?: EntityId;
  /** אריח משאב (איסוף) */
  tile?: Vec2;
  resource?: ResourceKind;
  /** נקודת חזרה אחרי שהמשימה נגמרת (למשל אחרי פריקה) */
  resume?: Order;
};

export type TrainItem = {
  unitId: string;
  /** זמן שנותר בשניות */
  remaining: number;
  total: number;
};

export type ResearchItem = {
  techId: string;
  remaining: number;
  total: number;
};

export type UnitComp = {
  cls: UnitClass;
  /** מסלול נוכחי באריחים */
  path: Vec2[];
  /** יעד סופי */
  goal: Vec2 | null;
  /** זמן עד למכה הבאה */
  cooldown: number;
  carrying: { kind: ResourceKind; amount: number } | null;
  facing: number;
  /** סימון "תקוע" — לשחרור מקומי מהתנגשויות */
  stuckTime: number;
  /** מיקום הזזה זמני להימנעות בין יחידות */
  push: Vec2;
  /** היחידה כבר חישבה מסלול בפריים הזה? (מגביל חישובי A* לפריים) */
  repathCooldown: number;
  /** אנימציית התקפה 0..1 */
  attackAnim: number;
};

export type BuildingComp = {
  size: number;
  complete: boolean;
  /** 0..1 */
  progress: number;
  trainQueue: TrainItem[];
  research: ResearchItem | null;
  rally: Vec2 | null;
  attackCooldown: number;
  /** צובר שברי משאבים מ-trickle */
  trickleAcc: Partial<Record<ResourceKind, number>>;
  healAcc: number;
};

export type Entity = {
  id: EntityId;
  kind: 'unit' | 'building';
  defId: string;
  owner: PlayerId;
  /** מרכז הישות בקואורדינטות אריחים (שבר אפשרי) */
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  order: Order;
  /** תור פקודות (Shift) */
  queue: Order[];
  unit?: UnitComp;
  building?: BuildingComp;
  /** זמן מאז שהישות ספגה נזק — לתצוגת פס חיים */
  lastDamaged: number;
  /** מי תקף אחרון — לתגובה אוטומטית */
  lastAttacker: EntityId | null;
};

let nextId = 1;

export function resetEntityIds(start = 1): void {
  nextId = start;
}

export function peekNextEntityId(): number {
  return nextId;
}

export function createUnit(def: UnitDef, owner: PlayerId, pos: Vec2, maxHp?: number): Entity {
  const hp = maxHp ?? def.hp;
  return {
    id: nextId++,
    kind: 'unit',
    defId: def.id,
    owner,
    pos: { x: pos.x, y: pos.y },
    hp,
    maxHp: hp,
    alive: true,
    order: { kind: 'idle' },
    queue: [],
    lastDamaged: -999,
    lastAttacker: null,
    unit: {
      cls: def.class,
      path: [],
      goal: null,
      cooldown: 0,
      carrying: null,
      facing: 0,
      stuckTime: 0,
      push: { x: 0, y: 0 },
      repathCooldown: 0,
      attackAnim: 0,
    },
  };
}

export function createBuilding(
  def: BuildingDef,
  owner: PlayerId,
  /** פינת שמאל-עליון באריחים */
  tile: Vec2,
  complete: boolean,
  maxHp?: number,
): Entity {
  const hp = maxHp ?? def.hp;
  return {
    id: nextId++,
    kind: 'building',
    defId: def.id,
    owner,
    pos: { x: tile.x + def.size / 2, y: tile.y + def.size / 2 },
    hp: complete ? hp : Math.max(1, Math.round(hp * 0.1)),
    maxHp: hp,
    alive: true,
    order: { kind: 'idle' },
    queue: [],
    lastDamaged: -999,
    lastAttacker: null,
    building: {
      size: def.size,
      complete,
      progress: complete ? 1 : 0,
      trainQueue: [],
      research: null,
      rally: null,
      attackCooldown: 0,
      trickleAcc: {},
      healAcc: 0,
    },
  };
}

/** פינת שמאל-עליון של מבנה באריחים. */
export function buildingOrigin(e: Entity): Vec2 {
  const size = e.building?.size ?? 1;
  return { x: Math.round(e.pos.x - size / 2), y: Math.round(e.pos.y - size / 2) };
}

/** רדיוס פיזי משוער של ישות (לחישובי טווח והתנגשות). */
export function entityRadius(e: Entity, unitRadius = 0.35): number {
  if (e.kind === 'building') return (e.building?.size ?? 1) / 2;
  return unitRadius;
}

/** מרחק בין מרכזי ישויות פחות הרדיוסים (מרחק "פנים אל פנים"). */
export function edgeDistance(a: Entity, b: Entity): number {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const d = Math.hypot(dx, dy);
  return d - entityRadius(a) - entityRadius(b);
}
