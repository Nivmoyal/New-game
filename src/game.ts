import { AiManager } from './ai/ai';
import { audio } from './audio/audio';
import { getBuilding, getNation, getUnit } from './data';
import type { Entity } from './core/entities';
import type { EntityId, Vec2 } from './core/types';
import { Player } from './core/player';
import {
  loadFromSlot,
  loadSettings,
  saveSettings,
  saveToSlot,
  type Settings,
} from './core/save';
import { World } from './core/world';
import { Minimap } from './render/minimap';
import { Renderer, type RenderState } from './render/renderer';
import { el, show } from './ui/dom';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';
import { StartMenu, type GameSetup } from './ui/menu';
import { T } from './ui/strings';

const CONTROL_GROUPS = 9;

/** מחבר את כל החלקים: סימולציה, ציור, ממשק, קלט, AI ושמירה. */
export class Game {
  private world: World | null = null;
  private ai: AiManager | null = null;
  private renderer: Renderer;
  private minimap: Minimap | null = null;
  private hud: Hud;
  private input: InputController;
  private menu: StartMenu;
  private settings: Settings;

  private localPlayerId = 0;
  private selected = new Set<EntityId>();
  private controlGroups = new Map<number, EntityId[]>();
  private placingBuilding: string | null = null;
  private placementTile: Vec2 = { x: 0, y: 0 };
  private placementValid = false;
  private settingRally = false;
  private paused = true;
  private lastFrame = 0;
  private lastAlertPos: Vec2 | null = null;
  private renderState: RenderState;
  private pauseOverlay: HTMLElement;

  constructor(private container: HTMLElement) {
    this.settings = loadSettings();

    const canvas = el('canvas', { className: 'game-canvas' }) as HTMLCanvasElement;
    container.appendChild(canvas);
    this.renderer = new Renderer(canvas);

    this.renderState = {
      selected: this.selected,
      hovered: null,
      dragRect: null,
      placing: null,
      showHealthBars: this.settings.showHealthBars,
      pings: [],
    };

    this.hud = new Hud(container, {
      onTrain: (bid, uid) => this.trainUnit(bid, uid),
      onCancelTrain: (bid, i) => this.world?.cancelTrain(bid, i),
      onResearch: (bid, tid) => this.research(bid, tid),
      onPickBuilding: (defId) => this.beginPlacement(defId),
      onAdvanceStage: () => this.advanceStage(),
      onCommand: (kind) => this.simpleCommand(kind),
      onChooseBranch: (branchId, optionId) => this.chooseBranch(branchId, optionId),
      onOpenMenu: () => this.togglePause(true),
      onSelectIdleWorker: () => this.selectIdleWorker(),
      onFocusTownCenter: () => this.focusTownCenter(),
    });
    show(this.hud.root, false);

    this.input = new InputController(canvas, this.renderer.camera, () => this.world, {
      onSelect: (ids, additive) => this.select(ids, additive),
      onCommandAt: (pos, target, queue) => this.commandAt(pos, target, queue),
      onPlaceBuilding: (_, queue) => this.confirmPlacement(queue),
      onCancelPlacement: () => this.cancelPlacement(),
      onMinimapNav: (pos) => this.renderer.camera.centerOn(pos.x, pos.y),
      onMinimapCommand: (pos) => this.commandAt(pos, undefined, false),
      onHotkey: (key, ctrl, shift) => this.hotkey(key, ctrl, shift),
      onHover: (pos, target) => this.onHover(pos, target),
    });
    this.input.edgeScroll = this.settings.edgeScroll;
    this.input.scrollSpeed = this.settings.scrollSpeed;

    this.pauseOverlay = this.buildPauseOverlay();
    container.appendChild(this.pauseOverlay);
    show(this.pauseOverlay, false);

    this.menu = new StartMenu(container, this.settings, {
      onStart: (setup) => this.startGame(setup),
      onLoad: (slot) => this.loadGame(slot),
      onSettingsChange: (s) => this.applySettings(s),
    });

    // חשיפה לניפוי שגיאות ולבדיקות אוטומטיות בסביבת פיתוח בלבד
    if (import.meta.env?.DEV) {
      (window as unknown as { __game: Game }).__game = this;
    }

    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(this.frame);
  }

