// 단어 수어용 손 모양 · 몸 위치 · 손 방향 사전
// - 국립국어원 한국수어사전의 수형 설명 낱말(주먹 · 1지 · 1·5지 · 편 손 · 구부린 손 …)을 손 모형 자세와 확인 항목으로 바꿈
// - 손가락 번호는 사전과 같음: 1지 = 검지, 2지 = 중지, 3지 = 약지, 4지 = 새끼손가락, 5지 = 엄지
// - 몸 좌표 B: 얼굴 상자 가운데가 원점, 단위 = 얼굴 상자 높이, x = 수어하는 사람의 오른쪽, y = 위
//   (왼손잡이면 판정 쪽에서 x 를 뒤집어 오른손 기준 정의를 그대로 씀)
import { PRESETS, normalizePose, withPose } from './handmodel.js';
import { applyMat, eulerMatrix, angleBetween } from './geometry.js';
import { THUMB_FOLDED } from './letters.js';
import { pointDistance } from './features.js';

const F = (mcp, pip, dip, abd = 0) => ({ mcp, pip, dip, abd });
const CURL = F(88, 100, 62);
const CURL_P = F(90, 98, 60);
const STRAIGHT = (abd = 0) => F(3, 3, 2, abd);
const THUMB_OVER = { cmcFlex: 29, cmcAbd: 46, mcp: 46, ip: 39 };
const THUMB_OUT = { cmcFlex: -38, cmcAbd: 3, mcp: 0, ip: 0 };
const THUMB_UP = { cmcFlex: -20, cmcAbd: 20, mcp: 0, ip: 0 };
const HALF = F(32, 48, 30);
const P = (o) => Object.freeze(normalizePose(o));

const KO = { thumb: '엄지', index: '검지', middle: '중지', ring: '약지', pinky: '새끼손가락' };
const OBJ = { thumb: '엄지를', index: '검지를', middle: '중지를', ring: '약지를', pinky: '새끼손가락을' };
const FINGERS5 = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/**
 * 손 모양 목록
 * - sig: 엄지 · 검지 · 중지 · 약지 · 새끼 순서의 목표 상태 (E 폄, F 접음, H 살짝 구부림, B 뿌리에서 꺾음, K 끝 두 마디 구부림, * 안 봄)
 * - touch: 맞닿아야 하는 두 손끝, accept: 이 모양과 헷갈려도 맞는 걸로 칠 비슷한 모양
 * - pose: 오른손 · 손바닥 앞 · 손끝 위 기준 손 모형 자세, contact: 몸에 닿는 점 기본값
 */
