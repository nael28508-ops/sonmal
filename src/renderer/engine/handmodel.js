// 손 모형 (정운동학): 관절 각도(HandPose) → 손 마디 21개의 3차원 위치
// - 참고 손 그림, 합성 손 인식기(카메라 없이 시험), 단위 테스트가 모두 이 모형을 씀
// - 좌표는 수어하는 사람 기준 S (x = 오른쪽, y = 위, z = 앞/카메라 쪽), 단위는 손바닥 길이
//   (손목 0번 → 중지 뿌리 9번 = 1, 어른 손 ≈ 9.2 cm)
// - 기본 자세(NEUTRAL_POSE): 오른손, 손바닥이 앞(카메라)을 보고, 손가락은 위로 곧게
// - 마디 번호는 MediaPipe 와 같음: 0 손목, 1~4 엄지(CMC·MCP·IP·끝), 5~8 검지(MCP·PIP·DIP·끝),
//   9~12 중지, 13~16 약지, 17~20 소지
import { add, scale, cross, norm, rotate, eulerMatrix, applyMat, toPt, clamp, mean, sub } from './geometry.js';

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
export const LONG_FINGERS = ['index', 'middle', 'ring', 'pinky'];
/** 손가락마다 마디 번호 (뿌리 → 끝) */
export const CHAINS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

/** 손바닥 길이를 미터로 (합성 world 좌표 만들 때) */
export const PALM_METERS = 0.092;

// 어른 손 비율 (손바닥 길이 = 1). 뼈 길이 문헌값(손가락 마디 길이 비율)에 손끝 살을 더해 맞춤
export const HAND_GEOMETRY = {
  // 손가락 뿌리(MCP) 위치: 가운데(중지)가 가장 손등 쪽으로 볼록한 가로 아치
  mcp: {
    index: [-0.27, 0.95, 0.03],
    middle: [0, 1, 0],
    ring: [0.22, 0.94, 0.015],
    pinky: [0.42, 0.84, 0.06],
  },
  // 마디 길이: [첫마디(MCP→PIP), 가운뎃마디(PIP→DIP), 끝마디(DIP→끝)]
  seg: {
    index: [0.42, 0.25, 0.21],
    middle: [0.47, 0.29, 0.22],
    ring: [0.44, 0.27, 0.21],
    pinky: [0.34, 0.2, 0.19],
  },
  thumbCmc: [-0.24, 0.2, 0.1], // 엄지 뿌리(CMC) 위치: 손목 가까이, 엄지 쪽, 조금 손바닥 쪽
  thumbSeg: [0.44, 0.33, 0.28], // [손허리뼈(CMC→MCP), 첫마디(MCP→IP), 끝마디(IP→끝)]
  thumbRest: 45, // cmcFlex = 0 일 때 엄지가 손 축(중지 방향)에서 엄지 쪽으로 벌어진 각도
  // 엄지 비틀림 = thumbTwist0 + thumbTwistK × cmcAbd (도). 90° 면 엄지가 손바닥 평면 안에서 굽혀짐
  thumbTwist0: 85,
  thumbTwistK: 0.25,
  // 그림용 굵기 (지름, 손바닥 길이 단위): [뿌리 쪽, 가운데, 끝 쪽]
  width: {
    thumb: [0.25, 0.215, 0.19],
    index: [0.195, 0.175, 0.16],
    middle: [0.2, 0.18, 0.165],
    ring: [0.185, 0.17, 0.155],
    pinky: [0.165, 0.15, 0.138],
  },
};

/** 관절 움직임 범위 (도). 이 범위를 넘는 값은 잘라서 씀 */
export const LIMITS = {
  finger: { mcp: [-30, 100], pip: [-5, 115], dip: [-15, 90], abd: [-25, 35] },
  thumb: { cmcFlex: [-45, 80], cmcAbd: [-15, 95], mcp: [-20, 75], ip: [-30, 95] },
  rot: [-360, 360],
};

