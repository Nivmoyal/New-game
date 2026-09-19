import type { UnitDef } from '../../data/schema';
import type { PersonStyle } from './people';
import type { VehicleKind } from './vehicles';

/**
 * איך כל יחידה נראית. ברירת המחדל נגזרת ממחלקת היחידה,
 * כך שיחידה חדשה ב-JSON מקבלת מראה סביר בלי לגעת בקוד;
 * ההגדרות המפורשות כאן נותנות אופי לאומות ולזרועות.
 */

export type UnitLook =
  | { kind: 'person'; style: Omit<PersonStyle, 'cloth' | 'accent' | 'skin'> & { tint?: string } }
  | { kind: 'vehicle'; vehicle: VehicleKind };

const VEHICLES: Record<string, VehicleKind> = {
  // רכובים — מצוירים כסוס/גמל עם רוכב
  il_horse_scout: 'horse',
  jp_cavalry: 'horse',
  ar_lighthorse: 'horse',
  ar_heavycav: 'horse',
  ar_camel: 'camel',
  ar_horsearcher: 'horse',
  rm_equites: 'horse',
  vk_raider: 'horse',
  jp_daimyo: 'horse',
  il_tank: 'tank',
  il_apc: 'apc',
  il_scout: 'jeep',
  il_flak: 'aa',
  il_drone: 'drone',
  jp_catapult: 'catapult',
  ar_mangonel: 'catapult',
  eg_catapult: 'catapult',
  vk_siege: 'catapult',
  rm_ballista: 'ballista',
  rm_ram: 'ram',
  eg_chariot: 'chariot',
  eg_chariot_archer: 'chariot',
};

const PEOPLE: Record<string, UnitLook['kind'] extends never ? never : NonNullable<PersonStyle['tool']>> = {
  il_worker: 'hammer',
  il_guard: 'rifle',
  il_infantry: 'rifle',
  il_rifleman: 'rifle',
  il_golani: 'rifle',
  il_commando: 'rifle',
  il_sniper: 'rifle',
  il_elite: 'rifle',
  il_medic: 'staff',
  jp_worker: 'sickle',
  jp_ashigaru: 'spear',
  jp_yari: 'spear',
  jp_archer: 'bow',
  jp_samurai: 'sword',
  jp_shinobi: 'sword',
  jp_daimyo: 'sword',
  ar_worker: 'sickle',
  ar_spear: 'spear',
  ar_archer: 'bow',
  ar_horsearcher: 'bow',
  ar_scholar: 'staff',
  rm_worker: 'hammer',
  rm_hastati: 'spear',
  rm_legion: 'sword',
  rm_archer: 'bow',
  rm_centurion: 'sword',
  eg_worker: 'sickle',
  eg_spear: 'spear',
  eg_archer: 'bow',
  eg_khopesh: 'sword',
  eg_priest: 'staff',
  vk_worker: 'axe',
  vk_bondi: 'axe',
  vk_spear: 'spear',
  vk_archer: 'bow',
  vk_huscarl: 'sword',
  vk_jarl: 'sword',
  vk_skald: 'staff',
};

const HATS: Record<string, NonNullable<PersonStyle['hat']>> = {
  il_worker: 'cap',
  il_guard: 'helmet',
  il_infantry: 'helmet',
  il_rifleman: 'helmet',
  il_golani: 'beret',
  il_commando: 'beret',
  il_sniper: 'hood',
  il_elite: 'helmet',
  il_medic: 'cap',
  jp_samurai: 'helmet',
  jp_daimyo: 'crown',
  jp_shinobi: 'hood',
  rm_legion: 'helmet',
  rm_hastati: 'helmet',
  rm_centurion: 'crown',
  ar_scholar: 'hood',
  eg_priest: 'hood',
  vk_bondi: 'helmet',
  vk_huscarl: 'helmet',
  vk_jarl: 'crown',
  vk_skald: 'hood',
};

/** כלי ברירת מחדל לפי מחלקה, לכל יחידה שאין לה רשומה מפורשת. */
function defaultTool(def: UnitDef): NonNullable<PersonStyle['tool']> {
  switch (def.class) {
    case 'worker':
      return def.healer ? 'staff' : 'hammer';
    case 'ranged':
      return 'bow';
    case 'infantry':
      return 'sword';
    case 'cavalry':
      return 'spear';
    default:
      return 'none';
  }
}

export function lookFor(def: UnitDef): UnitLook {
  const vehicle = VEHICLES[def.id];
  if (vehicle) return { kind: 'vehicle', vehicle };
  // ברירת מחדל לפרשים שאין להם רשומה: רוכבים על סוס
  if (def.class === 'cavalry') return { kind: 'vehicle', vehicle: 'horse' };
  return {
    kind: 'person',
    style: {
      tool: PEOPLE[def.id] ?? defaultTool(def),
      hat: HATS[def.id] ?? (def.class === 'infantry' ? 'helmet' : 'none'),
      shield: def.class === 'infantry',
    },
  };
}

/** האם היחידה מצוירת כרכב (משפיע על אנימציה ועל גודל). */
export function isVehicle(defId: string): boolean {
  return defId in VEHICLES;
}

/** האם היחידה מצוירת כרכב ממונע (להבדיל מרכיבה על בעל חיים). */
export function isMotorised(defId: string): boolean {
  const v = VEHICLES[defId];
  return !!v && v !== 'horse' && v !== 'camel';
}
