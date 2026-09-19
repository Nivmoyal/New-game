import { stageOf } from '../data';
import type { StageDef } from '../data/schema';
import type { Player } from './player';
import type { Resources } from './types';
import { RESOURCE_KINDS } from './types';

/**
 * מערכת הצמיחה — מחליפה את "העידנים" הקלאסיים.
 * כל אומה מתחילה ביישוב קטן וגדלה ל-4 שלבים.
 * המעבר דורש משאבים, אוכלוסייה ומבנים מסוימים, ולוקח זמן.
 */

export type BuildingCounts = Record<string, number>;

export type RequirementStatus = {
  /** השלב הבא, או null אם כבר בשלב האחרון */
  nextStage: number | null;
  stage: StageDef | null;
  ok: boolean;
  missing: {
    resources: Partial<Resources>;
    population: number;
    buildings: Array<{ id: string; need: number; have: number }>;
  };
  /** האם כבר יש מעבר פעיל */
  inProgress: boolean;
};

export function evaluateStageRequirements(
  player: Player,
  buildingCounts: BuildingCounts,
  population: number,
): RequirementStatus {
  const nextIndex = player.stage + 1;
  const hasNext = player.nation.stages.some((s) => s.index === nextIndex);
  if (!hasNext) {
    return {
      nextStage: null,
      stage: null,
      ok: false,
      missing: { resources: {}, population: 0, buildings: [] },
      inProgress: false,
    };
  }

  const stage = stageOf(player.nation, nextIndex);
  const req = stage.requires ?? {};
  const missingResources: Partial<Resources> = {};
  for (const k of RESOURCE_KINDS) {
    const need = req.resources?.[k] ?? 0;
    if (need > player.resources[k]) missingResources[k] = Math.ceil(need - player.resources[k]);
  }

  const popNeed = req.population ?? 0;
  const missingPop = Math.max(0, popNeed - population);

  const missingBuildings: Array<{ id: string; need: number; have: number }> = [];
  for (const [id, need] of Object.entries(req.buildings ?? {})) {
    const have = buildingCounts[id] ?? 0;
    if (have < need) missingBuildings.push({ id, need, have });
  }

  const ok =
    Object.keys(missingResources).length === 0 &&
    missingPop === 0 &&
    missingBuildings.length === 0 &&
    !player.transition;

  return {
    nextStage: nextIndex,
    stage,
    ok,
    missing: {
      resources: missingResources,
      population: missingPop,
      buildings: missingBuildings,
    },
    inProgress: player.transition !== null,
  };
}

/** מתחיל מעבר לשלב הבא: גובה משאבים ומפעיל טיימר. */
export function beginStageTransition(
  player: Player,
  buildingCounts: BuildingCounts,
  population: number,
): boolean {
  const status = evaluateStageRequirements(player, buildingCounts, population);
  if (!status.ok || !status.stage || status.nextStage === null) return false;
  const cost = status.stage.requires?.resources ?? {};
  if (!player.spend(cost)) return false;
  const total = (status.stage.requires?.time ?? 30) / Math.max(0.2, player.researchSpeed());
  player.transition = { targetStage: status.nextStage, remaining: total, total };
  return true;
}

/** ביטול מעבר והחזר מלא של המשאבים. */
export function cancelStageTransition(player: Player): boolean {
  if (!player.transition) return false;
  const stage = stageOf(player.nation, player.transition.targetStage);
  player.refund(stage.requires?.resources ?? {});
  player.transition = null;
  return true;
}

export type StageAdvanced = {
  player: Player;
  stage: StageDef;
  /** ענפים שצריך לבחור עכשיו (למשל סוג צבא בשלב 3) */
  pendingBranches: string[];
};

/** מקדם את שעון המעבר. מחזיר אירוע אם הושלם שלב. */
export function tickStageTransition(player: Player, dt: number): StageAdvanced | null {
  if (!player.transition) return null;
  player.transition.remaining -= dt;
  if (player.transition.remaining > 0) return null;

  const target = player.transition.targetStage;
  player.transition = null;
  player.stage = target;
  player.applyStageUnlocks(target);
  player.applyBranchUnlocks(target);
  player.recomputeModifiers();

  return {
    player,
    stage: stageOf(player.nation, target),
    pendingBranches: player.pendingBranches().map((b) => b.id),
  };
}

/** רדיוס השליטה של השחקן על המפה בשלב הנוכחי. */
export function controlRadius(player: Player): number {
  return stageOf(player.nation, player.stage).controlRadius;
}

/** התקדמות המעבר באחוזים (0..1). */
export function transitionProgress(player: Player): number {
  if (!player.transition) return 0;
  const { remaining, total } = player.transition;
  return Math.min(1, Math.max(0, 1 - remaining / total));
}
