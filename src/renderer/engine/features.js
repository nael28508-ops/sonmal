// 손 특징 뽑기: MediaPipe 손(21개 마디) → 손가락 상태 · 방향 · 손바닥 방향 · 엄지 위치 · 거리
// - 관절 각도와 방향은 world(미터) 마디로 계산 (없으면 영상 마디로 대신)
// - 모든 방향은 수어하는 사람 기준 좌표 S (x 오른쪽, y 위, z 앞 = 카메라 쪽)
// - 왼손은 S.x 를 뒤집어서 오른손처럼 판정 (왼손잡이가 거울처럼 하는 수어를 오른손 기준 규칙으로)
import {
  sub, add, scale, dot, cross, norm, len, dist, angleBetween, mean, clamp, projectOnPlane,
  nearestDir, dirScores, RAD,
} from './geometry.js';
import { CHAINS, FINGER_NAMES, LONG_FINGERS } from './handmodel.js';

export { CHAINS };
export const FINGERS = FINGER_NAMES;

// ───────── 한국어 이름 (화면 문구용) ─────────
export const FINGER_KO = { thumb: '엄지', index: '검지', middle: '중지', ring: '약지', pinky: '소지' };
export const STATES = ['extended', 'hooked', 'bent', 'curled'];
export const STATE_KO = {
  extended: '펴짐',
  hooked: '끝 두 마디만 구부림',
  bent: '뿌리 마디만 굽힘',
  curled: '말아 쥠',
  folded: '접힘',
};
export const THUMB_POSITIONS = ['out', 'up', 'side', 'across', 'tucked', 'front'];
export const THUMB_KO = {
  out: '옆으로 벌림',
  up: '손가락 쪽으로 세움',
  side: '검지 옆에 붙임',
  across: '손바닥 쪽으로 접음',
  tucked: '손가락 안에 넣음',
  front: '앞으로 내밂',
};
export const DIR_KO = {
  up: '위쪽', down: '아래쪽', left: '왼쪽', right: '오른쪽', forward: '앞쪽(화면 쪽)', back: '뒤쪽(내 쪽)',
};
export const PALM_KO = {
  up: '위쪽', down: '아래쪽', left: '왼쪽', right: '오른쪽', forward: '화면 쪽', back: '내 쪽',
};

/** 손끝 두 개 짝 (tipDist 열쇠) */
export const TIP_PAIRS = [];
for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) TIP_PAIRS.push(`${FINGERS[i]}-${FINGERS[j]}`);
export const SPREAD_PAIRS = ['thumb-index', 'index-middle', 'middle-ring', 'ring-pinky'];

/**
 * 손가락 상태 경계 (도). 뿌리 마디(m)와 가운데 마디(q)가 경계보다 크면 "굽힘"
 * - 검지~소지: m = MCP, q = PIP 80% + DIP 20%
 * - 엄지: m = MCP, q = IP
 */
export const STATE_LIMITS = { finger: { m: 40, q: 40 }, thumb: { m: 35, q: 40 } };

export const QUALITY_LIMITS = { minSize: 0.08, maxSize: 0.55, minScore: 0.5 };
export const QUALITY_MESSAGES = {
  'no-hand': '손이 보이지 않아요. 카메라에 손을 보여 주세요.',
  'too-far': '손이 너무 작게 보여요. 카메라에 조금 더 가까이 와 주세요.',
  'too-close': '손이 너무 가까워요. 조금 뒤로 물러나 주세요.',
  'out-of-frame': '손 일부가 화면 밖으로 나갔어요. 손 전체가 보이게 해 주세요.',
  'low-score': '손이 또렷하게 보이지 않아요. 밝은 곳에서 손을 보여 주세요.',
};

const okPt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** 상태 판정용 두 값 { m, q } */
export function stateInputs(finger, j) {
  if (finger === 'thumb') return { m: j.mcp, q: j.ip };
  return { m: j.mcp, q: 0.8 * j.pip + 0.2 * j.dip };
}

