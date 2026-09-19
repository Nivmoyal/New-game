import { peekNextEntityId, resetEntityIds, type Entity } from './entities';
import { FogOfWar } from './fog';
import type { MapOptions } from './gamemap';
import type { StageTransition } from './player';
import type { Resources } from './types';
import { World } from './world';

export const SAVE_VERSION = 3;
export const SAVE_PREFIX = 'rts.save.';
export const SETTINGS_KEY = 'rts.settings';

export type SavedPlayer = {
  id: number;
  name: string;
  nationId: string;
  color: string;
  isAI: boolean;
  difficulty: string;
  team: number;
  branchChoices: Record<string, string>;
  resources: Resources;
  stage: number;
  transition: StageTransition | null;
  researched: string[];
  unlockedBuildings: string[];
  unlockedUnits: string[];
  availableTechs: string[];
  defeated: boolean;
  fog: string;
  stats: unknown;
};

export type SaveGame = {
  version: number;
  savedAt: number;
  label: string;
  seed: number;
  mapOptions: MapOptions;
  time: number;
  terrain: string;
  resources: Array<[number, string, number, string]>;
  players: SavedPlayer[];
  entities: Entity[];
  nextEntityId: number;
  localPlayerId: number;
};

/** base64 שעובד גם בדפדפן וגם ב-Node (לבדיקות). */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 63];
  }
  return out;
}

function base64ToBytes(data: string): Uint8Array {
  const clean = data.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (const ch of clean) {
    const value = B64_CHARS.indexOf(ch);
    if (value < 0) continue;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, pos);
}

/** ממיר עולם חי למבנה שמירה. */
export function serializeWorld(world: World, localPlayerId: number, label = ''): SaveGame {
  const resources: Array<[number, string, number, string]> = [];
  for (const [idx, res] of world.map.resources) {
    resources.push([idx, res.kind, Math.round(res.amount * 100) / 100, res.visual]);
  }
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    label,
    seed: world.map.seed,
    mapOptions: {
      width: world.map.width,
      height: world.map.height,
      seed: world.map.seed,
      preset: world.map.presetId,
    },
    time: world.time,
    terrain: bytesToBase64(world.map.terrain),
    resources,
    players: world.players.map((p) => ({
      id: p.id,
      name: p.name,
      nationId: p.nation.id,
      color: p.color,
      isAI: p.isAI,
      difficulty: p.difficulty,
      team: p.team,
      branchChoices: { ...p.branchChoices },
      resources: { ...p.resources },
      stage: p.stage,
      transition: p.transition ? { ...p.transition } : null,
      researched: [...p.researched],
      unlockedBuildings: [...p.unlockedBuildings],
      unlockedUnits: [...p.unlockedUnits],
      availableTechs: [...p.availableTechs],
      defeated: p.defeated,
      fog: p.fog.serialize(),
      stats: p.stats,
    })),
    entities: [...world.entities.values()].filter((e) => e.alive),
    nextEntityId: peekNextEntityId(),
    localPlayerId,
  };
}

/** משחזר עולם ממבנה שמירה. */
export function deserializeWorld(save: SaveGame): { world: World; localPlayerId: number } {
  if (save.version !== SAVE_VERSION) {
    throw new Error(`גרסת שמירה לא נתמכת: ${save.version} (נדרש ${SAVE_VERSION})`);
  }
  const world = new World({
    seed: save.seed,
    map: save.mapOptions,
    players: save.players.map((p) => ({
      id: p.id,
      name: p.name,
      nationId: p.nationId,
      color: p.color,
      isAI: p.isAI,
      difficulty: p.difficulty as never,
      team: p.team,
      branchChoices: p.branchChoices,
    })),
  });

  // שחזור מצב המפה
  world.map.terrain.set(base64ToBytes(save.terrain));
  world.map.resources.clear();
  for (const [idx, kind, amount, visual] of save.resources) {
    world.map.resources.set(idx, {
      kind: kind as never,
      amount,
      visual: visual as never,
    });
  }

  // ניקוי הישויות שנוצרו בהתחלה ושחזור מהשמירה
  for (const e of [...world.entities.values()]) world.kill(e);
  world.entities.clear();
  (world as unknown as { cells: Map<number, Set<number>> }).cells = new Map();
  (world as unknown as { cellOf: Map<number, number> }).cellOf = new Map();
  world.rebuildFromEntities(save.entities);

  // שחזור מצב השחקנים
  save.players.forEach((sp) => {
    const p = world.player(sp.id);
    if (!p) return;
    p.resources = { ...sp.resources };
    p.stage = sp.stage;
    p.transition = sp.transition;
    p.defeated = sp.defeated;
    p.unlockedBuildings = new Set(sp.unlockedBuildings);
    p.unlockedUnits = new Set(sp.unlockedUnits);
    p.availableTechs = new Set(sp.availableTechs);
    p.researched = new Set();
    for (const tech of sp.researched) p.completeResearch(tech);
    p.recomputeModifiers();
    p.fog = FogOfWar.deserialize(world.map.width, world.map.height, sp.fog);
    Object.assign(p.stats, sp.stats ?? {});
  });

  world.time = save.time;
  resetEntityIds(save.nextEntityId);
  world.recomputePopulation();
  return { world, localPlayerId: save.localPlayerId };
}

// ===== localStorage =====

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export type SaveSlotInfo = {
  key: string;
  label: string;
  savedAt: number;
  nation: string;
  stage: number;
};

export function saveToSlot(world: World, localPlayerId: number, slot: string, label: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const data = serializeWorld(world, localPlayerId, label);
    store.setItem(SAVE_PREFIX + slot, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadFromSlot(slot: string): { world: World; localPlayerId: number } | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(SAVE_PREFIX + slot);
  if (!raw) return null;
  try {
    return deserializeWorld(JSON.parse(raw) as SaveGame);
  } catch (err) {
    console.error('טעינת המשחק נכשלה', err);
    return null;
  }
}

export function listSaves(): SaveSlotInfo[] {
  const store = storage();
  if (!store) return [];
  const out: SaveSlotInfo[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(SAVE_PREFIX)) continue;
    try {
      const data = JSON.parse(store.getItem(key)!) as SaveGame;
      const local = data.players.find((p) => p.id === data.localPlayerId);
      out.push({
        key: key.slice(SAVE_PREFIX.length),
        label: data.label || key.slice(SAVE_PREFIX.length),
        savedAt: data.savedAt,
        nation: local?.nationId ?? '',
        stage: local?.stage ?? 1,
      });
    } catch {
      /* שמירה פגומה — מדלגים */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteSave(slot: string): void {
  storage()?.removeItem(SAVE_PREFIX + slot);
}

export type Settings = {
  musicVolume: number;
  sfxVolume: number;
  scrollSpeed: number;
  showHealthBars: boolean;
  edgeScroll: boolean;
  gameSpeed: number;
};

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.3,
  sfxVolume: 0.6,
  scrollSpeed: 1,
  showHealthBars: true,
  edgeScroll: true,
  gameSpeed: 1,
};

export function loadSettings(): Settings {
  const store = storage();
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* אין אחסון זמין */
  }
}
