import { getBuilding, getTech, getUnit } from '../data';
import type { BranchDef, BuildingDef, TechDef, UnitDef } from '../data/schema';
import type { Entity } from '../core/entities';
import { evaluateStageRequirements } from '../core/growth';
import type { Player } from '../core/player';
import { RESOURCE_KINDS, type EntityId, type ResourceKind } from '../core/types';
import type { World } from '../core/world';
import { RESOURCE_ICONS } from '../render/sprites';
import { clear, el, show } from './dom';
import { buildingIcon, unitIcon } from './icons';
import { formatCost, formatTime, RESOURCE_NAMES, T } from './strings';

export type HudCallbacks = {
  onTrain: (buildingId: EntityId, unitId: string) => void;
  onCancelTrain: (buildingId: EntityId, index: number) => void;
  onResearch: (buildingId: EntityId, techId: string) => void;
  onPickBuilding: (defId: string) => void;
  onAdvanceStage: () => void;
  onCommand: (kind: 'stop' | 'hold' | 'repair' | 'rally') => void;
  onChooseBranch: (branchId: string, optionId: string) => void;
  onOpenMenu: () => void;
  onSelectIdleWorker: () => void;
  onFocusTownCenter: () => void;
};

/**
 * ממשק המשחק. בנוי מ-DOM מעל הקנבס —
 * כך מקבלים RTL אמיתי, טקסט נגיש וגדלי מגע נוחים במובייל.
 */
export class Hud {
  readonly root: HTMLElement;
  private resourceEls = new Map<ResourceKind, HTMLElement>();
  private popEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private stageBtn!: HTMLButtonElement;
  private stageReqEl!: HTMLElement;
  private selectionEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private branchOverlay!: HTMLElement;
  private idleBtn!: HTMLButtonElement;
  minimapCanvas!: HTMLCanvasElement;

  /** מצב תפריט הבנייה הפתוח */
  private buildMenuOpen = false;
  private lastSelectionKey = '';

  constructor(parent: HTMLElement, private cb: HudCallbacks) {
    this.root = el('div', { className: 'hud' });
    this.buildTopBar();
    this.buildBottom();
    this.toastEl = el('div', { className: 'toasts' });
    this.root.appendChild(this.toastEl);
    this.branchOverlay = el('div', { className: 'branch-overlay hidden' });
    this.root.appendChild(this.branchOverlay);
    parent.appendChild(this.root);
  }

  private buildTopBar(): void {
    const bar = el('div', { className: 'topbar' });

    const resources = el('div', { className: 'resources' });
    for (const kind of RESOURCE_KINDS) {
      const value = el('span', { className: 'value', text: '0' });
      this.resourceEls.set(kind, value);
      resources.appendChild(
        el('div', {
          className: `res res-${kind}`,
          title: RESOURCE_NAMES[kind],
          children: [el('span', { className: 'icon', text: RESOURCE_ICONS[kind] }), value],
        }),
      );
    }
    this.popEl = el('span', { className: 'value', text: '0/0' });
    resources.appendChild(
      el('div', {
        className: 'res res-pop',
        title: T.population,
        children: [el('span', { className: 'icon', text: '👥' }), this.popEl],
      }),
    );

    this.stageEl = el('div', { className: 'stage-name', text: '—' });
    this.stageReqEl = el('div', { className: 'stage-req' });
    this.stageBtn = el('button', {
      className: 'stage-btn',
      text: T.advanceStage,
      onClick: () => this.cb.onAdvanceStage(),
    }) as HTMLButtonElement;

    const stageBox = el('div', {
      className: 'stage-box',
      children: [this.stageEl, this.stageBtn, this.stageReqEl],
    });

    this.timeEl = el('div', { className: 'clock', text: '0:00' });
    this.idleBtn = el('button', {
      className: 'icon-btn',
      text: '😴',
      title: T.idleWorkers,
      onClick: () => this.cb.onSelectIdleWorker(),
    }) as HTMLButtonElement;

    const tools = el('div', {
      className: 'tools',
      children: [
        this.idleBtn,
        el('button', {
          className: 'icon-btn',
          text: '🏘️',
          title: T.buildings,
          onClick: () => this.cb.onFocusTownCenter(),
        }),
        this.timeEl,
        el('button', {
          className: 'icon-btn',
          text: '☰',
          title: T.settings,
          onClick: () => this.cb.onOpenMenu(),
        }),
      ],
    });

    bar.append(resources, stageBox, tools);
    this.root.appendChild(bar);
  }

