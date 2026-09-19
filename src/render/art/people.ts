import type { Camera } from '../camera';
import { poly, shade } from '../iso';

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
 * מצייר דמות במיקום עולם (wx,wy) על גובה z.
 * `facing` הוא זווית תנועה ברדיאנים בעולם; משמשת להיפוך צדדי.
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
  facing: number,
  scale = 1,
): void {
  const base = cam.worldToScreen(wx, wy, z);
  // גובה דמות ≈ 0.85 אריח
  const u = cam.zoom * 0.66 * scale; // יחידת מידה אנכית
  if (u < 3) {
    // זום רחוק מאוד — נקודה צבעונית בלבד, חוסך זמן ציור
    ctx.fillStyle = style.cloth;
    ctx.fillRect(base.x - u * 0.3, base.y - u * 0.6, u * 0.6, u * 0.6);
    return;
  }

  // כיוון: ימינה אם היחידה נעה לכיוון +x או -y
  const dirX = Math.cos(facing);
  const dirY = Math.sin(facing);
  const screenDir = dirX - dirY >= 0 ? 1 : -1;

  const t = phase * Math.PI * 2;
  const walking = action === 'walk' || action === 'carry';
  const swing = walking ? Math.sin(t) : 0;
  const bob = walking ? Math.abs(Math.cos(t)) * u * 0.05 : 0;

  // מחזור עבודה: זרועות מונפות ויורדות
  let workArm = 0;
  if (action === 'chop' || action === 'mine' || action === 'build' || action === 'fight') {
    workArm = Math.sin(phase * Math.PI * 2);
  } else if (action === 'farm') {
    workArm = Math.sin(phase * Math.PI * 2) * 0.5 - 0.3;
  }

  const px = (dx: number, dy: number) => ({ x: base.x + dx * screenDir, y: base.y + dy - bob });

  const legTop = -u * 0.44;
  const bodyTop = -u * 0.78;
  const headR = u * 0.15;

  // ===== צל =====
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#0a1508';
  ctx.beginPath();
  ctx.ellipse(base.x, base.y, u * 0.24, u * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const legColor = shade(style.accent, -0.1);
  const lw = Math.max(1, u * 0.11);

  // ===== רגליים =====
  ctx.lineCap = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = legColor;
  const legSwing = swing * u * 0.16;
  ctx.beginPath();
  const hip = px(0, legTop);
  ctx.moveTo(hip.x, hip.y);
  const footA = px(legSwing, 0);
  ctx.lineTo(footA.x, footA.y);
  ctx.moveTo(hip.x, hip.y);
  const footB = px(-legSwing, 0);
  ctx.lineTo(footB.x, footB.y);
  ctx.stroke();

  // ===== גוף =====
  const shoulderY = bodyTop + u * 0.06;
  const bodyPts = [
    px(-u * 0.15, shoulderY),
    px(u * 0.15, shoulderY),
    px(u * 0.12, legTop + u * 0.02),
    px(-u * 0.12, legTop + u * 0.02),
  ];
  poly(ctx, bodyPts, style.cloth, shade(style.cloth, -0.5));
  // הצללה בצד שמאל של הגוף
  poly(ctx, [bodyPts[0], px(-u * 0.04, shoulderY), px(-u * 0.03, legTop), bodyPts[3]], shade(style.cloth, -0.16));

  // ===== זרועות =====
  ctx.lineWidth = lw * 0.85;
  ctx.strokeStyle = style.skin;
  const shoulder = px(0, shoulderY + u * 0.02);
  // זרוע אחורית
  const backHand = px(-u * 0.2 - swing * u * 0.1, shoulderY + u * 0.26);
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(backHand.x, backHand.y);
  ctx.stroke();
  // זרוע קדמית — מונפת בעבודה
  const armLift = workArm * u * 0.4;
  const frontHand = px(u * 0.26 + swing * u * 0.1, shoulderY + u * 0.24 - armLift);
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(frontHand.x, frontHand.y);
  ctx.stroke();

  // ===== כלי עבודה =====
  if (style.tool && style.tool !== 'none') {
    drawTool(ctx, style.tool, frontHand, shoulder, u, screenDir, style);
  }

  // ===== ראש =====
  const head = px(u * 0.02, bodyTop - headR * 0.6);
  ctx.fillStyle = style.skin;
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fill();

  // ===== כובע =====
  drawHat(ctx, style, head, headR, screenDir);

  // ===== משא =====
  if (action === 'carry') {
    ctx.fillStyle = '#8a6a3f';
    const packX = head.x - screenDir * headR * 1.6;
    ctx.fillRect(packX - u * 0.09, head.y + headR * 0.4, u * 0.18, u * 0.2);
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