/** 기본 자세: 손바닥 앞, 손가락 위로 곧게, 엄지는 손바닥 평면에서 45° 벌림 */
export const NEUTRAL_POSE = Object.freeze({
  rot: { yaw: 0, pitch: 0, roll: 0 },
  thumb: { cmcFlex: 0, cmcAbd: 0, mcp: 0, ip: 0 },
  index: { mcp: 0, pip: 0, dip: 0, abd: 0 },
  middle: { mcp: 0, pip: 0, dip: 0, abd: 0 },
  ring: { mcp: 0, pip: 0, dip: 0, abd: 0 },
  pinky: { mcp: 0, pip: 0, dip: 0, abd: 0 },
});

// 엄지의 축 회전(엎침): 엄지를 손바닥 앞으로 들수록 엄지 배가 다른 손가락 쪽을 봄
function thumbTwist(cmcAbd) {
  const G = HAND_GEOMETRY;
  return G.thumbTwist0 + G.thumbTwistK * Math.max(0, cmcAbd);
}

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/**
 * 빠진 값은 0(기본 자세)으로 채우고, 관절 범위를 넘는 값은 잘라 낸 새 자세를 돌려줌
 * @param {object} pose 일부만 있어도 됨 (예: { index: { mcp: 90 } })
 */
export function normalizePose(pose = {}) {
  const out = { rot: {}, thumb: {} };
  const rot = pose.rot || {};
  for (const k of ['yaw', 'pitch', 'roll']) out.rot[k] = clamp(num(rot[k]), LIMITS.rot[0], LIMITS.rot[1]);
  const t = pose.thumb || {};
  for (const k of ['cmcFlex', 'cmcAbd', 'mcp', 'ip']) {
    out.thumb[k] = clamp(num(t[k]), LIMITS.thumb[k][0], LIMITS.thumb[k][1]);
  }
  for (const f of LONG_FINGERS) {
    const j = pose[f] || {};
    out[f] = {};
    for (const k of ['mcp', 'pip', 'dip', 'abd']) out[f][k] = clamp(num(j[k]), LIMITS.finger[k][0], LIMITS.finger[k][1]);
  }
  return out;
}

/** 두 자세 사이를 t(0~1) 만큼 섞은 자세 (합성 인식기의 부드러운 바뀜용) */
export function lerpPose(a, b, t) {
  const pa = normalizePose(a), pb = normalizePose(b);
  const out = normalizePose({});
  const mix = (x, y) => x + (y - x) * t;
  for (const k of ['yaw', 'pitch', 'roll']) out.rot[k] = mix(pa.rot[k], pb.rot[k]);
  for (const k of ['cmcFlex', 'cmcAbd', 'mcp', 'ip']) out.thumb[k] = mix(pa.thumb[k], pb.thumb[k]);
  for (const f of LONG_FINGERS) for (const k of ['mcp', 'pip', 'dip', 'abd']) out[f][k] = mix(pa[f][k], pb[f][k]);
  return out;
}

/** 자세 위에 일부 값만 덮어쓴 새 자세 (예: withPose(PRESETS.fist, { rot: { yaw: 30 } })) */
export function withPose(base, patch = {}) {
  const b = normalizePose(base);
  const out = { rot: { ...b.rot, ...(patch.rot || {}) }, thumb: { ...b.thumb, ...(patch.thumb || {}) } };
  for (const f of LONG_FINGERS) out[f] = { ...b[f], ...(patch[f] || {}) };
  return normalizePose(out);
}

/**
 * 자세 → 손 모형 전체 (그림 그리기에 필요한 마디별 방향까지)
 * @returns {{ points: number[][], frames: object, normal: number[], axis: number[], side: number[], pose: object }}
 *   points: 21개 [x,y,z] (S 좌표, 손바닥 길이 단위, 손목이 원점)
 *   frames[i]: 마디 i 에서 시작하는 뼈의 { x: 뼈 방향, pad: 손가락 배(손바닥 쪽)가 보는 방향 }
 *   normal: 손바닥이 보는 방향, axis: 손목→중지 뿌리 방향, side: 엄지 쪽→새끼 쪽 방향
 */
