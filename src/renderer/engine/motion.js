// 움직임 판정: 손 모양을 만든 뒤 손을 옮기기(move) · 흔들기(shake) · 손목 돌리기(twist)
// - push(features, t) 로 매 프레임 손 특징을 넣고, check(motionSpec) 로 움직임을 했는지 물어봄
// - 위치는 화면(원본 영상) 기준을 S 좌표로 바꾼 뒤 손바닥 길이 단위로 셈 (가까이 오면 손이 커 보이는 것으로 앞뒤도 셈)
// - 왼손(거울 판정)이면 왼쪽 ↔ 오른쪽을 뒤집어서, 오른손 기준 글자 정의를 그대로 씀
import { dirVector, dot, sub, len, norm, projectOnPlane, signedAngle, clamp } from './geometry.js';
import { DIR_KO } from './features.js';
import { evaluateCheck, getTolerance } from './rules.js';

/** 카메라 초점 거리 (영상 높이 단위, 보통 웹캠 ≈ 1.25) — 손 크기로 카메라까지 거리를 어림할 때 씀 */
export const FOCAL = 1.25;

const DEFAULTS = {
  move: { minDist: 1.0, within: 1500 },
  shake: { minDist: 0.4, within: 2000, count: 3 },
  twist: { minAngle: 60, within: 1500 },
  sequence: { within: 3000 },
};

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const dirKo = (d) => String(d).split('+').map((x) => DIR_KO[x] || x).join(' ').replace(/\(.+?\)/g, '');

/**
 * @param {{historyMs?: number, gapMs?: number}} [o]
 *   historyMs: 얼마 동안의 움직임을 기억할지, gapMs: 손이 이만큼 안 보이면 기억을 지움
 */
export function createMotionTracker({ historyMs = 3000, gapMs = 500 } = {}) {
  let hist = [];
  let lastT = null;

  function push(features, t) {
    if (!features || !features.screen) return;
    if (lastT !== null && (t - lastT > gapMs || t < lastT)) hist = [];
    lastT = t;
    const s = features.screen;
    const aspect = s.aspect || 16 / 9;
    let X = -s.cx * aspect; // 원본 영상 x 는 수어하는 사람의 왼쪽이 + → S.x 는 반대
    if (features.mirrored) X = -X;
    hist.push({ t, X, Y: -s.cy, size: s.size, n: features.palm.normal, u: features.hand.vec, f: features });
    while (hist.length && hist[0].t < t - historyMs) hist.shift();
  }

  function reset() {
    hist = [];
    lastT = null;
  }

  /**
   * @param {{type: 'move'|'shake'|'twist'|'sequence', dir?: string, minDist?: number, within?: number, count?: number,
   *          minAngle?: number, desc?: string, from?: object[], to?: object[], hintThen?: string}} spec
   *   sequence: 먼저 from(확인 항목 목록) 모양을 만든 뒤 지금은 다른 모양 (끝 모양은 글자 checks 가 봄,
   *             to 를 주면 여기서도 봄). 예: ㅘ = ㅗ 모양 → 손목을 돌려 ㅏ 모양
   * @param {{strictness?: string}} [o] sequence 의 처음 모양을 볼 때 쓸 엄격함
   * @returns {{ done: boolean, progress: number, hint: string }}
   */
  function check(spec, { strictness = 'normal' } = {}) {
    if (!spec || !spec.type) return { done: true, progress: 1, hint: '' };
    const def = DEFAULTS[spec.type] || {};
    const within = spec.within ?? def.within ?? 1500;
    const tNow = hist.length ? hist[hist.length - 1].t : 0;
    const win = hist.filter((h) => h.t >= tNow - within);
    const first = spec.desc || defaultHint(spec);
    if (win.length < 2) return { done: false, progress: 0, hint: first };
    const sref = median(win.map((h) => h.size)) || 0.2;
    const pos = (h) => [h.X / sref, h.Y / sref, -FOCAL / Math.max(h.size, 1e-3)];
    let progress = 0;

    if (spec.type === 'sequence') {
      const tol = getTolerance(strictness);
      const passAll = (checks, f) => !!f && (checks || []).every((c) => evaluateCheck(c, f, tol).ok);
      const last = win[win.length - 1];
      let seenAt = -1;
      for (let i = 0; i < win.length - 1; i++) if (passAll(spec.from, win[i].f)) seenAt = i;
      const seen = seenAt >= 0 && !passAll(spec.from, last.f);
      const toOk = !spec.to || passAll(spec.to, last.f);
      progress = seen ? (toOk ? 1 : 0.5) : seenAt >= 0 || passAll(spec.from, last.f) ? 0.5 : 0;
      const done = progress >= 1;
      const hint = done ? '좋아요!' : progress >= 0.5 ? spec.hintThen || '이제 손을 돌려 끝 모양을 만들어 주세요' : first;
      return { done, progress, hint };
    } else if (spec.type === 'move') {
      const dv = dirVector(spec.dir) || [1, 0, 0];
      const minDist = spec.minDist ?? def.minDist;
      const pNow = pos(win[win.length - 1]);
      let best = 0;
      for (const h of win) best = Math.max(best, dot(sub(pNow, pos(h)), dv));
      progress = clamp(best / minDist, 0, 1);
    } else if (spec.type === 'shake') {
      const minDist = spec.minDist ?? def.minDist;
      const count = spec.count ?? def.count;
      const pts = win.map(pos);
      let axis = dirVector(spec.dir);
      if (!axis) {
        // 방향을 안 정했으면 가장 많이 움직인 축 (좌우/위아래)
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const rx = Math.max(...xs) - Math.min(...xs), ry = Math.max(...ys) - Math.min(...ys);
        axis = rx >= ry ? [1, 0, 0] : [0, 1, 0];
      }
      progress = clamp(countStrokes(pts.map((p) => dot(p, axis)), minDist) / count, 0, 1);
    } else if (spec.type === 'twist') {
      const minAngle = spec.minAngle ?? def.minAngle;
      const last = win[win.length - 1];
      const axis = norm(last.u);
      const nNow = projectOnPlane(last.n, axis);
      let best = 0;
      for (const h of win) {
        const n0 = projectOnPlane(h.n, axis);
        if (len(n0) < 0.2 || len(nNow) < 0.2) continue;
        // 오른손 기준: + 는 엎침(안쪽으로 돌림), - 는 뒤침(바깥쪽으로 돌림)
        const a = signedAngle(n0, nNow, axis);
        const v = spec.dir === 'in' ? a : spec.dir === 'out' ? -a : Math.abs(a);
        best = Math.max(best, v);
      }
      progress = clamp(best / minAngle, 0, 1);
    }

    const done = progress >= 1;
    let hint = first;
    if (done) hint = '좋아요!';
    else if (progress >= 0.3) hint = spec.type === 'shake' ? '조금 더 흔들어 주세요' : spec.type === 'twist' ? '조금 더 돌려 주세요' : '조금 더 움직여 주세요';
    return { done, progress, hint };
  }

  return { push, reset, check, get length() { return hist.length; } };
}

