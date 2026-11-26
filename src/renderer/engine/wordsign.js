// 단어 수어 판정 · 시연 엔진 (화면 없이 Node 에서도 돔)
// - 단어 = 처음 모양(+ 몸 위치) → 움직임 → (끝 모양) 의 단계로 봄
// - 몸 위치는 얼굴 상자(MediaPipe FaceDetector)를 기준으로 셈: B 좌표 (word-shapes.js 참고)
// - 단계(tier): 'judged' = 모양 · 위치 · 움직임을 모두 판정 / 'follow' = 보고 따라 하기 (처음 모양 · 위치만 너그럽게)
// - 표정(비수지 신호)은 판정하지 않음 (안내 문구로만 알려 줌)
import { SHAPES, LOCS, CONTACT_INDEX, PALM_POINTS, judgeShape, shapePose, palmVector, axisVector, orientText } from './word-shapes.js';
import { extractFeatures } from './features.js';
import { poseToHand, lerpPose } from './handmodel.js';
import { angleBetween } from './geometry.js';
import { countStrokes } from './motion.js';

// 같은 프레임을 여러 단어로 볼 때(시험 · 혼동 확인) 손 특징을 다시 계산하지 않게
const featCache = new WeakMap();
function featuresOf(hand, aspect, dominant) {
  const key = aspect + dominant;
  const hit = featCache.get(hand);
  if (hit && hit.key === key) return hit.f;
  const f = extractFeatures(hand, { aspect, dominant });
  featCache.set(hand, { key, f });
  return f;
}

// ───────── 단어 정의 풀기 ─────────
/** 'fist f:d chin@pinky' → { shape, orient, loc, contact } ('-' 는 앞 값 그대로) */
export function parseHand(str, prev = null) {
  if (!str) return null;
  const [shape = '-', orient = '-', locRaw = '-'] = String(str).trim().split(/\s+/);
  const [loc, contact] = locRaw.split('@');
  const p = prev || {};
  const out = {
    shape: shape === '-' ? p.shape : shape,
    orient: orient === '-' ? p.orient : orient,
    loc: loc === '-' ? p.loc : loc,
    contact: contact || (loc === '-' ? p.contact : null) || null,
  };
  if (!out.contact) out.contact = (SHAPES[out.shape] && SHAPES[out.shape].contact) || 'palm';
  return out;
}

/** 'down:0.6' → { type: 'down', d: 0.6 } */
export function parseMove(str = 'hold') {
  const [type, d] = String(str).split(':');
  return { type, d: d ? Number(d) : null };
}

export const MOVE_TYPES = ['down', 'up', 'left', 'right', 'fwd', 'back', 'tap2', 'shake', 'shakeY', 'circle', 'apart', 'together', 'alt', 'twist', 'change', 'hold'];

/** 움직임 이름 → 쉬운 한국어 */
export const MOVE_KO = {
  down: '아래로 내리기', up: '위로 올리기', left: '왼쪽으로 옮기기', right: '오른쪽으로 옮기기',
  fwd: '앞(보는 사람 쪽)으로 내밀기', back: '몸 쪽으로 당기기', tap2: '두 번 대기 · 두드리기', shake: '좌우로 흔들기',
  shakeY: '위아래로 흔들기', circle: '돌리기(원 그리기)', apart: '두 손을 양옆으로 벌리기', together: '두 손을 가운데로 모으기',
  alt: '두 손을 위아래로 엇갈리게 움직이기', twist: '손목 돌리기', change: '손 모양 바꾸기', hold: '그대로 멈추기',
};
const MOVE_HINT = {
  down: '손을 아래로 내려 주세요', up: '손을 위로 올려 주세요', left: '손을 왼쪽으로 옮겨 주세요', right: '손을 오른쪽으로 옮겨 주세요',
  fwd: '손을 앞으로(화면 쪽으로) 내밀어 주세요', back: '손을 몸 쪽으로 당겨 주세요', tap2: '두 번 톡톡 대 주세요', shake: '손을 좌우로 흔들어 주세요',
  shakeY: '손을 위아래로 흔들어 주세요', circle: '손을 둥글게 돌려 주세요', apart: '두 손을 양옆으로 벌려 주세요', together: '두 손을 가운데로 모아 주세요',
  alt: '두 손을 위아래로 엇갈리게 움직여 주세요', twist: '손목을 돌려 주세요', change: '손 모양을 바꿔 주세요', hold: '그대로 잠깐 멈춰 주세요',
};
const DEFAULT_D = { down: 0.45, up: 0.45, left: 0.35, right: 0.35 };

