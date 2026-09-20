import { getBuilding, getUnit, stageOf } from '../data';
import type { BuildingDef, UnitDef } from '../data/schema';
import { evaluateStageRequirements } from '../core/growth';
import type { Entity } from '../core/entities';
import type { Player } from '../core/player';
import type { Difficulty, PlayerId, ResourceKind, Vec2 } from '../core/types';
import { RESOURCE_KINDS } from '../core/types';
import type { World } from '../core/world';
import { AI_PROFILES, type AiProfile } from './difficulty';
import { availableByRole, roleOf } from './roles';

/** יחס הפועלים הרצוי בין המשאבים. */
const GATHER_RATIO: Record<ResourceKind, number> = {
  food: 0.4,
  wood: 0.32,
  gold: 0.18,
  stone: 0.1,
};

type Wave = {
  units: number[];
  target: Vec2 | null;
  launched: boolean;
};

/**
 * בינה מלאכותית לאויב.
 * עובדת בדופק קבוע ("חשיבה"), בונה כלכלה, גדלה בשלבים,
 * מתגוננת ושולחת גלי התקפה לפי רמת הקושי.
 */
export class AiController {
  readonly playerId: PlayerId;
  readonly profile: AiProfile;
  private timer = 0;
  private waveTimer = 0;
  private wave: Wave = { units: [], target: null, launched: false };
  private lastEnemyBase: Vec2 | null = null;
  private defenseUntil = 0;
  /** מפת "מה כבר ביקשתי לבנות" — מונע ניסיונות כפולים באותו דופק */
  private pendingBuild = 0;
  /** מקום הנמל שנמצא (null = אין חוף בטווח, undefined = עוד לא נבדק). */
  private cachedShore: Vec2 | null | undefined = undefined;

  constructor(playerId: PlayerId, difficulty: Difficulty = 'normal') {
    this.playerId = playerId;
    this.profile = AI_PROFILES[difficulty] ?? AI_PROFILES.normal;
    this.waveTimer = this.profile.waveInterval * 0.6;
  }

  update(world: World, dt: number): void {
    const player = world.player(this.playerId);
    if (!player || player.defeated || world.gameOver) return;

    this.timer -= dt;
    this.waveTimer -= dt;
    if (this.timer > 0) return;
    this.timer = this.profile.thinkInterval;

    const mine = world.entitiesOf(this.playerId);
    const units = mine.filter((e) => e.kind === 'unit');
    const buildings = mine.filter((e) => e.kind === 'building');
    // סירת דיג אוספת, אבל היא לא פועל יבשתי: אסור לשלוח אותה לכרות עץ
    const workers = units.filter((e) => {
      const d = getUnit(e.defId);
      return Boolean(d.gatherRate) && d.class !== 'ship';
    });
    const army = units.filter((e) => this.isMilitary(e));

    this.manageEconomy(world, player, workers);
    this.manageTraining(world, player, buildings, workers.length, army.length);
    this.manageDocks(world, player, buildings);
    this.manageConstruction(world, player, buildings, workers);
    this.manageResearch(world, player, buildings);
    this.manageGrowth(world, player, buildings);
    this.manageDefense(world, player, army, buildings);
    this.manageAttack(world, player, army);
  }

  private isMilitary(e: Entity): boolean {
    const def = getUnit(e.defId);
    // ספינות לא נשלחות בגלי התקפה יבשתיים — הן מגינות על החוף בעצמן
    return def.class !== 'worker' && def.class !== 'ship' && !def.healer;
  }

  // ===== כלכלה =====