  private buildBottom(): void {
    const bottom = el('div', { className: 'bottombar' });

    this.minimapCanvas = el('canvas', { className: 'minimap' }) as HTMLCanvasElement;
    this.minimapCanvas.width = 256;
    this.minimapCanvas.height = 256;

    this.selectionEl = el('div', { className: 'selection' });
    this.actionsEl = el('div', { className: 'actions' });

    bottom.append(
      el('div', { className: 'minimap-wrap', children: [this.minimapCanvas] }),
      el('div', { className: 'panel', children: [this.selectionEl, this.actionsEl] }),
    );
    this.root.appendChild(bottom);
  }

  // ===== עדכון =====

  update(world: World, player: Player, selected: Set<EntityId>, idleWorkers: number): void {
    for (const kind of RESOURCE_KINDS) {
      this.resourceEls.get(kind)!.textContent = String(Math.floor(player.resources[kind]));
    }
    this.popEl.textContent = `${player.popUsed}/${player.popCap}`;
    this.popEl.parentElement!.classList.toggle('full', player.popUsed >= player.popCap);
    this.timeEl.textContent = formatTime(world.time);
    this.idleBtn.classList.toggle('alert', idleWorkers > 0);
    this.idleBtn.textContent = idleWorkers > 0 ? `😴${idleWorkers}` : '😴';

    this.updateStageBox(world, player);
    this.updateSelection(world, player, selected);
  }

  private updateStageBox(world: World, player: Player): void {
    const stage = player.currentStage();
    const appearance = player.centerAppearance();
    this.stageEl.textContent = `${stage.emoji} ${T.stage} ${stage.index}: ${appearance.name}`;

    if (player.transition) {
      const pct = Math.round((1 - player.transition.remaining / player.transition.total) * 100);
      this.stageBtn.disabled = true;
      this.stageBtn.textContent = `${T.advancing} ${pct}%`;
      this.stageReqEl.textContent = '';
      return;
    }

    const status = evaluateStageRequirements(
      player,
      world.countBuildings(player.id),
      player.popUsed,
    );
    if (!status.nextStage || !status.stage) {
      this.stageBtn.disabled = true;
      this.stageBtn.textContent = 'השלב הגבוה ביותר';
      this.stageReqEl.textContent = '';
      return;
    }

    this.stageBtn.disabled = !status.ok;
    this.stageBtn.textContent = `${T.advanceStage}: ${status.stage.name}`;
    const missing: string[] = [];
    for (const [k, v] of Object.entries(status.missing.resources)) {
      if (v) missing.push(`${RESOURCE_NAMES[k]} ${Math.ceil(v)}`);
    }
    if (status.missing.population > 0) {
      missing.push(`${T.population} +${status.missing.population}`);
    }
    for (const b of status.missing.buildings) {
      missing.push(`${getBuilding(b.id).name} ${b.have}/${b.need}`);
    }
    this.stageReqEl.textContent = missing.length ? `${T.requirements}: ${missing.join(' · ')}` : '';
  }

  // ===== פאנל בחירה =====

  private updateSelection(world: World, player: Player, selected: Set<EntityId>): void {
    const entities = [...selected]
      .map((id) => world.get(id))
      .filter((e): e is Entity => !!e);
    const key = `${entities.map((e) => `${e.id}:${Math.round(e.hp)}`).join(',')}|${this.buildMenuOpen}|${player.stage}|${player.resources.wood | 0}`;
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;

    clear(this.selectionEl);
    clear(this.actionsEl);

    if (entities.length === 0) {
      this.selectionEl.appendChild(
        el('div', { className: 'hint', text: T.help[0] + ' · ' + T.help[1] }),
      );
      return;
    }

    const mine = entities.filter((e) => e.owner === player.id);
    this.renderSelectionInfo(world, player, entities);
    if (mine.length === 0) return;

    if (this.buildMenuOpen) this.renderBuildMenu(player);
    else this.renderActions(world, player, mine);
  }

