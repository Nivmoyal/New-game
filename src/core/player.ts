import {
  applyCostMult,
  branchesAtStage,
  getBuilding,
  getNation,
  getTech,
  mergeModifiers,
  stageOf,
} from '../data';
import type { Modifiers, NationDef, TechEffect } from '../data/schema';
import { FogOfWar } from './fog';
import type { Difficulty, PlayerId, ResourceKind, Resources, UnitClass } from './types';
import { emptyResources, RESOURCE_KINDS } from './types';

export type TechBonuses = {
  attack: Partial<Record<UnitClass, number>>;
  armor: Partial<Record<UnitClass, number>>;
  pierceArmor: Partial<Record<UnitClass, number>>;
  hp: Partial<Record<UnitClass, number>>;
  speed: Partial<Record<UnitClass, number>>;
  los: number;
  buildingHp: number;
  buildingArmor: number;
  buildingAttack: number;
  popCapExtra: number;
  buildSpeedMult: number;
  gatherMult: Partial<Record<ResourceKind, number>>;
};

function emptyTechBonuses(): TechBonuses {
  return {
    attack: {},
    armor: {},
    pierceArmor: {},
    hp: {},
    speed: {},
    los: 0,
    buildingHp: 0,
    buildingArmor: 0,
    buildingAttack: 0,
    popCapExtra: 0,
    buildSpeedMult: 1,
    gatherMult: {},
  };
}

export type StageTransition = {
  targetStage: number;
  remaining: number;
  total: number;
};

export type PlayerConfig = {
  id: PlayerId;
  name: string;
  nationId: string;
  color?: string;
  isAI?: boolean;
  difficulty?: Difficulty;
  team?: number;
  /** בחירות ענפים: branchId -> optionId */
  branchChoices?: Record<string, string>;
  startingResources?: Partial<Resources>;
};

export const DEFAULT_START_RESOURCES: Resources = {
  food: 300,
  wood: 250,
  stone: 150,
  gold: 150,
};

export const BASE_POP_CAP = 5;
export const ABSOLUTE_POP_CAP = 200;

