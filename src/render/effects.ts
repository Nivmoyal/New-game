import type { Vec2 } from '../core/types';
import type { Camera } from './camera';
import { poly, shade } from './iso';

/**
 * אפקטים ויזואליים של קרב.
 *
 * הסימולציה מדווחת על אירוע (ירייה, פגיעה, מוות, בנייה) והשכבה הזו
 * מנהלת חלקיקים קצרי-חיים. האפקטים אינם משפיעים על מצב המשחק, ולכן
 * אפשר לוותר עליהם כשהעומס גבוה בלי לשנות את תוצאות הקרב.
 */

export type FxKind =
  | 'arrow'
  | 'bullet'
  | 'shell'
  | 'impact'
  | 'explosion'
  | 'smoke'
  | 'spark'
  | 'dust'
  | 'heal';

export type Fx = {
  kind: FxKind;
  from: Vec2;
  to: Vec2;
  /** זמן התחלה (ms) */
  t0: number;
  /** משך חיים (ms) */
  life: number;
  color: string;
  /** גובה קשת המעוף (יחידות אריח) */
  arc: number;
};

const MAX_FX = 400;

export class Effects {
  private items: Fx[] = [];

  clear(): void {
    this.items.length = 0;
  }

  get count(): number {
    return this.items.length;
  }

  add(fx: Fx): void {
    if (this.items.length >= MAX_FX) this.items.shift();
    this.items.push(fx);
  }

  /** ירייה/חץ/פגז מיחידה אל מטרה. */
  shot(kind: 'arrow' | 'bullet' | 'shell', from: Vec2, to: Vec2, now: number, color = '#e8e2d0'): void {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const speed = kind === 'bullet' ? 26 : kind === 'shell' ? 14 : 11; // אריחים לשנייה
    this.add({
      kind,
      from: { ...from },
      to: { ...to },
      t0: now,
      life: Math.max(70, (dist / speed) * 1000),
      color,
      arc: kind === 'arrow' ? dist * 0.14 : kind === 'shell' ? dist * 0.1 : 0,
    });
  }

  /** פגיעה במטרה. */
  impact(pos: Vec2, now: number, heavy = false): void {
    this.add({
      kind: heavy ? 'explosion' : 'impact',
      from: { ...pos },
      to: { ...pos },
      t0: now,
      life: heavy ? 520 : 240,
      color: heavy ? '#ffb347' : '#ffe08a',
      arc: 0,
    });
    if (heavy) {
      for (let i = 0; i < 4; i++) {
        this.add({
          kind: 'smoke',
          from: { ...pos },
          to: { x: pos.x + (Math.random() - 0.5) * 1.2, y: pos.y + (Math.random() - 0.5) * 1.2 },
          t0: now + i * 60,
          life: 900,
          color: '#8a8a8a',
          arc: 0,
        });
      }
    }
  }

  /** ניצוצות עבודה (כרייה/בנייה/כריתה). */
  work(pos: Vec2, now: number, color = '#d8c88a'): void {
    this.add({ kind: 'spark', from: { ...pos }, to: { ...pos }, t0: now, life: 260, color, arc: 0 });
  }

  /** ענן אבק (מוות של מבנה, נחיתה). */
  dust(pos: Vec2, now: number): void {
    for (let i = 0; i < 6; i++) {
      this.add({
        kind: 'dust',
        from: { ...pos },
        to: { x: pos.x + (Math.random() - 0.5) * 2.4, y: pos.y + (Math.random() - 0.5) * 2.4 },
        t0: now + i * 40,
        life: 800,
        color: '#b6a98c',
        arc: 0,
      });
    }
  }

  heal(pos: Vec2, now: number): void {
    this.add({ kind: 'heal', from: { ...pos }, to: { ...pos }, t0: now, life: 700, color: '#6ee7a8', arc: 0 });
  }

  /** מצייר את כל האפקטים החיים ומנקה את אלו שפגו. */
  render(ctx: CanvasRenderingContext2D, cam: Camera, now: number): void {
    let write = 0;
    for (let i = 0; i < this.items.length; i++) {
      const fx = this.items[i];
      const age = now - fx.t0;
      if (age < 0) {
        this.items[write++] = fx;
        continue;
      }
      const t = age / fx.life;
      if (t >= 1) continue;
      this.items[write++] = fx;
      this.drawOne(ctx, cam, fx, t, now);
    }
    this.items.length = write;
  }

  private drawOne(ctx: CanvasRenderingContext2D, cam: Camera, fx: Fx, t: number, now: number): void {
    const z = cam.zoom;
    switch (fx.kind) {
      case 'arrow':
      case 'bullet':
      case 'shell': {
        const x = fx.from.x + (fx.to.x - fx.from.x) * t;
        const y = fx.from.y + (fx.to.y - fx.from.y) * t;
        // קשת מעוף: גבוה באמצע המסלול
        const h = 0.75 + fx.arc * Math.sin(Math.PI * t);
        const p = cam.worldToScreen(x, y, h);
        if (fx.kind === 'bullet') {
          // קו נותב קצר
          const back = cam.worldToScreen(
            x - (fx.to.x - fx.from.x) * 0.05,
            y - (fx.to.y - fx.from.y) * 0.05,
            h,
          );
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = Math.max(1, z * 0.025);
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(back.x, back.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (fx.kind === 'arrow') {
          const prev = cam.worldToScreen(
            x - (fx.to.x - fx.from.x) * 0.06,
            y - (fx.to.y - fx.from.y) * 0.06,
            0.75 + fx.arc * Math.sin(Math.PI * Math.max(0, t - 0.06)),
          );
          ctx.strokeStyle = '#6b4a2f';
          ctx.lineWidth = Math.max(1, z * 0.022);
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#4a4e42';
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1.5, z * 0.045), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'impact': {
        const p = cam.worldToScreen(fx.from.x, fx.from.y, 0.6);
        const r = z * (0.05 + t * 0.12);
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = fx.color;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + t * 2;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.5, Math.max(1, z * 0.02), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'explosion': {
        const p = cam.worldToScreen(fx.from.x, fx.from.y, 0.5);
        const r = z * (0.1 + t * 0.4);
        ctx.globalAlpha = (1 - t) * 0.95;
        // ליבה בהירה עם הילה כתומה
        ctx.fillStyle = shade(fx.color, 0.3 * (1 - t));
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff7a2f';
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 0.6, r * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'smoke':
      case 'dust': {
        const x = fx.from.x + (fx.to.x - fx.from.x) * t;
        const y = fx.from.y + (fx.to.y - fx.from.y) * t;
        const p = cam.worldToScreen(x, y, 0.3 + t * 0.9);
        ctx.globalAlpha = (1 - t) * 0.45;
        ctx.fillStyle = fx.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, z * (0.06 + t * 0.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'spark': {
        const p = cam.worldToScreen(fx.from.x, fx.from.y, 0.45);
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = fx.color;
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + fx.t0;
          const d = z * 0.1 * t;
          ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.5, z * 0.02, z * 0.02);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'heal': {
        const p = cam.worldToScreen(fx.from.x, fx.from.y, 0.6 + t * 0.8);
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = fx.color;
        const s = z * 0.05;
        ctx.fillRect(p.x - s / 2, p.y - s * 1.5, s, s * 3);
        ctx.fillRect(p.x - s * 1.5, p.y - s / 2, s * 3, s);
        ctx.globalAlpha = 1;
        break;
      }
    }
    void now;
    void poly;
  }
}
