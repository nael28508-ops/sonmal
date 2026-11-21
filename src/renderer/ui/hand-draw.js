// 손 그림 잇기: ui/hand-render.js (drawReferenceHand · drawLiveHand)를 불러와 쓰고,
// 아직 없으면 아주 단순한 선 그림으로 대신 그림
import { loadHandRender } from '../core/optional.js';
import { poseToS } from '../engine/handmodel.js';

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const FINGER_OF = (i) => (i <= 4 ? 'thumb' : i <= 8 ? 'index' : i <= 12 ? 'middle' : i <= 16 ? 'ring' : 'pinky');
const COLORS = { ok: '#3fd47f', bad: '#ff6b55', na: '#b8c4c8' };

let impl = null;
export const handRenderReady = loadHandRender().then((m) => {
  impl = m;
  return m;
});

/** 카메라 위에 지금 손 그리기 (화면은 거울처럼: x → 1 - x) */
export function drawLive(ctx, hand, evaluation, opts) {
  if (impl && impl.drawLiveHand) return impl.drawLiveHand(ctx, hand, evaluation, opts);
  if (!hand || !hand.landmarks) return;
  const { width: W, height: H } = opts;
  const pt = (p) => [(1 - p.x) * W, p.y * H];
  const fs = (evaluation && evaluation.fingerStatus) || {};
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, W / 220);
  for (const [a, b] of BONES) {
    const f = a === 0 && b !== 1 && b !== 5 ? null : FINGER_OF(b);
    ctx.strokeStyle = f ? COLORS[fs[f] || 'na'] : COLORS.na;
    const [x1, y1] = pt(hand.landmarks[a]);
    const [x2, y2] = pt(hand.landmarks[b]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  for (const p of hand.landmarks) {
    const [x, y] = pt(p);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.5, W / 320), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 참고 손 그리기 (거울에 비친 내 손처럼). pose: HandPose */
export function drawReference(ctx, pose, opts) {
  if (impl && impl.drawReferenceHand) return impl.drawReferenceHand(ctx, pose, opts);
  const { width: W, height: H } = opts;
  const S = poseToS(pose);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of S) {
    const x = p[0] ?? p.x, y = p[1] ?? p.y;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const s = Math.min((W * 0.8) / (maxX - minX || 1), (H * 0.8) / (maxY - minY || 1));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const pt = (p) => [W / 2 + ((p[0] ?? p.x) - cx) * s, H / 2 - ((p[1] ?? p.y) - cy) * s];
  ctx.lineCap = 'round';
  ctx.strokeStyle = opts.color || '#0b7a70';
  ctx.lineWidth = Math.max(6, W / 24);
  for (const [a, b] of BONES) {
    const [x1, y1] = pt(S[a]);
    const [x2, y2] = pt(S[b]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

/**
 * 크기가 바뀌어도 선명한 캔버스: fitCanvas(canvas) → { ctx, width, height } (CSS 픽셀 단위로 그리면 됨)
 */
export function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr));
  const hgt = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, width: r.width, height: r.height };
}
