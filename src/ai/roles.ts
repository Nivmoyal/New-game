import { getBuilding } from '../data';
import type { BuildingDef } from '../data/schema';

/**
 * סיווג מבנים לפי תפקיד — נגזר מהנתונים עצמם,
 * כך ש-AI יודע לבנות גם עבור אומות שנוספו בעתיד בלי שינוי קוד.
 */
export type BuildingRole =
  | 'townCenter'
  | 'house'
  | 'dropOff'
  | 'farm'
  | 'military'
  | 'defense'
  | 'economy'
  | 'research'
  | 'wall'
  | 'other';

export function roleOf(def: BuildingDef): BuildingRole {
  if (def.isTownCenter) return 'townCenter';
  if (def.id === 'wall') return 'wall';
  if (def.attack && def.range) return 'defense';
  if (def.trains && def.trains.length > 0) return 'military';
  if (def.popProvided && !def.trains) return 'house';
  if (def.dropOff) return 'dropOff';
  if (def.trickle && (def.trickle.food ?? 0) > 0 && !def.researches) return 'farm';
  if (def.trickle) return 'economy';
  if (def.researches && def.researches.length > 0) return 'research';
  return 'other';
}

/** כל המבנים הזמינים לשחקן בתפקיד מסוים, ממוינים לפי עלות (הזול קודם). */
export function availableByRole(
  unlocked: Iterable<string>,
  role: BuildingRole,
): BuildingDef[] {
  const out: BuildingDef[] = [];
  for (const id of unlocked) {
    const def = getBuilding(id);
    if (roleOf(def) === role) out.push(def);
  }
  return out.sort((a, b) => costSum(a) - costSum(b));
}

export function costSum(def: BuildingDef): number {
  return Object.values(def.cost).reduce<number>((s, v) => s + (v ?? 0), 0);
}