export class Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly nation: NationDef;
  readonly color: string;
  readonly isAI: boolean;
  readonly difficulty: Difficulty;
  readonly team: number;

  resources: Resources;
  /** שלב צמיחה נוכחי (1..4) */
  stage = 1;
  transition: StageTransition | null = null;
  branchChoices: Record<string, string> = {};

  unlockedBuildings = new Set<string>();
  unlockedUnits = new Set<string>();
  availableTechs = new Set<string>();
  researched = new Set<string>();

  techBonuses: TechBonuses = emptyTechBonuses();
  modifiers: Modifiers = {};

  popUsed = 0;
  popCap = BASE_POP_CAP;
  defeated = false;

  fog: FogOfWar;

  /** סטטיסטיקה לסיכום משחק */
  stats = {
    gathered: emptyResources(),
    unitsTrained: 0,
    unitsLost: 0,
    buildingsBuilt: 0,
    kills: 0,
  };

  constructor(cfg: PlayerConfig, mapWidth: number, mapHeight: number) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.nation = getNation(cfg.nationId);
    this.color = cfg.color ?? this.nation.color;
    this.isAI = cfg.isAI ?? false;
    this.difficulty = cfg.difficulty ?? 'normal';
    this.team = cfg.team ?? cfg.id;
    this.resources = { ...DEFAULT_START_RESOURCES, ...(cfg.startingResources ?? {}) };
    this.fog = new FogOfWar(mapWidth, mapHeight);
    this.branchChoices = { ...(cfg.branchChoices ?? {}) };
    this.recomputeModifiers();
    this.applyStageUnlocks(1);
    // בחירות שנעשו לפני המשחק (שלב 1) נפתחות מיד
    this.applyBranchUnlocks(1);
  }

  /** מודיפיקטורים = אומה + כל הענפים שנבחרו עד השלב הנוכחי. */
  recomputeModifiers(): void {
    const chosen: Array<Modifiers | undefined> = [this.nation.modifiers];
    for (const branch of this.nation.branches ?? []) {
      const optionId = this.branchChoices[branch.id];
      if (!optionId) continue;
      if (branch.atStage > this.stage) continue;
      const option = branch.options.find((o) => o.id === optionId);
      if (option?.modifiers) chosen.push(option.modifiers);
    }
    this.modifiers = mergeModifiers(...chosen);
  }

  applyStageUnlocks(stageIndex: number): void {
    const stage = stageOf(this.nation, stageIndex);
    for (const b of stage.unlocks?.buildings ?? []) this.unlockedBuildings.add(b);
    for (const u of stage.unlocks?.units ?? []) this.unlockedUnits.add(u);
    for (const t of stage.unlocks?.techs ?? []) this.availableTechs.add(t);
  }

  applyBranchUnlocks(stageIndex: number): void {
    for (const branch of branchesAtStage(this.nation, stageIndex)) {
      const optionId = this.branchChoices[branch.id];
      if (!optionId) continue;
      const option = branch.options.find((o) => o.id === optionId);
      if (!option) continue;
      for (const b of option.unlocks?.buildings ?? []) this.unlockedBuildings.add(b);
      for (const u of option.unlocks?.units ?? []) this.unlockedUnits.add(u);
      for (const t of option.unlocks?.techs ?? []) this.availableTechs.add(t);
    }
  }

  /** בחירת ענף (למשל קיבוץ/מושב או סוג צבא). */
  chooseBranch(branchId: string, optionId: string): void {
    this.branchChoices[branchId] = optionId;
    this.recomputeModifiers();
    const branch = (this.nation.branches ?? []).find((b) => b.id === branchId);
    if (branch && branch.atStage <= this.stage) this.applyBranchUnlocks(branch.atStage);
  }

  /** ענפים שממתינים לבחירה בשלב הנוכחי. */
  pendingBranches() {
    return branchesAtStage(this.nation, this.stage).filter((b) => !this.branchChoices[b.id]);
  }

  hasResources(cost: Partial<Resources>): boolean {
    return RESOURCE_KINDS.every((k) => (cost[k] ?? 0) <= this.resources[k]);
  }

  spend(cost: Partial<Resources>): boolean {
    if (!this.hasResources(cost)) return false;
    for (const k of RESOURCE_KINDS) this.resources[k] -= cost[k] ?? 0;
    return true;
  }

  refund(cost: Partial<Resources>): void {
    for (const k of RESOURCE_KINDS) this.resources[k] += cost[k] ?? 0;
  }

  add(kind: ResourceKind, amount: number): void {
    this.resources[kind] += amount;
    this.stats.gathered[kind] += amount;
  }

  /** מחיר מבנה אחרי מודיפיקטורים. */
  buildingCost(buildingId: string): Partial<Resources> {
    const def = getBuilding(buildingId);
    return applyCostMult(def.cost, this.modifiers.buildingCostMult ?? 1) as Partial<Resources>;
  }

  unitCost(unitId: string, baseCost: Partial<Resources>): Partial<Resources> {
    void unitId;
    return applyCostMult(baseCost, this.modifiers.unitCostMult ?? 1) as Partial<Resources>;
  }

  /** מקדם קצב איסוף לפי משאב (אומה + ענפים + טכנולוגיות). */
  gatherMultiplier(kind: ResourceKind): number {
    const g = this.modifiers.gatherMult ?? {};
    return (g.all ?? 1) * (g[kind] ?? 1) * (this.techBonuses.gatherMult[kind] ?? 1);
  }

  researchSpeed(): number {
    return this.modifiers.researchSpeedMult ?? 1;
  }

  buildSpeed(): number {
    return (this.modifiers.buildSpeedMult ?? 1) * this.techBonuses.buildSpeedMult;
  }

  trainSpeed(): number {
    return this.modifiers.trainSpeedMult ?? 1;
  }

  losBonus(): number {
    return (this.modifiers.losBonus ?? 0) + this.techBonuses.los;
  }

  /** האם המבנה זמין לבנייה עכשיו. */
  canBuild(buildingId: string): boolean {
    return this.unlockedBuildings.has(buildingId);
  }

  canTrain(unitId: string): boolean {
    return this.unlockedUnits.has(unitId);
  }

  canResearch(techId: string): boolean {
    if (this.researched.has(techId)) return false;
    if (!this.availableTechs.has(techId)) return false;
    const def = getTech(techId);
    return (def.minStage ?? 1) <= this.stage;
  }

  completeResearch(techId: string): void {
    if (this.researched.has(techId)) return;
    this.researched.add(techId);
    for (const effect of getTech(techId).effects) this.applyTechEffect(effect);
  }

  private applyTechEffect(effect: TechEffect): void {
    const tb = this.techBonuses;
    switch (effect.kind) {
      case 'unitStat': {
        const classes: UnitClass[] = effect.classes ?? [
          'worker',
          'infantry',
          'ranged',
          'cavalry',
          'siege',
          'air',
        ];
        const bucket = tb[effect.stat] as Partial<Record<UnitClass, number>>;
        for (const c of classes) bucket[c] = (bucket[c] ?? 0) + effect.add;
        break;
      }
      case 'gatherRate': {
        if (effect.resource === 'all') {
          for (const k of RESOURCE_KINDS) tb.gatherMult[k] = (tb.gatherMult[k] ?? 1) * effect.mult;
        } else {
          tb.gatherMult[effect.resource] = (tb.gatherMult[effect.resource] ?? 1) * effect.mult;
        }
        break;
      }
      case 'buildingStat':
        if (effect.stat === 'hp') tb.buildingHp += effect.add;
        else if (effect.stat === 'armor') tb.buildingArmor += effect.add;
        else tb.buildingAttack += effect.add;
        break;
      case 'popCap':
        tb.popCapExtra += effect.add;
        break;
      case 'buildSpeed':
        tb.buildSpeedMult *= effect.mult;
        break;
      case 'losBonus':
        tb.los += effect.add;
        break;
    }
  }

  currentStage() {
    return stageOf(this.nation, this.stage);
  }

  /** שם ואמוג'י מרכז היישוב לפי שלב ולפי בחירת הענף. */
  centerAppearance(): { name: string; emoji: string } {
    const stage = this.currentStage();
    let name = stage.centerName;
    let emoji = stage.centerEmoji;
    for (const branch of this.nation.branches ?? []) {
      const optionId = this.branchChoices[branch.id];
      if (!optionId) continue;
      const option = branch.options.find((o) => o.id === optionId);
      if (!option) continue;
      if (option.centerNames?.[this.stage - 1]) name = option.centerNames[this.stage - 1];
      if (option.centerEmojis?.[this.stage - 1]) emoji = option.centerEmojis[this.stage - 1];
    }
    return { name, emoji };
  }
}