  private manageEconomy(world: World, player: Player, workers: Entity[]): void {
    if (workers.length === 0) return;
    const assigned: Record<ResourceKind, number> = { food: 0, wood: 0, stone: 0, gold: 0 };
    const idle: Entity[] = [];

    for (const w of workers) {
      const order = w.order;
      if (order.kind === 'gather' && order.resource) {
        assigned[order.resource]++;
      } else if (order.kind === 'return' && w.unit?.carrying) {
        assigned[w.unit.carrying.kind]++;
      } else if (order.kind === 'build' || order.kind === 'repair') {
        // עסוק בבנייה
      } else if (order.kind === 'idle' || order.kind === 'move') {
        idle.push(w);
      }
    }

    const working = RESOURCE_KINDS.reduce((s, k) => s + assigned[k], 0);
    const total = Math.max(1, working + idle.length);

    for (const worker of idle) {
      const kind = this.neediestResource(player, assigned, total);
      const tc = world.townCenterOf(this.playerId);
      const from = tc?.pos ?? worker.pos;
      const tile =
        world.findResourceTile(worker.pos, kind, 20) ?? world.findResourceTile(from, kind, 40);
      if (!tile) {
        // אין משאב כזה בסביבה — ננסה משאב אחר
        const fallback = RESOURCE_KINDS.find((k) => world.findResourceTile(from, k, 40));
        if (!fallback) continue;
        const ft = world.findResourceTile(from, fallback, 40)!;
        world.assignOrder(worker, { kind: 'gather', tile: ft, resource: fallback });
        assigned[fallback]++;
        continue;
      }
      world.assignOrder(worker, { kind: 'gather', tile, resource: kind });
      assigned[kind]++;
    }
  }