/**
 * 단어 데이터(words-data.js 의 한 항목) → 판정 · 시연에 쓰는 모양
 * @returns {{ id, hands: 1|2, tier, start: {R, L}, end: {R, L}, mv, palm, segments: [...] }}
 */
export function compileWord(word) {
  if (word && word._compiled) return word._compiled;
  const seg = (s, prevSeg = null) => {
    const R = parseHand(s.R, prevSeg ? null : null);
    const L = s.L ? parseHand(s.L) : null;
    const R2 = s.R2 ? parseHand(s.R2, R) : null;
    const L2 = s.L2 ? parseHand(s.L2, L) : null;
    return { R, L, R2, L2, mv: parseMove(s.mv) };
  };
  const spec = word.spec || {};
  const first = seg(spec);
  const segments = [first];
  if (spec.seg2) segments.push(seg(spec.seg2, first));
  const c = {
    id: word.id,
    hands: first.L ? 2 : 1,
    tier: word.tier === 'judged' ? 'judged' : 'follow',
    start: { R: first.R, L: first.L },
    end: { R: first.R2, L: first.L2 },
    mv: first.mv,
    palm: !!spec.palm,
    segments,
  };
  // 끝 모양을 따로 볼지: 모양이 바뀌는 단어만
  c.endShape = first.R2 && first.R2.shape !== first.R.shape ? first.R2.shape : null;
  if (word && typeof word === 'object') Object.defineProperty(word, '_compiled', { value: c, enumerable: false });
  return c;
}

// ───────── 몸 좌표 (B) ─────────
/**
 * 원본 영상 좌표 점 → B 좌표 (얼굴 가운데 원점, 얼굴 높이 단위, x = 수어하는 사람의 오른쪽)
 * @param {{x:number,y:number}} p 원본 영상 0~1 좌표
 * @param {{cx:number, cy:number, h:number}} face 얼굴 상자 (원본 영상 0~1, h 는 영상 높이 대비)
 * @param {number} aspect 영상 가로/세로
 * @param {boolean} mirrored 왼손잡이(왼손 기준)면 x 를 뒤집음
 */
export function toBody(p, face, aspect = 16 / 9, mirrored = false) {
  const x = (-(p.x - face.cx) * aspect) / face.h;
  return { x: mirrored ? -x : x, y: -(p.y - face.cy) / face.h };
}

/** B 좌표 → 원본 영상 좌표 (toBody 의 거꾸로) */
export function fromBody(b, face, aspect = 16 / 9, mirrored = false) {
  const bx = mirrored ? -b.x : b.x;
  return { x: face.cx - (bx * face.h) / aspect, y: face.cy - b.y * face.h };
}

/** 손에서 닿는 점(원본 영상 좌표) */
export function contactPoint(hand, contact = 'palm') {
  const lm = hand.landmarks;
  if (contact === 'palm' || !(contact in CONTACT_INDEX)) {
    let x = 0, y = 0;
    for (const i of PALM_POINTS) { x += lm[i].x; y += lm[i].y; }
    return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
  }
  const p = lm[CONTACT_INDEX[contact]];
  return { x: p.x, y: p.y };
}

/** 손 크기 (영상 높이 대비 손바닥 길이) — 앞뒤로 움직였는지 볼 때 씀 */
export function handSize(hand, aspect = 16 / 9) {
  const a = hand.landmarks[0], b = hand.landmarks[9];
  return Math.hypot((b.x - a.x) * aspect, b.y - a.y);
}

/** 두 자리 거리 판정 */
export function locationCheck(bodyPt, locId, strictness = 'normal') {
  const L = LOCS[locId];
  if (!L || !bodyPt) return { ok: null, dist: null };
  const k = strictness === 'lenient' ? 1.3 : strictness === 'strict' ? 0.8 : 1;
  const d = Math.hypot(bodyPt.x - L.x, bodyPt.y - L.y);
  return { ok: d <= L.r * k, dist: d, dx: L.x - bodyPt.x, dy: L.y - bodyPt.y };
}