  // ===== מחזור חיים =====

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    this.renderer.camera.minZoom = Math.min(10, this.defaultZoom() * 0.5);
  }

  /**
   * זום פתיחה מותאם לגודל המסך — במסכי מובייל רוצים לראות
   * בערך 20 אריחים לרוחב, ובמסך רחב יותר אריחים גדולים יותר.
   */
  private defaultZoom(): number {
    const small = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(14, Math.min(34, Math.round(small / 20)));
  }

  startGame(setup: GameSetup): void {
    audio.init();
    audio.resume();
    const enemies = StartMenu.pickEnemies(setup);
    const players = [
      {
        id: 0,
        name: 'אתה',
        nationId: setup.nationId,
        branchChoices: setup.branchChoices,
        team: 0,
      },
      ...enemies.map((n, i) => ({
        id: i + 1,
        name: `${getNation(n.id).name} (מחשב)`,
        nationId: n.id,
        isAI: true,
        difficulty: setup.difficulty,
        team: 1,
      })),
    ];

    this.world = new World({
      seed: setup.seed,
      map: {
        width: setup.mapSize.width,
        height: setup.mapSize.height,
        preset: setup.mapPreset,
      },
      players,
    });
    this.afterWorldReady(0);
  }

  loadGame(slot: string): void {
    audio.init();
    const loaded = loadFromSlot(slot);
    if (!loaded) {
      this.hud.toast(T.saveFailed, 'warn');
      return;
    }
    this.world = loaded.world;
    this.afterWorldReady(loaded.localPlayerId);
    this.hud.toast(T.gameLoaded, 'good');
  }

  private afterWorldReady(localPlayerId: number): void {
    const world = this.world!;
    this.localPlayerId = localPlayerId;
    this.ai = new AiManager(world);
    this.selected.clear();
    this.controlGroups.clear();
    this.placingBuilding = null;
    this.renderer.markTerrainDirty();
    this.minimap = new Minimap(this.hud.minimapCanvas);
    this.attachMinimapEvents();

    this.renderer.camera.zoom = this.defaultZoom();
    const tc = world.townCenterOf(this.localPlayerId);
    if (tc) this.renderer.camera.centerOn(tc.pos.x, tc.pos.y);

    this.menu.close();
    show(this.hud.root, true);
    this.paused = false;
    this.lastFrame = performance.now();
    audio.setVolumes(this.settings.sfxVolume, this.settings.musicVolume);
    audio.startMusic();
    this.hud.toast(`${T.stage} 1: ${this.localPlayer()?.centerAppearance().name ?? ''}`, 'good');
  }

  private localPlayer(): Player | undefined {
    return this.world?.player(this.localPlayerId);
  }

  private attachMinimapEvents(): void {
    const canvas = this.hud.minimapCanvas;
    const toWorld = (ev: MouseEvent | Touch): Vec2 => {
      const rect = canvas.getBoundingClientRect();
      const world = this.world!;
      return {
        x: ((ev.clientX - rect.left) / rect.width) * world.map.width,
        y: ((ev.clientY - rect.top) / rect.height) * world.map.height,
      };
    };
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onmousedown = (ev) => {
      if (!this.world) return;
      const pos = toWorld(ev);
      if (ev.button === 2) this.commandAt(pos, undefined, ev.shiftKey);
      else this.renderer.camera.centerOn(pos.x, pos.y);
    };
    canvas.ontouchstart = (ev) => {
      if (!this.world || ev.touches.length === 0) return;
      ev.preventDefault();
      const pos = toWorld(ev.touches[0]);
      this.renderer.camera.centerOn(pos.x, pos.y);
    };
  }

  // ===== לולאת המשחק =====

  private frame = (now: number): void => {
    const dtReal = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.world && !this.paused) {
      const dt = dtReal * this.settings.gameSpeed;
      this.world.update(dt);
      this.ai?.update(this.world, dt);
      this.handleEvents();
      this.input.updateCamera(dtReal);
      this.pruneSelection();
    }

    if (this.world) {
      const viewer = this.localPlayer();
      if (viewer) {
        this.renderState.dragRect = this.input.dragRect;
        this.renderState.showHealthBars = this.settings.showHealthBars;
        this.renderState.placing = this.placingBuilding
          ? { defId: this.placingBuilding, valid: this.placementValid, tile: this.placementTile }
          : null;
        this.renderer.render(this.world, viewer, this.renderState, now);
        this.minimap?.render(this.world, viewer, this.renderer.camera);
        this.hud.update(this.world, viewer, this.selected, this.countIdleWorkers());
      }
    }
    requestAnimationFrame(this.frame);
  };

  private handleEvents(): void {
    const world = this.world!;
    for (const ev of world.drainEvents()) {
      switch (ev.type) {
        case 'stageAdvanced':
          if (ev.playerId === this.localPlayerId) {
            audio.play('stageUp', 0);
            const player = this.localPlayer()!;
            this.hud.toast(`${T.stageReached}: ${player.centerAppearance().name}`, 'good');
            const pending = player.pendingBranches();
            if (pending.length > 0) {
              this.paused = true;
              this.hud.showBranchChoice(pending[0], (optionId) => {
                this.chooseBranch(pending[0].id, optionId);
                this.paused = false;
              });
            }
          }
          break;
        case 'buildingComplete':
          if (ev.playerId === this.localPlayerId) {
            audio.play('complete');
            this.hud.toast(`${T.buildingComplete}: ${getBuilding(ev.defId).name}`);
          }
          break;
        case 'unitTrained':
          if (ev.playerId === this.localPlayerId) audio.play('train');
          break;
        case 'researchComplete':
          if (ev.playerId === this.localPlayerId) {
            audio.play('complete');
            this.hud.toast(`${T.research}: ✔`, 'good');
          }
          break;
        case 'entityDied':
          if (ev.playerId === this.localPlayerId) audio.play('die', 220);
          this.selected.delete(ev.entityId);
          break;
        case 'underAttack':
          if (ev.playerId === this.localPlayerId) {
            audio.play('alert', 4000);
            this.hud.toast(T.underAttack, 'warn');
            this.lastAlertPos = ev.pos;
          }
          break;
        case 'notice':
          if (ev.playerId === this.localPlayerId) {
            audio.play('error', 400);
            this.hud.toast(ev.text, 'warn');
          }
          break;
        case 'victory': {
          const viewer = this.localPlayer();
          const won = viewer && viewer.team === ev.teamId;
          audio.play(won ? 'victory' : 'defeat', 0);
          this.showEndScreen(!!won);
          break;
        }
        case 'defeated':
          if (ev.playerId === this.localPlayerId) {
            audio.play('defeat', 0);
            this.showEndScreen(false);
          }
          break;
      }
    }
  }

  private pruneSelection(): void {
    for (const id of [...this.selected]) {
      if (!this.world?.get(id)) this.selected.delete(id);
    }
  }

  private countIdleWorkers(): number {
    const world = this.world;
    if (!world) return 0;
    let n = 0;
    for (const e of world.entitiesOf(this.localPlayerId)) {
      if (e.kind !== 'unit') continue;
      if (!getUnit(e.defId).gatherRate) continue;
      if (e.order.kind === 'idle') n++;
    }
    return n;
  }

  // ===== בחירה ופקודות =====

  private select(ids: EntityId[], additive: boolean): void {
    if (this.settingRally) return;
    if (!additive) this.selected.clear();
    const world = this.world;
    if (!world) return;
    // מעדיפים יחידות שלי; אם אין — מציגים מה שנבחר (גם של האויב, לצפייה)
    const mine = ids.filter((id) => world.get(id)?.owner === this.localPlayerId);
    const chosen = mine.length > 0 ? mine : ids.slice(0, 1);
    for (const id of chosen) this.selected.add(id);
    if (chosen.length > 0) audio.play('select', 80);
    this.hud.closeBuildMenu();
  }

  private commandAt(pos: Vec2, target: Entity | undefined, queue: boolean): void {
    const world = this.world;
    const player = this.localPlayer();
    if (!world || !player) return;

    if (this.settingRally) {
      for (const id of this.selected) {
        const e = world.get(id);
        if (e?.building) world.setRallyPoint(id, pos);
      }
      this.settingRally = false;
      audio.play('command');
      this.renderState.pings.push({ pos: { ...pos }, time: performance.now(), color: '#fbbf24' });
      return;
    }

    const mine = [...this.selected]
      .map((id) => world.get(id))
      .filter((e): e is Entity => !!e && e.owner === this.localPlayerId && e.kind === 'unit');
    if (mine.length === 0) return;

    // פקודה חכמה לכל יחידה לפי סוגה
    const groups = new Map<string, Entity[]>();
    for (const u of mine) {
      const order = world.smartOrder(u, pos, target);
      const key = `${order.kind}:${order.targetId ?? ''}:${order.tile?.x ?? ''},${order.tile?.y ?? ''}`;
      const list = groups.get(key) ?? [];
      list.push(u);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      const order = world.smartOrder(list[0], pos, target);
      world.issueCommand(
        list.map((u) => u.id),
        order,
        { queue, formation: order.kind === 'move' },
      );
    }

    audio.play('command');
    const color = target && world.isEnemy(mine[0], target) ? '#f87171' : '#4ade80';
    this.renderState.pings.push({ pos: { ...pos }, time: performance.now(), color });
  }

  private simpleCommand(kind: 'stop' | 'hold' | 'repair' | 'rally'): void {
    const world = this.world;
    if (!world) return;
    if (kind === 'rally') {
      this.settingRally = true;
      this.hud.toast(`${T.rally}: לחץ על המפה`);
      return;
    }
    const ids = [...this.selected].filter((id) => world.get(id)?.owner === this.localPlayerId);
    if (kind === 'stop') world.issueCommand(ids, { kind: 'idle' });
    else if (kind === 'hold') world.issueCommand(ids, { kind: 'hold' });
    else if (kind === 'repair') {
      // מתקן את המבנה הפגוע הקרוב ביותר
      const units = ids.map((id) => world.get(id)).filter((e): e is Entity => !!e);
      if (units.length === 0) return;
      let best: Entity | null = null;
      let bestDist = Infinity;
      for (const e of world.entitiesOf(this.localPlayerId)) {
        if (e.kind !== 'building' || e.hp >= e.maxHp) continue;
        const d = Math.hypot(e.pos.x - units[0].pos.x, e.pos.y - units[0].pos.y);
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
      if (best) world.issueCommand(ids, { kind: 'repair', targetId: best.id });
      else this.hud.toast('אין מבנים לתיקון', 'warn');
    }
    audio.play('command');
  }

  // ===== בנייה =====

  private beginPlacement(defId: string): void {
    this.placingBuilding = defId;
    this.input.placing = true;
    audio.play('click');
  }

  private cancelPlacement(): void {
    this.placingBuilding = null;
    this.input.placing = false;
  }

  private onHover(pos: Vec2, target: Entity | undefined): void {
    this.renderState.hovered = target?.id ?? null;
    if (!this.placingBuilding || !this.world) return;
    const def = getBuilding(this.placingBuilding);
    this.placementTile = {
      x: Math.round(pos.x - def.size / 2),
      y: Math.round(pos.y - def.size / 2),
    };
    this.placementValid = this.world.canPlaceBuilding(def, this.placementTile);
  }

  private confirmPlacement(queue: boolean): void {
    const world = this.world;
    const player = this.localPlayer();
    if (!world || !player || !this.placingBuilding) return;
    const builders = [...this.selected].filter((id) => {
      const e = world.get(id);
      return e?.kind === 'unit' && getUnit(e.defId).canBuild;
    });
    const site = world.startConstruction(
      this.localPlayerId,
      this.placingBuilding,
      this.placementTile,
      builders,
    );
    if (site) {
      audio.play('build');
      if (!queue) this.cancelPlacement();
    } else {
      audio.play('error');
      if (this.placementValid) this.hud.toast(T.needResources, 'warn');
    }
  }

  private trainUnit(buildingId: EntityId, unitId: string): void {
    if (!this.world?.enqueueTrain(buildingId, unitId)) audio.play('error');
    else audio.play('click');
  }

  private research(buildingId: EntityId, techId: string): void {
    if (!this.world?.startResearch(buildingId, techId)) audio.play('error');
    else audio.play('click');
  }

  private advanceStage(): void {
    if (this.world?.requestStageAdvance(this.localPlayerId)) audio.play('click');
    else audio.play('error');
  }

  private chooseBranch(branchId: string, optionId: string): void {
    const player = this.localPlayer();
    if (!player) return;
    player.chooseBranch(branchId, optionId);
    audio.play('complete');
    this.hud.toast(`נבחר: ${optionId}`, 'good');
  }

  // ===== קיצורי מקלדת =====

  private hotkey(key: string, ctrl: boolean, shift: boolean): void {
    const world = this.world;
    if (!world) return;
    const num = Number(key);
    if (!Number.isNaN(num) && num >= 1 && num <= CONTROL_GROUPS) {
      if (ctrl) {
        this.controlGroups.set(
          num,
          [...this.selected].filter((id) => world.get(id)?.owner === this.localPlayerId),
        );
        this.hud.toast(`קבוצה ${num} נשמרה`);
      } else {
        const group = this.controlGroups.get(num) ?? [];
        const alive = group.filter((id) => world.get(id));
        if (alive.length > 0) {
          this.selected.clear();
          for (const id of alive) this.selected.add(id);
          audio.play('select');
          if (shift) {
            const first = world.get(alive[0])!;
            this.renderer.camera.centerOn(first.pos.x, first.pos.y);
          }
        }
      }
      return;
    }

    switch (key.toLowerCase()) {
      case 'escape':
        if (this.placingBuilding) this.cancelPlacement();
        else if (this.selected.size > 0) this.selected.clear();
        else this.togglePause();
        break;
      case 'b': {
        const worker = [...this.selected].find((id) => {
          const e = world.get(id);
          return e?.kind === 'unit' && getUnit(e.defId).canBuild;
        });
        if (worker) this.hud.toast(T.build);
        break;
      }
      case 'h':
        this.focusTownCenter();
        break;
      case 'f':
        this.selectIdleWorker();
        break;
      case ' ':
        if (this.lastAlertPos) this.renderer.camera.centerOn(this.lastAlertPos.x, this.lastAlertPos.y);
        break;
      case 'p':
        this.togglePause();
        break;
      case 's':
        if (ctrl) this.quickSave();
        break;
      case 'delete': {
        for (const id of this.selected) {
          const e = world.get(id);
          if (e && e.owner === this.localPlayerId) world.kill(e);
        }
        this.selected.clear();
        break;
      }
    }
  }

  private selectIdleWorker(): void {
    const world = this.world;
    if (!world) return;
    const idle = world
      .entitiesOf(this.localPlayerId)
      .filter((e) => e.kind === 'unit' && getUnit(e.defId).gatherRate && e.order.kind === 'idle');
    if (idle.length === 0) {
      this.hud.toast('אין פועלים בטלים');
      return;
    }
    this.selected.clear();
    this.selected.add(idle[0].id);
    this.renderer.camera.centerOn(idle[0].pos.x, idle[0].pos.y);
    audio.play('select');
  }

  private focusTownCenter(): void {
    const tc = this.world?.townCenterOf(this.localPlayerId);
    if (tc) {
      this.renderer.camera.centerOn(tc.pos.x, tc.pos.y);
      this.selected.clear();
      this.selected.add(tc.id);
      audio.play('select');
    }
  }

  // ===== תפריט השהיה =====

  private buildPauseOverlay(): HTMLElement {
    // יציאה בשני שלבים במקום confirm() של הדפדפן — עקבי עם שאר הממשק
    let confirming = false;
    const exitBtn = el('button', { className: 'big ghost', text: T.exitToMenu }) as HTMLButtonElement;
    const warning = el('div', { className: 'muted small', text: T.confirmExit });
    show(warning, false);
    exitBtn.addEventListener('click', () => {
      if (!confirming) {
        confirming = true;
        exitBtn.textContent = T.confirmExitAction;
        exitBtn.classList.add('danger');
        show(warning, true);
        return;
      }
      confirming = false;
      exitBtn.textContent = T.exitToMenu;
      exitBtn.classList.remove('danger');
      show(warning, false);
      this.exitToMenu();
    });

    const panel = el('div', {
      className: 'pause-panel',
      children: [
        el('h2', { text: T.paused }),
        el('button', { className: 'primary big', text: T.resume, onClick: () => this.togglePause(false) }),
        el('button', { className: 'big', text: T.save, onClick: () => this.quickSave() }),
        el('button', { className: 'big', text: T.settings, onClick: () => this.openSettingsFromPause() }),
        exitBtn,
        warning,
      ],
    });
    return el('div', { className: 'pause-overlay', children: [panel] });
  }

  private openSettingsFromPause(): void {
    this.exitToMenu(false);
  }

  private togglePause(force?: boolean): void {
    if (!this.world) return;
    this.paused = force ?? !this.paused;
    show(this.pauseOverlay, this.paused);
    if (!this.paused) this.lastFrame = performance.now();
  }

  private quickSave(): void {
    if (!this.world) return;
    const player = this.localPlayer();
    const label = `${player?.nation.name ?? ''} · ${T.stage} ${player?.stage ?? 1}`;
    const ok = saveToSlot(this.world, this.localPlayerId, 'auto', label);
    this.hud.toast(ok ? T.gameSaved : T.saveFailed, ok ? 'good' : 'warn');
  }

  private exitToMenu(clearWorld = true): void {
    if (clearWorld) {
      this.world = null;
      this.ai = null;
    }
    this.paused = true;
    show(this.pauseOverlay, false);
    show(this.hud.root, false);
    this.menu.open();
  }

  private showEndScreen(won: boolean): void {
    this.paused = true;
    const overlay = el('div', {
      className: 'pause-overlay end',
      children: [
        el('div', {
          className: 'pause-panel',
          children: [
            el('h2', { text: won ? T.victory : T.defeat }),
            el('p', { className: 'muted', text: this.summaryText() }),
            el('button', {
              className: 'primary big',
              text: T.exitToMenu,
              onClick: () => {
                overlay.remove();
                this.exitToMenu();
              },
            }),
          ],
        }),
      ],
    });
    this.container.appendChild(overlay);
  }

  private summaryText(): string {
    const p = this.localPlayer();
    if (!p) return '';
    return `שלב ${p.stage} · יחידות שאומנו ${p.stats.unitsTrained} · מבנים ${p.stats.buildingsBuilt} · הכרעות ${p.stats.kills}`;
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    saveSettings(settings);
    audio.setVolumes(settings.sfxVolume, settings.musicVolume);
    this.input.edgeScroll = settings.edgeScroll;
    this.input.scrollSpeed = settings.scrollSpeed;
  }
}