export function buildHand(pose) {
  const p = normalizePose(pose);
  const G = HAND_GEOMETRY;
  const u = [0, 1, 0]; // 손 축 (손가락 방향)
  const r = [1, 0, 0]; // 엄지 쪽 → 새끼 쪽
  const n = [0, 0, 1]; // 손바닥이 보는 쪽
  const pts = new Array(21);
  const frames = {};
  pts[0] = [0, 0, 0];

  // 검지 ~ 소지: 벌림(abd)은 손바닥 평면 안에서, 굽힘은 손가락 축에 수직인 축으로
  for (const f of LONG_FINGERS) {
    const j = p[f];
    const chain = CHAINS[f];
    const sign = f === 'ring' || f === 'pinky' ? -1 : 1; // +abd: 검지·중지는 엄지 쪽, 약지·소지는 새끼 쪽으로
    const xa = rotate(u, n, sign * j.abd);
    const fa = rotate(r, n, sign * j.abd);
    let pos = G.mcp[f].slice();
    pts[chain[0]] = pos;
    const bends = [j.mcp, j.pip, j.dip];
    let ang = 0;
    for (let s = 0; s < 3; s++) {
      ang += bends[s];
      const x = rotate(xa, fa, ang);
      frames[chain[s]] = { x, pad: rotate(n, fa, ang) };
      pos = add(pos, scale(x, G.seg[f][s]));
      pts[chain[s + 1]] = pos;
    }
  }

  // 엄지: ① 손바닥 평면에서 엄지 쪽으로 벌림(45° - cmcFlex) ② 손바닥 앞으로 들어 올림(cmcAbd)
  //       ③ 엄지 축을 따라 비틀림(엄지 배가 손가락 쪽을 보게) ④ MCP · IP 굽힘
  const t = p.thumb;
  const beta = G.thumbRest - t.cmcFlex;
  const x0 = rotate(u, n, beta);
  const r0 = rotate(r, n, beta);
  const x1 = rotate(x0, r0, t.cmcAbd);
  const n1 = rotate(n, r0, t.cmcAbd);
  const pad = rotate(n1, x1, thumbTwist(t.cmcAbd));
  const fax = norm(cross(x1, pad));
  pts[1] = G.thumbCmc.slice();
  frames[1] = { x: x1, pad };
  pts[2] = add(pts[1], scale(x1, G.thumbSeg[0]));
  const x2 = rotate(x1, fax, t.mcp);
  frames[2] = { x: x2, pad: rotate(pad, fax, t.mcp) };
  pts[3] = add(pts[2], scale(x2, G.thumbSeg[1]));
  const x3 = rotate(x1, fax, t.mcp + t.ip);
  frames[3] = { x: x3, pad: rotate(pad, fax, t.mcp + t.ip) };
  pts[4] = add(pts[3], scale(x3, G.thumbSeg[2]));

  // 손 전체 회전 (손목 기준)
  const M = eulerMatrix(p.rot.yaw, p.rot.pitch, p.rot.roll);
  const R = (v) => applyMat(M, v);
  const outFrames = {};
  for (const k of Object.keys(frames)) outFrames[k] = { x: R(frames[k].x), pad: R(frames[k].pad) };
  return {
    points: pts.map(R),
    frames: outFrames,
    normal: R(n),
    axis: R(u),
    side: R(r),
    pose: p,
  };
}

/** 자세 → 21개 점 {x,y,z} (S 좌표, 손바닥 길이 단위, 손목이 원점) */
export function poseToS(pose) {
  return buildHand(pose).points.map(toPt);
}

/**
 * 자세 → MediaPipe 가 주는 것과 같은 모양의 손 { landmarks, world, handedness, score }
 * - landmarks: 카메라 원본(거울 반전 전) 영상 기준 0~1 좌표, z 는 손목 기준 깊이(카메라에 가까울수록 -)
 * - world: 미터 단위, 손 가운데가 원점, 카메라 원본 축(x 영상 오른쪽, y 아래, z 카메라에서 멀어지는 쪽 +)
 * @param {object} pose HandPose
 * @param {object} [o]
 * @param {number[]} [o.center=[0.5,0.55]] 손바닥 가운데가 놓일 원본 영상 좌표 (0~1)
 * @param {number} [o.size=0.22] 손바닥 길이 (영상 높이 대비 비율)
 * @param {number} [o.aspect=16/9] 영상 가로/세로 비율
 * @param {'right'|'left'} [o.side='right'] 왼손이면 좌우를 뒤집은 손을 만듦
 * @param {number} [o.score=0.97] 손 인식 점수
 * @param {boolean} [o.perspective=true] 가까운 부분을 조금 크게 (실제 카메라처럼)
 */