/** 관절 각도 → 상태 이름 ('extended' | 'hooked' | 'bent' | 'curled') */
export function stateOf(finger, j) {
  const L = finger === 'thumb' ? STATE_LIMITS.thumb : STATE_LIMITS.finger;
  const { m, q } = stateInputs(finger, j);
  const mF = m > L.m, qF = q > L.q;
  return mF ? (qF ? 'curled' : 'bent') : qF ? 'hooked' : 'extended';
}

/**
 * 원하는 상태까지의 여유 (도). 0 이상이면 통과, 음수면 그만큼 모자람
 * @param {string} target 'extended'|'hooked'|'bent'|'curled'|'folded'
 * @param {number} tol 허용 오차 (도, + 면 너그럽게, - 면 엄격하게)
 */
export function stateMargin(finger, j, target, tol = 0) {
  const L = finger === 'thumb' ? STATE_LIMITS.thumb : STATE_LIMITS.finger;
  const { m, q } = stateInputs(finger, j);
  const mStraight = L.m + tol - m; // 뿌리 마디가 펴져 있어야 할 때 여유
  const mBent = m - (L.m - tol); // 뿌리 마디가 굽어 있어야 할 때 여유
  const qStraight = L.q + tol - q;
  const qBent = q - (L.q - tol);
  switch (target) {
    case 'extended': return Math.min(mStraight, qStraight);
    case 'hooked': return Math.min(mStraight, qBent);
    case 'bent': return Math.min(mBent, qStraight);
    case 'curled': return Math.min(mBent, qBent);
    case 'folded': return Math.max(mBent, qBent);
    default: return -Infinity;
  }
}

// 굽힘 각도: v1 → v2 로 꺾인 크기, axis 쪽으로 꺾이면(손바닥 쪽) +
function flexAngle(v1, v2, axis) {
  const a = angleBetween(v1, v2);
  return dot(cross(v1, v2), axis) < 0 ? -a : a;
}

// x 가 a→b 로 갈 때 0→1 로 오르는 경사 (a > b 면 내리막)
function ramp(x, a, b) {
  return clamp((x - a) / (b - a), 0, 1);
}

/**
 * 엄지 위치 점수 (0~1) — 손 기준 좌표로 판단
 * @param {object} g 엄지 기하 정보 (손바닥 길이 단위, 손목 원점)
 *   tip: 엄지 끝 [r, u, n] (r: 새끼 쪽 +, u: 손가락 쪽 +, n: 손바닥이 보는 쪽 +)
 *   indexR: 검지 뿌리의 r, angle: 엄지 방향이 손 축에서 엄지 쪽으로 벌어진 각도(도),
 *   straight: 엄지가 곧은 정도(0~1), fingersFront: 접힌 검지·중지 마디가 손바닥 앞으로 나온 정도
 */
export function thumbPositionScores(g) {
  const [tr, tu, tn] = g.tip;
  const rad = g.indexR - tr; // + 면 검지보다 엄지 쪽 바깥, - 면 손바닥을 가로지름
  const ulnar = -rad;
  const front = ramp(tn, 0.42, 0.62) * ramp(ulnar, 0.3, 0.15);
  const tucked = ramp(ulnar, 0.12, 0.27) * ramp(g.fingersFront - tn, 0.06, 0.16);
  const across = ramp(ulnar, 0.12, 0.27) * ramp(tn, -0.3, -0.1) * (1 - tucked) * (1 - 0.5 * front);
  const notFront = 1 - ramp(tn, 0.45, 0.65);
  const out = ramp(g.angle, 28, 42) * ramp(rad, 0.3, 0.5) * notFront;
  const up = ramp(g.angle, 32, 18) * ramp(tu, 1.04, 1.16) * ramp(rad, -0.08, 0.04) * g.straight * notFront;
  const side = ramp(rad, -0.1, 0.04) * ramp(g.angle, 55, 35) * notFront * (1 - up) * (1 - ramp(rad, 0.6, 0.8));
  return { out, up, side, across, tucked, front };
}