/** 위치 고칠 점 문구 ("손을 조금 위로 올려 턱에 대 주세요") */
function locationMsg(locId, r) {
  const L = LOCS[locId];
  if (!L) return '';
  if (!r || r.dx === undefined) return `손을 ${L.name} 쪽으로 가져가 주세요`;
  const parts = [];
  if (Math.abs(r.dy) > Math.abs(r.dx) * 0.7) parts.push(r.dy > 0 ? '위로' : '아래로');
  if (Math.abs(r.dx) > Math.abs(r.dy) * 0.7) parts.push(r.dx > 0 ? '오른쪽으로' : '왼쪽으로');
  return `손을 ${parts.join(' ')} 옮겨 ${josaE(L.name)} 가져가 주세요`;
}
const josaE = (w) => `${w}${/[가-힣]$/.test(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 ? '으로' : '로'}`.replace(/(.)\s*으로$/, '$1으로');

// ───────── 시연 · 합성 손 (대본) ─────────
const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, t) => a + (b - a) * t;
const add2 = (a, d) => ({ x: a.x + d.x, y: a.y + d.y });

/** 손 하나의 자리 (B 좌표). 두 손이 같은 자리면 살짝 떨어뜨림 */
function placeOf(hand, side, twoSame) {
  const L = LOCS[hand.loc] || LOCS.front;
  const off = twoSame ? (side === 'R' ? 0.24 : -0.24) : 0;
  return { x: L.x + off, y: L.y };
}

/**
 * 한 구간의 장면 목록 [{ t, R: {shape, orient, pos, size, contact}, L }]
 * size 는 손바닥 길이(얼굴 높이 단위) 배율, 앞으로 내밀면 커짐
 */
function segmentKeys(seg) {
  const two = !!seg.L;
  const same = two && seg.L.loc === seg.R.loc;
  const R0 = { ...seg.R, pos: placeOf(seg.R, 'R', same), k: 1 };
  const L0 = two ? { ...seg.L, pos: placeOf(seg.L, 'L', same), k: 1 } : null;
  const R1 = seg.R2 ? { ...seg.R2, pos: seg.R2.loc !== seg.R.loc ? placeOf(seg.R2, 'R', false) : R0.pos, k: 1 } : { ...R0 };
  const L1 = two ? (seg.L2 ? { ...seg.L2, pos: seg.L2.loc !== seg.L.loc ? placeOf(seg.L2, 'L', false) : L0.pos, k: 1 } : { ...L0 }) : null;
  const { type } = seg.mv;
  const d = seg.mv.d ?? DEFAULT_D[type] ?? 0.45;
  const keys = [{ t: 0, R: R0, L: L0 }, { t: 500, R: R0, L: L0 }];
  const at = (t, r, l) => keys.push({ t, R: r, L: l });
  const mv = (h, dx, dy, k = 1) => h && { ...h, pos: add2(h.pos, { x: dx, y: dy }), k: (h.k || 1) * k };
  const end = 500;
  if (['down', 'up', 'left', 'right'].includes(type)) {
    const v = { down: [0, -d], up: [0, d], left: [-d, 0], right: [d, 0] }[type];
    const r1 = seg.R2 && seg.R2.loc !== seg.R.loc ? R1 : mv(R1, v[0], v[1]);
    const l1 = two ? (seg.L2 && seg.L2.loc !== seg.L.loc ? L1 : seg.L2 || seg.mv.both !== false ? mv(L1, v[0], v[1]) : L1) : null;
    // 왼손이 받침(가만히 있는 손)이면 움직이지 않음: 오른손 · 왼손 모양이 다르면 받침으로 봄
    const lStill = two && seg.L.shape !== seg.R.shape && !seg.L2;
    at(end + 900, r1, lStill ? L0 : l1);
  } else if (type === 'fwd' || type === 'back') {
    const k = type === 'fwd' ? 1.3 : 0.78;
    const dy = type === 'fwd' ? -0.05 : 0.05;
    const lStill = two && seg.L.shape !== seg.R.shape;
    at(end + 800, mv(R1, 0, dy, k), two ? (lStill ? L1 : mv(L1, 0, dy, k)) : null);
  } else if (type === 'tap2' || type === 'shake' || type === 'shakeY' || type === 'alt') {
    const n = type === 'tap2' ? 2 : 3;
    const amp = type === 'tap2' ? 0.2 : 0.22;
    for (let i = 0; i < n; i++) {
      const t0 = end + i * 560;
      let r, l;
      if (type === 'shake') { r = mv(R0, amp, 0); l = mv(L0, -amp, 0); }
      else if (type === 'alt') { r = mv(R0, 0, amp); l = mv(L0, 0, -amp); }
      else { r = mv(R0, 0, amp); l = L0 && seg.L.shape === seg.R.shape ? mv(L0, 0, amp) : L0; }
      at(t0 + 280, r, l);
      if (type === 'shake') at(t0 + 560, mv(R0, -amp, 0), mv(L0, amp, 0));
      else if (type === 'alt') at(t0 + 560, mv(R0, 0, -amp), mv(L0, 0, amp));
      else at(t0 + 560, R0, L0);
    }
    if (seg.R2 || seg.L2) at(keys[keys.length - 1].t + 300, R1, L1);
  } else if (type === 'circle') {
    const r = 0.26;
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      at(end + i * 160, mv(R0, r * Math.sin(a), r * (Math.cos(a) - 1)), L0);
    }
    if (seg.R2) at(end + 8 * 160 + 400, R1, L1);
  } else if (type === 'apart' || type === 'together') {
    const s = type === 'apart' ? 1 : -1;
    const dd = seg.mv.d ?? 0.6;
    at(end + 900, mv(R1, s * dd, 0), two ? mv(L1, -s * dd, 0) : null);
  } else if (type === 'twist' || type === 'change') {
    at(end + 700, R1, L1);
  } else {
    // hold: 그대로
    at(end + 1100, R0, L0);
  }
  const last = keys[keys.length - 1];
  at(last.t + 500, last.R, last.L);
  return keys;
}