export const SHAPES = {
  fist: { name: '주먹', sig: '*FFFF', pose: PRESETS.fist, contact: 'palm', accept: ['thumb'] },
  point: { name: '1지(검지)를 편 주먹', sig: 'fEFFF', pose: PRESETS.point, contact: 'index', accept: ['hook1'] },
  mid: { name: '2지(중지)를 편 주먹', sig: 'fFEFF', pose: P({ thumb: THUMB_OVER, index: CURL, middle: STRAIGHT(), ring: CURL, pinky: CURL_P }), contact: 'middle' },
  vee: { name: '1·2지를 편 주먹', sig: 'fEEFF', pose: PRESETS.vee, contact: 'index', accept: ['vthumb', 'hook2'] },
  three: { name: '1·2·3지를 편 주먹', sig: 'fEEEF', pose: P({ thumb: THUMB_OVER, index: STRAIGHT(10), middle: STRAIGHT(), ring: STRAIGHT(-8), pinky: CURL_P }), contact: 'index' },
  pinky: { name: '4지(새끼손가락)를 편 주먹', sig: 'fFFFE', pose: PRESETS.pinkyUp, contact: 'pinky' },
  thumb: { name: '5지(엄지)를 편 주먹', sig: 'EFFFF', pose: P({ thumb: THUMB_UP, index: CURL, middle: CURL, ring: CURL, pinky: CURL_P }), contact: 'thumb', accept: ['fist'] },
  ell: { name: '1·5지를 편 주먹', sig: 'EEFFF', pose: PRESETS.ell, contact: 'index', accept: ['ellBent'] },
  ellBent: { name: '1·5지를 펴서 구부린 손', sig: 'eHFFF', pose: P({ thumb: { cmcFlex: -10, cmcAbd: 30, mcp: 15, ip: 25 }, index: HALF, middle: CURL, ring: CURL, pinky: CURL_P }), contact: 'index', accept: ['hook1', 'ell'] },
  hook1: { name: '1지를 펴서 구부린 주먹', sig: 'fHFFF', pose: P({ thumb: THUMB_OVER, index: F(25, 70, 45), middle: CURL, ring: CURL, pinky: CURL_P }), contact: 'index', accept: ['ellBent', 'point'] },
  hook2: { name: '1·2지를 펴서 구부린 주먹', sig: 'fHHFF', pose: P({ thumb: THUMB_OVER, index: F(25, 70, 45, 8), middle: F(25, 70, 45, -8), ring: CURL, pinky: CURL_P }), contact: 'index', accept: ['vee'] },
  yshape: { name: '4·5지를 편 주먹', sig: 'EFFFE', pose: P({ thumb: THUMB_OUT, index: CURL, middle: CURL, ring: CURL, pinky: STRAIGHT(18) }), contact: 'thumb' },
  vthumb: { name: '1·2·5지를 편 주먹', sig: 'EEEFF', pose: P({ thumb: THUMB_OUT, index: STRAIGHT(10), middle: STRAIGHT(-10), ring: CURL, pinky: CURL_P }), contact: 'index', accept: ['vee'] },
  vpinky: { name: '1·2·4지를 편 주먹', sig: 'fEEFE', pose: P({ thumb: THUMB_OVER, index: STRAIGHT(10), middle: STRAIGHT(-8), ring: CURL, pinky: STRAIGHT(14) }), contact: 'index' },
  ring: { name: '1·5지 끝을 맞댄 동그라미', sig: '*****', touch: ['thumb', 'index'], pose: P({ thumb: { cmcFlex: 19, cmcAbd: 46, mcp: 26, ip: 13 }, index: F(45, 60, 40, 0), middle: F(40, 50, 30), ring: F(42, 50, 30), pinky: F(45, 50, 30) }), contact: 'index', accept: ['bunch'] },
  flat: { name: '편 손(손가락을 붙여 폄)', sig: '*EEEE', pose: PRESETS.flat, contact: 'palm', accept: ['open'] },
  open: { name: '손가락을 벌려 편 손', sig: 'EEEEE', pose: PRESETS.open, contact: 'palm', accept: ['flat'] },
  bent: { name: '약간 구부린 손', sig: '*HHHH', pose: P({ thumb: { cmcFlex: 10, cmcAbd: 40, mcp: 10, ip: 15 }, index: HALF, middle: HALF, ring: HALF, pinky: F(34, 48, 30) }), contact: 'middle', accept: ['bend', 'wc', 'flat', 'open'] },
  bend: { name: '손가락을 붙여 \'ㄱ\'자로 꺾은 손', sig: '*BBBB', pose: PRESETS.bend, contact: 'index.pip', accept: ['bent'] },
  wc: { name: '2·3·4지를 벌려 펴고 1·5지를 \'C\'자로 구부린 손', sig: 'eHEEE', pose: P({ thumb: { cmcFlex: 5, cmcAbd: 40, mcp: 15, ip: 25 }, index: HALF, middle: STRAIGHT(-6), ring: STRAIGHT(6), pinky: STRAIGHT(16) }), contact: 'palm' },
  bunch: { name: '손가락을 오므린 손', sig: '*HHHH', touch: ['thumb', 'index'], pose: P({ thumb: { cmcFlex: 19, cmcAbd: 46, mcp: 26, ip: 13 }, index: F(45, 60, 40), middle: F(45, 55, 35), ring: F(45, 55, 35), pinky: F(48, 55, 35) }), contact: 'middle', accept: ['ring', 'bent'] },
};

export const SHAPE_IDS = Object.keys(SHAPES);

