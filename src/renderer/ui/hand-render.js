// 손 그리기
// - drawReferenceHand: 손 모형(HandPose)이나 S 좌표 21점으로 "참고 손" 그림 (거울에 비친 내 손처럼)
//   · 화면 오른쪽 = 수어하는 사람의 오른쪽(+S.x), 화면 위 = +S.y, 보는 사람 쪽 = +S.z
//   · 살짝 위 · 옆에서 본 원근 그림 + 가까운 것부터 나중에 그리기(화가 알고리즘)
//   · 손바닥이 보이면 밝은 살색 + 손금, 손등이 보이면 조금 진한 살색 + 손톱 · 손마디 → 손바닥/손등을 색만이 아니라 모양으로 구분
// - drawLiveHand: 카메라 위에 실시간 손 뼈대 (손가락마다 맞음 초록 실선 / 틀림 빨강 점선 / 판정 안 함 회색)
import { buildHand, HAND_GEOMETRY, CHAINS, FINGER_NAMES } from '../engine/handmodel.js';
import { sub, add, scale, norm, dot, cross, len, mean, rotX, rotY, lerp } from '../engine/geometry.js';

export const REFERENCE_COLORS = {
  palm: '#f6c9a8', // 손바닥 쪽 살색
  back: '#e7a982', // 손등 쪽 살색
  outline: '#7a4a32',
  crease: 'rgba(122, 74, 50, 0.45)',
  nail: '#f5cdb9',
  nailEdge: 'rgba(122, 74, 50, 0.55)',
  knuckle: 'rgba(122, 74, 50, 0.35)',
  shadow: 'rgba(0, 0, 0, 0.10)',
};

export const LIVE_COLORS = {
  ok: '#16a34a', // 초록 (맞음)
  bad: '#e5484d', // 빨강 계열 (틀림)
  na: '#9aa3ad', // 회색 (판정 안 함)
  palm: '#e6edf3',
  joint: '#ffffff',
  outline: 'rgba(0, 0, 0, 0.55)',
};

const toArr = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z || 0]);
const isLetter = (src) => src && typeof src === 'object' && src.pose && Array.isArray(src.checks);
const isPose = (src) => src && !Array.isArray(src) && typeof src === 'object' && !Array.isArray(src.points);

/** 글자를 그릴 때 쓰는 기본 보는 각도 (글자에 refView 가 있으면 그것) */
export const DEFAULT_VIEW = Object.freeze({ yaw: -14, pitch: 12 });

// S 좌표 점만 있을 때: 마디별 뼈 방향과 "손가락 배" 방향을 어림 (손바닥 법선 기준)
function framesFromPoints(P) {
  const nRaw = add(cross(sub(P[17], P[0]), sub(P[5], P[0])), cross(sub(P[13], P[0]), sub(P[5], P[0])));
  const n = len(nRaw) > 1e-9 ? norm(nRaw) : [0, 0, 1];
  const frames = {};
  for (const f of FINGER_NAMES) {
    const c = CHAINS[f];
    for (let s = 0; s < 3; s++) {
      const x = norm(sub(P[c[s + 1]], P[c[s]]));
      // 손가락 배 ≈ 손바닥 법선에서 뼈 방향 성분을 뺀 것
      let pad = sub(n, scale(x, dot(n, x)));
      pad = len(pad) > 1e-6 ? norm(pad) : n;
      frames[c[s]] = { x, pad };
    }
  }
  return { normal: n, frames };
}

/** 그릴 손 모형 준비: 자세 → 점 · 마디 방향 · 손바닥 방향 (왼손이면 좌우 뒤집기) */
export function referenceModel(src, { side = 'right' } = {}) {
  let points, frames, normal;
  if (isPose(src)) {
    const h = buildHand(src);
    points = h.points;
    frames = h.frames;
    normal = h.normal;
  } else {
    const arr = Array.isArray(src) ? src : src.points;
    points = arr.map(toArr);
    ({ frames, normal } = framesFromPoints(points));
  }
  if (side === 'left') {
    const fx = (v) => [-v[0], v[1], v[2]];
    points = points.map(fx);
    normal = fx(normal);
    const out = {};
    for (const k of Object.keys(frames)) out[k] = { x: fx(frames[k].x), pad: fx(frames[k].pad) };
    frames = out;
  }
  return { points, frames, normal };
}

