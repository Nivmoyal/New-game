import type { Camera } from '../camera';
import { drawCastShadowEllipse, poly, shade } from '../iso';

/**
 * דמויות אנוש מצוירות פרוצדורלית, עם אנימציית הליכה ועבודה.
 *
 * כל דמות נבנית מגוף, ראש, שתי רגליים ושתי זרועות, ומצוירת בסקאלה
 * שנגזרת מהזום. הפוזה נקבעת מ-phase (0..1) ומסוג הפעולה.
 */

export type Action = 'idle' | 'walk' | 'chop' | 'mine' | 'build' | 'farm' | 'fight' | 'carry';

export type PersonStyle = {
  /** צבע הבגד — בדרך כלל צבע השחקן */
  cloth: string;
  /** צבע משני (מכנסיים/שריון) */
  accent: string;
  skin: string;
  /** כובע/קסדה */
  hat?: 'none' | 'helmet' | 'cap' | 'hood' | 'crown' | 'beret';
  /** כלי ביד */
  tool?: 'none' | 'axe' | 'pick' | 'hammer' | 'sickle' | 'sword' | 'spear' | 'bow' | 'rifle' | 'staff';
  /** מגן על הגב/יד */
  shield?: boolean;
};

const SKIN_TONES = ['#e8b98a', '#d69f6e', '#b87c4e', '#8d5a34', '#f0c9a0'];

/** גוון עור יציב לפי מזהה — כדי שכל יחידה תיראה עקבית לאורך המשחק. */
export function skinFor(id: number): string {
  return SKIN_TONES[Math.abs(id * 2654435761) % SKIN_TONES.length];
}

/**
 * ממיר כיוון תנועה בעולם לזווית על המסך.
 * בהיטל איזומטרי כיוון (dx,dy) ממופה ל-(dx-dy, (dx+dy)/2).
 */
export function screenAngleOf(worldFacing: number): number {
  const dx = Math.cos(worldFacing);
  const dy = Math.sin(worldFacing);
  return Math.atan2((dx + dy) / 2, dx - dy);
}

/** מספר כיווני הפנייה הנתמכים. */
export const DIRECTIONS = 8;

/** ממפה זווית מסך לאחד משמונה הכיוונים. */
export function directionIndex(screenAngle: number): number {
  const t = (screenAngle / (Math.PI * 2) + 1) % 1;
  return Math.round(t * DIRECTIONS) % DIRECTIONS;
}

/** זווית המסך המייצגת של כיוון בדיד. */
export function angleOfDirection(dir: number): number {
  return (dir / DIRECTIONS) * Math.PI * 2;
}

/**
 * מצייר דמות במיקום עולם (wx,wy) על גובה z.
 *
 * `screenAngle` הוא הכיוון שאליו הדמות פונה **על המסך**. ממנו נגזרים
 * שני גורמים רציפים: `fwd` (‎+1 פונה אל הצופה, ‎-1 מפנה גב) ו-`lat`
 * (‎+1 ימינה, ‎-1 שמאלה). רוחב הכתפיים, מרווח הרגליים, מיקום הידיים
 * והאם רואים פנים — כולם נגזרים מהם, כך שמתקבלים שמונה כיוונים
 * משכנעים בלי לצייר שמונה ספרייטים ביד.
 */