// 손가락 목표 (뿌리 관절 MCP 각도, 둘째 + 끝마디 각도 합)
const TARGET = { E: [0, 0], F: [85, 150], H: [35, 75], B: [85, 5], K: [10, 140] };
const TARGET_MSG = {
  E: (f) => `${OBJ[f]} 펴 주세요`, F: (f) => `${OBJ[f]} 접어 주세요`, H: (f) => `${OBJ[f]} 살짝 구부려 주세요`,
  B: (f) => `${OBJ[f]} 곧게 둔 채 뿌리에서 꺾어 주세요`, K: (f) => `${KO[f]} 끝 두 마디를 구부려 주세요`,
};
/** 엄격함별: 모양 거리 허용값 (작을수록 엄격) */
export const SHAPE_TOL = { lenient: 0.46, normal: 0.38, strict: 0.3 };
const OK_FINGER = 0.4; // 손가락 하나 오차가 이보다 작으면 그 손가락은 맞음 (그림 색)

function fingerErr(features, f, code) {
  const j = features.fingers[f];
  if (!j || code === '*') return 0;
  if (f === 'thumb') {
    const pos = features.thumbPos;
    const up = code.toUpperCase();
    if (up === 'E') return (j.state === 'extended' ? 0 : 0.55) + (pos === 'across' || pos === 'tucked' ? 0.45 : 0);
    if (up === 'F') return THUMB_FOLDED.includes(pos) ? 0 : 0.6;
    return 0;
  }
  const [tm, tq] = TARGET[code] || TARGET.E;
  const m = Math.max(-10, j.mcp || 0), q = Math.max(0, (j.pip || 0) + (j.dip || 0));
  return Math.abs(m - tm) / 110 + Math.abs(q - tq) / 190;
}

function touchErr(features, pair) {
  const d = pointDistance(features, pair[0], pair[1]);
  return Number.isFinite(d) ? Math.max(0, d - 0.25) * 2.5 : 1;
}

/**
 * 손 모양 하나와의 거리 (0 = 딱 맞음). 엄지 기호가 소문자(e/f)면 엄지는 가볍게만 봄
 * @returns {{ dist, errs: {finger: number}, touch: number }}
 */
export function shapeDistance(features, id) {
  const s = SHAPES[id];
  const errs = {};
  let sum = 0, wsum = 0;
  FINGERS5.forEach((f, i) => {
    const code = s.sig[i];
    if (code === '*') return;
    const w = f === 'thumb' ? (code === code.toLowerCase() ? 0.25 : 0.7) : 1;
    const e = fingerErr(features, f, code);
    errs[f] = e;
    sum += e * w;
    wsum += w;
  });
  let dist = wsum ? sum / wsum : 0;
  let touch = 0;
  if (s.touch) {
    touch = touchErr(features, s.touch);
    dist = wsum ? dist * 0.4 + touch * 0.6 : touch;
  }
  return { dist, errs, touch };
}

/**
 * 손 모양 판정
 * @returns {{ ok, dist, best, msg, fingerStatus }} best: 가장 가까운 모양 id, msg: 고칠 점 하나
 */
export function judgeShape(features, id, strictness = 'normal') {
  const s = SHAPES[id];
  if (!features || !s) return { ok: false, dist: 1, best: null, msg: '손을 보여 주세요', fingerStatus: {} };
  const tol = SHAPE_TOL[strictness] ?? SHAPE_TOL.normal;
  const me = shapeDistance(features, id);
  let best = id, bestD = me.dist;
  for (const other of SHAPE_IDS) {
    if (other === id || (s.accept || []).includes(other)) continue;
    const d = shapeDistance(features, other).dist;
    if (d < bestD - 0.03) { best = other; bestD = d; }
  }
  const ok = me.dist <= tol && best === id;
  const fingerStatus = {};
  FINGERS5.forEach((f, i) => {
    fingerStatus[f] = s.sig[i] === '*' ? 'na' : (me.errs[f] ?? 0) < OK_FINGER ? 'ok' : 'bad';
  });
  let msg = '';
  if (!ok) {
    let worstF = null, worstE = 0;
    FINGERS5.forEach((f, i) => {
      const e = (me.errs[f] ?? 0) * (s.sig[i] === s.sig[i].toLowerCase() && f === 'thumb' ? 0.4 : 1);
      if (e > worstE) { worstE = e; worstF = f; }
    });
    if (s.touch && me.touch > 0.25 && me.touch >= worstE * 0.8) msg = `${KO[s.touch[0]]} 끝과 ${KO[s.touch[1]]} 끝을 맞대 주세요`;
    else if (worstF) msg = TARGET_MSG[s.sig[FINGERS5.indexOf(worstF)].toUpperCase()](worstF);
    else msg = `${s.name} 모양을 만들어 주세요`;
  }
  return { ok, dist: me.dist, best, msg, fingerStatus };
}