  /** המשאב עם הפער הגדול ביותר מהיחס הרצוי. */
  private neediestResource(
    player: Player,
    assigned: Record<ResourceKind, number>,
    total: number,
  ): ResourceKind {
    let best: ResourceKind = 'food';
    let bestScore = -Infinity;
    for (const k of RESOURCE_KINDS) {
      const want = GATHER_RATIO[k] * total;
      let score = want - assigned[k];
      // מחסור במשאב מסוים מעלה עדיפות
      if (player.resources[k] < 150) score += 1.5;
      if (player.resources[k] > 900) score -= 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  }

  // ===== אימון =====

  private manageTraining(
    world: World,
    player: Player,
    buildings: Entity[],
    workerCount: number,
    armyCount: number,
  ): void {
    const stageIdx = Math.min(3, player.stage - 1);
    const workerTarget = Math.round(this.profile.workerTarget[stageIdx]);

    // פועלים ממרכז היישוב
    if (workerCount < workerTarget) {
      for (const b of buildings) {
        if (!getBuilding(b.defId).isTownCenter) continue;
        if ((b.building?.trainQueue.length ?? 0) >= 2) continue;
        world.enqueueTrain(b.id, player.nation.worker);
        break;
      }
    }

    // צבא — רק אם יש כלכלה בסיסית
    if (workerCount < Math.min(6, workerTarget * 0.4)) return;
    const desiredArmy = this.profile.waveSize[stageIdx] * 2;
    if (armyCount >= desiredArmy + 6) return;

    for (const b of buildings) {
      const def = getBuilding(b.defId);
      if (!def.trains || def.isTownCenter) continue;
      // נמל מנוהל בנפרד: סירות דיג הן כלכלה, לא צבא
      if (roleOf(def) === 'dock') continue;
      if (!b.building?.complete) continue;
      if ((b.building.trainQueue.length ?? 0) >= 2) continue;
      const choice = this.pickUnit(world, player, def);
      if (choice) world.enqueueTrain(b.id, choice.id);
    }
  }

  /**
   * נמלים: קודם צי דיג (כלכלה), ורק כשיש מספיק — ספינות קרב.
   * סירת דיג נספרת ככלכלה ולא כצבא, אחרת ה-AI היה חושב שיש לו צבא
   * ושולח גלי התקפה של סירות.
   */
  private manageDocks(world: World, player: Player, buildings: Entity[]): void {
    const docks = buildings.filter(
      (b) => b.building?.complete && roleOf(getBuilding(b.defId)) === 'dock',
    );
    if (docks.length === 0) return;

    let boats = 0;
    let warships = 0;
    for (const e of world.entitiesOf(this.playerId)) {
      if (!e.alive || e.kind !== 'unit') continue;
      const d = getUnit(e.defId);
      if (d.class !== 'ship') continue;
      if (d.gatherRate) boats++;
      else warships++;
    }

    const wantBoats = 2 + player.stage;
    for (const b of docks) {
      const def = getBuilding(b.defId);
      if (!def.trains || (b.building!.trainQueue.length ?? 0) >= 1) continue;
      const fishing = def.trains.filter((id) => getUnit(id).gatherRate);
      const war = def.trains.filter((id) => !getUnit(id).gatherRate);
      const pick = boats < wantBoats ? fishing[0] : warships < player.stage ? war[0] : null;
      if (!pick || !player.canTrain(pick)) continue;
      const u = getUnit(pick);
      if (!player.hasResources(player.unitCost(u.id, u.cost))) continue;
      world.enqueueTrain(b.id, pick);
      if (boats < wantBoats) boats++;
      else warships++;
    }

    // סירת דיג שסיימה או שנולדה — שולחים לדגה הקרובה
    for (const e of world.entitiesOf(this.playerId)) {
      if (!e.alive || e.kind !== 'unit' || e.order.kind !== 'idle') continue;
      const d = getUnit(e.defId);
      if (d.class !== 'ship' || !d.gatherRate) continue;
      const tile = world.findResourceTile(e.pos, 'food', 26, true);
      if (tile) world.assignOrder(e, { kind: 'gather', tile, resource: 'food' });
    }
  }

  /** בוחר יחידה לאימון: מעדיף יחידה שחזקה מול הצבא של האויב. */
  private pickUnit(world: World, player: Player, building: BuildingDef): UnitDef | null {
    const options = (building.trains ?? [])
      .filter((id) => player.canTrain(id))
      .map((id) => getUnit(id))
      .filter((u) => !u.healer)
      .filter((u) => player.hasResources(player.unitCost(u.id, u.cost)));
    if (options.length === 0) return null;

    // ספירת סוגי היחידות של האויב הנראות
    const enemyClasses = new Map<string, number>();
    for (const e of world.entities.values()) {
      if (!e.alive || e.kind !== 'unit') continue;
      const other = world.player(e.owner);
      if (!other || other.team === player.team) continue;
      const cls = getUnit(e.defId).class;
      enemyClasses.set(cls, (enemyClasses.get(cls) ?? 0) + 1);
    }

    let best = options[0];
    let bestScore = -Infinity;
    for (const u of options) {
      let score = u.attack / Math.max(0.5, u.attackCooldown) + u.hp / 40;
      for (const [cls, count] of enemyClasses) {
        const bonus = u.bonusVs?.[cls as keyof typeof u.bonusVs] ?? 1;
        if (bonus > 1) score += count * (bonus - 1) * 0.8;
      }
      score -= (u.pop - 1) * 1.5;
      score += world.rng.float(-0.6, 0.6); // גיוון
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  // ===== בנייה =====

  private manageConstruction(
    world: World,
    player: Player,
    buildings: Entity[],
    workers: Entity[],
  ): void {
    if (workers.length === 0) return;
    this.pendingBuild = buildings.filter((b) => !b.building?.complete).length;
    if (this.pendingBuild >= 2) {
      this.assignBuilders(world, buildings, workers);
      return;
    }

    const wanted = this.nextBuildingToPlace(world, player, buildings);
    if (!wanted) return;
    const cost = player.buildingCost(wanted.id);
    if (!player.hasResources(cost)) return;

    const tc = world.townCenterOf(this.playerId);
    const anchor = tc?.pos ?? workers[0].pos;
    const spot = this.findBuildSpot(world, wanted, anchor, roleOf(wanted));
    if (!spot) return;

    const builders = workers
      .filter((w) => w.order.kind === 'gather' || w.order.kind === 'idle')
      .slice(0, wanted.size >= 4 ? 3 : 2)
      .map((w) => w.id);
    world.startConstruction(this.playerId, wanted.id, spot, builders);
  }

  private assignBuilders(world: World, buildings: Entity[], workers: Entity[]): void {
    const sites = buildings.filter((b) => !b.building?.complete);
    for (const site of sites) {
      const onIt = workers.filter(
        (w) => w.order.kind === 'build' && w.order.targetId === site.id,
      ).length;
      if (onIt >= 2) continue;
      const free = workers.find((w) => w.order.kind === 'gather' || w.order.kind === 'idle');
      if (free) world.assignOrder(free, { kind: 'build', targetId: site.id });
    }
  }

  /** סדר עדיפויות הבנייה של ה-AI. */
  private nextBuildingToPlace(
    world: World,
    player: Player,
    buildings: Entity[],
  ): BuildingDef | null {
    const counts: Record<string, number> = {};
    for (const b of buildings) counts[b.defId] = (counts[b.defId] ?? 0) + 1;
    const stageIdx = Math.min(3, player.stage - 1);
    const unlocked = [...player.unlockedBuildings];

    const has = (id: string) => (counts[id] ?? 0);
    const totalOfRole = (role: string) =>
      Object.entries(counts).reduce(
        (sum, [id, n]) => sum + (roleOf(getBuilding(id)) === role ? n : 0),
        0,
      );

    // 1. בתים — כשהמרווח לתקרת האוכלוסייה מתקרב לאפס.
    //    המרווח גדל עם השלב, כי בשלבים גבוהים מאמנים מהר יותר.
    const popBuffer = 4 + player.stage * 2;
    if (player.popCap - player.popUsed <= popBuffer && player.popCap < 195) {
      const house = availableByRole(unlocked, 'house')[0];
      if (house) return house;
    }

    // 2. נקודת פריקה ראשונה (עץ)
    if (totalOfRole('dropOff') < 1 + Math.floor(player.stage / 2)) {
      const drop = availableByRole(unlocked, 'dropOff')[0];
      if (drop) return drop;
    }

    // 3. דרישות המבנים לשלב הבא
    const req = evaluateStageRequirements(player, world.countBuildings(this.playerId), player.popUsed);
    for (const missing of req.missing.buildings) {
      if (player.canBuild(missing.id)) return getBuilding(missing.id);
    }

    // 4. מבני צבא.
    //    בשלב 1 רק אחרי שהמשאבים למעבר לשלב 2 כבר בקופה: קסרקטין מוקדם
    //    שורף בדיוק את העץ שדרוש לצמיחה, וה-AI היה נתקע ביישוב קטן.
    const militaryWant = this.profile.militaryBuildings[stageIdx];
    const nextCost = stageOf(player.nation, player.stage + 1)?.requires?.resources ?? {};
    const bankedForGrowth = RESOURCE_KINDS.every(
      (k) => player.resources[k] >= (nextCost[k] ?? 0),
    );
    if ((player.stage > 1 || bankedForGrowth) && totalOfRole('military') < militaryWant) {
      const options = availableByRole(unlocked, 'military').filter(
        (d) => !d.isTownCenter && (d.limit == null || has(d.id) < d.limit),
      );
      if (options.length > 0) {
        return options[Math.floor(world.rng.next() * options.length)];
      }
    }

    // 5. חוות וכלכלה
    if (player.stage >= 2 && totalOfRole('farm') < 2 + player.stage) {
      const farm = availableByRole(unlocked, 'farm')[0];
      if (farm) return farm;
    }
    if (player.stage >= 3 && totalOfRole('economy') < player.stage - 1) {
      const eco = availableByRole(unlocked, 'economy').find(
        (d) => d.limit == null || has(d.id) < d.limit,
      );
      if (eco) return eco;
    }

    // 5ב. נמל — רק אם באמת יש חוף בטווח סביר מהבסיס.
    //     בלי הבדיקה הזו ה-AI היה "רוצה" נמל במפה יבשתית ונתקע בלי לבנות כלום.
    if (player.stage >= 2 && totalOfRole('dock') < 1) {
      const dock = availableByRole(unlocked, 'dock')[0];
      if (dock && this.shoreSpot(world, dock) !== null) return dock;
    }

    // 6. מחקר
    if (player.stage >= 2 && totalOfRole('research') < 1 + Math.floor(player.stage / 2)) {
      const res = availableByRole(unlocked, 'research').find(
        (d) => d.limit == null || has(d.id) < d.limit,
      );
      if (res) return res;
    }

    // 7. הגנה
    if (this.profile.defends && totalOfRole('defense') < player.stage) {
      const def = availableByRole(unlocked, 'defense').find(
        (d) => d.limit == null || has(d.id) < d.limit,
      );
      if (def) return def;
    }

    // 8. בית נוסף רק אם באמת מתקרבים לתקרה.
    //    בלי התנאי הזה ה-AI היה בונה בתים עד תקרה של 120 גם עם 17 תושבים,
    //    ושורף את כל העץ שדרוש למעבר בין שלבי הצמיחה.
    const house = availableByRole(unlocked, 'house')[0];
    if (house && player.popCap - player.popUsed <= popBuffer * 2) return house;
    return null;
  }

  /**
   * מוצא מקום פנוי למבנה סביב הבסיס.
   *
   * שני סבבים: קודם מחפשים מקום עם מרווח מעבר סביב המבנה, ואם לא נמצא —
   * מסתפקים בהצמדה. בלי הסבב השני ה-AI נתקע במפות צפופות כמו "יער עד",
   * צובר משאבים ולא בונה כלום. הרדיוס גדל ככל שהניסיונות נכשלים.
   */
  /**
   * מקום חוף לנמל, בסריקה מסודרת מהקרוב לרחוק.
   * דגימה אקראית כמעט אף פעם לא פוגעת ברצועת חוף, ולכן כאן סורקים.
   * התוצאה נשמרת במטמון: קו החוף לא זז במהלך המשחק.
   */
  private shoreSpot(world: World, def: BuildingDef): Vec2 | null {
    if (this.cachedShore !== undefined) return this.cachedShore;
    const tc = world.townCenterOf(this.playerId);
    const anchor = tc?.pos ?? { x: world.map.width / 2, y: world.map.height / 2 };
    this.cachedShore = null;
    for (let r = 4; r <= 50 && this.cachedShore === null; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tile = { x: Math.round(anchor.x) + dx, y: Math.round(anchor.y) + dy };
          if (world.canPlaceBuilding(def, tile)) {
            this.cachedShore = tile;
            break;
          }
        }
        if (this.cachedShore !== null) break;
      }
    }
    return this.cachedShore;
  }

  private findBuildSpot(
    world: World,
    def: BuildingDef,
    anchor: Vec2,
    role: string,
  ): Vec2 | null {
    if (role === 'dock') {
      const spot = this.shoreSpot(world, def);
      // המקום שנשמר עלול להיתפס בינתיים — אז סורקים מחדש
      if (spot && world.canPlaceBuilding(def, spot)) return spot;
      this.cachedShore = undefined;
      return this.shoreSpot(world, def);
    }
    const minR = role === 'defense' ? 6 : 3;
    const baseMax = role === 'dropOff' ? 20 : 16;

    for (const requireGap of [true, false]) {
      for (let attempt = 0; attempt < 140; attempt++) {
        // מרחיבים את טווח החיפוש ככל שמתקשים למצוא מקום
        const maxR = baseMax + Math.floor(attempt / 35) * 6;
        const angle = world.rng.float(0, Math.PI * 2);
        const r = world.rng.float(minR, maxR);
        const tile = {
          x: Math.round(anchor.x + Math.cos(angle) * r - def.size / 2),
          y: Math.round(anchor.y + Math.sin(angle) * r - def.size / 2),
        };
        if (!world.canPlaceBuilding(def, tile)) continue;
        if (requireGap && !world.canPlaceBuilding({ ...def, size: def.size + 1 }, tile)) continue;
        return tile;
      }
    }
    return null;
  }

  // ===== מחקר וצמיחה =====

  private manageResearch(world: World, player: Player, buildings: Entity[]): void {
    for (const b of buildings) {
      if (!b.building?.complete || b.building.research) continue;
      const def = getBuilding(b.defId);
      if (!def.researches) continue;
      for (const techId of def.researches) {
        if (!player.canResearch(techId)) continue;
        if (world.startResearch(b.id, techId)) break;
      }
    }
  }

  private manageGrowth(world: World, player: Player, buildings: Entity[]): void {
    if (player.transition) return;
    // בחירת ענף (למשל סוג צבא) ברגע שנפתח
    for (const branch of player.pendingBranches()) {
      const option = branch.options[Math.floor(world.rng.next() * branch.options.length)];
      player.chooseBranch(branch.id, option.id);
    }
    const counts: Record<string, number> = {};
    for (const b of buildings) if (b.building?.complete) counts[b.defId] = (counts[b.defId] ?? 0) + 1;
    const status = evaluateStageRequirements(player, counts, player.popUsed);
    if (!status.ok) return;
    // לא לרוקן את הקופה לגמרי ברמות הנמוכות
    const nextStage = stageOf(player.nation, status.nextStage!);
    const cost = nextStage.requires?.resources ?? {};
    const reserve = this.profile.expandEagerness >= 1 ? 1 : 1.25;
    const affordable = RESOURCE_KINDS.every(
      (k) => player.resources[k] >= (cost[k] ?? 0) * reserve,
    );
    if (affordable) world.requestStageAdvance(this.playerId);
  }

  // ===== הגנה ותקיפה =====

  private manageDefense(
    world: World,
    player: Player,
    army: Entity[],
    buildings: Entity[],
  ): void {
    const attacked = buildings.find((b) => world.time - b.lastDamaged < 8);
    const attackedUnit = army.find((u) => world.time - u.lastDamaged < 6);
    const threat = attacked ?? attackedUnit;
    if (!threat) return;
    this.defenseUntil = world.time + 25;
    for (const u of army) {
      const dist = Math.hypot(u.pos.x - threat.pos.x, u.pos.y - threat.pos.y);
      if (dist > 45) continue;
      if (u.order.kind === 'attack') continue;
      world.assignOrder(u, { kind: 'attackMove', target: { ...threat.pos } });
    }
    void player;
  }

  private manageAttack(world: World, player: Player, army: Entity[]): void {
    if (world.time < this.defenseUntil) return;
    const stageIdx = Math.min(3, player.stage - 1);
    const needed = this.profile.waveSize[stageIdx];
    const idleArmy = army.filter(
      (u) => u.order.kind === 'idle' || u.order.kind === 'hold' || u.order.kind === 'move',
    );

    if (this.waveTimer > 0 && idleArmy.length < needed * 1.8) return;
    if (army.length < needed) return;
    if (world.rng.next() > this.profile.aggression + 0.25) {
      this.waveTimer = this.profile.waveInterval * 0.4;
      return;
    }

    const target = this.findAttackTarget(world, player);
    if (!target) return;

    this.waveTimer = this.profile.waveInterval;
    this.wave = { units: army.map((u) => u.id), target, launched: true };
    for (const u of army) {
      world.assignOrder(u, { kind: 'attackMove', target: { ...target } });
    }
  }

  /** מטרת התקפה: מרכז היישוב של האויב הקרוב ביותר. */
  private findAttackTarget(world: World, player: Player): Vec2 | null {
    const myTc = world.townCenterOf(this.playerId);
    const from = myTc?.pos ?? { x: world.map.width / 2, y: world.map.height / 2 };
    let best: Vec2 | null = null;
    let bestDist = Infinity;
    for (const other of world.players) {
      if (other.team === player.team || other.defeated) continue;
      for (const e of world.entitiesOf(other.id)) {
        if (e.kind !== 'building') continue;
        const isTc = getBuilding(e.defId).isTownCenter;
        const d = Math.hypot(e.pos.x - from.x, e.pos.y - from.y) * (isTc ? 0.7 : 1);
        if (d < bestDist) {
          bestDist = d;
          best = { x: e.pos.x, y: e.pos.y };
        }
      }
    }
    if (best) this.lastEnemyBase = best;
    // אם לא ראינו כלום — פושטים לעבר נקודת פתיחה אחרת
    if (!best && this.lastEnemyBase) return this.lastEnemyBase;
    if (!best) {
      const idx = world.players.findIndex((p) => p.id === this.playerId);
      const other = world.map.startPositions.find((_, i) => i !== idx);
      return other ?? null;
    }
    return best;
  }

  /** מידע לניפוי שגיאות ולתצוגה. */
  debugInfo(): Record<string, unknown> {
    return {
      difficulty: this.profile.id,
      waveTimer: Math.round(this.waveTimer),
      waveSize: this.wave.units.length,
      launched: this.wave.launched,
    };
  }
}

/** מנהל כל יריבי המחשב במשחק. */
export class AiManager {
  private controllers: AiController[] = [];

  constructor(world: World) {
    for (const p of world.players) {
      if (p.isAI) this.controllers.push(new AiController(p.id, p.difficulty));
    }
  }

  update(world: World, dt: number): void {
    for (const c of this.controllers) c.update(world, dt);
  }

  get all(): AiController[] {
    return this.controllers;
  }
}