export function drawPerson(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  wx: number,
  wy: number,
  z: number,
  style: PersonStyle,
  action: Action,
  phase: number,
  screenAngle: number,
  scale = 1,
  withShadow = true,
): void {
  const base = cam.worldToScreen(wx, wy, z);
  const u = cam.zoom * 0.66 * scale;
  if (u < 3) {
    ctx.fillStyle = style.cloth;
    ctx.fillRect(base.x - u * 0.3, base.y - u * 0.6, u * 0.6, u * 0.6);
    return;
  }

  // fwd: +1 פונה אלינו, -1 מפנה גב. lat: +1 ימינה, -1 שמאלה.
  const fwd = Math.sin(screenAngle);
  const lat = Math.cos(screenAngle);
  const side = Math.abs(lat); // כמה רואים פרופיל
  const facingUs = fwd > 0;
  const dirSign = lat >= 0 ? 1 : -1;

  const t = phase * Math.PI * 2;
  const walking = action === 'walk' || action === 'carry';
  const swing = walking ? Math.sin(t) : 0;
  const bob = walking ? Math.abs(Math.cos(t)) * u * 0.05 : 0;

  let workArm = 0;
  if (action === 'chop' || action === 'mine' || action === 'build' || action === 'fight') {
    workArm = Math.sin(phase * Math.PI * 2);
  } else if (action === 'farm') {
    workArm = Math.sin(phase * Math.PI * 2) * 0.5 - 0.3;
  }

  const px = (dx: number, dy: number) => ({ x: base.x + dx, y: base.y + dy - bob });

  const legTop = -u * 0.44;
  const bodyTop = -u * 0.78;
  const headR = u * 0.15;
  // כתפיים רחבות כשרואים חזית/גב, צרות בפרופיל
  const half = u * (0.1 + 0.08 * (1 - side));

  if (withShadow) {
    drawCastShadowEllipse(ctx, cam, wx, wy, 0.22 * scale, 0.8 * scale);
  }

  const legColor = shade(style.accent, -0.1);
  const lw = Math.max(1, u * 0.11);
  ctx.lineCap = 'round';

  // ===== רגליים =====
  // בפרופיל הרגליים מתנדנדות קדימה ואחורה; בחזית הן זזות הצידה
  ctx.lineWidth = lw;
  ctx.strokeStyle = legColor;
  const legSpread = half * 0.55;
  const stepFwd = swing * u * 0.16 * side * dirSign;
  const stepSide = swing * u * 0.06 * (1 - side);
  ctx.beginPath();
  const hipL = px(-legSpread, legTop);
  const hipR = px(legSpread, legTop);
  ctx.moveTo(hipL.x, hipL.y);
  const footL = px(-legSpread + stepFwd + stepSide, 0);
  ctx.lineTo(footL.x, footL.y);
  ctx.moveTo(hipR.x, hipR.y);
  const footR = px(legSpread - stepFwd - stepSide, 0);
  ctx.lineTo(footR.x, footR.y);
  ctx.stroke();

  // ===== גוף =====
  const shoulderY = bodyTop + u * 0.06;
  const bodyPts = [
    px(-half, shoulderY),
    px(half, shoulderY),
    px(half * 0.82, legTop + u * 0.02),
    px(-half * 0.82, legTop + u * 0.02),
  ];
  poly(ctx, bodyPts, style.cloth, shade(style.cloth, -0.5));
  // הצללה בצד המרוחק מהשמש
  poly(ctx, [bodyPts[0], px(-half * 0.2, shoulderY), px(-half * 0.18, legTop), bodyPts[3]],
    shade(style.cloth, -0.16));

  // ===== זרועות =====
  ctx.lineWidth = lw * 0.85;
  ctx.strokeStyle = style.skin;
  const shoulder = px(0, shoulderY + u * 0.02);
  const armLift = workArm * u * 0.4;
  // יד "אחורית" — נעלמת כמעט לגמרי בפרופיל
  const backHand = px(
    -half * 1.5 * (0.4 + 0.6 * (1 - side)) - swing * u * 0.08 * side * dirSign,
    shoulderY + u * 0.26,
  );
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(backHand.x, backHand.y);
  ctx.stroke();
  // יד קדמית — נושאת את הכלי
  const frontHand = px(
    (half * 1.5 * (0.4 + 0.6 * (1 - side)) + u * 0.1 * side) * dirSign + swing * u * 0.08 * side * dirSign,
    shoulderY + u * 0.24 - armLift,
  );
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(frontHand.x, frontHand.y);
  ctx.stroke();

  if (style.tool && style.tool !== 'none') {
    drawTool(ctx, style.tool, frontHand, shoulder, u, dirSign, style);
  }

  // ===== ראש =====
  const head = px(u * 0.02 * dirSign * side, bodyTop - headR * 0.6);
  ctx.fillStyle = style.skin;
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fill();

  // גב הראש: כשמפנים גב רואים רק שיער/קסדה
  if (!facingUs) {
    ctx.fillStyle = style.hat === 'helmet' ? '#8a939c' : '#3a2a1c';
    ctx.beginPath();
    ctx.arc(head.x, head.y, headR * 0.98, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // פנים: עיניים נראות רק כשפונים אלינו, ומתעמעמות בפרופיל
    const eyeAlpha = Math.max(0, fwd) * (0.45 + 0.55 * (1 - side));
    if (eyeAlpha > 0.08) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, eyeAlpha);
      ctx.fillStyle = '#2b2420';
      const eyeDx = headR * 0.38;
      const eyeOff = headR * 0.3 * dirSign * side;
      ctx.beginPath();
      ctx.arc(head.x - eyeDx * (1 - side * 0.5) + eyeOff, head.y - headR * 0.05, headR * 0.15, 0, Math.PI * 2);
      ctx.arc(head.x + eyeDx * (1 - side * 0.5) + eyeOff, head.y - headR * 0.05, headR * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawHat(ctx, style, head, headR, dirSign);

  // ===== משא על הגב =====
  if (action === 'carry') {
    ctx.fillStyle = '#8a6a3f';
    const packX = head.x - dirSign * headR * 1.5 * side;
    const packY = head.y + headR * (facingUs ? 0.9 : 0.4);
    ctx.fillRect(packX - u * 0.09, packY, u * 0.18, u * 0.2);
  }
}

function drawTool(
  ctx: CanvasRenderingContext2D,
  tool: NonNullable<PersonStyle['tool']>,
  hand: { x: number; y: number },
  shoulder: { x: number; y: number },
  u: number,
  dir: number,
  style: PersonStyle,
): void {
  const handleLen = u * 0.42;
  const angle = Math.atan2(hand.y - shoulder.y, hand.x - shoulder.x);
  const tipX = hand.x + Math.cos(angle) * handleLen * dir * (dir > 0 ? 1 : 1);
  const tipY = hand.y + Math.sin(angle) * handleLen;

  switch (tool) {
    case 'axe':
    case 'pick':
    case 'hammer': {
      ctx.strokeStyle = '#8b6b42';
      ctx.lineWidth = Math.max(1, u * 0.06);
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = tool === 'hammer' ? '#9aa3ad' : '#c7ced6';
      const s = u * 0.13;
      ctx.fillRect(tipX - s / 2, tipY - s / 2, s, s * (tool === 'pick' ? 0.6 : 1));
      break;
    }
    case 'sickle':
      ctx.strokeStyle = '#c7ced6';
      ctx.lineWidth = Math.max(1, u * 0.06);
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, u * 0.18, 0, Math.PI * 1.2);
      ctx.stroke();
      break;
    case 'sword':
      ctx.strokeStyle = '#dfe6ee';
      ctx.lineWidth = Math.max(1, u * 0.07);
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y);
      ctx.lineTo(hand.x + dir * u * 0.34, hand.y - u * 0.3);
      ctx.stroke();
      break;
    case 'spear':
      ctx.strokeStyle = '#8b6b42';
      ctx.lineWidth = Math.max(1, u * 0.05);
      ctx.beginPath();
      ctx.moveTo(hand.x - dir * u * 0.1, hand.y + u * 0.25);
      ctx.lineTo(hand.x + dir * u * 0.22, hand.y - u * 0.55);
      ctx.stroke();
      ctx.fillStyle = '#dfe6ee';
      ctx.beginPath();
      ctx.moveTo(hand.x + dir * u * 0.22, hand.y - u * 0.62);
      ctx.lineTo(hand.x + dir * u * 0.3, hand.y - u * 0.46);
      ctx.lineTo(hand.x + dir * u * 0.15, hand.y - u * 0.46);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bow':
      ctx.strokeStyle = '#8b6b42';
      ctx.lineWidth = Math.max(1, u * 0.05);
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, u * 0.28, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
      break;
    case 'rifle':
      ctx.strokeStyle = '#2f3640';
      ctx.lineWidth = Math.max(1, u * 0.07);
      ctx.beginPath();
      ctx.moveTo(hand.x - dir * u * 0.14, hand.y + u * 0.06);
      ctx.lineTo(hand.x + dir * u * 0.34, hand.y - u * 0.06);
      ctx.stroke();
      break;
    case 'staff':
      ctx.strokeStyle = '#9a7b4f';
      ctx.lineWidth = Math.max(1, u * 0.05);
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y + u * 0.3);
      ctx.lineTo(hand.x, hand.y - u * 0.5);
      ctx.stroke();
      ctx.fillStyle = shade(style.cloth, 0.3);
      ctx.beginPath();
      ctx.arc(hand.x, hand.y - u * 0.52, u * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

function drawHat(
  ctx: CanvasRenderingContext2D,
  style: PersonStyle,
  head: { x: number; y: number },
  r: number,
  dir: number,
): void {
  switch (style.hat) {
    case 'helmet':
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath();
      ctx.arc(head.x, head.y - r * 0.15, r * 1.08, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(head.x - r * 1.1, head.y - r * 0.2, r * 2.2, r * 0.3);
      break;
    case 'cap':
      ctx.fillStyle = shade(style.accent, -0.15);
      ctx.beginPath();
      ctx.arc(head.x, head.y - r * 0.1, r * 1.02, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(head.x + (dir > 0 ? 0 : -r * 1.4), head.y - r * 0.2, r * 1.4, r * 0.22);
      break;
    case 'beret':
      ctx.fillStyle = '#6b7f4a';
      ctx.beginPath();
      ctx.ellipse(head.x - dir * r * 0.15, head.y - r * 0.5, r * 1.15, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'hood':
      ctx.fillStyle = shade(style.cloth, -0.25);
      ctx.beginPath();
      ctx.arc(head.x, head.y, r * 1.2, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
      break;
    case 'crown':
      ctx.fillStyle = '#e8c24a';
      ctx.beginPath();
      ctx.moveTo(head.x - r, head.y - r * 0.5);
      ctx.lineTo(head.x - r, head.y - r * 1.3);
      ctx.lineTo(head.x - r * 0.4, head.y - r * 0.85);
      ctx.lineTo(head.x, head.y - r * 1.45);
      ctx.lineTo(head.x + r * 0.4, head.y - r * 0.85);
      ctx.lineTo(head.x + r, head.y - r * 1.3);
      ctx.lineTo(head.x + r, head.y - r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      // שיער
      ctx.fillStyle = '#3a2a1c';
      ctx.beginPath();
      ctx.arc(head.x, head.y - r * 0.25, r * 0.95, Math.PI, 0);
      ctx.fill();
  }
}