/** 점수 중 가장 큰 엄지 위치 (모두 0 이면 가까운 쪽으로) */
export function pickThumbPosition(scores, g) {
  let best = null;
  for (const k of THUMB_POSITIONS) if (best === null || scores[k] > scores[best]) best = k;
  if (scores[best] > 0.02) return best;
  const rad = g.indexR - g.tip[0];
  if (g.tip[2] > 0.5) return 'front';
  if (rad < -0.15) return g.fingersFront - g.tip[2] > 0.1 ? 'tucked' : 'across';
  if (g.angle > 35) return 'out';
  return g.tip[1] > 1.1 ? 'up' : 'side';
}

/**
 * MediaPipe 손 → HandFeatures (계산할 수 없으면 null)
 * @param {{landmarks: object[], world?: object[], handedness?: string, score?: number}} hand
 * @param {{aspect?: number, dominant?: 'right'|'left'}} [opts]
 */
export function extractFeatures(hand, { aspect = 16 / 9, dominant = 'right' } = {}) {
  const lm = hand && hand.landmarks;
  if (!Array.isArray(lm) || lm.length < 21 || !lm.every(okPt)) return null;
  const hasWorld = Array.isArray(hand.world) && hand.world.length >= 21 && hand.world.every(okPt);
  const label = String(hand.handedness || '').toLowerCase();
  const side = label === 'left' || label === 'right' ? label : dominant === 'left' ? 'left' : 'right';
  const mirrored = side === 'left';
  const mx = mirrored ? -1 : 1;

  // 카메라 원본 축 → S (x,y,z 모두 뒤집기, 왼손이면 x 를 한 번 더 뒤집기)
  const src = hasWorld ? hand.world : lm;
  const k = hasWorld ? 1 : aspect; // 영상 마디는 x, z 를 가로세로 비율로 맞춤
  const raw = src.map((p) => [-p.x * k * mx, -p.y, -(p.z || 0) * k]);
  const palm = dist(raw[9], raw[0]);
  if (!(palm > 1e-9)) return null;
  const W = raw[0];
  const pts = raw.map((p) => scale(sub(p, W), 1 / palm)); // 손목 원점, 손바닥 길이 단위

  // 손 기준 축: u = 손목→중지 뿌리, n = 손바닥이 보는 쪽, r = 엄지 쪽 → 새끼 쪽
  const u = norm(pts[9]);
  const nRaw = add(cross(pts[17], pts[5]), cross(pts[13], pts[5]));
  let n = norm(projectOnPlane(nRaw, u));
  if (len(n) < 0.5) n = [0, 0, 1];
  const r = cross(u, n);
  const toHand = (v) => [dot(v, r), dot(v, u), dot(v, n)];

  // ── 검지 ~ 소지 ──
  const fingers = {};
  for (const f of LONG_FINGERS) {
    const [a, b, c, d] = CHAINS[f].map((i) => pts[i]);
    const p1 = sub(b, a), p2 = sub(c, b), p3 = sub(d, c);
    const pn = dot(p1, n);
    const inPlane = sub(p1, scale(n, pn));
    const ipl = len(inPlane);
    const fwd = dot(inPlane, u);
    const mcp = Math.atan2(pn, fwd >= 0 ? ipl : -ipl) * RAD;
    const pip = flexAngle(p1, p2, r);
    const dip = flexAngle(p2, p3, r);
    let abd = 0;
    if (ipl > 0.3 * len(p1) && fwd > 0) {
      abd = Math.atan2(-dot(inPlane, r), fwd) * RAD; // + = 엄지 쪽
      if (f === 'ring' || f === 'pinky') abd = -abd; // 약지 · 소지는 새끼 쪽으로 벌어질 때 +
    }
    const dirVec = norm(sub(d, a));
    const j = { mcp, pip, dip, abd };
    fingers[f] = {
      ...j,
      state: stateOf(f, j),
      dir: nearestDir(dirVec),
      dirVec,
      curl: clamp((Math.max(0, mcp) + Math.max(0, pip) + Math.max(0, dip)) / 250, 0, 1),
    };
  }

  // ── 엄지 ──
  const [c1, t2, t3, t4] = CHAINS.thumb.map((i) => pts[i]);
  const m1 = sub(t2, c1), m2 = sub(t3, t2), m3 = sub(t4, t3);
  const md = toHand(norm(m1));
  const thumbJ = {
    cmc: 45 - Math.atan2(-md[0], md[1]) * RAD, // HandPose.thumb.cmcFlex 와 같은 뜻 (+ 면 손바닥 쪽으로)
    abd: Math.asin(clamp(md[2], -1, 1)) * RAD, // 손바닥 앞으로 들어 올린 각도 (= cmcAbd)
    mcp: angleBetween(m1, m2),
    ip: angleBetween(m2, m3),
  };
  const thumbDir = norm(sub(t4, t2));
  fingers.thumb = {
    ...thumbJ,
    state: stateOf('thumb', thumbJ),
    dir: nearestDir(thumbDir),
    dirVec: thumbDir,
    curl: clamp((thumbJ.mcp + thumbJ.ip) / 130, 0, 1),
  };

  // 엄지 위치 (손 기준)
  const td = toHand(thumbDir);
  const fingersFront = Math.max(...[6, 7, 10, 11].map((i) => dot(pts[i], n)));
  const thumbGeom = {
    tip: toHand(t4),
    indexR: dot(pts[5], r),
    angle: Math.atan2(-td[0], td[1]) * RAD,
    straight: 1 - ramp(thumbJ.mcp + thumbJ.ip, 45, 80),
    fingersFront,
  };
  const thumbScores = thumbPositionScores(thumbGeom);
  const thumbPos = pickThumbPosition(thumbScores, thumbGeom);

  // ── 손끝 거리 · 벌림 ──
  const tips = { thumb: pts[4], index: pts[8], middle: pts[12], ring: pts[16], pinky: pts[20] };
  const tipDist = {};
  for (const key of TIP_PAIRS) {
    const [a, b] = key.split('-');
    tipDist[key] = dist(tips[a], tips[b]);
  }
  const spread = {};
  for (const key of SPREAD_PAIRS) {
    const [a, b] = key.split('-');
    spread[key] = spreadAngle(fingers[a].dirVec, fingers[b].dirVec, n);
  }

  // ── 화면 위치 · 크기 (원본 영상 기준) ──
  const sx = (p) => p.x * aspect;
  const d2 = (a, b) => Math.hypot(sx(a) - sx(b), a.y - b.y);
  const palmIdx = [0, 5, 9, 13, 17];
  const cx = palmIdx.reduce((s, i) => s + lm[i].x, 0) / palmIdx.length;
  const cy = palmIdx.reduce((s, i) => s + lm[i].y, 0) / palmIdx.length;
  const size = Math.max(d2(lm[0], lm[9]), d2(lm[5], lm[17]) / 0.7);
  const inFrame = lm.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  const score = Number.isFinite(hand.score) ? hand.score : 1;

  const reasons = [];
  if (score < QUALITY_LIMITS.minScore) reasons.push('low-score');
  if (size < QUALITY_LIMITS.minSize) reasons.push('too-far');
  if (size > QUALITY_LIMITS.maxSize) reasons.push('too-close');
  if (!inFrame) reasons.push('out-of-frame');

  return {
    side,
    mirrored,
    isDominant: side === (dominant === 'left' ? 'left' : 'right'),
    score,
    fingers,
    palm: { normal: n, facing: nearestDir(n), scores: dirScores(n) },
    hand: { dir: nearestDir(u), vec: u },
    thumbPos,
    thumbScores,
    thumbGeom,
    tipDist,
    spread,
    screen: { cx, cy, size, inFrame, aspect },
    quality: { ok: reasons.length === 0, reasons },
    // 덧붙인 정보: 직접 판정(custom)이나 선생님 손 본뜨기에 씀
    points: pts, // S 좌표, 손목 원점, 손바닥 길이 단위 (왼손은 뒤집힌 상태)
    frame: { u, r, n },
    source: hasWorld ? 'world' : 'image',
  };
}

