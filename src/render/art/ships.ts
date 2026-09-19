import type { Camera } from '../camera';
import { drawColumn, poly, shade } from '../iso';

/**
 * כלי שיט.
 *
 * בניגוד לרכב יבשתי, ספינה מצוירת לפי כיוון ההפלגה האמיתי: הגוף הוא
 * מצולע מוארך בעולם לאורך וקטור הכיוון, כך שהיא נראית נכון בכל אחד
 * משמונת הכיוונים. מעליו סיפון מוגבה מעט — הרווח ביניהם נקרא כדופן.
 */

export type ShipKind = 'boat' | 'galley' | 'longship';

type Spec = {
  length: number;
  width: number;
  hull: string;
  deck: string;
  mast: number;
  sail: number;
  oars: number;
  shields: boolean;
};

const SPECS: Record<ShipKind, Spec> = {
  boat: { length: 0.42, width: 0.2, hull: '#7a5a38', deck: '#9c7a4e', mast: 0.5, sail: 0.3, oars: 0, shields: false },
  galley: { length: 0.62, width: 0.26, hull: '#6b4f32', deck: '#8f7048', mast: 0.8, sail: 0.46, oars: 4, shields: false },
  longship: { length: 0.72, width: 0.24, hull: '#5e4126', deck: '#86653c', mast: 0.85, sail: 0.5, oars: 5, shields: true },
};

export function drawShip(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  kind: ShipKind,
  wx: number,
  wy: number,
  facing: number,
  owner: string,
  time: number,
): void {
  const s = SPECS[kind];
  const fx = Math.cos(facing);
  const fy = Math.sin(facing);
  const rx = -Math.sin(facing);
  const ry = Math.cos(facing);
  // נדנוד עדין על הגלים
  const bob = Math.sin(time * 0.0016 + wx * 0.7 + wy * 0.5) * 0.03;

  const pt = (along: number, across: number, z: number) =>
    cam.worldToScreen(
      wx + fx * along * s.length + rx * across * s.width,
      wy + fy * along * s.length + ry * across * s.width,
      z + bob,
    );

  // שובל — שני פסים בהירים מאחורי הירכתיים
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#dff0f7';
  ctx.lineWidth = Math.max(1, cam.zoom * 0.03);
  for (const side of [-0.8, 0.8]) {
    const a = pt(-1.05, side, 0);
    const b = pt(-1.9, side * 1.5, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();

  const outline = (z: number, scale: number) => [
    pt(1.0 * scale, 0, z),
    pt(0.45 * scale, 1 * scale, z),
    pt(-0.75 * scale, 0.86 * scale, z),
    pt(-1.0 * scale, 0, z),
    pt(-0.75 * scale, -0.86 * scale, z),
    pt(0.45 * scale, -1 * scale, z),
  ];

  // קו המים, ואז הסיפון מעליו — הרווח נקרא כדופן הספינה
  poly(ctx, outline(0, 1), shade(s.hull, -0.25));
  poly(ctx, outline(0.16, 0.86), s.deck);

  // משוטים
  if (s.oars > 0) {
    ctx.save();
    ctx.strokeStyle = shade(s.hull, 0.18);
    ctx.lineWidth = Math.max(0.8, cam.zoom * 0.022);
    const stroke = Math.sin(time * 0.004) * 0.25;
    for (let i = 0; i < s.oars; i++) {
      const t = -0.6 + (i / (s.oars - 1)) * 1.2;
      for (const side of [-1, 1]) {
        const a = pt(t, side * 0.8, 0.16);
        const b = pt(t - 0.5 + stroke, side * 2.1, 0.02);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // מגני ויקינגים על הדופן
  if (s.shields) {
    for (let i = 0; i < 4; i++) {
      const t = -0.45 + (i / 3) * 1.0;
      for (const side of [-1, 1]) {
        const c = pt(t, side * 0.95, 0.2);
        ctx.fillStyle = i % 2 === 0 ? owner : '#d8d2c4';
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(1.2, cam.zoom * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // תורן ומפרש
  const mast = cam.worldToScreen(wx + bob * 0, wy, 0.16 + bob);
  void mast;
  drawColumn(ctx, cam, wx + fx * 0.02, wy + fy * 0.02, 0.045, s.mast, '#6b4a2f', 0.16 + bob);

  const sailTop = s.mast + 0.16;
  const sailBottom = s.mast * 0.34 + 0.16;
  const w = s.sail;
  poly(ctx, [
    cam.worldToScreen(wx + rx * -w, wy + ry * -w, sailBottom + bob),
    cam.worldToScreen(wx + rx * w, wy + ry * w, sailBottom + bob),
    cam.worldToScreen(wx + rx * w * 0.8, wy + ry * w * 0.8, sailTop + bob),
    cam.worldToScreen(wx + rx * -w * 0.8, wy + ry * -w * 0.8, sailTop + bob),
  ], '#f0ece0');
  // פס בצבע השחקן על המפרש
  poly(ctx, [
    cam.worldToScreen(wx + rx * -w * 0.34, wy + ry * -w * 0.34, sailBottom + bob),
    cam.worldToScreen(wx + rx * w * 0.34, wy + ry * w * 0.34, sailBottom + bob),
    cam.worldToScreen(wx + rx * w * 0.27, wy + ry * w * 0.27, sailTop + bob),
    cam.worldToScreen(wx + rx * -w * 0.27, wy + ry * -w * 0.27, sailTop + bob),
  ], owner);
}