export function poseToHand(pose, o = {}) {
  const {
    center = [0.5, 0.55],
    size = 0.22,
    aspect = 16 / 9,
    side = 'right',
    score = 0.97,
    perspective = true,
    focal = 1.25,
    palmMeters = PALM_METERS,
  } = o;
  const left = side === 'left';
  const S = buildHand(pose).points.map((v) => (left ? [-v[0], v[1], v[2]] : v));
  const gc = mean(S); // world 원점 ≈ 손 가운데
  const world = S.map((v) => {
    const d = sub(v, gc);
    return { x: -d[0] * palmMeters, y: -d[1] * palmMeters, z: -d[2] * palmMeters };
  });
  const pc = mean([0, 5, 9, 13, 17].map((i) => S[i])); // 손바닥 가운데
  const Z0 = focal / size; // 카메라 → 손바닥까지 거리 (손바닥 길이 단위)
  const wz = S[0][2];
  const landmarks = S.map((v) => {
    const d = sub(v, pc);
    const k = perspective ? focal / Math.max(Z0 - d[2], Z0 * 0.25) : size;
    return {
      x: center[0] + (-d[0] * k) / aspect,
      y: center[1] - d[1] * k,
      z: (-(v[2] - wz) * size) / aspect,
    };
  });
  return { landmarks, world, handedness: left ? 'Left' : 'Right', score };
}

// ───────── 미리 만든 자세 ─────────
// 한국수어 지문자가 아니라, 손 모형 · 인식 시험에 쓰는 일반적인 손 모양
// (엄지 값은 실제 손 사진의 엄지 위치에 맞춰 찾은 값)
const F = (mcp, pip, dip, abd = 0) => ({ mcp, pip, dip, abd });
const CURL = F(88, 100, 62);
const CURL_PINKY = F(90, 98, 60);
const THUMB_OVER = { cmcFlex: 29, cmcAbd: 46, mcp: 46, ip: 39 }; // 말아 쥔 손가락 앞을 가로지름
const THUMB_OUT = { cmcFlex: -38, cmcAbd: 3, mcp: 0, ip: 0 }; // 옆으로 쭉 (L 모양)
const P = (o) => Object.freeze(normalizePose(o));

