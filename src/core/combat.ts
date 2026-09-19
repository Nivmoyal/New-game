import { getBuilding, getUnit } from '../data';
import type { AttackType } from '../data/schema';
import type { Entity } from './entities';
import type { Player } from './player';
import type { UnitClass } from './types';

export type CombatStats = {
  attack: number;
  attackType: AttackType;
  armor: number;
  pierceArmor: number;
  range: number;
  cooldown: number;
  cls: UnitClass;
  bonusVs: Partial<Record<UnitClass, number>>;
  maxHp: number;
  speed: number;
  los: number;
};

/**
 * יחסי חוזק בסיסיים בין סוגי יחידות — "אבן־נייר־ומספריים" של המשחק.
 * מוכפל בבונוסים הספציפיים של היחידה (bonusVs).
 */
export const CLASS_MATCHUP: Record<UnitClass, Partial<Record<UnitClass, number>>> = {
  infantry: { cavalry: 1.25, siege: 1.15, building: 0.6, air: 0.4 },
  ranged: { infantry: 1.2, air: 0.85, building: 0.5, siege: 1.1 },
  cavalry: { ranged: 1.3, siege: 1.25, worker: 1.2, building: 0.5, air: 0.35 },
  siege: { building: 2.0, infantry: 1.1, cavalry: 0.7, air: 0.2 },
  air: { siege: 1.3, worker: 1.2, ranged: 0.8, building: 0.8 },
  worker: { building: 0.4, air: 0.2 },
  building: { air: 0.6 },
};

/** נזק מינימלי — כדי שקרב לא ייתקע לעד. */
export const MIN_DAMAGE = 1;

/** בוחר את סוג השריון הרלוונטי לפי סוג התקיפה. */
export function armorAgainst(defender: CombatStats, attackType: AttackType): number {
  switch (attackType) {
    case 'melee':
      return defender.armor;
    case 'pierce':
    case 'flak':
      return defender.pierceArmor;
    case 'siege':
      // מצור מתעלם מחלק מהשריון
      return Math.floor(defender.armor * 0.5);
  }
}

/** מכפיל הנזק הכולל של תוקף מול מגן. */
export function damageMultiplier(attacker: CombatStats, defender: CombatStats): number {
  const table = CLASS_MATCHUP[attacker.cls] ?? {};
  const base = table[defender.cls] ?? 1;
  const specific = attacker.bonusVs[defender.cls] ?? 1;
  return base * specific;
}

/** נזק למכה אחת. תמיד לפחות MIN_DAMAGE כשיש תקיפה בכלל. */
export function computeDamage(attacker: CombatStats, defender: CombatStats): number {
  if (attacker.attack <= 0) return 0;
  const raw = attacker.attack * damageMultiplier(attacker, defender);
  const armor = armorAgainst(defender, attacker.attackType);
  return Math.max(MIN_DAMAGE, Math.round((raw - armor) * 100) / 100);
}

/** מחשב כמה מכות צריך כדי להרוג — שימושי ל-AI ולבדיקות. */
export function hitsToKill(attacker: CombatStats, defender: CombatStats, hp = defender.maxHp): number {
  const dmg = computeDamage(attacker, defender);
  if (dmg <= 0) return Infinity;
  return Math.ceil(hp / dmg);
}

/** "ציון יעילות" — נזק לשנייה מנורמל, ל-AI ולממשק. */
export function dps(attacker: CombatStats, defender: CombatStats): number {
  const cd = Math.max(0.1, attacker.cooldown);
  return computeDamage(attacker, defender) / cd;
}

const EMPTY_BONUS: Partial<Record<UnitClass, number>> = {};

/** סטטיסטיקות אפקטיביות של ישות, כולל טכנולוגיות ובונוסים של האומה. */
export function statsOf(entity: Entity, player: Player | undefined): CombatStats {
  if (entity.kind === 'building') {
    const def = getBuilding(entity.defId);
    const tb = player?.techBonuses;
    const attackBonus = tb?.buildingAttack ?? 0;
    return {
      attack: def.attack ? def.attack + attackBonus : 0,
      attackType: def.attackType ?? 'pierce',
      armor: def.armor + (tb?.buildingArmor ?? 0),
      pierceArmor: def.pierceArmor + (tb?.buildingArmor ?? 0),
      range: def.range ?? 0,
      cooldown: def.attackCooldown ?? 2,
      cls: 'building',
      bonusVs: def.bonusVs ?? EMPTY_BONUS,
      maxHp: entity.maxHp,
      speed: 0,
      los: def.los + (player?.losBonus() ?? 0),
    };
  }

  const def = getUnit(entity.defId);
  const cls = def.class;
  const tb = player?.techBonuses;
  const mods = player?.modifiers;
  const attackMult = mods?.unitAttackMult?.[cls] ?? 1;
  return {
    attack: (def.attack + (tb?.attack[cls] ?? 0)) * attackMult,
    attackType: def.attackType,
    armor: def.armor + (tb?.armor[cls] ?? 0) + (mods?.unitArmorBonus ?? 0),
    pierceArmor: def.pierceArmor + (tb?.pierceArmor[cls] ?? 0) + (mods?.unitArmorBonus ?? 0),
    range: def.range,
    cooldown: def.attackCooldown,
    cls,
    bonusVs: def.bonusVs ?? EMPTY_BONUS,
    maxHp: entity.maxHp,
    speed: def.speed + (tb?.speed[cls] ?? 0),
    los: def.los + (player?.losBonus() ?? 0),
  };
}

/** נקודות חיים מרביות אחרי בונוסים — בשימוש בעת יצירת ישות. */
export function maxHpFor(defId: string, kind: 'unit' | 'building', player: Player): number {
  if (kind === 'building') {
    const def = getBuilding(defId);
    return Math.round(def.hp * (player.modifiers.buildingHpMult ?? 1) + player.techBonuses.buildingHp);
  }
  const def = getUnit(defId);
  const cls = def.class;
  return Math.round(
    (def.hp + (player.techBonuses.hp[cls] ?? 0)) * (player.modifiers.unitHpMult ?? 1),
  );
}