  private renderSelectionInfo(world: World, player: Player, entities: Entity[]): void {
    if (entities.length === 1) {
      const e = entities[0];
      const def = e.kind === 'unit' ? getUnit(e.defId) : getBuilding(e.defId);
      const owner = world.player(e.owner);
      const isTc = e.kind === 'building' && getBuilding(e.defId).isTownCenter;
      const name = isTc && owner ? owner.centerAppearance().name : def.name;
      const emoji = isTc && owner ? owner.centerAppearance().emoji : def.emoji;

      const stats: string[] = [`${T.health} ${Math.ceil(e.hp)}/${e.maxHp}`];
      if (e.kind === 'unit') {
        const u = def as UnitDef;
        if (u.attack > 0) stats.push(`${T.attack} ${u.attack}`);
        stats.push(`${T.armor} ${u.armor}/${u.pierceArmor}`);
        if (u.range > 1.2) stats.push(`${T.range} ${u.range}`);
        if (e.unit?.carrying) {
          stats.push(
            `${T.carrying} ${RESOURCE_NAMES[e.unit.carrying.kind]} ${Math.floor(e.unit.carrying.amount)}`,
          );
        }
      } else {
        const b = def as BuildingDef;
        if (b.attack) stats.push(`${T.attack} ${b.attack}`);
        stats.push(`${T.armor} ${b.armor}/${b.pierceArmor}`);
      }

      this.selectionEl.appendChild(
        el('div', {
          className: 'sel-single',
          children: [
            el('div', { className: 'portrait', text: emoji }),
            el('div', {
              className: 'sel-info',
              children: [
                el('div', { className: 'sel-name', text: `${name} · ${owner?.name ?? ''}` }),
                el('div', { className: 'sel-desc', text: def.desc ?? '' }),
                el('div', { className: 'sel-stats', text: stats.join(' · ') }),
              ],
            }),
          ],
        }),
      );

      // תור אימון של המבנה
      if (e.building?.trainQueue.length && e.owner === player.id) {
        const queue = el('div', { className: 'train-queue' });
        e.building.trainQueue.forEach((item, i) => {
          const u = getUnit(item.unitId);
          queue.appendChild(
            el('button', {
              className: 'queue-item',
              text: u.emoji,
              title: `${u.name} — ${T.cancel}`,
              onClick: () => this.cb.onCancelTrain(e.id, i),
            }),
          );
        });
        this.selectionEl.appendChild(queue);
      }
      return;
    }

    const grid = el('div', { className: 'sel-grid' });
    const counts = new Map<string, { count: number; kind: 'unit' | 'building' }>();
    for (const e of entities) {
      const entry = counts.get(e.defId) ?? { count: 0, kind: e.kind };
      entry.count++;
      counts.set(e.defId, entry);
    }
    for (const [defId, { count, kind }] of counts) {
      const def = kind === 'unit' ? getUnit(defId) : getBuilding(defId);
      grid.appendChild(
        el('div', {
          className: 'sel-chip',
          title: def.name,
          children: [
            el('span', { text: def.emoji }),
            el('span', { className: 'count', text: `×${count}` }),
          ],
        }),
      );
    }
    this.selectionEl.appendChild(
      el('div', {
        className: 'sel-multi',
        children: [el('div', { className: 'sel-name', text: `${T.selected}: ${entities.length}` }), grid],
      }),
    );
  }

  private renderActions(world: World, player: Player, mine: Entity[]): void {
    const hasWorker = mine.some((e) => e.kind === 'unit' && getUnit(e.defId).canBuild);
    const buildings = mine.filter((e) => e.kind === 'building' && e.building?.complete);

    if (hasWorker) {
      this.actionsEl.appendChild(
        this.actionButton('🏗️', T.build, () => {
          this.buildMenuOpen = true;
          this.lastSelectionKey = '';
        }),
      );
      this.actionsEl.appendChild(
        this.actionButton('🔧', T.repair, () => this.cb.onCommand('repair')),
      );
    }
    if (mine.some((e) => e.kind === 'unit')) {
      this.actionsEl.appendChild(this.actionButton('✋', T.stop, () => this.cb.onCommand('stop')));
      this.actionsEl.appendChild(this.actionButton('🛡️', T.hold, () => this.cb.onCommand('hold')));
    }

    for (const b of buildings) {
      const def = getBuilding(b.defId);
      if (def.trains?.length) {
        this.actionsEl.appendChild(this.actionButton('🚩', T.rally, () => this.cb.onCommand('rally')));
        break;
      }
    }

    // אימון
    const trainable = new Map<string, Entity>();
    for (const b of buildings) {
      for (const unitId of getBuilding(b.defId).trains ?? []) {
        if (!player.canTrain(unitId)) continue;
        if (!trainable.has(unitId)) trainable.set(unitId, b);
      }
    }
    if (trainable.size > 0) {
      this.actionsEl.appendChild(el('div', { className: 'divider', text: T.train }));
      for (const [unitId, building] of trainable) {
        const u = getUnit(unitId);
        const cost = player.unitCost(unitId, u.cost);
        const affordable = player.hasResources(cost);
        const popOk = player.popUsed + u.pop <= player.popCap;
        this.actionsEl.appendChild(
          this.actionButton(
            unitIcon(unitId, player.color),
            `${u.name}\n${formatCost(cost)}\n${u.desc ?? ''}`,
            () => this.cb.onTrain(building.id, unitId),
            !affordable || !popOk,
            formatCost(cost),
          ),
        );
      }
    }

    // מחקר
    const researchable = new Map<string, Entity>();
    for (const b of buildings) {
      if (b.building?.research) continue;
      for (const techId of getBuilding(b.defId).researches ?? []) {
        if (!player.canResearch(techId)) continue;
        if (!researchable.has(techId)) researchable.set(techId, b);
      }
    }
    if (researchable.size > 0) {
      this.actionsEl.appendChild(el('div', { className: 'divider', text: T.research }));
      for (const [techId, building] of researchable) {
        const tech: TechDef = getTech(techId);
        const affordable = player.hasResources(tech.cost);
        this.actionsEl.appendChild(
          this.actionButton(
            tech.emoji,
            `${tech.name}\n${tech.desc}\n${formatCost(tech.cost)}`,
            () => this.cb.onResearch(building.id, techId),
            !affordable,
            formatCost(tech.cost),
          ),
        );
      }
    }
    void world;
  }

