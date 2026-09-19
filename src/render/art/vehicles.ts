import type { Camera } from '../camera';
import { drawBox, drawCastShadowEllipse, drawColumn, faceColors, poly, shade } from '../iso';

/**
 * כלי רכב וכלי מצור — מצוירים כתיבות תלת-ממדיות עם פרטים.
 * כולם מקבלים פס בצבע השחקן כדי שיהיה קל לזהות למי הם שייכים.
 */

export type VehicleKind =
  | 'horse'
  | 'camel'
  | 'tank'
  | 'apc'
  | 'jeep'
  | 'aa'
  | 'drone'
  | 'catapult'
  | 'ram'
  | 'ballista'
  | 'chariot';

/** פס זיהוי בצבע השחקן על גג הרכב. */
function ownerStripe(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  w: number,
  d: number,
  z: number,
  color: string,
): void {
  poly(ctx, [
    cam.worldToScreen(x + w * 0.3, y, z),
    cam.worldToScreen(x + w * 0.45, y, z),
    cam.worldToScreen(x + w * 0.45, y + d, z),
    cam.worldToScreen(x + w * 0.3, y + d, z),
  ], color);
}

export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  kind: VehicleKind,
  wx: number,
  wy: number,
  facing: number,
  owner: string,
  time: number,
  scale = 1,
): void {
  const s = 0.72 * scale;
  const x = wx - s / 2;
  const y = wy - s * 0.38;
  const dir = Math.cos(facing) - Math.sin(facing) >= 0 ? 1 : -1;

  // צל מוטל בכיוון השמש
  if (kind !== 'drone') {
    drawCastShadowEllipse(ctx, cam, wx, wy, s * 0.55, kind === 'horse' || kind === 'camel' ? 0.8 : 0.5);
  } else {
    // מל"ט מרחף — צל קטן ורחוק מתחתיו
    drawCastShadowEllipse(ctx, cam, wx, wy, s * 0.3, 1.2);
  }

  switch (kind) {
    case 'horse':
    case 'camel': {
      // סוס/גמל עם רוכב: גוף, ארבע רגליים, צוואר, ראש ורוכב בצבע השחקן
      const coat = kind === 'camel' ? '#c8a86a' : ['#6b4a32', '#3f332b', '#8a6a45'][Math.abs(Math.round(wx * 7 + wy * 13)) % 3];
      const gait = Math.sin(time * 0.008 + wx * 2 + wy) * 0.06;
      const bodyZ = 0.3 + (kind === 'camel' ? 0.08 : 0);

      // רגליים
      for (const [lx, ly] of [[0.2, 0.26], [0.2, 0.62], [0.72, 0.26], [0.72, 0.62]]) {
        const swing = Math.sin(time * 0.012 + lx * 6 + ly * 3) * 0.05;
        drawColumn(ctx, cam, x + s * lx + swing, y + s * ly, 0.045, bodyZ, shade(coat, -0.25));
      }
      // גוף
      drawBox(ctx, cam, x + s * 0.14, y + s * 0.26, s * 0.66, s * 0.4, 0.22, faceColors(coat), bodyZ + gait);
      if (kind === 'camel') {
        // דבשת
        drawBox(ctx, cam, x + s * 0.34, y + s * 0.32, s * 0.28, s * 0.28, 0.14, faceColors(shade(coat, 0.05)), bodyZ + 0.22 + gait);
      }
      // צוואר וראש בכיוון ההליכה
      const hx = x + s * (dir > 0 ? 0.78 : 0.12);
      drawColumn(ctx, cam, hx, y + s * 0.45, 0.07, 0.26, shade(coat, 0.04), bodyZ + 0.1 + gait);
      drawBox(ctx, cam, hx - s * 0.08, y + s * 0.37, s * 0.18, s * 0.16, 0.1, faceColors(shade(coat, 0.08)), bodyZ + 0.34 + gait);
      // זנב
      const tail = cam.worldToScreen(x + s * (dir > 0 ? 0.1 : 0.9), y + s * 0.45, bodyZ + 0.2 + gait);
      ctx.strokeStyle = shade(coat, -0.3);
      ctx.lineWidth = Math.max(1, cam.zoom * 0.035);
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(tail.x - dir * cam.zoom * 0.08, tail.y + cam.zoom * 0.1);
      ctx.stroke();

      // רוכב
      const rz = bodyZ + 0.22 + gait;
      drawBox(ctx, cam, x + s * 0.34, y + s * 0.38, s * 0.2, s * 0.18, 0.24, faceColors(owner), rz);
      const head = cam.worldToScreen(x + s * 0.44, y + s * 0.47, rz + 0.34);
      ctx.fillStyle = '#e0b088';
      ctx.beginPath();
      ctx.arc(head.x, head.y, cam.zoom * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(owner, -0.3);
      ctx.beginPath();
      ctx.arc(head.x, head.y - cam.zoom * 0.02, cam.zoom * 0.075, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 'tank': {
      const hull = '#6b7050';
      // שרשראות
      drawBox(ctx, cam, x, y, s, s * 0.22, 0.12, faceColors('#3a3d33'));
      drawBox(ctx, cam, x, y + s * 0.54, s, s * 0.22, 0.12, faceColors('#3a3d33'));
      // גוף משופע
      drawBox(ctx, cam, x + s * 0.04, y + s * 0.16, s * 0.92, s * 0.46, 0.2, faceColors(hull), 0.08);
      // צריח
      drawBox(ctx, cam, x + s * 0.26, y + s * 0.24, s * 0.44, s * 0.32, 0.16, faceColors(shade(hull, 0.06)), 0.28);
      ownerStripe(ctx, cam, x, y + s * 0.16, s, s * 0.46, 0.44, owner);
      // קנה
      const b0 = cam.worldToScreen(x + s * (dir > 0 ? 0.68 : 0.3), y + s * 0.4, 0.38);
      const b1 = cam.worldToScreen(x + s * (dir > 0 ? 1.25 : -0.27), y + s * 0.4, 0.38);
      ctx.strokeStyle = '#4a4e42';
      ctx.lineWidth = Math.max(1.5, cam.zoom * 0.05);
      ctx.beginPath();
      ctx.moveTo(b0.x, b0.y);
      ctx.lineTo(b1.x, b1.y);
      ctx.stroke();
      break;
    }
    case 'apc': {
      const hull = '#777a56';
      drawBox(ctx, cam, x, y, s, s * 0.2, 0.11, faceColors('#3a3d33'));
      drawBox(ctx, cam, x, y + s * 0.56, s, s * 0.2, 0.11, faceColors('#3a3d33'));
      drawBox(ctx, cam, x + s * 0.05, y + s * 0.14, s * 0.9, s * 0.5, 0.3, faceColors(hull), 0.07);
      ownerStripe(ctx, cam, x, y + s * 0.14, s, s * 0.5, 0.37, owner);
      // צריחון מקלע
      drawBox(ctx, cam, x + s * 0.4, y + s * 0.3, s * 0.2, s * 0.18, 0.1, faceColors(shade(hull, 0.1)), 0.37);
      break;
    }
    case 'jeep': {
      const body = shade(owner, -0.1);
      drawBox(ctx, cam, x + s * 0.06, y + s * 0.18, s * 0.88, s * 0.44, 0.18, faceColors(body), 0.06);
      drawBox(ctx, cam, x + s * 0.3, y + s * 0.22, s * 0.34, s * 0.36, 0.14, faceColors(shade(body, -0.2)), 0.24);
      for (const [wxo, wyo] of [[0.16, 0.12], [0.76, 0.12], [0.16, 0.66], [0.76, 0.66]]) {
        drawColumn(ctx, cam, x + s * wxo, y + s * wyo, 0.06, 0.1, '#2b2b2b');
      }
      break;
    }
    case 'aa': {
      const hull = '#6d7360';
      drawBox(ctx, cam, x + s * 0.05, y + s * 0.18, s * 0.9, s * 0.46, 0.22, faceColors(hull), 0.06);
      for (const [wxo, wyo] of [[0.18, 0.14], [0.78, 0.14], [0.18, 0.66], [0.78, 0.66]]) {
        drawColumn(ctx, cam, x + s * wxo, y + s * wyo, 0.06, 0.1, '#2b2b2b');
      }
      // תאי יירוט משופעים
      drawBox(ctx, cam, x + s * 0.28, y + s * 0.26, s * 0.42, s * 0.3, 0.26, faceColors(shade(hull, -0.1)), 0.28);
      for (let i = 0; i < 3; i++) {
        const c = cam.worldToScreen(x + s * (0.34 + i * 0.12), y + s * 0.3, 0.56);
        ctx.fillStyle = '#2b3138';
        ctx.beginPath();
        ctx.arc(c.x, c.y, cam.zoom * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
      ownerStripe(ctx, cam, x, y + s * 0.18, s, s * 0.46, 0.28, owner);
      break;
    }
    case 'drone': {
      // מרחף — גובה קבוע מעל הקרקע
      const z = 1.15 + Math.sin(time * 0.002 + wx) * 0.06;
      const body = '#c9cdd2';
      drawBox(ctx, cam, x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.2, 0.1, faceColors(body), z);
      // כנפיים
      poly(ctx, [
        cam.worldToScreen(x - s * 0.25, y + s * 0.36, z + 0.06),
        cam.worldToScreen(x + s * 1.25, y + s * 0.36, z + 0.06),
        cam.worldToScreen(x + s * 1.25, y + s * 0.46, z + 0.06),
        cam.worldToScreen(x - s * 0.25, y + s * 0.46, z + 0.06),
      ], shade(body, -0.08));
      // מדחף מסתובב
      const prop = cam.worldToScreen(x + s * (dir > 0 ? 0.72 : 0.28), y + s * 0.4, z + 0.05);
      ctx.strokeStyle = 'rgba(80,80,80,0.5)';
      ctx.lineWidth = Math.max(1, cam.zoom * 0.02);
      const spin = time * 0.02;
      ctx.beginPath();
      ctx.ellipse(prop.x, prop.y, cam.zoom * 0.1, cam.zoom * 0.03, spin, 0, Math.PI * 2);
      ctx.stroke();
      ownerStripe(ctx, cam, x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.2, z + 0.1, owner);
      break;
    }
    case 'catapult': {
      drawBox(ctx, cam, x + s * 0.1, y + s * 0.25, s * 0.8, s * 0.4, 0.14, faceColors('#7a5c3a'), 0.06);
      for (const wyo of [0.18, 0.72]) {
        drawColumn(ctx, cam, x + s * 0.25, y + s * wyo, 0.08, 0.1, '#4a3826');
        drawColumn(ctx, cam, x + s * 0.75, y + s * wyo, 0.08, 0.1, '#4a3826');
      }
      // זרוע ההטלה
      const pivot = cam.worldToScreen(x + s * 0.5, y + s * 0.45, 0.2);
      const swing = Math.sin(time * 0.0015) * 0.4 - 0.7;
      const tip = cam.worldToScreen(
        x + s * (0.5 - dir * Math.cos(swing) * 0.7),
        y + s * 0.45,
        0.2 + Math.sin(-swing) * 0.7,
      );
      ctx.strokeStyle = '#6b4a2f';
      ctx.lineWidth = Math.max(1.5, cam.zoom * 0.05);
      ctx.beginPath();
      ctx.moveTo(pivot.x, pivot.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.fillStyle = '#8d949c';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, cam.zoom * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ram': {
      drawBox(ctx, cam, x + s * 0.08, y + s * 0.2, s * 0.84, s * 0.5, 0.16, faceColors('#6b4a2f'), 0.05);
      // גגון
      poly(ctx, [
        cam.worldToScreen(x, y + s * 0.1, 0.5),
        cam.worldToScreen(x + s, y + s * 0.1, 0.5),
        cam.worldToScreen(x + s, y + s * 0.8, 0.34),
        cam.worldToScreen(x, y + s * 0.8, 0.34),
      ], '#5a4732');
      // קורת הניגוח
      const r0 = cam.worldToScreen(x + s * (dir > 0 ? 0.6 : 0.4), y + s * 0.45, 0.24);
      const r1 = cam.worldToScreen(x + s * (dir > 0 ? 1.3 : -0.3), y + s * 0.45, 0.24);
      ctx.strokeStyle = '#4a3826';
      ctx.lineWidth = Math.max(2, cam.zoom * 0.07);
      ctx.beginPath();
      ctx.moveTo(r0.x, r0.y);
      ctx.lineTo(r1.x, r1.y);
      ctx.stroke();
      break;
    }
    case 'ballista': {
      drawBox(ctx, cam, x + s * 0.15, y + s * 0.3, s * 0.7, s * 0.34, 0.12, faceColors('#7a5c3a'), 0.06);
      const c = cam.worldToScreen(x + s * 0.5, y + s * 0.45, 0.3);
      ctx.strokeStyle = '#4a3826';
      ctx.lineWidth = Math.max(1.5, cam.zoom * 0.045);
      ctx.beginPath();
      ctx.moveTo(c.x - cam.zoom * 0.18, c.y - cam.zoom * 0.06);
      ctx.lineTo(c.x + cam.zoom * 0.18, c.y - cam.zoom * 0.06);
      ctx.stroke();
      break;
    }
    case 'chariot': {
      drawBox(ctx, cam, x + s * 0.3, y + s * 0.28, s * 0.4, s * 0.34, 0.2, faceColors(shade(owner, -0.05)), 0.08);
      for (const wyo of [0.2, 0.7]) {
        drawColumn(ctx, cam, x + s * 0.42, y + s * wyo, 0.1, 0.06, '#5a4026');
      }
      // סוס מקורב
      drawBox(ctx, cam, x + s * (dir > 0 ? 0.78 : -0.1), y + s * 0.34, s * 0.34, s * 0.22, 0.24, faceColors('#8a6a45'), 0.1);
      break;
    }
  }
}
