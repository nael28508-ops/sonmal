// 3차원 벡터 계산 도우미
// - 벡터는 [x, y, z] 배열로 돌려줌. 입력은 배열과 MediaPipe 식 {x, y, z} 객체 모두 받음
// - 각도는 모두 도(degree) 단위
// - 화면 · 브라우저 기능을 쓰지 않아서 Node 에서도 그대로 돌아감

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** {x,y,z} 또는 [x,y,z] → [x,y,z] */
export function vec(p) {
  if (Array.isArray(p)) return [p[0] || 0, p[1] || 0, p[2] || 0];
  return [p.x || 0, p.y || 0, p.z || 0];
}

/** [x,y,z] → {x,y,z} (MediaPipe 랜드마크 모양) */
export function toPt(a) {
  const v = vec(a);
  return { x: v[0], y: v[1], z: v[2] };
}

const A = (p) => (Array.isArray(p) ? p : vec(p));

export function add(a, b) {
  a = A(a); b = A(b);
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  a = A(a); b = A(b);
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, s) {
  a = A(a);
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  a = A(a); b = A(b);
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  a = A(a); b = A(b);
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** 벡터 길이 */
export function len(a) {
  a = A(a);
  return Math.hypot(a[0], a[1], a[2]);
}

/** 두 점 사이 거리 */
export function dist(a, b) {
  return len(sub(a, b));
}

/** 길이 1 로 맞춘 벡터 (길이가 0 이면 [0,0,0]) */
export function norm(a) {
  a = A(a);
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
export const normalize = norm;

/** a + (b - a) * t */
export function lerp(a, b, t) {
  a = A(a); b = A(b);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 여러 점의 평균 */
export function mean(points) {
  const s = [0, 0, 0];
  if (!points.length) return s;
  for (const p of points) {
    const v = A(p);
    s[0] += v[0]; s[1] += v[1]; s[2] += v[2];
  }
  return [s[0] / points.length, s[1] / points.length, s[2] / points.length];
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** 두 벡터 사이 각도 (0~180°) */
export function angleBetween(a, b) {
  const la = len(a), lb = len(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  return Math.acos(clamp(dot(a, b) / (la * lb), -1, 1)) * RAD;
}

/** axis 를 축으로 a 에서 b 로 돌아간 각도 (부호 있음, -180~180°) */
export function signedAngle(a, b, axis) {
  const c = cross(a, b);
  const s = dot(c, norm(axis));
  return Math.atan2(s, dot(a, b)) * RAD;
}

/** 세 점 a-b-c 에서 b 의 굽힘 각도 (곧으면 0°) */
export function bendAt(a, b, c) {
  return angleBetween(sub(b, a), sub(c, b));
}

/** n 방향 성분을 뺀 벡터 (n 에 수직인 평면으로 내린 그림자) */
export function projectOnPlane(v, n) {
  const u = norm(n);
  return sub(v, scale(u, dot(v, u)));
}

/** 로드리게스 회전: v 를 axis 축으로 deg 만큼 돌림 (오른손 법칙, 숫자 계산 기준) */
export function rotate(v, axis, deg) {
  v = A(v);
  const k = norm(axis);
  const t = deg * DEG;
  const c = Math.cos(t), s = Math.sin(t);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
}

/** x 축 회전 (+deg: +y 가 +z 쪽으로) */
export function rotX(v, deg) {
  v = A(v);
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/** y 축 회전 (+deg: +z 가 +x 쪽으로) */
export function rotY(v, deg) {
  v = A(v);
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** z 축 회전 (+deg: +y 가 -x 쪽으로 = 거울 화면에서 시계 반대 방향) */
export function rotZ(v, deg) {
  v = A(v);
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

// ───────── 방향 (수어하는 사람 기준 좌표 S) ─────────
// S.x = 수어하는 사람의 오른쪽, S.y = 위, S.z = 앞 (카메라 쪽)
export const DIRS = ['up', 'down', 'left', 'right', 'forward', 'back'];
export const DIR_VECTORS = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  forward: [0, 0, 1],
  back: [0, 0, -1],
};
export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left', forward: 'back', back: 'forward' };

/**
 * 방향 이름 → 단위 벡터. 'up+left' 처럼 + 로 이으면 사이 방향(대각선)
 * 모르는 이름이면 null
 */
export function dirVector(dir) {
  if (Array.isArray(dir)) return norm(dir);
  if (typeof dir !== 'string') return null;
  const parts = dir.split('+').map((s) => s.trim());
  let v = [0, 0, 0];
  for (const p of parts) {
    const d = DIR_VECTORS[p];
    if (!d) return null;
    v = add(v, d);
  }
  return len(v) < 1e-9 ? null : norm(v);
}

/** 여섯 방향 각각과의 코사인 값 (1 = 바로 그쪽) */
export function dirScores(v) {
  const u = norm(v);
  return { up: u[1], down: -u[1], left: -u[0], right: u[0], forward: u[2], back: -u[2] };
}

/** 가장 가까운 방향 이름 */
export function nearestDir(v) {
  const s = dirScores(v);
  let best = 'up';
  for (const d of DIRS) if (s[d] > s[best]) best = d;
  return best;
}

/** 3x3 행렬 (행 우선) 곱하기 벡터 */
export function applyMat(m, v) {
  v = A(v);
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** 손 모델 회전: 먼저 roll(z), 그다음 pitch(x), 마지막 yaw(y) — 각각 S 좌표축 기준 */
export function eulerMatrix(yaw = 0, pitch = 0, roll = 0) {
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => rotY(rotX(rotZ(e, roll), pitch), yaw));
  return [
    cols[0][0], cols[1][0], cols[2][0],
    cols[0][1], cols[1][1], cols[2][1],
    cols[0][2], cols[1][2], cols[2][2],
  ];
}

/** 작은 난수 발생기 (씨앗이 같으면 같은 수열) — 테스트 · 합성 손 떨림용 */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