/**
 * 참고 손 그리기
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|Array} src 글자(Letter: pose · refView 를 씀) 또는 HandPose 또는 S 좌표 21점 ([x,y,z] / {x,y,z}, 손바닥 길이 단위)
 * @param {object} [opts]
 * @param {number} [opts.x=0] [opts.y=0] [opts.width] [opts.height] 그릴 상자 (기본: 캔버스 전체)
 * @param {'right'|'left'} [opts.side='right'] 왼손잡이용이면 'left' (좌우를 뒤집어 그림)
 * @param {{yaw:number, pitch:number, focal?:number}} [opts.view] 보는 각도 (도). 기본은 글자의 refView 또는 DEFAULT_VIEW. {yaw:0,pitch:0} 이면 정면(완전한 거울)
 * @param {number} [opts.zoom=1] 크기 배율 (1 = 상자에 손이 넉넉히 들어감)
 * @param {boolean} [opts.fit=false] true 면 손 모양에 맞춰 상자를 꽉 채움 (글자마다 크기가 달라짐)
 * @param {object} [opts.colors] REFERENCE_COLORS 일부 바꾸기
 * @param {boolean} [opts.shadow=true] 손 아래 옅은 그림자
 * @returns {{ palmVisible: boolean, bounds: {x:number,y:number,w:number,h:number} }}
 */