/** 단어 전체 장면 (구간을 잇고, 구간 사이에 0.35초 바뀜) */
export function wordKeyframes(word) {
  const c = compileWord(word);
  const out = [];
  let offset = 0;
  c.segments.forEach((seg, i) => {
    const keys = segmentKeys(seg);
    if (i > 0) offset += 350;
    for (const k of keys) out.push({ ...k, t: k.t + offset, seg: i });
    offset = out[out.length - 1].t;
  });
  return out;
}

/** 장면 목록에서 t ms 의 상태 (손마다 자세 섞기) */
export function keyframeAt(keys, t) {
  if (!keys.length) return null;
  if (t <= keys[0].t) return { ...keys[0], u: 0 };
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const u = smooth((t - a.t) / Math.max(1, b.t - a.t));
      const mix = (ha, hb) => {
        if (!ha || !hb) return hb || ha || null;
        return {
          ...hb,
          from: ha,
          u,
          pos: { x: lerp(ha.pos.x, hb.pos.x, u), y: lerp(ha.pos.y, hb.pos.y, u) },
          k: lerp(ha.k || 1, hb.k || 1, u),
        };
      };
      return { t, R: mix(a.R, b.R), L: mix(a.L, b.L), seg: b.seg };
    }
  }
  return { ...keys[keys.length - 1] };
}

/** 장면의 손 하나 → 손 모형 자세 (모양 · 방향이 바뀌는 중이면 섞음) */
export function handPoseAt(h, side = 'right') {
  const p1 = shapePose(h.shape, h.orient, side);
  if (h.from && h.u < 1 && (h.from.shape !== h.shape || h.from.orient !== h.orient)) {
    return lerpPose(shapePose(h.from.shape, h.from.orient, side), p1, h.u);
  }
  return p1;
}

/** 합성 얼굴 상자 (원본 영상 0~1): 화면 위쪽 가운데 */
export const SYNTH_FACE = Object.freeze({ cx: 0.5, cy: 0.25, w: 0.2 * (9 / 16), h: 0.2, score: 0.95 });
/** 손바닥 길이 ÷ 얼굴 상자 높이 (어른 손 약 9 cm, 얼굴 상자 약 16 cm) */
export const PALM_PER_FACE = 0.58;

/**
 * 합성 손 인식 프레임 하나 (카메라 없이 시험 · 시연)
 * @returns {{ t, videoW, videoH, hands, face, source }}
 */
