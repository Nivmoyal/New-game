import unitsJson from './units.json';
import buildingsJson from './buildings.json';
import techsJson from './techs.json';
import nationsJson from './nations.json';
import mapsJson from './maps.json';
import type {
  BranchDef,
  MapPresetDef,
  BuildingDef,
  GameData,
  Modifiers,
  NationDef,
  StageDef,
  TechDef,
  UnitDef,
} from './schema';

export * from './schema';

export const DATA: GameData = {
  units: unitsJson as unknown as Record<string, UnitDef>,
  buildings: buildingsJson as unknown as Record<string, BuildingDef>,
  techs: techsJson as unknown as Record<string, TechDef>,
  nations: nationsJson as unknown as Record<string, NationDef>,
  maps: mapsJson as unknown as Record<string, MapPresetDef>,
};

export function getUnit(id: string): UnitDef {
  const def = DATA.units[id];
  if (!def) throw new Error(`יחידה לא מוכרת: ${id}`);
  return def;
}

export function getBuilding(id: string): BuildingDef {
  const def = DATA.buildings[id];
  if (!def) throw new Error(`מבנה לא מוכר: ${id}`);
  return def;
}

export function getTech(id: string): TechDef {
  const def = DATA.techs[id];
  if (!def) throw new Error(`טכנולוגיה לא מוכרת: ${id}`);
  return def;
}

export function getNation(id: string): NationDef {
  const def = DATA.nations[id];
  if (!def) throw new Error(`אומה לא מוכרת: ${id}`);
  return def;
}

export function allNations(): NationDef[] {
  return Object.values(DATA.nations);
}

export function getMapPreset(id: string): MapPresetDef {
  const def = DATA.maps[id];
  if (!def) throw new Error(`תבנית מפה לא מוכרת: ${id}`);
  return def;
}

export function allMapPresets(): MapPresetDef[] {
  return Object.values(DATA.maps);
}

export const DEFAULT_MAP_PRESET = 'greenland';

export function stageOf(nation: NationDef, index: number): StageDef {
  const stage = nation.stages.find((s) => s.index === index);
  if (!stage) throw new Error(`שלב ${index} לא קיים באומה ${nation.id}`);
  return stage;
}

export function branchesAtStage(nation: NationDef, stage: number): BranchDef[] {
  return (nation.branches ?? []).filter((b) => b.atStage === stage);
}

export function findBranchOption(nation: NationDef, branchId: string, optionId: string) {
  const branch = (nation.branches ?? []).find((b) => b.id === branchId);
  return branch?.options.find((o) => o.id === optionId);
}

/** מאחד כמה קבוצות מודיפיקטורים לאחת (מכפלות מוכפלות, תוספות מסוכמות). */
export function mergeModifiers(...mods: Array<Modifiers | undefined>): Modifiers {
  // מתחילים מערכים נייטרליים כדי שהתוצאה תמיד מלאה וצפויה
  const out: Modifiers = {
    buildingCostMult: 1,
    unitCostMult: 1,
    researchSpeedMult: 1,
    buildSpeedMult: 1,
    trainSpeedMult: 1,
    unitHpMult: 1,
    buildingHpMult: 1,
    tradeGoldMult: 1,
    houseCapBonus: 0,
    popCapBonus: 0,
    unitArmorBonus: 0,
    losBonus: 0,
  };
  for (const m of mods) {
    if (!m) continue;
    if (m.gatherMult) {
      out.gatherMult = { ...out.gatherMult };
      for (const [k, v] of Object.entries(m.gatherMult)) {
        const key = k as keyof NonNullable<Modifiers['gatherMult']>;
        out.gatherMult[key] = (out.gatherMult[key] ?? 1) * (v ?? 1);
      }
    }
    if (m.unitAttackMult) {
      out.unitAttackMult = { ...out.unitAttackMult };
      for (const [k, v] of Object.entries(m.unitAttackMult)) {
        const key = k as keyof NonNullable<Modifiers['unitAttackMult']>;
        out.unitAttackMult[key] = (out.unitAttackMult[key] ?? 1) * (v ?? 1);
      }
    }
    out.buildingCostMult = (out.buildingCostMult ?? 1) * (m.buildingCostMult ?? 1);
    out.unitCostMult = (out.unitCostMult ?? 1) * (m.unitCostMult ?? 1);
    out.researchSpeedMult = (out.researchSpeedMult ?? 1) * (m.researchSpeedMult ?? 1);
    out.buildSpeedMult = (out.buildSpeedMult ?? 1) * (m.buildSpeedMult ?? 1);
    out.trainSpeedMult = (out.trainSpeedMult ?? 1) * (m.trainSpeedMult ?? 1);
    out.unitHpMult = (out.unitHpMult ?? 1) * (m.unitHpMult ?? 1);
    out.buildingHpMult = (out.buildingHpMult ?? 1) * (m.buildingHpMult ?? 1);
    out.tradeGoldMult = (out.tradeGoldMult ?? 1) * (m.tradeGoldMult ?? 1);
    out.houseCapBonus = (out.houseCapBonus ?? 0) + (m.houseCapBonus ?? 0);
    out.popCapBonus = (out.popCapBonus ?? 0) + (m.popCapBonus ?? 0);
    out.unitArmorBonus = (out.unitArmorBonus ?? 0) + (m.unitArmorBonus ?? 0);
    out.losBonus = (out.losBonus ?? 0) + (m.losBonus ?? 0);
  }
  return out;
}

/** מחיר אחרי מודיפיקטורים, מעוגל למעלה. */
export function applyCostMult(
  cost: Partial<Record<string, number>>,
  mult: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cost)) {
    if (v == null) continue;
    out[k] = Math.max(0, Math.ceil(v * mult));
  }
  return out;
}