/**
 * 한 줄로 늘어선 위치 값에서 "한 방향으로 minDist 이상 움직인 획" 수 세기
 * (왼→오→왼 이면 3획, 작은 떨림은 세지 않음)
 */
export function countStrokes(values, minDist) {
  if (!values.length) return 0;
  let strokes = 0, dir = 0, ext = values[0];
  const start = values[0];
  for (const v of values) {
    if (dir === 0) {
      if (v - start >= minDist) { dir = 1; ext = v; strokes = 1; }
      else if (start - v >= minDist) { dir = -1; ext = v; strokes = 1; }
    } else if (dir > 0) {
      if (v > ext) ext = v;
      else if (ext - v >= minDist) { dir = -1; ext = v; strokes++; }
    } else {
      if (v < ext) ext = v;
      else if (v - ext >= minDist) { dir = 1; ext = v; strokes++; }
    }
  }
  return strokes;
}

const AXIS_KO = { left: '좌우로', right: '좌우로', up: '위아래로', down: '위아래로', forward: '앞뒤로', back: '앞뒤로' };

/** 움직임 안내 기본 문구 */
export function defaultHint(spec) {
  if (!spec) return '';
  if (spec.type === 'move') return `손을 ${dirKo(spec.dir || 'right')}으로 움직여 주세요`;
  if (spec.type === 'shake') {
    const axis = spec.dir && AXIS_KO[String(spec.dir).split('+')[0]];
    return axis ? `손을 ${axis} 흔들어 주세요` : '손을 가볍게 흔들어 주세요';
  }
  if (spec.type === 'sequence') return spec.hintFirst || '처음 모양을 먼저 만들어 주세요';
  if (spec.type === 'twist') {
    return spec.dir === 'in' ? '손목을 안쪽으로 돌려 주세요' : spec.dir === 'out' ? '손목을 바깥쪽으로 돌려 주세요' : '손목을 돌려 주세요';
  }
  return '';
}
