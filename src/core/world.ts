import { getBuilding, getNation, getTech, getUnit, stageOf } from '../data';
import type { BuildingDef, UnitDef } from '../data/schema';
import { computePopCap, computePopUsed, applyTrickle, carryCapacity, gatherRateFor } from './economy';
import {
  buildingOrigin,
  createBuilding,
  createUnit,
  edgeDistance,
  entityRadius,
  resetEntityIds,
  type Entity,
  type Order,
} from './entities';
import { FOG_VISIBLE } from './fog';
import { GameMap, generateMap, type MapOptions } from './gamemap';
import { beginStageTransition, tickStageTransition } from './growth';
import { computeDamage, maxHpFor, statsOf, type CombatStats } from './combat';
import { findPath, formationOffsets, rotateOffsets, smoothPath, type PathGrid } from './pathfinding';
import { Player, type PlayerConfig } from './player';
import { Rng } from './rng';
import type { EntityId, PlayerId, ResourceKind, Vec2 } from './types';

/** גריד ניווט: קרקע + טביעת רגל של מבנים. */
export class NavGrid implements PathGrid {
  readonly width: number;
  readonly height: number;
  private occupied: Uint8Array;

  constructor(private map: GameMap) {
    this.width = map.width;
    this.height = map.height;
    this.occupied = new Uint8Array(map.width * map.height);
  }

  setOccupied(x: number, y: number, value: boolean): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.occupied[y * this.width + x] = value ? 1 : 0;
  }

  isOccupied(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    return this.occupied[y * this.width + x] === 1;
  }

  isBlocked(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    if (this.occupied[y * this.width + x]) return true;
    return this.map.isBlocked(x, y);
  }

  speedAt(x: number, y: number): number {
    return this.map.speedAt(x, y);
  }
}

export type GameEvent =
  | { type: 'stageAdvanced'; playerId: PlayerId; stage: number; pendingBranches: string[] }
  | { type: 'buildingComplete'; playerId: PlayerId; entityId: EntityId; defId: string }
  | { type: 'unitTrained'; playerId: PlayerId; entityId: EntityId; defId: string }
  | { type: 'researchComplete'; playerId: PlayerId; techId: string }
  | { type: 'entityDied'; playerId: PlayerId; entityId: EntityId; kind: 'unit' | 'building' }
  | { type: 'underAttack'; playerId: PlayerId; pos: Vec2 }
  | { type: 'defeated'; playerId: PlayerId }
  | { type: 'victory'; teamId: number }
  | { type: 'notice'; playerId: PlayerId; text: string };

export type WorldOptions = {
  map?: MapOptions;
  players: PlayerConfig[];
  seed?: number;
  /** ללא ערפל מלחמה */
  revealAll?: boolean;
};

const CELL_SIZE = 4;

export class World {
  readonly map: GameMap;
  readonly nav: NavGrid;
  readonly players: Player[];
  readonly entities = new Map<EntityId, Entity>();
  readonly rng: Rng;
  time = 0;
  tickCount = 0;
  gameOver: { winnerTeam: number } | null = null;
  events: GameEvent[] = [];

  /** hash מרחבי לשאילתות שכנים מהירות */
  private cells = new Map<number, Set<EntityId>>();
  private cellOf = new Map<EntityId, number>();
  private fogTimer = 0;
  private popTimer = 0;
  private pathBudget = 0;

  constructor(opts: WorldOptions) {
    resetEntityIds(1);
    const seed = opts.seed ?? 12345;
    this.rng = new Rng(seed);
    this.map = generateMap({
      ...(opts.map ?? {}),
      seed: opts.map?.seed ?? seed,
      playerCount: opts.players.length,
    });
    this.nav = new NavGrid(this.map);
    this.players = opts.players.map((p) => new Player(p, this.map.width, this.map.height));
    if (opts.revealAll) for (const p of this.players) p.fog.revealAll();
    this.spawnStartingEntities();
    this.updateFog(true);
    this.recomputePopulation();
  }

  // ===== ניהול ישויות =====

  private cellIndex(x: number, y: number): number {
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    return cy * 4096 + cx;
  }

  private addToGrid(e: Entity): void {
    const key = this.cellIndex(e.pos.x, e.pos.y);
    let set = this.cells.get(key);
    if (!set) {
      set = new Set();
      this.cells.set(key, set);
    }
    set.add(e.id);
    this.cellOf.set(e.id, key);
  }

  private removeFromGrid(e: Entity): void {
    const key = this.cellOf.get(e.id);
    if (key === undefined) return;
    this.cells.get(key)?.delete(e.id);
    this.cellOf.delete(e.id);
  }

  private refreshGrid(e: Entity): void {
    const key = this.cellIndex(e.pos.x, e.pos.y);
    if (this.cellOf.get(e.id) === key) return;
    this.removeFromGrid(e);
    this.addToGrid(e);
  }