/** 손 마디 번호: 닿는 점 이름 → MediaPipe 번호 ('palm' 은 손바닥 가운데) */
export const CONTACT_INDEX = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20, 'index.pip': 6, wrist: 0 };
export const PALM_POINTS = [0, 5, 9, 13, 17];

/**
 * 몸 위치 (B 좌표: 얼굴 상자 가운데 원점, 얼굴 높이 단위, x = 수어하는 사람의 오른쪽)
 * r: 이만큼 안이면 그 자리로 봄 (보통 엄격함 기준)
 */
const FACE_R = 0.38, BODY_R = 0.62, SPACE_R = 0.8;
const L = (name, x, y, r) => ({ name, x, y, r });
export const LOCS = {
  forehead: L('이마', 0, 0.45, FACE_R), foreheadL: L('이마 왼쪽', -0.3, 0.45, FACE_R), foreheadR: L('이마 오른쪽', 0.3, 0.45, FACE_R),
  eyes: L('눈', 0, 0.12, FACE_R), eyeR: L('오른쪽 눈', 0.22, 0.12, FACE_R), eyeL: L('왼쪽 눈', -0.22, 0.12, FACE_R),
  eyeSideR: L('오른쪽 눈 옆', 0.42, 0.12, FACE_R), underEyeR: L('오른쪽 눈 밑', 0.22, -0.04, FACE_R),
  nose: L('코', 0, 0, FACE_R), noseR: L('코 오른쪽', 0.13, -0.02, FACE_R),
  mouth: L('입', 0, -0.27, FACE_R), mouthR: L('오른쪽 입가', 0.18, -0.27, FACE_R),
  chin: L('턱', 0, -0.5, FACE_R), underChin: L('턱 밑', 0, -0.66, FACE_R),
  cheekR: L('오른쪽 볼', 0.36, -0.15, FACE_R), cheekL: L('왼쪽 볼', -0.36, -0.15, FACE_R),
  templeR: L('오른쪽 관자놀이', 0.45, 0.3, FACE_R), earR: L('오른쪽 귀', 0.56, 0.02, FACE_R), earL: L('왼쪽 귀', -0.56, 0.02, FACE_R),
  headR: L('머리 오른쪽 옆', 0.8, 0.25, BODY_R), headL: L('머리 왼쪽 옆', -0.8, 0.25, BODY_R),
  faceFront: L('얼굴 앞', 0, -0.1, BODY_R), faceFrontR: L('얼굴 앞 오른쪽', 0.3, -0.1, BODY_R), faceFrontL: L('얼굴 앞 왼쪽', -0.3, -0.1, BODY_R),
  neck: L('목', 0, -0.88, FACE_R),
  shoulderR: L('오른쪽 어깨', 0.95, -1.05, BODY_R), shoulderL: L('왼쪽 어깨', -0.95, -1.05, BODY_R),
  chest: L('가슴', 0, -1.7, BODY_R), chestR: L('오른쪽 가슴', 0.55, -1.6, BODY_R), chestL: L('왼쪽 가슴', -0.55, -1.6, BODY_R),
  belly: L('배', 0, -2.45, BODY_R), bellyR: L('배 오른쪽', 0.45, -2.4, BODY_R), bellyL: L('배 왼쪽', -0.45, -2.4, BODY_R),
  front: L('가슴 앞', 0, -1.45, SPACE_R), frontR: L('가슴 앞 오른쪽', 0.45, -1.45, SPACE_R), frontL: L('가슴 앞 왼쪽', -0.45, -1.45, SPACE_R),
  armL: L('왼팔', -0.7, -1.9, BODY_R), side: L('왼쪽 옆구리', -0.9, -2.2, BODY_R),
};

