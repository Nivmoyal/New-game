import type { Difficulty } from '../core/types';

export type AiProfile = {
  id: Difficulty;
  name: string;
  desc: string;
  /** כל כמה שניות ה-AI "חושב" */
  thinkInterval: number;
  /** כמה פועלים לשאוף אליהם בכל שלב */
  workerTarget: number[];
  /** גודל גל התקפה בכל שלב */
  waveSize: number[];
  /** כמה זמן בין גלים (שניות) */
  waveInterval: number;
  /** כמה מבני צבא לבנות */
  militaryBuildings: number[];
  /** מכפיל קצב איסוף (יתרון מובנה לרמות גבוהות) */
  gatherBonus: number;
  /** נטייה לתקוף (0..1) */
  aggression: number;
  /** האם בונה מגדלי הגנה */
  defends: boolean;
  /** דחיפות המעבר בין שלבים (מכפיל לדרישות) */
  expandEagerness: number;
};

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    id: 'easy',
    name: 'קל',
    desc: 'בונה לאט, תוקף מעט. מתאים ללימוד המשחק.',
    thinkInterval: 2.5,
    workerTarget: [8, 12, 16, 20],
    waveSize: [3, 5, 7, 9],
    waveInterval: 150,
    militaryBuildings: [0, 1, 1, 2],
    gatherBonus: 0.85,
    aggression: 0.25,
    defends: false,
    expandEagerness: 0.7,
  },
  normal: {
    id: 'normal',
    name: 'רגיל',
    desc: 'כלכלה מסודרת וגלי התקפה קבועים.',
    thinkInterval: 1.6,
    workerTarget: [12, 18, 24, 30],
    waveSize: [4, 7, 11, 15],
    waveInterval: 110,
    militaryBuildings: [0, 1, 2, 3],
    gatherBonus: 1,
    aggression: 0.5,
    defends: true,
    expandEagerness: 1,
  },
  hard: {
    id: 'hard',
    name: 'קשה',
    desc: 'מתרחב מהר, לוחץ מוקדם ומגוון את הצבא.',
    thinkInterval: 1.1,
    workerTarget: [16, 24, 32, 40],
    waveSize: [5, 9, 14, 20],
    waveInterval: 80,
    militaryBuildings: [1, 2, 3, 4],
    gatherBonus: 1.15,
    aggression: 0.75,
    defends: true,
    expandEagerness: 1.2,
  },
  insane: {
    id: 'insane',
    name: 'אכזרי',
    desc: 'יתרון כלכלי, גלים גדולים ורצופים. לשחקנים מנוסים.',
    thinkInterval: 0.8,
    workerTarget: [20, 30, 40, 50],
    waveSize: [6, 12, 18, 26],
    waveInterval: 55,
    militaryBuildings: [1, 2, 4, 5],
    gatherBonus: 1.4,
    aggression: 0.95,
    defends: true,
    expandEagerness: 1.4,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard', 'insane'];