export function syntheticWordFrame(word, t, { keys = null, videoW = 1280, videoH = 720, face = SYNTH_FACE, jitter = null } = {}) {
  const aspect = videoW / videoH;
  const ks = keys || wordKeyframes(word);
  const st = keyframeAt(ks, t);
  const hands = [];
  for (const [key, side] of [['R', 'right'], ['L', 'left']]) {
    const h = st && st[key];
    if (!h) continue;
    const pose = handPoseAt(h, side);
    const size = face.h * PALM_PER_FACE * (h.k || 1);
    const hand = poseToHand(pose, { center: [0.5, 0.5], size, aspect, side });
    // 닿는 점이 목표 자리에 오도록 옮김
    const target = fromBody(h.pos, face, aspect);
    const cp = contactPoint(hand, h.contact);
    let dx = target.x - cp.x, dy = target.y - cp.y;
    if (jitter) { dx += jitter() * 0.004; dy += jitter() * 0.004; }
    for (const p of hand.landmarks) { p.x += dx; p.y += dy; }
    hands.push(hand);
  }
  return { t, videoW, videoH, hands, face: { ...face }, source: 'synthetic' };
}

/** 단어 시연 길이 (ms) */
export function wordDuration(word) {
  const ks = wordKeyframes(word);
  return ks.length ? ks[ks.length - 1].t : 0;
}

// ───────── 판정기 (단계 상태 기계) ─────────
const START_HOLD_MS = 250;
const HOLD_WORD_MS = 900; // 멈추는 단어: 이만큼 가만히 맞으면 성공
const FOLLOW_HOLD_MS = 600;
const MOVE_TIMEOUT_MS = 3200;
const END_TIMEOUT_MS = 1400;
const LOST_MS = 700;
const FACE_KEEP_MS = 1500;
const MOVE_SCALE = { lenient: 0.75, normal: 1, strict: 1.2 };
// 단어 수어는 지문자보다 손 모양을 한 단계 너그럽게 봄 (움직이는 중이라 모양이 흐트러지기 쉬움)
const SHAPE_LEVEL = { lenient: 'lenient', normal: 'lenient', strict: 'normal' };

/**
 * @param {{ getStrictness?: () => string, getDominant?: () => 'right'|'left' }} [o]
 * @returns {{ update(frame, word) => WordResult, reset(), readonly phase }}
 */
