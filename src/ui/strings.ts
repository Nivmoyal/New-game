/** כל הטקסטים בממשק במקום אחד — נוח לתרגום או לשינוי ניסוח. */
export const T = {
  gameTitle: 'אומות וממלכות',
  gameSubtitle: 'משחק אסטרטגיית זמן־אמת: בנייה, כלכלה וצמיחה',

  // תפריט
  newGame: 'משחק חדש',
  quickGame: 'משחק מהיר',
  loadGame: 'טעינת משחק',
  settings: 'הגדרות',
  credits: 'אודות',
  back: 'חזרה',
  start: 'התחלת משחק',
  chooseNation: 'בחירת אומה',
  chooseStart: 'נקודת פתיחה',
  chooseEnemy: 'אויב',
  chooseDifficulty: 'רמת קושי',
  chooseMapSize: 'גודל מפה',
  chooseMap: 'סוג מפה',
  randomMap: 'מפה אקראית',
  bonuses: 'יתרונות',
  uniqueBuildings: 'מבנים ייחודיים',
  growthPath: 'מסלול הצמיחה',
  version: 'גרסה',
  randomNation: 'אומה אקראית',

  // משאבים
  food: 'אוכל',
  wood: 'עץ',
  stone: 'אבן',
  gold: 'זהב',
  population: 'אוכלוסייה',

  // ממשק משחק
  stage: 'שלב',
  advanceStage: 'צמיחה לשלב הבא',
  advancing: 'בתהליך צמיחה…',
  requirements: 'דרישות',
  build: 'בנייה',
  train: 'אימון',
  research: 'מחקר',
  units: 'יחידות',
  buildings: 'מבנים',
  cancel: 'ביטול',
  stop: 'עצירה',
  hold: 'החזקת עמדה',
  repair: 'תיקון',
  rally: 'נקודת כינוס',
  selected: 'נבחרו',
  queue: 'תור',
  idleWorkers: 'פועלים בטלים',
  attack: 'תקיפה',
  armor: 'שריון',
  range: 'טווח',
  speed: 'מהירות',
  health: 'חיים',
  carrying: 'נושא',

  // הודעות
  needResources: 'אין מספיק משאבים',
  needPop: 'צריך עוד בתים — האוכלוסייה מלאה',
  underAttack: 'היישוב שלך מותקף!',
  stageReached: 'הגעת לשלב חדש',
  chooseBranch: 'הגיע הזמן לבחור',
  buildingComplete: 'הבנייה הושלמה',
  victory: 'ניצחון!',
  defeat: 'הפסדת',
  gameSaved: 'המשחק נשמר',
  gameLoaded: 'המשחק נטען',
  saveFailed: 'השמירה נכשלה',
  noSaves: 'אין משחקים שמורים',
  paused: 'המשחק מושהה',
  resume: 'המשך',
  save: 'שמירה',
  exitToMenu: 'יציאה לתפריט',
  deleteSave: 'מחיקה',
  confirmExit: 'התקדמות שלא נשמרה תאבד.',
  confirmExitAction: 'לצאת בלי לשמור',

  // הגדרות
  sfxVolume: 'עוצמת אפקטים',
  musicVolume: 'עוצמת מוזיקה',
  scrollSpeed: 'מהירות גלילה',
  showHealthBars: 'הצגת פסי חיים',
  edgeScroll: 'גלילה בקצה המסך',
  gameSpeed: 'מהירות משחק',

  // עזרה
  helpTitle: 'שליטה',
  help: [
    'גרירה עם העכבר — בחירת יחידות',
    'קליק ימני — תנועה, תקיפה, איסוף או בנייה',
    'Ctrl+1..9 — שמירת קבוצת בקרה, 1..9 — בחירה',
    'רווח — קפיצה לאירוע האחרון, F — פועל בטל',
    'גלגלת — זום, חצים/WASD — הזזת מצלמה',
    'B — תפריט בנייה, H — מרכז היישוב, Esc — ביטול',
    'במגע: נגיעה = בחירה, נגיעה ארוכה = פקודה',
  ],
} as const;

export const RESOURCE_NAMES: Record<string, string> = {
  food: T.food,
  wood: T.wood,
  stone: T.stone,
  gold: T.gold,
};

export const MAP_SIZES = [
  { id: 'small', name: 'קטנה (96×96)', width: 96, height: 96 },
  { id: 'normal', name: 'רגילה (128×128)', width: 128, height: 128 },
  { id: 'large', name: 'גדולה (160×160)', width: 160, height: 160 },
];

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** מנסח רשימת עלויות לטקסט קריא. */
export function formatCost(cost: Record<string, number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(cost)) {
    if (!v) continue;
    parts.push(`${RESOURCE_NAMES[k] ?? k} ${v}`);
  }
  return parts.join(' · ');
}