/** 왼손(주로 안 쓰는 손) 자리 이름을 오른쪽 ↔ 왼쪽 맞바꿈 */
export function mirrorLoc(id) {
  if (/R$/.test(id)) return id.replace(/R$/, 'L');
  if (/L$/.test(id) && LOCS[id.replace(/L$/, 'R')]) return id.replace(/L$/, 'R');
  return id;
}

// ───────── 손 방향 (손끝/손 축 방향 : 손바닥 방향) ─────────
const DIRV = { u: [0, 1, 0], d: [0, -1, 0], l: [-1, 0, 0], r: [1, 0, 0], f: [0, 0, 1], b: [0, 0, -1] };
const DIR_WORD = { u: '위', d: '아래', l: '왼쪽', r: '오른쪽', f: '앞(보는 사람 쪽)', b: '내 쪽' };
const vecOf = (code) => {
  const v = [0, 0, 0];
  for (const ch of code) for (let i = 0; i < 3; i++) v[i] += DIRV[ch][i];
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
const orientCache = new Map();

/**
 * 'u:f' (손끝 위 : 손바닥 앞) 같은 방향 이름 → 손 모형 회전 { yaw, pitch, roll }
 * @param {string} code 손끝(손 축) 방향 + ':' + 손바닥 방향, 글자 u d l r f b 를 이어 쓰면 사이 방향 (예 'uf:b')
 * @param {'right'|'left'} side 왼손이면 거울처럼 (모형은 오른손이라 x 를 뒤집어 풂)
 */
export function orientRot(code = 'u:f', side = 'right') {
  const key = `${code}|${side}`;
  if (orientCache.has(key)) return orientCache.get(key);
  const [a, b] = String(code).split(':');
  let ax = vecOf(a || 'u'), nx = vecOf(b || 'f');
  if (side === 'left') { ax = [-ax[0], ax[1], ax[2]]; nx = [-nx[0], nx[1], nx[2]]; }
  let best = null, bestErr = Infinity;
  for (let yaw = -180; yaw < 180; yaw += 15) {
    for (let pitch = -90; pitch <= 90; pitch += 15) {
      for (let roll = -180; roll < 180; roll += 15) {
        const M = eulerMatrix(yaw, pitch, roll);
        const e = angleBetween(applyMat(M, [0, 1, 0]), ax) + angleBetween(applyMat(M, [0, 0, 1]), nx);
        if (e < bestErr - 1e-6) { bestErr = e; best = { yaw, pitch, roll }; }
      }
    }
  }
  orientCache.set(key, best);
  return best;
}

/** 방향 이름을 한국어로: 'u:f' → '손끝 위 · 손바닥 앞(보는 사람 쪽)' */
export function orientText(code = 'u:f') {
  const [a, b] = String(code).split(':');
  const w = (s) => [...(s || '')].map((c) => DIR_WORD[c]).join(' ');
  return `손끝 ${w(a)} · 손바닥 ${w(b)}`;
}

/** 손 모양 + 방향 → 손 모형 자세 */
export function shapePose(shapeId, orient = 'u:f', side = 'right') {
  const s = SHAPES[shapeId] || SHAPES.flat;
  return withPose(s.pose, { rot: orientRot(orient, side) });
}

/** 방향 이름 → 판정에 쓸 손바닥 방향 (S 좌표 단위 벡터) */
export function axisVector(orient = 'u:f') {
  return vecOf(String(orient).split(':')[0] || 'u');
}

export function palmVector(orient = 'u:f') {
  return vecOf(String(orient).split(':')[1] || 'f');
}