/**
 * 두 손가락 사이 벌림 각도 (도): 손바닥 평면에 내린 방향끼리 잼
 * (굽힘 정도가 달라도 옆으로 벌린 만큼만 나오게). 손가락이 손바닥 쪽으로 너무 굽어 그림자가 짧으면 3차원 각도
 */
export function spreadAngle(da, db, n) {
  const pa = projectOnPlane(da, n), pb = projectOnPlane(db, n);
  if (len(pa) < 0.35 || len(pb) < 0.35) return angleBetween(da, db);
  return angleBetween(pa, pb);
}

/** 특징에서 두 손가락 벌림 각도 (features.spread 에 없는 짝도) */
export function spreadBetween(features, a, b) {
  const k1 = `${a}-${b}`, k2 = `${b}-${a}`;
  if (features.spread[k1] !== undefined) return features.spread[k1];
  if (features.spread[k2] !== undefined) return features.spread[k2];
  return spreadAngle(features.fingers[a].dirVec, features.fingers[b].dirVec, features.palm.normal);
}

/** 두 마디(또는 손끝 이름) 사이 거리 (손바닥 길이 단위). 이름: 'index' = 검지 끝, 'index.pip', 'thumb.ip', 'palm' 등 */
export function pointOf(features, name) {
  const P = features.points;
  if (name === 'palm') return mean([0, 5, 9, 13, 17].map((i) => P[i]));
  if (name === 'wrist') return P[0];
  const [f, part = 'tip'] = String(name).split('.');
  const chain = CHAINS[f];
  if (!chain) return null;
  const idx = f === 'thumb'
    ? { cmc: 0, mcp: 1, ip: 2, tip: 3 }[part]
    : { mcp: 0, pip: 1, dip: 2, tip: 3 }[part];
  return idx === undefined ? null : P[chain[idx]];
}

