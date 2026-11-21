// 모든 글자의 참고 손 그림 + 실시간 손 뼈대 예시를 캔버스에 그려 window.__result 로 넘김
import { LETTERS } from '../../src/renderer/engine/letters.js';
import { drawReferenceHand, drawLiveHand } from '../../src/renderer/ui/hand-render.js';
import { poseToHand, normalizePose } from '../../src/renderer/engine/handmodel.js';
import { extractFeatures } from '../../src/renderer/engine/features.js';
import { evaluate } from '../../src/renderer/engine/rules.js';

const params = new URLSearchParams(location.search);
const only = params.get('only') || window.__only || null;

function grid(list, { cols = 9, cw = 200, ch = 236, side = 'right' } = {}) {
  const rows = Math.ceil(list.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * cw;
  c.height = rows * ch;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  list.forEach((l, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    ctx.strokeStyle = '#d0d7de';
    ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    const r = drawReferenceHand(ctx, l, { x: x + 6, y: y + 30, width: cw - 12, height: ch - 40, side });
    if (l.startPose) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x + cw - 74, y + 4, 70, 78);
      drawReferenceHand(ctx, l.startPose, { x: x + cw - 74, y: y + 4, width: 70, height: 78, shadow: false, side });
      ctx.fillStyle = '#0f766e';
      ctx.font = 'bold 18px "Malgun Gothic", sans-serif';
      ctx.fillText('→', x + cw - 96, y + 46);
      ctx.restore();
    }
    ctx.fillStyle = '#111';
    ctx.font = 'bold 22px "Malgun Gothic", sans-serif';
    ctx.fillText(l.glyph, x + 8, y + 26);
    ctx.font = '13px "Malgun Gothic", sans-serif';
    ctx.fillStyle = '#555';
    ctx.fillText(`${l.name} · ${r.palmVisible ? '손바닥' : '손등'}${l.motion ? ' · ' + l.motion.type : ''}`, x + 8 + ctx.measureText(l.glyph).width * 1.9 + 6, y + 24);
  });
  return c.toDataURL('image/png');
}

// 실시간 뼈대 예시: ㄷ 에서 약지를 편 손 (약지 = 틀림 점선)
function live() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 360;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, c.width, c.height);
  const l = LETTERS.find((x) => x.id === 'ㄷ');
  const p = normalizePose(l.pose);
  p.ring = { mcp: 3, pip: 4, dip: 2, abd: 10 };
  const hand = poseToHand(p, { center: [0.5, 0.5], size: 0.35 });
  const ev = evaluate(l, extractFeatures(hand));
  drawLiveHand(ctx, hand, ev, { videoW: 1280, videoH: 720, fit: 'cover' });
  ctx.fillStyle = '#fff';
  ctx.font = '18px "Malgun Gothic", sans-serif';
  ctx.fillText(`ㄷ 판정: ${ev.worst ? ev.worst.msg : '통과'}`, 12, 28);
  return c.toDataURL('image/png');
}

try {
  const list = only ? LETTERS.filter((l) => only.split(',').includes(l.id)) : LETTERS;
  window.__result = {
    images: { 'letters-grid': grid(list), 'letters-grid-left': grid(list.slice(0, 18), { side: 'left' }), 'live-hand': live() },
  };
} catch (e) {
  console.error(e);
  window.__result = { images: {}, error: String(e && e.stack || e) };
}