  private renderBuildMenu(player: Player): void {
    this.actionsEl.appendChild(
      this.actionButton('↩️', T.back, () => {
        this.buildMenuOpen = false;
        this.lastSelectionKey = '';
      }),
    );
    this.actionsEl.appendChild(el('div', { className: 'divider', text: T.build }));
    const ids = [...player.unlockedBuildings].sort((a, b) => {
      const ca = Object.values(getBuilding(a).cost).reduce<number>((s, v) => s + (v ?? 0), 0);
      const cbv = Object.values(getBuilding(b).cost).reduce<number>((s, v) => s + (v ?? 0), 0);
      return ca - cbv;
    });
    for (const id of ids) {
      const def: BuildingDef = getBuilding(id);
      const cost = player.buildingCost(id);
      const affordable = player.hasResources(cost);
      this.actionsEl.appendChild(
        this.actionButton(
          buildingIcon(id, player.nation.id, player.color),
          `${def.name}\n${def.desc ?? ''}\n${formatCost(cost)}`,
          () => {
            this.buildMenuOpen = false;
            this.lastSelectionKey = '';
            this.cb.onPickBuilding(id);
          },
          !affordable,
          formatCost(cost),
        ),
      );
    }
  }

  /**
   * כפתור פעולה. `icon` הוא או תמונה מצוירת (מבנה/יחידה) או טקסט —
   * טקסט נשאר לפעולות כלליות כמו "עצור" שאין להן ייצוג על המפה.
   */
  private actionButton(
    icon: string | HTMLCanvasElement,
    tooltip: string,
    onClick: () => void,
    disabled = false,
    caption = '',
  ): HTMLElement {
    const art = typeof icon === 'string'
      ? el('span', { className: 'emoji', text: icon })
      : el('span', { className: 'art', children: [icon] });
    const btn = el('button', {
      className: `action${disabled ? ' disabled' : ''}`,
      title: tooltip,
      onClick: () => {
        if (!disabled) onClick();
      },
      children: [
        art,
        caption ? el('span', { className: 'caption', text: caption }) : null,
      ],
    });
    (btn as HTMLButtonElement).disabled = disabled;
    return btn;
  }

  closeBuildMenu(): void {
    this.buildMenuOpen = false;
    this.lastSelectionKey = '';
  }

  // ===== הודעות =====

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const node = el('div', { className: `toast ${kind}`, text });
    this.toastEl.appendChild(node);
    window.setTimeout(() => {
      node.classList.add('fade');
      window.setTimeout(() => node.remove(), 500);
    }, 3200);
  }

  /** מסך בחירת ענף (קיבוץ/מושב, סוג צבא…). */
  showBranchChoice(branch: BranchDef, onPick: (optionId: string) => void): void {
    clear(this.branchOverlay);
    this.branchOverlay.appendChild(
      el('div', {
        className: 'branch-card',
        children: [
          el('h2', { text: `${T.chooseBranch}: ${branch.name}` }),
          el('p', { className: 'muted', text: branch.desc }),
          el('div', {
            className: 'branch-options',
            children: branch.options.map((opt) =>
              el('button', {
                className: 'branch-option',
                onClick: () => {
                  show(this.branchOverlay, false);
                  this.branchOverlay.classList.add('hidden');
                  onPick(opt.id);
                },
                children: [
                  el('div', { className: 'branch-emoji', text: opt.emoji }),
                  el('div', { className: 'branch-name', text: opt.name }),
                  el('div', { className: 'branch-desc', text: opt.desc }),
                  el('ul', {
                    className: 'branch-highlights',
                    children: opt.highlights.map((h) => el('li', { text: h })),
                  }),
                ],
              }),
            ),
          }),
        ],
      }),
    );
    this.branchOverlay.classList.remove('hidden');
    show(this.branchOverlay, true);
  }

  isBranchOpen(): boolean {
    return !this.branchOverlay.classList.contains('hidden');
  }
}