/** 손끝(또는 마디) 사이 거리 — features.tipDist 에 없는 짝도 계산 */
export function pointDistance(features, a, b) {
  const key = `${a}-${b}`, rev = `${b}-${a}`;
  if (features.tipDist[key] !== undefined) return features.tipDist[key];
  if (features.tipDist[rev] !== undefined) return features.tipDist[rev];
  const pa = pointOf(features, a), pb = pointOf(features, b);
  return pa && pb ? dist(pa, pb) : NaN;
}

/** 손 품질 이유 → 안내 문구 */
export function qualityMessage(features) {
  if (!features) return QUALITY_MESSAGES['no-hand'];
  const r = features.quality.reasons[0];
  return r ? QUALITY_MESSAGES[r] : '';
}

/**
 * 한 화면(HandFrame)의 손들 중에서 판정할 손 고르기
 * 주로 쓰는 손(dominant)과 같은 쪽 손 → 없으면 가장 크게 보이는 손
 */
export function pickHand(hands, { dominant = 'right', aspect = 16 / 9 } = {}) {
  if (!Array.isArray(hands) || !hands.length) return null;
  const want = dominant === 'left' ? 'left' : 'right';
  const same = hands.filter((h) => String(h.handedness || '').toLowerCase() === want);
  const pool = same.length ? same : hands;
  let best = null, bestSize = -1;
  for (const h of pool) {
    const lm = h.landmarks;
    if (!Array.isArray(lm) || lm.length < 21) continue;
    const s = Math.hypot((lm[9].x - lm[0].x) * aspect, lm[9].y - lm[0].y);
    if (s > bestSize) { best = h; bestSize = s; }
  }
  return best;
}
