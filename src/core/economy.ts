import { getBuilding, getUnit } from '../data';
import type { Entity } from './entities';
import type { Player } from './player';
import { ABSOLUTE_POP_CAP, BASE_POP_CAP } from './player';
import type { ResourceKind, Resources } from './types';
import { RESOURCE_KINDS } from './types';

/** כמה משאב פועל אוסף בשנייה, כולל בונוסים. */
export function gatherRateFor(
  workerDefId: string,
  resource: ResourceKind,
  player: Player,
): number {
  const def = getUnit(workerDefId);
  const base = def.gatherRate?.[resource] ?? 0;
  if (base <= 0) return 0;
  return base * player.gatherMultiplier(resource);
}

/** קיבולת נשיאה של פועל. */
export function carryCapacity(workerDefId: string): number {
  return getUnit(workerDefId).carry ?? 0;
}

/**
 * מחשב תקרת אוכלוסייה מכל המבנים של השחקן.
 * בתים מושפעים מ-houseCapBonus (למשל מושב), ובנוסף יש בונוס שלב וטכנולוגיות.
 */
export function computePopCap(player: Player, buildings: Iterable<Entity>): number {
  let cap = BASE_POP_CAP;
  for (const b of buildings) {
    if (!b.alive || b.owner !== player.id) continue;
    if (!b.building?.complete) continue;
    const def = getBuilding(b.defId);
    if (!def.popProvided) continue;
    const bonus = def.id === 'house' ? (player.modifiers.houseCapBonus ?? 0) : 0;
    cap += def.popProvided + bonus;
  }
  for (const stage of player.nation.stages) {
    if (stage.index <= player.stage) cap += stage.popBonus ?? 0;
  }
  cap += player.modifiers.popCapBonus ?? 0;
  cap += player.techBonuses.popCapExtra;
  return Math.min(ABSOLUTE_POP_CAP, Math.round(cap));
}

/** סופר אוכלוסייה בשימוש: יחידות חיות + יחידות בתור אימון. */
export function computePopUsed(player: Player, entities: Iterable<Entity>): number {
  let used = 0;
  for (const e of entities) {
    if (!e.alive || e.owner !== player.id) continue;
    if (e.kind === 'unit') {
      used += getUnit(e.defId).pop;
    } else if (e.building?.complete) {
      for (const item of e.building.trainQueue) used += getUnit(item.unitId).pop;
    }
  }
  return used;
}

/** האם יש מקום לאוכלוסייה נוספת. */
export function hasPopSpace(player: Player, needed: number): boolean {
  return player.popUsed + needed <= player.popCap;
}

/** זרימת משאבים פסיבית ממבנים (חוות, שווקים, בורסה...). */
export function applyTrickle(player: Player, building: Entity, dt: number): void {
  const def = getBuilding(building.defId);
  if (!def.trickle || !building.building?.complete) return;
  const acc = building.building.trickleAcc;
  for (const kind of RESOURCE_KINDS) {
    const rate = def.trickle[kind];
    if (!rate) continue;
    let amount = rate * dt;
    if (kind === 'gold') amount *= player.modifiers.tradeGoldMult ?? 1;
    if (kind === 'food') amount *= player.gatherMultiplier('food');
    acc[kind] = (acc[kind] ?? 0) + amount;
    const whole = Math.floor(acc[kind]!);
    if (whole > 0) {
      acc[kind]! -= whole;
      player.add(kind, whole);
    }
  }
}

/** סכום כולל של משאבים — לסיכום משחק ולבינה מלאכותית. */
export function totalResources(res: Resources): number {
  return RESOURCE_KINDS.reduce((sum, k) => sum + res[k], 0);
}

/** מחסור: כמה חסר מכל משאב כדי לעמוד בעלות. */
export function missingResources(
  have: Resources,
  cost: Partial<Resources>,
): Partial<Resources> {
  const out: Partial<Resources> = {};
  for (const k of RESOURCE_KINDS) {
    const diff = (cost[k] ?? 0) - have[k];
    if (diff > 0) out[k] = Math.ceil(diff);
  }
  return out;
}
