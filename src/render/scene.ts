import { Camera } from './camera';
import { poly, shade, tileDiamond } from './iso';
import { drawBroadleaf, drawConifer, drawRocks } from './art/nature';
import { drawPerson, type Action, type PersonStyle } from './art/people';
import { drawStructure, paletteFor, type Archetype } from './art/structures';
import { drawVehicle } from './art/vehicles';

/**
 * סצנת רקע חיה למסך הפתיחה: יישוב איזומטרי קטן עם אנשים שעובדים.
 * משתמשת באותן פונקציות ציור כמו המשחק עצמו, כך שמסך הפתיחה מציג
 * בדיוק את מה שהשחקן יקבל.
 */

type Prop =
  | { kind: 'building'; arch: Archetype; x: number; y: number; size: number; nation: string }
  | { kind: 'tree'; x: number; y: number; broad: boolean; h: number }
  | { kind: 'rock'; x: number; y: number }
  | { kind: 'vehicle'; x: number; y: number };

type Walker = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  style: PersonStyle;
  action: Action;
  workUntil: number;
};

const GRASS = '#5f9145';
const FIELD = '#6f8347';

export class MenuScene {
  private camera = new Camera();
  private ctx: CanvasRenderingContext2D;
  private props: Prop[] = [];
  private walkers: Walker[] = [];
  private raf = 0;
  private running = false;
  private size = 26;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('לא ניתן ליצור הקשר ציור לסצנת הפתיחה');
    this.ctx = ctx;
    this.build();
  }

  private build(): void {
    const S = this.size;
    const mid = S / 2;
    this.props = [
      { kind: 'building', arch: 'townCenter', x: mid - 2, y: mid - 2, size: 4, nation: 'israel' },
      { kind: 'building', arch: 'house', x: mid + 3, y: mid - 4, size: 2, nation: 'israel' },
      { kind: 'building', arch: 'house', x: mid - 6, y: mid + 1, size: 2, nation: 'israel' },
      { kind: 'building', arch: 'farm', x: mid + 3, y: mid + 2, size: 3, nation: 'israel' },
      { kind: 'building', arch: 'storage', x: mid - 6, y: mid - 4, size: 2, nation: 'israel' },
      { kind: 'building', arch: 'tower', x: mid + 7, y: mid - 1, size: 1, nation: 'israel' },
      { kind: 'building', arch: 'longhouse', x: mid - 3, y: mid + 5, size: 3, nation: 'israel' },
      { kind: 'vehicle', x: mid + 6, y: mid + 5 },
    ];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 9 + (i % 4);
      this.props.push({
        kind: 'tree',
        x: mid + Math.cos(a) * r,
        y: mid + Math.sin(a) * r * 0.9,
        broad: i % 3 === 0,
        h: 1 + (i % 3) * 0.25,
      });
    }
    this.props.push({ kind: 'rock', x: mid - 9, y: mid + 6 });
    this.props.push({ kind: 'rock', x: mid + 9, y: mid - 6 });

    const clothes = ['#3b82f6', '#2563eb', '#1d4ed8'];
    const tools: Array<NonNullable<PersonStyle['tool']>> = ['axe', 'hammer', 'sickle', 'pick'];
    for (let i = 0; i < 9; i++) {
      this.walkers.push({
        x: mid + (Math.random() - 0.5) * 12,
        y: mid + (Math.random() - 0.5) * 10,
        tx: 0,
        ty: 0,
        speed: 0.8 + Math.random() * 0.7,
        style: {
          cloth: clothes[i % clothes.length],
          accent: '#1e293b',
          skin: ['#e8b98a', '#c88c58', '#8d5a34'][i % 3],
          hat: i % 4 === 0 ? 'cap' : 'none',
          tool: tools[i % tools.length],
        },
        action: 'walk',
        workUntil: 0,
      });
      this.retarget(this.walkers[i]);
    }
  }

  private retarget(w: Walker): void {
    const mid = this.size / 2;
    w.tx = mid + (Math.random() - 0.5) * 14;
    w.ty = mid + (Math.random() - 0.5) * 11;
    w.action = 'walk';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.update(dt, now);
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private update(dt: number, now: number): void {
    for (const w of this.walkers) {
      if (w.action !== 'walk') {
        if (now > w.workUntil) this.retarget(w);
        continue;
      }
      const dx = w.tx - w.x;
      const dy = w.ty - w.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.25) {
        // עוצר לעבוד קצת ואז ממשיך
        w.action = (['chop', 'build', 'mine', 'farm'] as Action[])[Math.floor(Math.random() * 4)];
        w.workUntil = now + 2200 + Math.random() * 2600;
        continue;
      }
      w.x += (dx / d) * w.speed * dt;
      w.y += (dy / d) * w.speed * dt;
    }
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cam = this.camera;
    cam.setViewport(w, h);
    cam.zoom = Math.max(30, Math.min(70, w / 22));
    // מסיטים את היישוב מטה ושמאלה כדי שהכותרת והכפתורים יישארו קריאים מעליו
    cam.x = this.size / 2 - 3.5;
    cam.y = this.size / 2 - 3.5;

    // קרקע
    for (let sum = 0; sum < this.size * 2; sum++) {
      for (let x = Math.max(0, sum - this.size + 1); x <= Math.min(this.size - 1, sum); x++) {
        const y = sum - x;
        const mid = this.size / 2;
        const d = Math.hypot(x - mid, y - mid);
        if (d > this.size * 0.46) continue;
        const v = ((x * 73 + y * 131) % 17) / 17;
        const base = (x + y) % 7 === 0 ? FIELD : GRASS;
        const fade = Math.max(0, 1 - Math.max(0, d - this.size * 0.26) / (this.size * 0.2));
        ctx.globalAlpha = fade;
        poly(ctx, tileDiamond(cam, x, y, 1, 1, 0), shade(base, (v - 0.5) * 0.08));
      }
    }
    ctx.globalAlpha = 1;

    // אובייקטים + אנשים, ממוינים לפי עומק
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    for (const p of this.props) {
      if (p.kind === 'building') {
        items.push({
          depth: p.x + p.y + p.size * 0.25,
          draw: () =>
            drawStructure(ctx, cam, p.arch, p.x, p.y, p.size, paletteFor(p.nation, '#3b82f6'), {
              stage: 2,
              time: now,
              seed: Math.round(p.x * 7 + p.y),
            }),
        });
      } else if (p.kind === 'tree') {
        items.push({
          depth: p.x + p.y,
          draw: () =>
            p.broad
              ? drawBroadleaf(ctx, cam, p.x, p.y, p.h, 3)
              : drawConifer(ctx, cam, p.x, p.y, p.h, 3),
        });
      } else if (p.kind === 'rock') {
        items.push({ depth: p.x + p.y, draw: () => drawRocks(ctx, cam, p.x, p.y, 11) });
      } else {
        items.push({
          depth: p.x + p.y,
          draw: () => drawVehicle(ctx, cam, 'jeep', p.x, p.y, 0.6, '#3b82f6', now),
        });
      }
    }
    for (const wk of this.walkers) {
      const phase = ((now * 0.0032 + wk.x) % 1 + 1) % 1;
      const facing = Math.atan2(wk.ty - wk.y, wk.tx - wk.x);
      items.push({
        depth: wk.x + wk.y,
        draw: () => drawPerson(ctx, cam, wk.x, wk.y, 0, wk.style, wk.action, phase, facing, 0.95),
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
  }
}