export const PRESETS = {
  /** 기본 자세 그대로 (손바닥 앞, 다섯 손가락 곧게) */
  neutral: P({}),
  /** 손바닥 펴기: 다섯 손가락 펴고 살짝 벌림, 손바닥 앞 */
  open: P({
    thumb: { cmcFlex: -5, cmcAbd: 20, mcp: 5, ip: 5 },
    index: F(4, 4, 2, 9), middle: F(4, 4, 2, 0), ring: F(4, 4, 2, 7), pinky: F(5, 4, 2, 15),
  }),
  /** 납작 손: 네 손가락 붙여 펴고 엄지는 손바닥 위로 접음 */
  flat: P({
    thumb: { cmcFlex: 32, cmcAbd: 17, mcp: 70, ip: 24 },
    index: F(3, 3, 2, 1), middle: F(3, 3, 2, 0), ring: F(3, 3, 2, 1), pinky: F(4, 3, 2, 2),
  }),
  /** 주먹: 네 손가락 말아 쥐고 엄지는 손가락 앞을 가로질러 */
  fist: P({ thumb: THUMB_OVER, index: CURL, middle: CURL, ring: CURL, pinky: CURL_PINKY }),
  /** 엄지를 검지 옆에 붙인 주먹 */
  fistThumbSide: P({
    thumb: { cmcFlex: 5, cmcAbd: 22, mcp: 50, ip: 15 },
    index: CURL, middle: CURL, ring: CURL, pinky: CURL_PINKY,
  }),
  /** 엄지를 손가락 안에 넣은 주먹 */
  fistThumbIn: P({
    thumb: { cmcFlex: 26, cmcAbd: 24, mcp: 70, ip: 51 },
    index: CURL, middle: CURL, ring: CURL, pinky: CURL_PINKY,
  }),
  /** 손바닥이 앞을 보는 주먹에서 엄지를 손 축 따라 위로 */
  fistThumbAlong: P({
    thumb: { cmcFlex: 29, cmcAbd: 4, mcp: 11, ip: 0 },
    index: CURL, middle: CURL, ring: CURL, pinky: CURL_PINKY,
  }),
  /** 검지 세우기: 검지만 위로, 나머지는 쥐고 엄지는 가운뎃손가락 위에 */
  point: P({ thumb: THUMB_OVER, index: F(2, 3, 2, 2), middle: CURL, ring: CURL, pinky: CURL_PINKY }),
  /** 엄지 세우기 (👍): 주먹에서 엄지만 위로, 손 옆면이 앞을 봄 */
  thumbsUp: P({
    rot: { roll: -90, yaw: -120 },
    thumb: THUMB_OUT,
    index: CURL, middle: CURL, ring: CURL, pinky: CURL_PINKY,
  }),
  /** 브이: 검지 · 중지 펴서 벌리고 나머지는 쥠 */
  vee: P({ thumb: THUMB_OVER, index: F(2, 3, 2, 12), middle: F(2, 3, 2, -12), ring: CURL, pinky: CURL_PINKY }),
  /** L 모양: 엄지 옆으로, 검지 위로 */
  ell: P({ thumb: THUMB_OUT, index: F(2, 3, 2, 2), middle: CURL, ring: CURL, pinky: CURL_PINKY }),
  /** 갈고리: 네 손가락 첫마디는 펴고 끝 두 마디만 구부림 */
  hook: P({
    thumb: { cmcFlex: 10, cmcAbd: 25, mcp: 15, ip: 10 },
    index: F(5, 95, 65, 3), middle: F(5, 95, 65, 0), ring: F(5, 95, 65, 3), pinky: F(5, 95, 65, 6),
  }),
  /** 뿌리만 굽힘: 네 손가락을 뿌리에서 90° 꺾고 곧게 */
  bend: P({
    thumb: { cmcFlex: 20, cmcAbd: 30, mcp: 10, ip: 5 },
    index: F(88, 3, 2), middle: F(88, 3, 2), ring: F(88, 3, 2), pinky: F(88, 3, 2),
  }),
  /** OK: 엄지 끝과 검지 끝을 맞대 동그라미, 나머지 세 손가락은 펴기 */
  ok: P({
    thumb: { cmcFlex: 19, cmcAbd: 46, mcp: 26, ip: 13 },
    index: F(45, 60, 40, 0), middle: F(4, 4, 2, -4), ring: F(4, 4, 2, 6), pinky: F(5, 4, 2, 14),
  }),
  /** C 모양: 손가락을 둥글게 구부리고 엄지를 마주 보게 */
  cee: P({
    thumb: { cmcFlex: 14, cmcAbd: 48, mcp: 10, ip: 24 },
    index: F(30, 45, 30), middle: F(30, 45, 30), ring: F(30, 45, 30), pinky: F(32, 45, 30),
  }),
  /** 엄지를 앞(카메라 쪽)으로 내밀기, 네 손가락은 펴기 */
  thumbFront: P({
    thumb: { cmcFlex: 27, cmcAbd: 70, mcp: 0, ip: 3 },
    index: F(3, 3, 2, 2), middle: F(3, 3, 2, 0), ring: F(3, 3, 2, 2), pinky: F(4, 3, 2, 4),
  }),
  /** 새끼손가락만 펴기 */
  pinkyUp: P({ thumb: THUMB_OVER, index: CURL, middle: CURL, ring: CURL, pinky: F(3, 3, 2, 6) }),
};