export function createWordJudge({ getStrictness = () => 'normal', getDominant = () => 'right' } = {}) {
  let wordId = null;
  let phase = 'start';
  let since = 0; // 처음 모양이 맞기 시작한 때
  let anchor = null; // 움직임 시작 자리
  let track = []; // 움직임 기록
  let moveAt = 0, endAt = 0;
  let lastSeen = -Infinity;
  let face = null, faceAt = -Infinity;
  let success = false;
  let doneMove = false;
  let note = '';

  function reset() {
    phase = 'start';
    since = 0;
    anchor = null;
    track = [];
    success = false;
    doneMove = false;
    note = '';
  }

  /** 프레임의 손들을 주로 쓰는 손(R) · 다른 손(L)으로 나눔 */
  function splitHands(hands, dominant) {
    const want = dominant === 'left' ? 'left' : 'right';
    let R = null, L = null;
    for (const h of hands || []) {
      const side = String(h.handedness || '').toLowerCase();
      if (side === want && !R) R = h;
      else if (!L) L = h;
      else if (!R) R = h;
    }
    if (!R && L) { R = L; L = null; }
    return { R, L };
  }

  function update(frame, word) {
    const c = compileWord(word);
    if (word.id !== wordId) { wordId = word.id; reset(); }
    const strict = getStrictness() || 'normal';
    const shapeLevel = SHAPE_LEVEL[strict] || 'lenient';
    const dominant = getDominant() === 'left' ? 'left' : 'right';
    const mirrored = dominant === 'left';
    const t = frame.t;
    const aspect = frame.videoW && frame.videoH ? frame.videoW / frame.videoH : 16 / 9;
    if (frame.face) { face = frame.face; faceAt = t; }
    else if (t - faceAt > FACE_KEEP_MS) face = null;

    const { R, L } = splitHands(frame.hands, dominant);
    const fR = R ? featuresOf(R, aspect, dominant) : null;
    const fL = L ? featuresOf(L, aspect, dominant) : null;
    if (R) lastSeen = t;

    // 지금 단계에서 볼 모양 (끝 단계면 끝 모양)
    const wantR = phase === 'end' && c.endShape ? c.endShape : c.start.R.shape;
    const sR = fR ? judgeShape(fR, wantR, shapeLevel) : null;
    const sL = c.hands === 2 && fL ? judgeShape(fL, c.start.L.shape, 'lenient') : null;
    // 손바닥 방향 (palm: true 인 단어만, 아주 너그럽게 70°)
    let palmOk = true;
    if (c.palm && fR) palmOk = orientOk(fR, c.start.R.orient);
    if (c.palm && c.hands === 2 && fL) palmOk = palmOk && orientOk(fL, c.start.L.orient);

    const bR = R && face ? toBody(contactPoint(R, c.start.R.contact), face, aspect, mirrored) : null;
    const bL = L && face && c.start.L ? toBody(contactPoint(L, c.start.L.contact), face, aspect, mirrored) : null;
    const twoSame = c.hands === 2 && c.start.L.loc === c.start.R.loc;
    const locR = bR ? locationCheck(twoSame ? { x: bR.x - 0.24, y: bR.y } : bR, c.start.R.loc, strict) : { ok: null };
    const locL = bL && c.start.L ? locationCheck(twoSame ? { x: bL.x + 0.24, y: bL.y } : bL, c.start.L.loc, 'lenient') : { ok: c.hands === 2 && face ? false : null };

    const shapeOk = !!(sR && sR.ok && palmOk && (c.hands === 1 || (sL && sL.ok)));
    const locOk = locR.ok !== false && (c.hands === 1 || locL.ok !== false);
    const startOk = shapeOk && locOk;

    // 손이 오래 안 보이면 처음부터
    if (!R && t - lastSeen > LOST_MS && phase !== 'start' && !success) reset();

    if (!success) {
      if (phase === 'start') {
        if (startOk) {
          if (!since) since = t;
          const needStill = c.tier === 'follow' ? FOLLOW_HOLD_MS : c.mv.type === 'hold' ? HOLD_WORD_MS : START_HOLD_MS;
          if (c.tier === 'judged' && c.mv.type === 'hold') {
            // 멈추는 단어는 정말 멈췄는지 (움직이는 단어를 하는 중에 지나가는 것과 구별)
            track.push({ t, b: bR || { x: 0, y: 0 }, size: handSize(R, aspect) });
            track = track.filter((s) => s.t >= t - needStill);
          }
          if (t - since >= needStill && (c.tier !== 'judged' || c.mv.type !== 'hold' || stillEnough(track, needStill))) {
            if (c.tier === 'follow' || c.mv.type === 'hold') success = true;
            else {
              phase = 'move';
              moveAt = t;
              anchor = { bR: bR || { x: 0, y: 0 }, bL, size: handSize(R, aspect), normal: fR.palm.normal };
              track = [];
            }
          }
        } else {
          since = 0;
          track = [];
        }
      } else if (phase === 'move') {
        if (R) {
          const b = face ? toBody(contactPoint(R, c.start.R.contact), face, aspect, mirrored) : null;
          const bl = L && face ? toBody(contactPoint(L, (c.start.L && c.start.L.contact) || 'palm'), face, aspect, mirrored) : null;
          track.push({ t, b, bl, size: handSize(R, aspect), normal: fR ? fR.palm.normal : null, sR });
        }
        const m = moveProgress(c, anchor, track, strict);
        if (m.done) {
          doneMove = true;
          if (c.endShape) { phase = 'end'; endAt = t; }
          else success = true;
        } else if (t - moveAt > MOVE_TIMEOUT_MS) {
          reset();
          note = '움직임이 끝나지 않았어요. 처음 모양부터 다시 해 볼까요?';
        }
      } else if (phase === 'end') {
        if (sR && sR.ok) success = true;
        else if (t - endAt > END_TIMEOUT_MS) {
          reset();
          note = '끝 모양을 만들지 못했어요. 처음부터 다시 해 볼까요?';
        }
      }
    }

    const mprog = phase === 'move' ? moveProgress(c, anchor, track, strict).progress : doneMove || success ? 1 : 0;
    const res = buildResult({ c, phase, success, sR, sL, palmOk, locR, locL, face, R, L, fR, fL, shapeOk, mprog, note, t, since });
    if (startOk || phase !== 'start') note = '';
    return res;
  }

  return { update, reset, get phase() { return phase; } };
}

