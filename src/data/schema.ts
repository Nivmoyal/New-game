import type { ResourceKind, Resources, UnitClass } from '../core/types';

/** ======= סכמת נתונים ======= *
 * כל התוכן (יחידות, מבנים, אומות, שלבי צמיחה) מוגדר בקבצי JSON
 * ונטען דרך הקובץ הזה. הוספת אומה חדשה = הוספת רשומה ל-nations.json
 * (ואולי כמה יחידות/מבנים) — בלי לגעת בקוד המנוע.
 */

export type AttackType = 'melee' | 'pierce' | 'siege' | 'flak';

export type UnitDef = {
  id: string;
  name: string;
  emoji: string;
  /** תיאור קצר לממשק */
  desc?: string;
  class: UnitClass;
  cost: Partial<Resources>;
  trainTime: number;
  hp: number;
  armor: number;
  pierceArmor: number;
  attack: number;
  attackType: AttackType;
  /** טווח תקיפה באריחים (0.8 = מגע) */
  range: number;
  /** שניות בין מכות */
  attackCooldown: number;
  /** אריחים לשנייה */
  speed: number;
  /** טווח ראייה */
  los: number;
  pop: number;
  /** רדיוס פיזי להימנעות בין יחידות */
  radius?: number;
  /** כמות משאב שהיחידה נושאת (פועלים) */
  carry?: number;
  /** קצב איסוף ליחידת זמן לכל סוג משאב */
  gatherRate?: Partial<Record<ResourceKind, number>>;
  /** יכול לבנות מבנים */
  canBuild?: boolean;
  /** יכול לרפא / לתקן */
  canRepair?: boolean;
  /** בונוסים כנגד סוגי יחידות (מכפילי נזק) */
  bonusVs?: Partial<Record<UnitClass, number>>;
  /** אם true — היחידה מרפאת יחידות ידידותיות במקום לתקוף */
  healer?: boolean;
};

export type BuildingDef = {
  id: string;
  name: string;
  emoji: string;
  desc?: string;
  /** גודל בצד אריחים (ריבוע) */
  size: number;
  cost: Partial<Resources>;
  buildTime: number;
  hp: number;
  armor: number;
  pierceArmor: number;
  los: number;
  /** כמה אוכלוסייה המבנה מוסיף לתקרה */
  popProvided?: number;
  /** אילו יחידות אפשר לאמן כאן */
  trains?: string[];
  /** אילו טכנולוגיות אפשר לחקור כאן */
  researches?: string[];
  /** המבנה מקבל משאבים שפועלים מחזירים */
  dropOff?: ResourceKind[] | 'all';
  /** מבנה תוקף (מגדל/הגנה אווירית) */
  attack?: number;
  attackType?: AttackType;
  range?: number;
  attackCooldown?: number;
  bonusVs?: Partial<Record<UnitClass, number>>;
  /** המבנה הוא מרכז היישוב (משפיע על שלב הצמיחה) */
  isTownCenter?: boolean;
  /** מייצר משאב לאט מעצמו (חווה, מגדל מים, בורסה) */
  trickle?: Partial<Record<ResourceKind, number>>;
  /** מספר מרבי של מבנים כאלה לשחקן */
  limit?: number;
  /** מרפא יחידות בסביבה (בית חולים) */
  healAura?: { radius: number; rate: number };
};

export type TechDef = {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  cost: Partial<Resources>;
  researchTime: number;
  /** דורש שלב צמיחה מינימלי */
  minStage?: number;
  effects: TechEffect[];
};

export type TechEffect =
  | { kind: 'unitStat'; stat: 'attack' | 'armor' | 'pierceArmor' | 'hp' | 'speed'; add: number; classes?: UnitClass[] }
  | { kind: 'gatherRate'; resource: ResourceKind | 'all'; mult: number }
  | { kind: 'buildingStat'; stat: 'hp' | 'armor' | 'attack'; add: number }
  | { kind: 'popCap'; add: number }
  | { kind: 'buildSpeed'; mult: number }
  | { kind: 'losBonus'; add: number };