  /** כל הישויות ברדיוס נתון מנקודה. */
  near(pos: Vec2, radius: number, filter?: (e: Entity) => boolean): Entity[] {
    const out: Entity[] = [];
    const r = Math.max(1, Math.ceil(radius / CELL_SIZE));
    const cx = Math.floor(pos.x / CELL_SIZE);
    const cy = Math.floor(pos.y / CELL_SIZE);
    const r2 = radius * radius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const set = this.cells.get((cy + dy) * 4096 + (cx + dx));
        if (!set) continue;
        for (const id of set) {
          const e = this.entities.get(id);
          if (!e || !e.alive) continue;
          const ddx = e.pos.x - pos.x;
          const ddy = e.pos.y - pos.y;
          const reach = radius + entityRadius(e);
          if (ddx * ddx + ddy * ddy > Math.max(r2, reach * reach)) continue;
          if (filter && !filter(e)) continue;
          out.push(e);
        }
      }
    }
    return out;
  }

  get(id: EntityId | null | undefined): Entity | undefined {
    if (id == null) return undefined;
    const e = this.entities.get(id);
    return e && e.alive ? e : undefined;
  }

  player(id: PlayerId): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  isEnemy(a: Entity, b: Entity): boolean {
    if (a.owner === b.owner) return false;
    const pa = this.player(a.owner);
    const pb = this.player(b.owner);
    if (!pa || !pb) return false;
    return pa.team !== pb.team;
  }

  entitiesOf(owner: PlayerId): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.values()) if (e.alive && e.owner === owner) out.push(e);
    return out;
  }

  // ===== יצירה =====

  spawnUnit(defId: string, owner: PlayerId, pos: Vec2): Entity | null {
    const player = this.player(owner);
    if (!player) return null;
    const def = getUnit(defId);
    const free = this.map.findFreeTile(pos.x, pos.y, 14) ?? { x: Math.floor(pos.x), y: Math.floor(pos.y) };
    const e = createUnit(def, owner, { x: free.x + 0.5, y: free.y + 0.5 }, maxHpFor(defId, 'unit', player));
    this.entities.set(e.id, e);
    this.addToGrid(e);
    player.stats.unitsTrained++;
    return e;
  }

  /** בונה מבנה. tile = פינת שמאל-עליון. */
  spawnBuilding(defId: string, owner: PlayerId, tile: Vec2, complete = false): Entity | null {
    const player = this.player(owner);
    if (!player) return null;
    const def = getBuilding(defId);
    if (!this.canPlaceBuilding(def, tile)) return null;
    const e = createBuilding(def, owner, tile, complete, maxHpFor(defId, 'building', player));
    this.entities.set(e.id, e);
    this.addToGrid(e);
    this.setFootprint(e, true);
    if (complete) {
      player.stats.buildingsBuilt++;
      this.recomputePopulation();
    }
    return e;
  }

  canPlaceBuilding(def: BuildingDef, tile: Vec2): boolean {
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (!this.map.inBounds(x, y)) return false;
        if (this.map.isBlocked(x, y)) return false;
        if (this.nav.isOccupied(x, y)) return false;
        const t = this.map.terrainAt(x, y);
        if (t === 'water' || t === 'shallow') return false;
      }
    }
    return true;
  }

  private setFootprint(e: Entity, occupied: boolean): void {
    if (e.kind !== 'building') return;
    const origin = buildingOrigin(e);
    const size = e.building!.size;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        this.nav.setOccupied(origin.x + dx, origin.y + dy, occupied);
      }
    }
  }

  private spawnStartingEntities(): void {
    this.players.forEach((player, i) => {
      const start = this.map.startPositions[i] ?? { x: 10 + i * 10, y: 10 };
      const nation = getNation(player.nation.id);
      for (const bId of nation.startingBuildings ?? []) {
        const def = getBuilding(bId);
        const tile = { x: Math.round(start.x - def.size / 2), y: Math.round(start.y - def.size / 2) };
        const placed = this.placeNear(bId, player.id, tile, 8);
        if (placed) placed.building!.rally = { x: start.x + def.size / 2 + 1, y: start.y + 1 };
      }
      let ring = 0;
      (nation.startingUnits ?? []).forEach((uId, idx) => {
        const angle = (idx / Math.max(1, (nation.startingUnits ?? []).length)) * Math.PI * 2;
        ring = 3.5;
        this.spawnUnit(uId, player.id, {
          x: start.x + Math.cos(angle) * ring,
          y: start.y + Math.sin(angle) * ring,
        });
      });
    });
  }

  /** מנסה למקם מבנה בסביבת אריח נתון. */
  placeNear(defId: string, owner: PlayerId, tile: Vec2, maxRadius = 10): Entity | null {
    const def = getBuilding(defId);
    if (this.canPlaceBuilding(def, tile)) return this.spawnBuilding(defId, owner, tile, true);
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const t = { x: tile.x + dx, y: tile.y + dy };
          if (this.canPlaceBuilding(def, t)) return this.spawnBuilding(defId, owner, t, true);
        }
      }
    }
    return null;
  }

  // ===== מוות וניקוי =====

  damage(target: Entity, amount: number, attacker?: Entity): void {
    if (!target.alive) return;
    target.hp -= amount;
    target.lastDamaged = this.time;
    if (attacker) target.lastAttacker = attacker.id;
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(e: Entity, killer?: Entity): void {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    if (e.kind === 'building') this.setFootprint(e, false);
    this.removeFromGrid(e);
    const owner = this.player(e.owner);
    if (owner && e.kind === 'unit') owner.stats.unitsLost++;
    if (killer) {
      const killerPlayer = this.player(killer.owner);
      if (killerPlayer) killerPlayer.stats.kills++;
    }
    this.events.push({ type: 'entityDied', playerId: e.owner, entityId: e.id, kind: e.kind });
    // יחידות שהיו בדרך אל הישות הזאת — לבטל
    for (const other of this.entities.values()) {
      if (other.alive && other.order.targetId === e.id) other.order = { kind: 'idle' };
    }
    this.recomputePopulation();
  }

  private cleanupDead(): void {
    for (const [id, e] of this.entities) {
      if (!e.alive && this.time - e.lastDamaged > 6) this.entities.delete(id);
    }
  }

  // ===== שאילתות עזר =====

  /** נקודת פריקה קרובה ביותר לסוג משאב. */
  findDropOff(owner: PlayerId, from: Vec2, kind: ResourceKind): Entity | null {
    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== owner || e.kind !== 'building') continue;
      if (!e.building?.complete) continue;
      const def = getBuilding(e.defId);
      const drop = def.dropOff;
      if (!drop) continue;
      if (drop !== 'all' && !drop.includes(kind)) continue;
      const d = (e.pos.x - from.x) ** 2 + (e.pos.y - from.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  /** אריח משאב פנוי קרוב לנקודה, מסוג מסוים. */
  findResourceTile(from: Vec2, kind: ResourceKind, maxRadius = 22): Vec2 | null {
    let best: Vec2 | null = null;
    let bestDist = Infinity;
    const cx = Math.floor(from.x);
    const cy = Math.floor(from.y);
    for (let r = 1; r <= maxRadius; r++) {
      if (best && bestDist < (r - 1) * (r - 1)) break;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          const res = this.map.resourceAt(x, y);
          if (!res || res.kind !== kind || res.amount <= 0) continue;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            best = { x, y };
          }
        }
      }
    }
    return best;
  }

  /** האם השחקן רואה את הישות. */
  canSee(viewer: PlayerId, e: Entity): boolean {
    const p = this.player(viewer);
    if (!p) return false;
    if (e.owner === viewer) return true;
    return p.fog.state(Math.floor(e.pos.x), Math.floor(e.pos.y)) === FOG_VISIBLE;
  }

  countBuildings(owner: PlayerId, onlyComplete = true): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== owner || e.kind !== 'building') continue;
      if (onlyComplete && !e.building?.complete) continue;
      counts[e.defId] = (counts[e.defId] ?? 0) + 1;
    }
    return counts;
  }

  townCenterOf(owner: PlayerId): Entity | null {
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== owner || e.kind !== 'building') continue;
      if (getBuilding(e.defId).isTownCenter) return e;
    }
    return null;
  }

  recomputePopulation(): void {
    const all = [...this.entities.values()];
    for (const p of this.players) {
      p.popCap = computePopCap(p, all);
      p.popUsed = computePopUsed(p, all);
    }
  }

  // ===== פקודות שחקן =====

  /** פקודה כללית לקבוצת יחידות, עם פורמציה. */
  issueCommand(
    ids: EntityId[],
    order: Order,
    opts: { queue?: boolean; formation?: boolean } = {},
  ): void {
    const units = ids.map((id) => this.get(id)).filter((e): e is Entity => !!e && e.kind === 'unit');
    if (units.length === 0) return;

    if (order.kind === 'move' && order.target && opts.formation !== false && units.length > 1) {
      const center = {
        x: units.reduce((s, u) => s + u.pos.x, 0) / units.length,
        y: units.reduce((s, u) => s + u.pos.y, 0) / units.length,
      };
      const angle = Math.atan2(order.target.y - center.y, order.target.x - center.x);
      const offsets = rotateOffsets(formationOffsets(units.length, 'box', 1.1), angle);
      units.forEach((u, i) => {
        const target = {
          x: order.target!.x + offsets[i].x,
          y: order.target!.y + offsets[i].y,
        };
        this.assignOrder(u, { ...order, target }, opts.queue ?? false);
      });
      return;
    }

    for (const u of units) this.assignOrder(u, { ...order }, opts.queue ?? false);
  }

  assignOrder(e: Entity, order: Order, queue = false): void {
    if (!e.alive) return;
    if (queue) {
      e.queue.push(order);
      if (e.order.kind === 'idle') this.startNextOrder(e);
      return;
    }
    e.queue.length = 0;
    this.setOrder(e, order);
  }

  private setOrder(e: Entity, order: Order): void {
    e.order = order;
    if (e.unit) {
      e.unit.path = [];
      e.unit.goal = null;
      e.unit.repathCooldown = 0;
    }
  }

  private startNextOrder(e: Entity): void {
    const next = e.queue.shift();
    this.setOrder(e, next ?? { kind: 'idle' });
  }

  /** ממיר קליק ימני ליעד חכם: אויב=תקיפה, משאב=איסוף, מבנה שלי=פריקה/בנייה. */
  smartOrder(unit: Entity, tile: Vec2, targetEntity?: Entity): Order {
    const def = unit.kind === 'unit' ? getUnit(unit.defId) : null;
    if (targetEntity && this.isEnemy(unit, targetEntity)) {
      return { kind: 'attack', targetId: targetEntity.id };
    }
    if (targetEntity && targetEntity.owner === unit.owner && targetEntity.kind === 'building') {
      if (!targetEntity.building!.complete && def?.canBuild) {
        return { kind: 'build', targetId: targetEntity.id };
      }
      if (targetEntity.hp < targetEntity.maxHp && def?.canRepair) {
        return { kind: 'repair', targetId: targetEntity.id };
      }
    }
    if (targetEntity && targetEntity.owner === unit.owner && targetEntity.kind === 'unit') {
      if (def?.healer && targetEntity.hp < targetEntity.maxHp) {
        return { kind: 'heal', targetId: targetEntity.id };
      }
    }
    const res = this.map.resourceAt(Math.floor(tile.x), Math.floor(tile.y));
    if (res && def?.gatherRate?.[res.kind]) {
      return { kind: 'gather', tile: { x: Math.floor(tile.x), y: Math.floor(tile.y) }, resource: res.kind };
    }
    return { kind: 'move', target: { x: tile.x, y: tile.y } };
  }

  /** מוסיף יחידה לתור אימון במבנה. */
  enqueueTrain(buildingId: EntityId, unitId: string): boolean {
    const b = this.get(buildingId);
    if (!b || b.kind !== 'building' || !b.building?.complete) return false;
    const player = this.player(b.owner);
    if (!player || !player.canTrain(unitId)) return false;
    const bDef = getBuilding(b.defId);
    if (!bDef.trains?.includes(unitId)) return false;
    const uDef = getUnit(unitId);
    if (b.building.trainQueue.length >= 10) return false;
    if (player.popUsed + uDef.pop > player.popCap) {
      this.events.push({ type: 'notice', playerId: player.id, text: 'צריך עוד בתים — האוכלוסייה מלאה' });
      return false;
    }
    const cost = player.unitCost(unitId, uDef.cost);
    if (!player.spend(cost)) {
      this.events.push({ type: 'notice', playerId: player.id, text: 'אין מספיק משאבים' });
      return false;
    }
    const total = uDef.trainTime / Math.max(0.2, player.trainSpeed());
    b.building.trainQueue.push({ unitId, remaining: total, total });
    this.recomputePopulation();
    return true;
  }

  cancelTrain(buildingId: EntityId, index: number): boolean {
    const b = this.get(buildingId);
    if (!b || b.kind !== 'building') return false;
    const item = b.building?.trainQueue[index];
    if (!item) return false;
    const player = this.player(b.owner);
    if (player) player.refund(player.unitCost(item.unitId, getUnit(item.unitId).cost));
    b.building!.trainQueue.splice(index, 1);
    this.recomputePopulation();
    return true;
  }

  startResearch(buildingId: EntityId, techId: string): boolean {
    const b = this.get(buildingId);
    if (!b || b.kind !== 'building' || !b.building?.complete) return false;
    if (b.building.research) return false;
    const player = this.player(b.owner);
    if (!player || !player.canResearch(techId)) return false;
    const bDef = getBuilding(b.defId);
    if (!bDef.researches?.includes(techId)) return false;
    const tech = getTech(techId);
    if (!player.spend(tech.cost)) return false;
    const total = tech.researchTime / Math.max(0.2, player.researchSpeed());
    b.building.research = { techId, remaining: total, total };
    return true;
  }

  /** מתחיל בניית מבנה (יוצר "אתר בנייה" ושולח פועלים). */
  startConstruction(
    owner: PlayerId,
    defId: string,
    tile: Vec2,
    builderIds: EntityId[] = [],
  ): Entity | null {
    const player = this.player(owner);
    if (!player || !player.canBuild(defId)) return null;
    const def = getBuilding(defId);
    if (def.limit != null) {
      const counts = this.countBuildings(owner, false);
      if ((counts[defId] ?? 0) >= def.limit) {
        this.events.push({ type: 'notice', playerId: owner, text: `הגעת למגבלת ${def.name}` });
        return null;
      }
    }
    if (!this.canPlaceBuilding(def, tile)) return null;
    const cost = player.buildingCost(defId);
    if (!player.spend(cost)) {
      this.events.push({ type: 'notice', playerId: owner, text: 'אין מספיק משאבים לבנייה' });
      return null;
    }
    const site = this.spawnBuilding(defId, owner, tile, false);
    if (!site) {
      player.refund(cost);
      return null;
    }
    for (const id of builderIds) {
      const u = this.get(id);
      if (u && u.kind === 'unit' && getUnit(u.defId).canBuild) {
        this.assignOrder(u, { kind: 'build', targetId: site.id });
      }
    }
    return site;
  }

  /** מבטל אתר בנייה ומחזיר חלק מהמשאבים. */
  cancelConstruction(entityId: EntityId): boolean {
    const e = this.get(entityId);
    if (!e || e.kind !== 'building' || e.building?.complete) return false;
    const player = this.player(e.owner);
    if (player) {
      const cost = player.buildingCost(e.defId);
      const refundRatio = 1 - (e.building?.progress ?? 0);
      for (const [k, v] of Object.entries(cost)) {
        player.resources[k as ResourceKind] += Math.floor((v ?? 0) * refundRatio);
      }
    }
    this.kill(e);
    return true;
  }

  /** מנסה להתחיל מעבר לשלב הצמיחה הבא. */
  requestStageAdvance(owner: PlayerId): boolean {
    const player = this.player(owner);
    if (!player) return false;
    return beginStageTransition(player, this.countBuildings(owner), player.popUsed);
  }

  setRallyPoint(buildingId: EntityId, point: Vec2): void {
    const b = this.get(buildingId);
    if (b?.building) b.building.rally = { x: point.x, y: point.y };
  }

  // ===== לולאת הסימולציה =====

  update(dt: number): void {
    if (this.gameOver) return;
    const step = Math.min(0.1, Math.max(0, dt));
    this.time += step;
    this.tickCount++;
    this.pathBudget = 48;

    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      if (e.kind === 'unit') this.updateUnit(e, step);
      else this.updateBuilding(e, step);
    }

    for (const p of this.players) {
      const advanced = tickStageTransition(p, step);
      if (advanced) {
        this.events.push({
          type: 'stageAdvanced',
          playerId: p.id,
          stage: advanced.stage.index,
          pendingBranches: advanced.pendingBranches,
        });
        this.upgradeTownCenters(p);
        this.recomputePopulation();
      }
    }

    this.fogTimer += step;
    if (this.fogTimer >= 0.2) {
      this.fogTimer = 0;
      this.updateFog();
    }

    this.popTimer += step;
    if (this.popTimer >= 0.5) {
      this.popTimer = 0;
      this.recomputePopulation();
      this.checkDefeat();
    }

    this.cleanupDead();
  }

  /** מרכז היישוב גדל עם השלב — יותר חיים וטווח ראייה. */
  private upgradeTownCenters(player: Player): void {
    const bonus = 1 + (player.stage - 1) * 0.25;
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== player.id || e.kind !== 'building') continue;
      if (!getBuilding(e.defId).isTownCenter) continue;
      const base = maxHpFor(e.defId, 'building', player);
      const newMax = Math.round(base * bonus);
      const ratio = e.hp / e.maxHp;
      e.maxHp = newMax;
      e.hp = Math.round(newMax * ratio);
    }
  }

  private updateFog(force = false): void {
    for (const p of this.players) {
      if (!force && p.defeated) continue;
      p.fog.clearVisible();
    }
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      const p = this.player(e.owner);
      if (!p) continue;
      const def = e.kind === 'unit' ? getUnit(e.defId) : getBuilding(e.defId);
      p.fog.reveal(e.pos.x, e.pos.y, def.los + p.losBonus());
    }
    // בעלי ברית חולקים ראייה
    for (const p of this.players) {
      for (const other of this.players) {
        if (other === p || other.team !== p.team) continue;
        for (const e of this.entities.values()) {
          if (!e.alive || e.owner !== other.id) continue;
          const def = e.kind === 'unit' ? getUnit(e.defId) : getBuilding(e.defId);
          p.fog.reveal(e.pos.x, e.pos.y, def.los + p.losBonus());
        }
      }
    }
  }

  private checkDefeat(): void {
    const aliveTeams = new Set<number>();
    for (const p of this.players) {
      const has = this.entitiesOf(p.id).length > 0;
      if (!has && !p.defeated) {
        p.defeated = true;
        this.events.push({ type: 'defeated', playerId: p.id });
      }
      if (has) aliveTeams.add(p.team);
    }
    if (aliveTeams.size === 1 && this.players.length > 1) {
      const winner = [...aliveTeams][0];
      this.gameOver = { winnerTeam: winner };
      this.events.push({ type: 'victory', teamId: winner });
    }
  }

  // ===== תנועה =====

  /** כוח הדיפה בין יחידות סמוכות — מונע ערימה על אותה נקודה. */
  private separation(e: Entity): Vec2 {
    const push = { x: 0, y: 0 };
    const r = entityRadius(e) * 2 + 0.25;
    const neighbours = this.near(e.pos, r, (o) => o.kind === 'unit' && o.id !== e.id);
    for (const o of neighbours) {
      const dx = e.pos.x - o.pos.x;
      const dy = e.pos.y - o.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-4) {
        push.x += (this.rng.next() - 0.5) * 0.5;
        push.y += (this.rng.next() - 0.5) * 0.5;
        continue;
      }
      if (d >= r) continue;
      const strength = (r - d) / r;
      push.x += (dx / d) * strength;
      push.y += (dy / d) * strength;
    }
    return push;
  }

  /** מזיז יחידה לעבר יעד לאורך מסלול. מחזיר true כשהגיעה. */
  private moveTowards(e: Entity, goal: Vec2, dt: number, stopDistance = 0.3): boolean {
    const u = e.unit!;
    const def = getUnit(e.defId);
    const player = this.player(e.owner);
    const stats = statsOf(e, player);
    const distToGoal = Math.hypot(goal.x - e.pos.x, goal.y - e.pos.y);
    if (distToGoal <= stopDistance) {
      u.path = [];
      u.goal = null;
      return true;
    }

    const flying = def.class === 'air';
    u.repathCooldown -= dt;

    const goalChanged =
      !u.goal || Math.hypot(u.goal.x - goal.x, u.goal.y - goal.y) > Math.max(0.6, stopDistance);

    if (!flying && (goalChanged || (u.path.length === 0 && u.repathCooldown <= 0))) {
      if (this.pathBudget > 0) {
        this.pathBudget--;
        u.goal = { x: goal.x, y: goal.y };
        const result = findPath(this.nav, e.pos, goal, {
          stopDistance: stopDistance > 1 ? stopDistance - 0.5 : 0,
          maxNodes: 9000,
        });
        u.path = smoothPath(this.nav, e.pos, result.path);
        u.repathCooldown = result.found ? 0.6 : 1.4;
        if (u.path.length === 0 && !result.found) {
          u.stuckTime += dt;
          if (u.stuckTime > 2.5) {
            u.stuckTime = 0;
            return true; // ויתור — נחשב כהגעה כדי לא להיתקע לנצח
          }
        }
      }
    }

    let step: Vec2;
    if (flying || u.path.length === 0) {
      step = { x: goal.x - e.pos.x, y: goal.y - e.pos.y };
    } else {
      const wp = u.path[0];
      step = { x: wp.x + 0.5 - e.pos.x, y: wp.y + 0.5 - e.pos.y };
      if (Math.hypot(step.x, step.y) < 0.35) {
        u.path.shift();
        if (u.path.length === 0) {
          step = { x: goal.x - e.pos.x, y: goal.y - e.pos.y };
        } else {
          const nx = u.path[0];
          step = { x: nx.x + 0.5 - e.pos.x, y: nx.y + 0.5 - e.pos.y };
        }
      }
    }

    const len = Math.hypot(step.x, step.y);
    if (len < 1e-5) return true;
    let dirX = step.x / len;
    let dirY = step.y / len;

    if (!flying) {
      const sep = this.separation(e);
      dirX += sep.x * 0.85;
      dirY += sep.y * 0.85;
      const l2 = Math.hypot(dirX, dirY);
      if (l2 > 1e-5) {
        dirX /= l2;
        dirY /= l2;
      }
    }

    const terrain = flying ? 1 : Math.max(0.25, this.map.speedAt(Math.floor(e.pos.x), Math.floor(e.pos.y)));
    const speed = stats.speed * terrain;
    const nx = e.pos.x + dirX * speed * dt;
    const ny = e.pos.y + dirY * speed * dt;

    u.facing = Math.atan2(dirY, dirX);

    if (flying) {
      e.pos.x = Math.max(0.5, Math.min(this.map.width - 0.5, nx));
      e.pos.y = Math.max(0.5, Math.min(this.map.height - 0.5, ny));
    } else {
      // תנועה עם החלקה לאורך מכשולים
      const canX = !this.nav.isBlocked(Math.floor(nx), Math.floor(e.pos.y));
      const canY = !this.nav.isBlocked(Math.floor(e.pos.x), Math.floor(ny));
      if (canX) e.pos.x = nx;
      if (canY) e.pos.y = ny;
      if (!canX && !canY) {
        u.stuckTime += dt;
        if (u.stuckTime > 1.2) {
          u.stuckTime = 0;
          u.path = [];
          u.goal = null;
          u.repathCooldown = 0;
        }
      } else {
        u.stuckTime = Math.max(0, u.stuckTime - dt);
      }
    }

    this.refreshGrid(e);
    return Math.hypot(goal.x - e.pos.x, goal.y - e.pos.y) <= stopDistance;
  }

  /** מתקרב לישות עד לטווח נתון מהקצה שלה. */
  private approachEntity(e: Entity, target: Entity, dt: number, range: number): boolean {
    if (edgeDistance(e, target) <= range) {
      const u = e.unit!;
      u.path = [];
      u.facing = Math.atan2(target.pos.y - e.pos.y, target.pos.x - e.pos.x);
      return true;
    }
    const stop = range + entityRadius(target) + entityRadius(e) * 0.5;
    return this.moveTowards(e, target.pos, dt, Math.max(0.35, stop));
  }

  // ===== התנהגות יחידות =====

  private updateUnit(e: Entity, dt: number): void {
    const u = e.unit!;
    const def = getUnit(e.defId);
    u.cooldown = Math.max(0, u.cooldown - dt);
    u.attackAnim = Math.max(0, u.attackAnim - dt * 3);

    switch (e.order.kind) {
      case 'idle':
        this.autoAcquire(e, def);
        break;
      case 'hold':
        this.attackInPlace(e);
        break;
      case 'move': {
        if (!e.order.target) {
          this.finishOrder(e);
          break;
        }
        if (this.moveTowards(e, e.order.target, dt, 0.35)) this.finishOrder(e);
        break;
      }
      case 'attackMove': {
        const found = this.findNearbyEnemy(e, statsOf(e, this.player(e.owner)).los);
        if (found) {
          const resume = e.order;
          this.setOrder(e, { kind: 'attack', targetId: found.id, resume });
          break;
        }
        if (!e.order.target || this.moveTowards(e, e.order.target, dt, 0.5)) this.finishOrder(e);
        break;
      }
      case 'attack':
        this.updateAttackOrder(e, dt);
        break;
      case 'gather':
        this.updateGatherOrder(e, def, dt);
        break;
      case 'return':
        this.updateReturnOrder(e, def, dt);
        break;
      case 'build':
        this.updateBuildOrder(e, dt);
        break;
      case 'repair':
        this.updateRepairOrder(e, dt);
        break;
      case 'heal':
        this.updateHealOrder(e, def, dt);
        break;
    }
  }

  private finishOrder(e: Entity): void {
    if (e.order.resume) {
      const resume = e.order.resume;
      this.setOrder(e, resume);
      return;
    }
    this.startNextOrder(e);
  }

  /** יחידות צבאיות בהמתנה מגיבות לאויב בטווח ראייה. */
  private autoAcquire(e: Entity, def: UnitDef): void {
    if (def.class === 'worker' && !def.healer) {
      // פועל שהותקף בורח למרכז היישוב
      if (e.lastAttacker && this.time - e.lastDamaged < 2) {
        const tc = this.townCenterOf(e.owner);
        if (tc) this.setOrder(e, { kind: 'move', target: { x: tc.pos.x, y: tc.pos.y } });
      }
      return;
    }
    if (def.healer) {
      const hurt = this.near(e.pos, def.los, (o) =>
        o.kind === 'unit' && o.owner === e.owner && o.id !== e.id && o.hp < o.maxHp,
      )[0];
      if (hurt) this.setOrder(e, { kind: 'heal', targetId: hurt.id });
      return;
    }
    const enemy = this.findNearbyEnemy(e, def.los * 0.8);
    if (enemy) this.setOrder(e, { kind: 'attack', targetId: enemy.id });
  }

  /** תוקף מטרה בטווח בלי לזוז (מצב "החזק עמדה"). */
  private attackInPlace(e: Entity): void {
    const player = this.player(e.owner);
    const stats = statsOf(e, player);
    if (stats.attack <= 0) return;
    const target = this.findNearbyEnemy(e, Math.max(stats.range, 1.5));
    if (!target) return;
    if (edgeDistance(e, target) <= stats.range) this.tryHit(e, target, stats);
  }

  findNearbyEnemy(e: Entity, radius: number): Entity | null {
    const candidates = this.near(e.pos, radius, (o) => this.isEnemy(e, o));
    if (candidates.length === 0) return null;
    let best: Entity | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const d = Math.hypot(c.pos.x - e.pos.x, c.pos.y - e.pos.y);
      // עדיפות ליחידות על פני מבנים, ולקרובים
      let score = -d;
      if (c.kind === 'unit') score += 6;
      if (c.id === e.lastAttacker) score += 4;
      if (c.kind === 'building' && !c.building?.complete) score -= 3;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  private tryHit(attacker: Entity, target: Entity, stats: CombatStats): void {
    const u = attacker.unit;
    if (u) {
      if (u.cooldown > 0) return;
      u.cooldown = stats.cooldown;
      u.attackAnim = 1;
    }
    const defenderStats = statsOf(target, this.player(target.owner));
    const dmg = computeDamage(stats, defenderStats);
    this.damage(target, dmg, attacker);
    const owner = this.player(target.owner);
    if (owner && !owner.isAI && this.time - (owner as unknown as { lastWarn?: number }).lastWarn! > 12) {
      (owner as unknown as { lastWarn?: number }).lastWarn = this.time;
      this.events.push({ type: 'underAttack', playerId: target.owner, pos: { ...target.pos } });
    }
  }

  private updateAttackOrder(e: Entity, dt: number): void {
    const target = this.get(e.order.targetId);
    const player = this.player(e.owner);
    const stats = statsOf(e, player);
    if (!target || !this.isEnemy(e, target)) {
      this.finishOrder(e);
      return;
    }
    if (stats.attack <= 0) {
      this.finishOrder(e);
      return;
    }
    if (this.approachEntity(e, target, dt, stats.range)) {
      this.tryHit(e, target, stats);
    }
  }

  private updateGatherOrder(e: Entity, def: UnitDef, dt: number): void {
    const u = e.unit!;
    const player = this.player(e.owner);
    if (!player || !e.order.tile || !e.order.resource) {
      this.finishOrder(e);
      return;
    }
    const capacity = carryCapacity(e.defId);
    if (u.carrying && u.carrying.amount >= capacity) {
      this.beginReturn(e, u.carrying.kind);
      return;
    }
    const tile = e.order.tile;
    const res = this.map.resourceAt(tile.x, tile.y);
    if (!res || res.amount <= 0) {
      // המשאב נגמר — מחפשים אריח קרוב מאותו סוג
      const next = this.findResourceTile(e.pos, e.order.resource, 14);
      if (next) {
        this.setOrder(e, { kind: 'gather', tile: next, resource: e.order.resource });
      } else if (u.carrying && u.carrying.amount > 0) {
        this.beginReturn(e, u.carrying.kind);
      } else {
        this.finishOrder(e);
      }
      return;
    }

    const target = { x: tile.x + 0.5, y: tile.y + 0.5 };
    const dist = Math.hypot(target.x - e.pos.x, target.y - e.pos.y);
    if (dist > 1.25) {
      this.moveTowards(e, target, dt, 1.1);
      return;
    }
    u.facing = Math.atan2(target.y - e.pos.y, target.x - e.pos.x);
    const rate = gatherRateFor(e.defId, res.kind, player);
    if (rate <= 0) {
      this.finishOrder(e);
      return;
    }
    const want = rate * dt;
    const got = this.map.harvest(tile.x, tile.y, want);
    if (got > 0) {
      if (!u.carrying || u.carrying.kind !== res.kind) u.carrying = { kind: res.kind, amount: 0 };
      u.carrying.amount = Math.min(capacity, u.carrying.amount + got);
      if (u.carrying.amount >= capacity) this.beginReturn(e, res.kind);
    }
    void def;
  }

  private beginReturn(e: Entity, kind: ResourceKind): void {
    const drop = this.findDropOff(e.owner, e.pos, kind);
    if (!drop) return; // אין לאן לפרוק — ממשיכים לאסוף
    const resume: Order | undefined = e.order.kind === 'gather' ? { ...e.order } : e.order.resume;
    this.setOrder(e, { kind: 'return', targetId: drop.id, resume });
  }

  private updateReturnOrder(e: Entity, def: UnitDef, dt: number): void {
    const u = e.unit!;
    const player = this.player(e.owner);
    if (!u.carrying || !player) {
      this.finishOrder(e);
      return;
    }
    let drop = this.get(e.order.targetId);
    if (!drop) {
      drop = this.findDropOff(e.owner, e.pos, u.carrying.kind) ?? undefined;
      if (!drop) {
        this.finishOrder(e);
        return;
      }
      e.order.targetId = drop.id;
    }
    if (this.approachEntity(e, drop, dt, 0.6)) {
      player.add(u.carrying.kind, Math.floor(u.carrying.amount));
      u.carrying = null;
      this.finishOrder(e);
    }
    void def;
  }

  private updateBuildOrder(e: Entity, dt: number): void {
    const site = this.get(e.order.targetId);
    const player = this.player(e.owner);
    if (!site || site.kind !== 'building' || !player) {
      this.finishOrder(e);
      return;
    }
    if (site.building!.complete) {
      this.finishOrder(e);
      return;
    }
    if (!this.approachEntity(e, site, dt, 0.7)) return;
    const def = getBuilding(site.defId);
    const rate = player.buildSpeed() / def.buildTime;
    site.building!.progress = Math.min(1, site.building!.progress + rate * dt);
    site.hp = Math.max(1, Math.round(site.maxHp * (0.1 + 0.9 * site.building!.progress)));
    e.unit!.attackAnim = 1;
    if (site.building!.progress >= 1) {
      this.completeBuilding(site);
    }
  }

  completeBuilding(site: Entity): void {
    if (!site.building || site.building.complete) return;
    site.building.complete = true;
    site.building.progress = 1;
    site.hp = site.maxHp;
    const player = this.player(site.owner);
    if (player) player.stats.buildingsBuilt++;
    this.recomputePopulation();
    this.events.push({
      type: 'buildingComplete',
      playerId: site.owner,
      entityId: site.id,
      defId: site.defId,
    });
    // פועלים שבנו את המבנה ממשיכים למשימה הבאה
    for (const e of this.entities.values()) {
      if (e.alive && e.order.kind === 'build' && e.order.targetId === site.id) this.finishOrder(e);
    }
  }

  private updateRepairOrder(e: Entity, dt: number): void {
    const target = this.get(e.order.targetId);
    if (!target || target.hp >= target.maxHp) {
      this.finishOrder(e);
      return;
    }
    if (!this.approachEntity(e, target, dt, 0.7)) return;
    const rate = target.maxHp * 0.035;
    target.hp = Math.min(target.maxHp, target.hp + rate * dt);
    e.unit!.attackAnim = 1;
  }

  private updateHealOrder(e: Entity, def: UnitDef, dt: number): void {
    const target = this.get(e.order.targetId);
    if (!target || target.hp >= target.maxHp || target.owner !== e.owner) {
      this.finishOrder(e);
      return;
    }
    if (!this.approachEntity(e, target, dt, Math.max(1, def.range))) return;
    target.hp = Math.min(target.maxHp, target.hp + 6 * dt);
  }

  // ===== מבנים =====

  private updateBuilding(e: Entity, dt: number): void {
    const b = e.building!;
    const player = this.player(e.owner);
    if (!player) return;
    if (!b.complete) return;

    const def = getBuilding(e.defId);
    applyTrickle(player, e, dt);

    // תור אימון
    if (b.trainQueue.length > 0) {
      const item = b.trainQueue[0];
      item.remaining -= dt;
      if (item.remaining <= 0) {
        const spawnAt = this.spawnPointFor(e);
        const unit = this.spawnUnit(item.unitId, e.owner, spawnAt);
        b.trainQueue.shift();
        if (unit) {
          this.events.push({
            type: 'unitTrained',
            playerId: e.owner,
            entityId: unit.id,
            defId: unit.defId,
          });
          if (b.rally) {
            const rallyTile = { x: Math.floor(b.rally.x), y: Math.floor(b.rally.y) };
            const res = this.map.resourceAt(rallyTile.x, rallyTile.y);
            const uDef = getUnit(unit.defId);
            if (res && uDef.gatherRate?.[res.kind]) {
              this.assignOrder(unit, { kind: 'gather', tile: rallyTile, resource: res.kind });
            } else {
              this.assignOrder(unit, { kind: 'move', target: { ...b.rally } });
            }
          }
        }
        this.recomputePopulation();
      }
    }

    // מחקר
    if (b.research) {
      b.research.remaining -= dt;
      if (b.research.remaining <= 0) {
        player.completeResearch(b.research.techId);
        this.events.push({ type: 'researchComplete', playerId: e.owner, techId: b.research.techId });
        b.research = null;
        this.recomputePopulation();
      }
    }

    // הילת ריפוי (בית חולים)
    if (def.healAura) {
      b.healAcc += dt;
      if (b.healAcc >= 0.5) {
        const amount = def.healAura.rate * b.healAcc;
        b.healAcc = 0;
        for (const o of this.near(e.pos, def.healAura.radius, (x) => x.owner === e.owner && x.hp < x.maxHp)) {
          o.hp = Math.min(o.maxHp, o.hp + amount);
        }
      }
    }

    // מבנה תוקף
    if (def.attack && def.range) {
      b.attackCooldown = Math.max(0, b.attackCooldown - dt);
      if (b.attackCooldown <= 0) {
        const stats = statsOf(e, player);
        const target = this.findNearbyEnemy(e, def.range + (e.building!.size ?? 1) / 2);
        if (target && edgeDistance(e, target) <= def.range) {
          b.attackCooldown = stats.cooldown;
          const dmg = computeDamage(stats, statsOf(target, this.player(target.owner)));
          this.damage(target, dmg, e);
        }
      }
    }
  }

  /** נקודת הופעה ליחידה חדשה — סמוך לקצה המבנה. */
  private spawnPointFor(b: Entity): Vec2 {
    const origin = buildingOrigin(b);
    const size = b.building?.size ?? 1;
    const candidates: Vec2[] = [];
    for (let i = -1; i <= size; i++) {
      candidates.push({ x: origin.x + i, y: origin.y - 1 });
      candidates.push({ x: origin.x + i, y: origin.y + size });
      candidates.push({ x: origin.x - 1, y: origin.y + i });
      candidates.push({ x: origin.x + size, y: origin.y + i });
    }
    for (const c of candidates) {
      if (!this.nav.isBlocked(c.x, c.y)) return { x: c.x + 0.5, y: c.y + 0.5 };
    }
    return { x: b.pos.x, y: b.pos.y + size / 2 + 1 };
  }

  /** מידע שלב נוכחי — נוחות לממשק. */
  stageInfo(playerId: PlayerId) {
    const p = this.player(playerId);
    if (!p) return null;
    return {
      stage: stageOf(p.nation, p.stage),
      appearance: p.centerAppearance(),
      transition: p.transition,
    };
  }

  /** משחזר ישויות מתוך שמירה (בשימוש save.ts). */
  rebuildFromEntities(entities: Entity[]): void {
    for (const raw of entities) {
      const e: Entity = JSON.parse(JSON.stringify(raw)) as Entity;
      this.entities.set(e.id, e);
      this.addToGrid(e);
      if (e.kind === 'building') this.setFootprint(e, true);
    }
    this.updateFog(true);
    this.recomputePopulation();
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
