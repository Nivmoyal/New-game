import { allNations, branchesAtStage, getNation } from '../data';
import type { BranchOptionDef, NationDef } from '../data/schema';
import { DIFFICULTY_ORDER, AI_PROFILES } from '../ai/difficulty';
import type { Difficulty } from '../core/types';
import { deleteSave, listSaves, type Settings } from '../core/save';
import { clear, el, show } from './dom';
import { MAP_SIZES, T } from './strings';

export type GameSetup = {
  nationId: string;
  /** בחירות שנעשות לפני המשחק (למשל קיבוץ/מושב אצל ישראל) */
  branchChoices: Record<string, string>;
  enemyNationId: string;
  difficulty: Difficulty;
  mapSize: { width: number; height: number };
  seed: number;
  /** מספר יריבים */
  enemies: number;
};

export type MenuCallbacks = {
  onStart: (setup: GameSetup) => void;
  onLoad: (slot: string) => void;
  onSettingsChange: (settings: Settings) => void;
};

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

/** מסך הפתיחה: בחירת אומה, נקודת פתיחה, אויב וקושי, הגדרות ושמירות. */
export class StartMenu {
  readonly root: HTMLElement;
  private screen: HTMLElement;
  private setup: GameSetup;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private cb: MenuCallbacks,
  ) {
    const nations = allNations();
    this.setup = {
      nationId: 'israel',
      branchChoices: {},
      enemyNationId: nations[1]?.id ?? 'japan',
      difficulty: 'normal',
      mapSize: { width: MAP_SIZES[1].width, height: MAP_SIZES[1].height },
      seed: randomSeed(),
      enemies: 1,
    };
    this.root = el('div', { className: 'menu-root' });
    this.screen = el('div', { className: 'menu-screen' });
    this.root.appendChild(this.screen);
    parent.appendChild(this.root);
    this.showMain();
  }

  open(): void {
    show(this.root, true);
    this.showMain();
  }

  close(): void {
    show(this.root, false);
  }

  // ===== מסך ראשי =====

  showMain(): void {
    clear(this.screen);
    this.screen.appendChild(
      el('div', {
        className: 'menu-hero',
        children: [
          el('h1', { className: 'title', text: T.gameTitle }),
          el('p', { className: 'subtitle', text: T.gameSubtitle }),
          el('div', {
            className: 'menu-buttons',
            children: [
              el('button', { className: 'primary big', text: T.newGame, onClick: () => this.showNationSelect() }),
              el('button', { className: 'big', text: T.quickGame, onClick: () => this.startQuick() }),
              el('button', { className: 'big', text: T.loadGame, onClick: () => this.showLoad() }),
              el('button', { className: 'big', text: T.settings, onClick: () => this.showSettings() }),
              el('button', { className: 'big ghost', text: T.helpTitle, onClick: () => this.showHelp() }),
            ],
          }),
        ],
      }),
    );
  }

  private startQuick(): void {
    const nations = allNations();
    const nation = nations[Math.floor(Math.random() * nations.length)];
    const branchChoices: Record<string, string> = {};
    for (const branch of branchesAtStage(nation, 1)) {
      branchChoices[branch.id] =
        branch.options[Math.floor(Math.random() * branch.options.length)].id;
    }
    const enemies = nations.filter((n) => n.id !== nation.id);
    this.cb.onStart({
      nationId: nation.id,
      branchChoices,
      enemyNationId: enemies[Math.floor(Math.random() * enemies.length)].id,
      difficulty: 'normal',
      mapSize: { width: 112, height: 112 },
      seed: randomSeed(),
      enemies: 1,
    });
  }

  // ===== בחירת אומה =====

  private showNationSelect(): void {
    clear(this.screen);
    const nations = allNations();
    const detail = el('div', { className: 'nation-detail' });

    const list = el('div', { className: 'nation-list' });
    const renderList = () => {
      clear(list);
      for (const nation of nations) {
        list.appendChild(
          el('button', {
            className: `nation-card${nation.id === this.setup.nationId ? ' active' : ''}`,
            onClick: () => {
              this.setup.nationId = nation.id;
              this.setup.branchChoices = {};
              renderList();
              renderDetail();
            },
            children: [
              el('span', { className: 'flag', text: nation.flag }),
              el('span', { className: 'nation-name', text: nation.name }),
            ],
          }),
        );
      }
      list.appendChild(
        el('button', {
          className: 'nation-card ghost',
          onClick: () => {
            this.setup.nationId = nations[Math.floor(Math.random() * nations.length)].id;
            this.setup.branchChoices = {};
            renderList();
            renderDetail();
          },
          children: [
            el('span', { className: 'flag', text: '🎲' }),
            el('span', { className: 'nation-name', text: T.randomNation }),
          ],
        }),
      );
    };

    const renderDetail = () => {
      clear(detail);
      const nation = getNation(this.setup.nationId);
      detail.appendChild(el('h2', { text: `${nation.flag} ${nation.name}` }));
      detail.appendChild(el('p', { className: 'muted', text: nation.desc }));

      detail.appendChild(el('h3', { text: T.bonuses }));
      detail.appendChild(
        el('ul', { className: 'bullets', children: nation.bonuses.map((b) => el('li', { text: b })) }),
      );

      if (nation.uniques?.length) {
        detail.appendChild(el('h3', { text: T.uniqueBuildings }));
        detail.appendChild(
          el('div', {
            className: 'chips',
            children: nation.uniques.map((u) => el('span', { className: 'chip', text: u })),
          }),
        );
      }

      detail.appendChild(el('h3', { text: T.growthPath }));
      detail.appendChild(
        el('div', {
          className: 'stage-path',
          children: nation.stages.map((s, i) =>
            el('div', {
              className: 'stage-step',
              children: [
                el('span', { className: 'step-num', text: String(i + 1) }),
                el('span', { className: 'step-emoji', text: s.emoji }),
                el('span', { className: 'step-name', text: s.name }),
                el('span', { className: 'step-desc', text: s.desc }),
              ],
            }),
          ),
        }),
      );

      // בחירות לפני המשחק (נקודת פתיחה — קיבוץ/מושב)
      for (const branch of branchesAtStage(nation, 1)) {
        detail.appendChild(el('h3', { text: `${T.chooseStart}: ${branch.name}` }));
        detail.appendChild(el('p', { className: 'muted small', text: branch.desc }));
        const options = el('div', { className: 'start-options' });
        const renderOptions = () => {
          clear(options);
          for (const opt of branch.options) {
            options.appendChild(this.startOptionCard(branch.id, opt, renderOptions));
          }
        };
        renderOptions();
        detail.appendChild(options);
        if (!this.setup.branchChoices[branch.id]) {
          this.setup.branchChoices[branch.id] = branch.options[0].id;
          renderOptions();
        }
      }
    };

    renderList();
    renderDetail();

    this.screen.appendChild(
      el('div', {
        className: 'menu-page',
        children: [
          el('div', { className: 'menu-header', children: [
            el('h1', { text: T.chooseNation }),
            el('button', { className: 'ghost', text: T.back, onClick: () => this.showMain() }),
          ] }),
          el('div', { className: 'nation-layout', children: [list, detail] }),
          this.opponentBar(),
        ],
      }),
    );
  }

  private startOptionCard(
    branchId: string,
    opt: BranchOptionDef,
    rerender: () => void,
  ): HTMLElement {
    const active = this.setup.branchChoices[branchId] === opt.id;
    return el('button', {
      className: `start-option${active ? ' active' : ''}`,
      onClick: () => {
        this.setup.branchChoices[branchId] = opt.id;
        rerender();
      },
      children: [
        el('div', { className: 'opt-head', children: [
          el('span', { className: 'opt-emoji', text: opt.emoji }),
          el('span', { className: 'opt-name', text: opt.name }),
        ] }),
        el('div', { className: 'opt-desc', text: opt.desc }),
        el('ul', {
          className: 'bullets small',
          children: opt.highlights.map((h) => el('li', { text: h })),
        }),
      ],
    });
  }

  private opponentBar(): HTMLElement {
    const nations = allNations();
    const enemySelect = el('select', { className: 'select' }) as HTMLSelectElement;
    for (const n of nations) {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = `${n.flag} ${n.name}`;
      enemySelect.appendChild(opt);
    }
    enemySelect.value = this.setup.enemyNationId;
    enemySelect.addEventListener('change', () => {
      this.setup.enemyNationId = enemySelect.value;
    });

    const diffSelect = el('select', { className: 'select' }) as HTMLSelectElement;
    for (const d of DIFFICULTY_ORDER) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `${AI_PROFILES[d].name} — ${AI_PROFILES[d].desc}`;
      diffSelect.appendChild(opt);
    }
    diffSelect.value = this.setup.difficulty;
    diffSelect.addEventListener('change', () => {
      this.setup.difficulty = diffSelect.value as Difficulty;
    });

    const sizeSelect = el('select', { className: 'select' }) as HTMLSelectElement;
    for (const s of MAP_SIZES) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sizeSelect.appendChild(opt);
    }
    sizeSelect.value = MAP_SIZES[1].id;
    sizeSelect.addEventListener('change', () => {
      const found = MAP_SIZES.find((s) => s.id === sizeSelect.value) ?? MAP_SIZES[1];
      this.setup.mapSize = { width: found.width, height: found.height };
    });

    const enemyCount = el('select', { className: 'select' }) as HTMLSelectElement;
    for (const n of [1, 2, 3]) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = `${n} יריבים`;
      enemyCount.appendChild(opt);
    }
    enemyCount.value = '1';
    enemyCount.addEventListener('change', () => {
      this.setup.enemies = Number(enemyCount.value);
    });

    return el('div', {
      className: 'opponent-bar',
      children: [
        this.field(T.chooseEnemy, enemySelect),
        this.field(T.chooseDifficulty, diffSelect),
        this.field(T.chooseMapSize, sizeSelect),
        this.field('יריבים', enemyCount),
        el('button', {
          className: 'primary big',
          text: T.start,
          onClick: () => {
            this.setup.seed = randomSeed();
            this.cb.onStart({ ...this.setup, branchChoices: { ...this.setup.branchChoices } });
          },
        }),
      ],
    });
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    return el('label', {
      className: 'field',
      children: [el('span', { className: 'field-label', text: label }), control],
    });
  }

  // ===== טעינה =====

  private showLoad(): void {
    clear(this.screen);
    const saves = listSaves();
    const list = el('div', { className: 'save-list' });
    if (saves.length === 0) {
      list.appendChild(el('p', { className: 'muted', text: T.noSaves }));
    }
    for (const save of saves) {
      const date = new Date(save.savedAt);
      list.appendChild(
        el('div', {
          className: 'save-row',
          children: [
            el('div', {
              className: 'save-info',
              children: [
                el('div', { className: 'save-label', text: save.label }),
                el('div', {
                  className: 'muted small',
                  text: `${T.stage} ${save.stage} · ${date.toLocaleString('he-IL')}`,
                }),
              ],
            }),
            el('button', { className: 'primary', text: T.loadGame, onClick: () => this.cb.onLoad(save.key) }),
            el('button', {
              className: 'ghost',
              text: T.deleteSave,
              onClick: () => {
                deleteSave(save.key);
                this.showLoad();
              },
            }),
          ],
        }),
      );
    }
    this.screen.appendChild(
      el('div', {
        className: 'menu-page narrow',
        children: [
          el('div', { className: 'menu-header', children: [
            el('h1', { text: T.loadGame }),
            el('button', { className: 'ghost', text: T.back, onClick: () => this.showMain() }),
          ] }),
          list,
        ],
      }),
    );
  }

  // ===== הגדרות =====

  private showSettings(): void {
    clear(this.screen);
    const rows: HTMLElement[] = [];
    const slider = (
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      onChange: (v: number) => void,
    ) => {
      const input = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } }) as HTMLInputElement;
      input.value = String(value);
      const out = el('span', { className: 'slider-value', text: value.toFixed(2) });
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = v.toFixed(2);
        onChange(v);
        this.cb.onSettingsChange(this.settings);
      });
      return el('div', { className: 'setting-row', children: [
        el('span', { className: 'setting-label', text: label }), input, out,
      ] });
    };
    const toggle = (label: string, value: boolean, onChange: (v: boolean) => void) => {
      const input = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      input.checked = value;
      input.addEventListener('change', () => {
        onChange(input.checked);
        this.cb.onSettingsChange(this.settings);
      });
      return el('div', { className: 'setting-row', children: [
        el('span', { className: 'setting-label', text: label }), input,
      ] });
    };

    rows.push(slider(T.sfxVolume, this.settings.sfxVolume, 0, 1, 0.05, (v) => (this.settings.sfxVolume = v)));
    rows.push(slider(T.musicVolume, this.settings.musicVolume, 0, 1, 0.05, (v) => (this.settings.musicVolume = v)));
    rows.push(slider(T.scrollSpeed, this.settings.scrollSpeed, 0.4, 2.5, 0.1, (v) => (this.settings.scrollSpeed = v)));
    rows.push(slider(T.gameSpeed, this.settings.gameSpeed, 0.5, 3, 0.5, (v) => (this.settings.gameSpeed = v)));
    rows.push(toggle(T.showHealthBars, this.settings.showHealthBars, (v) => (this.settings.showHealthBars = v)));
    rows.push(toggle(T.edgeScroll, this.settings.edgeScroll, (v) => (this.settings.edgeScroll = v)));

    this.screen.appendChild(
      el('div', {
        className: 'menu-page narrow',
        children: [
          el('div', { className: 'menu-header', children: [
            el('h1', { text: T.settings }),
            el('button', { className: 'ghost', text: T.back, onClick: () => this.showMain() }),
          ] }),
          el('div', { className: 'settings', children: rows }),
        ],
      }),
    );
  }

  private showHelp(): void {
    clear(this.screen);
    this.screen.appendChild(
      el('div', {
        className: 'menu-page narrow',
        children: [
          el('div', { className: 'menu-header', children: [
            el('h1', { text: T.helpTitle }),
            el('button', { className: 'ghost', text: T.back, onClick: () => this.showMain() }),
          ] }),
          el('ul', { className: 'bullets', children: T.help.map((h) => el('li', { text: h })) }),
          el('p', {
            className: 'muted small',
            text: 'כל האומות מוצגות בכבוד ובעומק שווה. היריבים במשחק הם אומות שנשלטות על ידי המחשב, והדגש הוא על בנייה, כלכלה, צמיחה ואסטרטגיה.',
          }),
        ],
      }),
    );
  }

  /** בחירת אומות היריבים בפועל (נמנע מכפילות עם השחקן). */
  static pickEnemies(setup: GameSetup): NationDef[] {
    const pool = allNations().filter((n) => n.id !== setup.nationId);
    const chosen: NationDef[] = [getNation(setup.enemyNationId)];
    for (let i = 1; i < setup.enemies; i++) {
      const rest = pool.filter((n) => !chosen.some((c) => c.id === n.id));
      if (rest.length === 0) break;
      chosen.push(rest[Math.floor(Math.random() * rest.length)]);
    }
    return chosen;
  }
}