/** שלב צמיחה — מחליף את "העידנים" הקלאסיים. */
export type StageDef = {
  /** 1..4 */
  index: number;
  name: string;
  emoji: string;
  desc: string;
  /** דרישות למעבר לשלב הזה (השלב הראשון תמיד זמין) */
  requires?: {
    resources?: Partial<Resources>;
    population?: number;
    /** מזהי מבנים שחייבים להיות בנויים (וכמה) */
    buildings?: Record<string, number>;
    /** זמן מעבר בשניות */
    time?: number;
  };
  /** מה נפתח בשלב */
  unlocks?: {
    buildings?: string[];
    units?: string[];
    techs?: string[];
  };
  /** רדיוס השליטה של היישוב על המפה */
  controlRadius: number;
  /** תוספת קבועה לתקרת האוכלוסייה */
  popBonus?: number;
  /** מראה מרכז היישוב בשלב הזה */
  centerEmoji: string;
  centerName: string;
};

/** מודיפיקטורים שמגיעים מבחירות (קיבוץ/מושב, סוג צבא) ומבונוסי אומה. */
export type Modifiers = {
  gatherMult?: Partial<Record<ResourceKind | 'all', number>>;
  buildingCostMult?: number;
  unitCostMult?: number;
  houseCapBonus?: number;
  popCapBonus?: number;
  researchSpeedMult?: number;
  buildSpeedMult?: number;
  trainSpeedMult?: number;
  unitArmorBonus?: number;
  unitAttackMult?: Partial<Record<UnitClass, number>>;
  unitHpMult?: number;
  buildingHpMult?: number;
  tradeGoldMult?: number;
  losBonus?: number;
};

/** בחירה שהשחקן עושה (לפני המשחק או בשלב מסוים). */
export type BranchOptionDef = {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** נקודות מפתח להצגה בממשק */
  highlights: string[];
  modifiers?: Modifiers;
  unlocks?: { buildings?: string[]; units?: string[]; techs?: string[] };
  /** שמות חלופיים למרכז היישוב לפי שלב */
  centerNames?: string[];
  centerEmojis?: string[];
};

export type BranchDef = {
  id: string;
  name: string;
  desc: string;
  /** באיזה שלב נבחר (1 = לפני המשחק) */
  atStage: number;
  options: BranchOptionDef[];
};

export type NationDef = {
  id: string;
  name: string;
  flag: string;
  /** תיאור מכבד ומאוזן לכל אומה */
  desc: string;
  /** צבע ברירת מחדל בממשק */
  color: string;
  bonuses: string[];
  modifiers?: Modifiers;
  /** מזהה יחידת הפועל */
  worker: string;
  /** מזהה מבנה מרכז היישוב */
  townCenter: string;
  /** מבנים/יחידות זמינים מההתחלה */
  startingBuildings?: string[];
  startingUnits?: string[];
  stages: StageDef[];
  branches?: BranchDef[];
  /** מבנים ייחודיים לאומה (להצגה במסך הבחירה) */
  uniques?: string[];
};

/** תבנית מפה שהשחקן בוחר במסך הפתיחה. */
export type MapPresetDef = {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  highlights: string[];
  /** כמות מים (0 = יבש לגמרי, 1 = הרבה אגמים) */
  water: number;
  /** צפיפות יערות (0..1) */
  woodDensity: number;
  /** כמה גבעות והרים (0..1) */
  hills: number;
  /** הסטת לחות: שלילי = מדברי יותר, חיובי = ירוק יותר */
  moisture: number;
  /** מכפיל כמות מכרות */
  mines: number;
  /** מכפיל כמות שיחי פירות */
  berries: number;
  /** תכונה גאוגרפית מיוחדת */
  feature: 'none' | 'river' | 'lakes' | 'coast' | 'oasis';
};

export type GameData = {
  units: Record<string, UnitDef>;
  buildings: Record<string, BuildingDef>;
  techs: Record<string, TechDef>;
  nations: Record<string, NationDef>;
  maps: Record<string, MapPresetDef>;
};