export function drawReferenceHand(ctx, src, opts = {}) {
  const W = opts.width ?? ctx.canvas.width;
  const H = opts.height ?? ctx.canvas.height;
  const ox = opts.x ?? 0, oy = opts.y ?? 0;
  const C = { ...REFERENCE_COLORS, ...(opts.colors || {}) };
  const letterView = isLetter(src) ? src.refView : null;
  if (isLetter(src)) src = src.pose;
  const view0 = opts.view || letterView || DEFAULT_VIEW;
  // 왼손 그림은 오른손 그림의 정확한 거울상이 되게 보는 각도도 좌우로 뒤집음
  const view = opts.side === 'left' ? { ...view0, yaw: -(view0.yaw || 0) } : view0;
  const model = referenceModel(src, { side: opts.side });
  const { points, frames } = model;

  // 보는 각도 적용 (점과 방향 모두)
  const V = (v) => rotX(rotY(v, view.yaw || 0), view.pitch || 0);
  const P = points.map(V);
  const center3 = mean([0, 5, 9, 13, 17, 4, 8, 12, 16, 20].map((i) => P[i]));
  const focal = view.focal || 7; // 원근: 눈까지 거리 (손바닥 길이 단위, 작을수록 가까운 것이 크게)
  const proj = (v) => {
    const d = sub(v, center3);
    const k = focal / Math.max(focal - d[2], focal * 0.4);
    return { x: d[0] * k, y: -d[1] * k, k, z: d[2] };
  };
  const Q = P.map(proj);
  const toView = [0, 0, 1];
  const G = HAND_GEOMETRY;

  // 크기와 위치: 기본은 손바닥 길이 고정 배율(글자끼리 크기 비교 쉬움), fit 이면 꽉 채움
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of Q) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
  }
  const padU = 0.22;
  const bw = maxX - minX + 2 * padU, bh = maxY - minY + 2 * padU;
  let s = opts.fit ? Math.min(W / bw, H / bh) : Math.min(W, H) / 2.9;
  if (!opts.fit) s = Math.min(s, W / bw, H / bh); // 넘치면 줄임
  s *= opts.zoom ?? 1;
  const cx = ox + W / 2 - ((minX + maxX) / 2) * s;
  const cy = oy + H / 2 - ((minY + maxY) / 2) * s;
  const S = (q) => [cx + q.x * s, cy + q.y * s];

  const palmVisible = dot(V(model.normal), toView) > 0;
  const items = [];

  // 손바닥 다각형: 손목 양옆 → 엄지 뿌리 → 검지 · 중지 · 약지 · 소지 뿌리
  const side3 = norm(sub(P[17], P[5]));
  const wristL = sub(P[0], scale(side3, 0.3));
  const wristR = add(P[0], scale(side3, 0.3));
  const palmPts = [wristL, P[1], lerp(P[1], P[2], 0.55), P[5], P[9], P[13], P[17], lerp(P[17], P[0], 0.5), wristR].map(proj);
  items.push({ kind: 'palm', z: mean([P[0], P[5], P[9], P[13], P[17]])[2], pts: palmPts });
  // 손목 (팔뚝 시작)
  const armDir = norm(sub(P[0], P[9]));
  const arm0 = proj(P[0]), arm1 = proj(add(P[0], scale(armDir, 0.32)));
  items.push({ kind: 'arm', z: -Infinity, a: arm0, b: arm1, w: 0.5 });

  // 손가락 마디 (엄지는 손바닥 안쪽 마디 1→2 도 두툼하게)
  for (const f of FINGER_NAMES) {
    const c = CHAINS[f];
    for (let k = 0; k < 3; k++) {
      const i = c[k], j = c[k + 1];
      const fr = frames[i];
      const pad = fr ? V(fr.pad) : V(model.normal);
      items.push({
        kind: 'seg', finger: f, seg: k, z: (P[i][2] + P[j][2]) / 2 + (k === 2 ? 0.02 : 0),
        a: Q[i], b: Q[j], w: G.width[f][k] * (f === 'thumb' && k === 0 ? 1.25 : 1), facing: dot(pad, toView),
        dir3: norm(sub(P[j], P[i])),
      });
    }
  }
  items.sort((p, q) => p.z - q.z);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ow = Math.max(1.5, s * 0.022); // 테두리 굵기

  if (opts.shadow !== false) {
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(cx + 0.05 * s, oy + H - Math.max(8, H * 0.05), W * 0.28, Math.max(4, H * 0.025), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const capsule = (a, b, wpx, fill) => {
    const [ax, ay] = S(a), [bx, by] = S(b);
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = wpx + 2 * ow;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx + 0.01, by); ctx.stroke();
    ctx.strokeStyle = fill;
    ctx.lineWidth = wpx;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx + 0.01, by); ctx.stroke();
  };

  for (const it of items) {
    if (it.kind === 'arm') {
      capsule(it.a, it.b, it.w * s * it.a.k, palmVisible ? C.palm : C.back);
    } else if (it.kind === 'palm') {
      const pts = it.pts.map(S);
      const fill = palmVisible ? C.palm : C.back;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 0.2 * s + 2 * ow; // 두꺼운 테두리로 모서리를 둥글게
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 0.2 * s;
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.fill();
      drawPalmMarks(ctx, P, proj, S, s, palmVisible, C);
    } else {
      const wpx = it.w * s * ((it.a.k + it.b.k) / 2);
      const fill = it.facing > 0.15 ? C.palm : C.back;
      capsule(it.a, it.b, wpx, fill);
      if (it.seg === 2) drawNail(ctx, it, S, wpx, C);
      if (it.seg === 1 && it.facing < -0.2) {
        // 손등 쪽에서 보이는 가운뎃마디 주름
        const [ax, ay] = S(it.a);
        ctx.strokeStyle = C.knuckle;
        ctx.lineWidth = Math.max(1, ow * 0.8);
        ctx.beginPath();
        ctx.arc(ax, ay, wpx * 0.28, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  return { palmVisible, bounds: { x: cx + minX * s, y: cy + minY * s, w: (maxX - minX) * s, h: (maxY - minY) * s } };
}

// 손바닥이 보이면 손금 두 줄, 손등이 보이면 손가락 뿌리 마디(너클) 표시
function drawPalmMarks(ctx, P, proj, S, s, palmVisible, C) {
  ctx.save();
  ctx.lineWidth = Math.max(1.2, s * 0.018);
  if (palmVisible) {
    ctx.strokeStyle = C.crease;
    const line = (a, ctrl, b) => {
      const [ax, ay] = S(proj(a)), [cxp, cyp] = S(proj(ctrl)), [bx, by] = S(proj(b));
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cxp, cyp, bx, by); ctx.stroke();
    };
    const pc = mean([P[0], P[5], P[9], P[13], P[17]]);
    line(lerp(P[17], P[0], 0.28), lerp(pc, P[13], 0.35), lerp(P[5], P[9], 0.15)); // 감정선
    line(lerp(P[5], P[1], 0.45), lerp(pc, P[0], 0.15), lerp(P[0], P[1], 0.35)); // 생명선
  } else {
    ctx.strokeStyle = C.knuckle;
    for (const i of [5, 9, 13, 17]) {
      const [x, y] = S(proj(P[i]));
      ctx.beginPath();
      ctx.arc(x, y, s * 0.045, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 손톱: 끝마디의 손등 쪽이 보는 사람을 향할 때만 (손등이 보이는지 바로 알 수 있게)
function drawNail(ctx, it, S, wpx, C) {
  if (it.facing > -0.35) return;
  const [ax, ay] = S(it.a), [bx, by] = S(it.b);
  const dx = bx - ax, dy = by - ay;
  const L = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const vis = Math.min(1, -it.facing); // 비스듬하면 좁게
  const along = Math.min(wpx * 0.36, L * 0.4);
  const tx = bx - (dx / (L || 1)) * along * 0.9, ty = by - (dy / (L || 1)) * along * 0.9;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(ang);
  ctx.fillStyle = C.nail;
  ctx.strokeStyle = C.nailEdge;
  ctx.lineWidth = Math.max(1, wpx * 0.06);
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(2, along), Math.max(1.5, wpx * 0.28 * vis), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ───────── 실시간 손 ─────────
const PALM_BONES = [[0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17]];

/**
 * 영상 좌표(원본 0~1) → 캔버스 좌표 바꾸개
 * @param {{width:number, height:number, videoW?:number, videoH?:number, fit?:'cover'|'contain'|'fill', mirror?:boolean}} o
 *   fit 은 CSS object-fit 과 같은 뜻 (video 요소와 같게 맞춰 주세요). mirror 기본 true (거울 화면)
 */
export function makeLandmarkMapper({ width, height, videoW, videoH, fit = 'cover', mirror = true }) {
  let sx = width, sy = height, offX = 0, offY = 0;
  if (videoW && videoH && fit !== 'fill') {
    const k = fit === 'contain' ? Math.min(width / videoW, height / videoH) : Math.max(width / videoW, height / videoH);
    sx = videoW * k; sy = videoH * k;
    offX = (width - sx) / 2; offY = (height - sy) / 2;
  }
  return (p) => [offX + (mirror ? 1 - p.x : p.x) * sx, offY + p.y * sy];
}

/**
 * 카메라 위에 실시간 손 뼈대 그리기 (캔버스는 거울 반전하지 않은 상태로 두고, 좌표만 거울처럼)
 * @param {CanvasRenderingContext2D} ctx
 * @param {{landmarks: {x,y,z}[]}} hand MediaPipe 손 (원본 영상 좌표)
 * @param {object|null} evaluation rules.evaluate 결과 (fingerStatus, palmStatus) — 없으면 모두 회색
 * @param {object} [opts] makeLandmarkMapper 의 선택 + { lineWidth, colors, showJoints=true, clear=false }
 * @returns {{ map: Function, tips: Object<string, number[]> }} 다른 그림을 얹을 때 쓸 바꾸개와 손끝 위치
 */
export function drawLiveHand(ctx, hand, evaluation = null, opts = {}) {
  const width = opts.width ?? ctx.canvas.width;
  const height = opts.height ?? ctx.canvas.height;
  if (opts.clear) ctx.clearRect(0, 0, width, height);
  const lm = hand && hand.landmarks;
  const map = makeLandmarkMapper({ ...opts, width, height });
  if (!Array.isArray(lm) || lm.length < 21) return { map, tips: {} };
  const C = { ...LIVE_COLORS, ...(opts.colors || {}) };
  const P = lm.map(map);
  const palmPx = Math.hypot(P[9][0] - P[0][0], P[9][1] - P[0][1]);
  const lw = opts.lineWidth ?? Math.max(3, Math.min(14, palmPx * 0.09));
  const status = (evaluation && evaluation.fingerStatus) || {};
  const palmStatus = (evaluation && evaluation.palmStatus) || 'na';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (a, b, color, w, dash) => {
    ctx.setLineDash([]);
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = w + 3;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  };

  // 손바닥 뼈대 (손바닥 방향 판정 결과로 색)
  const palmColor = palmStatus === 'ok' ? C.ok : palmStatus === 'bad' ? C.bad : C.palm;
  for (const [a, b] of PALM_BONES) line(P[a], P[b], palmColor, lw * 0.8, palmStatus === 'bad' ? [lw * 1.2, lw] : null);

  const tips = {};
  for (const f of FINGER_NAMES) {
    const c = CHAINS[f];
    const st = status[f] || 'na';
    const color = st === 'ok' ? C.ok : st === 'bad' ? C.bad : C.na;
    const w = st === 'na' ? lw * 0.75 : lw;
    const dash = st === 'bad' ? [lw * 1.4, lw * 1.0] : null; // 틀린 손가락은 점선 (색만으로 구분하지 않게)
    const chain = f === 'thumb' ? c : [c[0], ...c.slice(1)];
    for (let k = 0; k < chain.length - 1; k++) line(P[chain[k]], P[chain[k + 1]], color, w, dash);
    tips[f] = P[c[3]];
    if (opts.showJoints !== false) {
      for (const i of c) {
        ctx.setLineDash([]);
        ctx.fillStyle = C.joint;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, lw * 0.35);
        ctx.beginPath(); ctx.arc(P[i][0], P[i][1], lw * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // 손끝 표시: 맞음 = 채운 원, 틀림 = 빈 고리 + ✕
    const [tx, ty] = P[c[3]];
    ctx.setLineDash([]);
    if (st === 'ok') {
      ctx.fillStyle = C.ok;
      ctx.beginPath(); ctx.arc(tx, ty, lw * 0.9, 0, Math.PI * 2); ctx.fill();
    } else if (st === 'bad') {
      const r = lw * 1.3;
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = Math.max(2, lw * 0.45);
      ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx - r * 0.5, ty - r * 0.5); ctx.lineTo(tx + r * 0.5, ty + r * 0.5);
      ctx.moveTo(tx + r * 0.5, ty - r * 0.5); ctx.lineTo(tx - r * 0.5, ty + r * 0.5);
      ctx.stroke();
    }
  }
  // 손목 점
  ctx.fillStyle = C.joint;
  ctx.strokeStyle = palmColor;
  ctx.lineWidth = Math.max(1.5, lw * 0.35);
  ctx.beginPath(); ctx.arc(P[0][0], P[0][1], lw * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
  return { map, tips };
}