/** 손 방향이 대충 맞는지 (손바닥 70° · 손끝 75° 안). 특징은 오른손 기준으로 뒤집혀 있으므로 왼손이면 목표도 뒤집음 */
function orientOk(f, orient, isLeftFrame) {
  const flip = (v) => (f.mirrored ? [-v[0], v[1], v[2]] : v);
  return angleBetween(f.palm.normal, flip(palmVector(orient))) <= 70 && angleBetween(f.hand.vec, flip(axisVector(orient))) <= 75;
}

function stillEnough(track, ms) {
  if (track.length < 3) return false;
  const xs = track.map((s) => s.b.x), ys = track.map((s) => s.b.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const ss = track.map((s) => s.size);
  return span < 0.14 && Math.max(...ss) / Math.min(...ss) < 1.08 && track[track.length - 1].t - track[0].t >= ms * 0.95;
}

/** 움직임을 얼마나 했는지 { done, progress } */
export function moveProgress(c, anchor, track, strictness = 'normal') {
  if (!anchor || !track.length) return { done: false, progress: 0 };
  const sc = MOVE_SCALE[strictness] || 1;
  const { type } = c.mv;
  const d = (c.mv.d ?? DEFAULT_D[type] ?? 0.45) * 0.6 * sc; // 시연 거리의 60% 면 됨 (너그럽게)
  const pts = track.filter((s) => s.b);
  let progress = 0;
  if (['down', 'up', 'left', 'right'].includes(type)) {
    const v = { down: [0, -1], up: [0, 1], left: [-1, 0], right: [1, 0] }[type];
    let best = 0;
    for (const s of pts) best = Math.max(best, (s.b.x - anchor.bR.x) * v[0] + (s.b.y - anchor.bR.y) * v[1]);
    progress = best / d;
  } else if (type === 'fwd' || type === 'back') {
    let best = 0;
    for (const s of track) {
      const r = s.size / anchor.size;
      best = Math.max(best, type === 'fwd' ? r - 1 : 1 - r);
    }
    progress = best / (0.14 * sc);
  } else if (type === 'tap2' || type === 'shake' || type === 'shakeY') {
    const need = type === 'tap2' ? 3 : 3;
    const minD = (type === 'tap2' ? 0.09 : 0.12) * sc;
    let n;
    if (type === 'tap2') {
      n = Math.max(countStrokes(pts.map((s) => s.b.x), minD), countStrokes(pts.map((s) => s.b.y), minD),
        countStrokes(track.map((s) => Math.log(s.size / anchor.size) * 3), minD));
    } else n = countStrokes(pts.map((s) => (type === 'shake' ? s.b.x : s.b.y)), minD);
    progress = n / need;
  } else if (type === 'alt') {
    const rel = pts.filter((s) => s.bl).map((s) => s.b.y - s.bl.y);
    progress = countStrokes(rel, 0.2 * sc) / 3;
  } else if (type === 'circle') {
    if (pts.length > 3) {
      const xs = pts.map((s) => s.b.x), ys = pts.map((s) => s.b.y);
      const rx = Math.max(...xs) - Math.min(...xs), ry = Math.max(...ys) - Math.min(...ys);
      progress = Math.min(rx, ry) / (0.3 * sc);
    }
  } else if (type === 'apart' || type === 'together') {
    const dist0 = anchor.bL ? Math.hypot(anchor.bR.x - anchor.bL.x, anchor.bR.y - anchor.bL.y) : null;
    if (dist0 !== null) {
      let best = 0;
      for (const s of pts) {
        if (!s.bl) continue;
        const dd = Math.hypot(s.b.x - s.bl.x, s.b.y - s.bl.y);
        best = Math.max(best, type === 'apart' ? dd - dist0 : dist0 - dd);
      }
      progress = best / ((c.mv.d ?? 0.6) * 1.2 * sc);
    }
  } else if (type === 'twist') {
    let best = 0;
    for (const s of track) if (s.normal) best = Math.max(best, angleBetween(s.normal, anchor.normal));
    progress = best / (50 * sc);
  } else if (type === 'change') {
    progress = 1; // 바로 끝 모양 단계로
  } else progress = 1;
  progress = Math.max(0, Math.min(1, progress));
  return { done: progress >= 1, progress };
}

/** 판정 결과 → 화면용 (모양 / 위치 / 움직임 / 끝 모양 확인 목록 + 큰 안내 하나) */
function buildResult({ c, phase, success, sR, sL, palmOk, locR, locL, face, R, L, fR, fL, shapeOk, mprog, note }) {
  const checks = [];
  const shapeName = SHAPES[c.start.R.shape].name;
  const shapeLabel = c.hands === 2 ? `모양: 오른손 ${shapeName}${c.start.L.shape !== c.start.R.shape ? ` · 왼손 ${SHAPES[c.start.L.shape].name}` : ''}` : `모양: ${shapeName}`;
  const pastStart = phase !== 'start' || success;
  let shapeMsg = '';
  if (!sR) shapeMsg = '손을 카메라에 보여 주세요';
  else if (!sR.ok && phase !== 'end') shapeMsg = sR.msg;
  else if (!palmOk) shapeMsg = `손 방향: ${orientText(c.start.R.orient)}이 되게 해 주세요`;
  else if (c.hands === 2 && !sL) shapeMsg = '두 손을 모두 보여 주세요';
  else if (c.hands === 2 && !sL.ok) shapeMsg = `다른 손: ${sL.msg}`;
  checks.push({ id: 'shape', label: shapeLabel, ok: pastStart || shapeOk, msg: shapeMsg });

  const locName = (LOCS[c.start.R.loc] || {}).name || '';
  let locState = null, locMsg = '';
  if (!face) { locState = null; locMsg = '얼굴이 안 보여서 위치는 확인하지 못해요'; }
  else if (pastStart) locState = true;
  else if (locR.ok === false) { locState = false; locMsg = locationMsg(c.start.R.loc, locR); }
  else if (c.hands === 2 && locL.ok === false) { locState = false; locMsg = '다른 손도 자리에 맞춰 주세요'; }
  else locState = locR.ok === null ? null : true;
  checks.push({ id: 'loc', label: `위치: ${locName}`, ok: locState, msg: locMsg });

  const judged = c.tier === 'judged';
  if (c.mv.type !== 'hold' || !judged) {
    checks.push({
      id: 'move', label: `움직임: ${MOVE_KO[c.mv.type]}${judged ? '' : ' (보고 따라 하기)'}`,
      ok: judged ? (success || phase === 'end' ? true : phase === 'move' ? (mprog >= 1 ? true : false) : null) : null,
      progress: mprog, judged, msg: judged && phase === 'move' ? MOVE_HINT[c.mv.type] : '',
    });
  }
  if (judged && c.endShape) {
    checks.push({ id: 'end', label: `끝 모양: ${SHAPES[c.endShape].name}`, ok: success ? true : phase === 'end' ? !!(sR && sR.ok) : null, msg: phase === 'end' && sR ? sR.msg : '' });
  }

  let msg = '', tone = 'hint';
  if (success) { msg = '잘했어요!'; tone = 'ok'; }
  else if (note) { msg = note; tone = 'hint'; }
  else if (!R) { msg = '손을 카메라에 보여 주세요'; tone = 'na'; }
  else if (phase === 'start') {
    const bad = checks.find((k) => k.ok === false);
    if (bad) { msg = bad.msg; tone = 'bad'; }
    else { msg = judged ? (c.mv.type === 'hold' ? '좋아요! 그대로 잠깐 멈춰 주세요' : '좋아요! 이제 움직여 볼까요?') : '좋아요! 그대로 잠깐 멈춰 주세요'; tone = 'ok'; }
  } else if (phase === 'move') { msg = MOVE_HINT[c.mv.type]; tone = 'hint'; }
  else if (phase === 'end') { msg = sR && !sR.ok ? `끝 모양: ${sR.msg}` : '끝 모양을 만들어 주세요'; tone = 'hint'; }

  return {
    phase, success, checks, msg, tone, face,
    hands: [R && { hand: R, fingerStatus: sR ? sR.fingerStatus : {} }, L && { hand: L, fingerStatus: sL ? sL.fingerStatus : {} }].filter(Boolean),
    features: fR, featuresL: fL, moveProgress: mprog,
    target: c.start.R.loc,
  };
}
