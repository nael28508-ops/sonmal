// 수어 단어 (사용자가 등록한 낱말 수어) 알아보기 — 화면(DOM)을 쓰지 않는 순수 모듈
// - 한 프레임 → 특징(frameFeature): 주로 쓰는 손 모양(knn.vectorize) + 손 위치(손바닥 길이 단위) + 다른 손 모양 · 상대 위치
// - 녹화 한 번(buildRecording): 손이 안 보이는 앞뒤를 자르고, 움직임이 있는 부분만 남겨 SIGN_FRAMES 개로 고르게 다시 뽑음
// - 맞춰 보기: 동적 시간 정합(DTW). 같은 단어 녹화끼리의 거리로 "이 정도까지는 같은 단어" 기준을 스스로 정함
// - createSignSpotter: 카메라 프레임을 계속 받아 여러 길이의 창(지금 끝나는 구간)을 단어마다 맞춰 보고,
//   같은 단어가 잠깐 이어지면 확정(commit). 확정한 뒤에는 손을 바꾸거나 쉬어야 다음 단어를 받음
// - planTranslation: 글 → [등록 단어 | 지문자로 쓸 부분 | 띄어쓰기] 나누기
import { extractFeatures, pickHand } from './features.js';
import { vectorize } from './knn.js';

export const SIGN_VERSION = 1;
/** 녹화 · 창을 이만큼의 프레임으로 고르게 다시 뽑아서 비교 */
export const SIGN_FRAMES = 24;
/** 미리 보기용 손 마디는 이만큼까지만 저장 */
export const DEMO_FRAMES = 48;
/** 특징 묶음별 무게 */
export const SIGN_WEIGHTS = Object.freeze({ shape: 1.0, pos: 1.5, two: 1.6, shape2: 0.6, rel: 0.6 });
/** 엄격함별 기준 배율 */
export const STRICT_FACTOR = Object.freeze({ lenient: 1.3, normal: 1.0, strict: 0.78 });
/** 녹화가 하나뿐일 때 쓰는 기본 기준 거리 */
export const DEFAULT_THRESHOLD = 1.3;
const MIN_THRESHOLD = 0.85;
const MAX_THRESHOLD = 2.6;
const SHAPE_LEN = 46;

const r3 = (x) => Math.round(x * 1000) / 1000;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// 손바닥 가운데 (S 좌표 쪽: x = 수어하는 사람의 오른쪽, y = 위). 왼손잡이는 거울처럼
function palmCenter(lm, aspect, mirror) {
  let x = 0, y = 0;
  for (const i of [0, 5, 9, 13, 17]) {
    x += lm[i].x;
    y += lm[i].y;
  }
  x /= 5;
  y /= 5;
  return [(mirror ? x : -x) * aspect, -y];
}
const palmSize = (lm, aspect) => Math.hypot((lm[9].x - lm[0].x) * aspect, lm[9].y - lm[0].y);
const sideOf = (hand) => (String(hand.handedness || '').toLowerCase() === 'left' ? 'left' : 'right');
const packLm = (lm) => {
  const out = new Array(42);
  for (let i = 0; i < 21; i++) {
    out[i * 2] = r3(lm[i].x);
    out[i * 2 + 1] = r3(lm[i].y);
  }
  return out;
};

/** 저장한 마디(숫자 42개) → [{x, y}] */
export function unpackLandmarks(arr) {
  if (!Array.isArray(arr) || arr.length < 42) return null;
  const out = [];
  for (let i = 0; i < 21; i++) out.push({ x: arr[i * 2], y: arr[i * 2 + 1], z: 0 });
  return out;
}

/**
 * 한 프레임의 손들 → 수어 단어 특징 (주로 쓰는 손이 없으면 null)
 * @param {object[]} hands HandFrame.hands
 * @param {{ aspect?: number, dominant?: 'right'|'left', keepLandmarks?: boolean }} [o]
 * @returns {null | { s: number[], p: number[], z: number, s2: number[]|null, p2: number[]|null, lm?: [number[], number[]|null] }}
 */
export function frameFeature(hands, { aspect = 16 / 9, dominant = 'right', keepLandmarks = false } = {}) {
  const main = pickHand(hands, { dominant, aspect });
  if (!main) return null;
  const f = extractFeatures(main, { aspect, dominant: sideOf(main) });
  const s = f ? vectorize(f) : null;
  if (!s) return null;
  const mirror = dominant === 'left';
  const out = { s, p: palmCenter(main.landmarks, aspect, mirror), z: palmSize(main.landmarks, aspect), s2: null, p2: null };
  const other = (hands || []).find((h) => h !== main && Array.isArray(h.landmarks) && h.landmarks.length >= 21);
  if (other) {
    const f2 = extractFeatures(other, { aspect, dominant: sideOf(other) });
    const s2 = f2 ? vectorize(f2) : null;
    if (s2) {
      out.s2 = s2;
      out.p2 = palmCenter(other.landmarks, aspect, mirror);
    }
  }
  if (keepLandmarks) out.lm = [packLm(main.landmarks), other ? packLm(other.landmarks) : null];
  return out;
}

// ───────── 다시 뽑기 · 행렬 만들기 ─────────
const lerpArr = (a, b, u) => a.map((x, i) => x + (b[i] - x) * u);

/** 특징 프레임 목록을 n 개로 고르게 (시간 순서 그대로, 사이 값은 이어서) */
export function resampleFeatures(frames, n = SIGN_FRAMES) {
  const list = frames.filter(Boolean);
  if (!list.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = list.length === 1 ? 0 : (i * (list.length - 1)) / Math.max(1, n - 1);
    const a = list[Math.floor(x)];
    const b = list[Math.min(list.length - 1, Math.floor(x) + 1)];
    const u = x - Math.floor(x);
    const two = (a.s2 ? 1 - u : 0) + (b.s2 ? u : 0);
    const s2a = a.s2 || b.s2, s2b = b.s2 || a.s2;
    const p2a = a.p2 ? sub2(a.p2, a.p) : b.p2 ? sub2(b.p2, b.p) : null;
    const p2b = b.p2 ? sub2(b.p2, b.p) : p2a;
    out.push({
      s: lerpArr(a.s, b.s, u),
      p: lerpArr(a.p, b.p, u),
      z: a.z + (b.z - a.z) * u,
      two,
      s2: s2a ? lerpArr(s2a, s2b, u) : null,
      r: p2a ? lerpArr(p2a, p2b, u) : null,
    });
  }
  return out;
}
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];

/** 저장용으로 줄이기 (소수 셋째 자리) */
export function compactFrames(rs) {
  return rs.map((f) => {
    const o = { s: f.s.map(r3), p: f.p.map(r3), z: r3(f.z), two: r3(f.two) };
    if (f.s2) o.s2 = f.s2.map(r3);
    if (f.r) o.r = f.r.map(r3);
    return o;
  });
}

/**
 * 다시 뽑은 프레임들 → 비교용 행렬 (위치는 구간 평균을 빼고 손바닥 길이로 나눔 → 화면 어디서 해도 같음)
 * @returns {{ M: number[][], motion: number, two: number }}
 */
export function sequenceMatrix(rs, W = SIGN_WEIGHTS) {
  const palm = median(rs.map((f) => f.z).filter((z) => z > 1e-4)) || 0.2;
  const cx = mean(rs.map((f) => f.p[0]));
  const cy = mean(rs.map((f) => f.p[1]));
  let motion = 0;
  const M = rs.map((f) => {
    const px = (f.p[0] - cx) / palm, py = (f.p[1] - cy) / palm;
    motion = Math.max(motion, Math.hypot(px, py));
    const v = f.s.map((x) => x * W.shape);
    v.push(px * W.pos, py * W.pos, (f.two || 0) * W.two);
    for (let i = 0; i < SHAPE_LEN; i++) v.push(f.s2 ? (f.s2[i] || 0) * W.shape2 * (f.two || 0) : 0);
    v.push(f.r ? (f.r[0] / palm) * W.rel * (f.two || 0) : 0, f.r ? (f.r[1] / palm) * W.rel * (f.two || 0) : 0);
    return v;
  });
  return { M, motion, two: mean(rs.map((f) => f.two || 0)) };
}

function frameDist(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * 동적 시간 정합(DTW) 거리 — 지나간 길의 프레임 거리 평균 (속도가 조금 달라도 같은 동작이면 가까움)
 * @param {number[][]} A
 * @param {number[][]} B
 * @param {{ band?: number }} [o] 대각선에서 벗어날 수 있는 칸 수 (기본: 길이의 30%)
 */
export function dtw(A, B, { band } = {}) {
  const n = A.length, m = B.length;
  if (!n || !m) return Infinity;
  const w = Math.max(band ?? Math.ceil(Math.max(n, m) * 0.3), Math.abs(n - m) + 1);
  const INF = Infinity;
  let prevC = new Float64Array(m + 1).fill(INF), prevL = new Float64Array(m + 1);
  let curC = new Float64Array(m + 1), curL = new Float64Array(m + 1);
  prevC[0] = 0;
  for (let i = 1; i <= n; i++) {
    curC.fill(INF);
    curL.fill(0);
    const j0 = Math.max(1, Math.round((i * m) / n) - w), j1 = Math.min(m, Math.round((i * m) / n) + w);
    for (let j = j0; j <= j1; j++) {
      const d = frameDist(A[i - 1], B[j - 1]);
      // 대각선 · 위 · 왼쪽 중 평균이 가장 낮은 길
      let bc = prevC[j - 1], bl = prevL[j - 1];
      if (prevC[j] < INF && (bc === INF || prevC[j] / (prevL[j] + 1) < bc / (bl + 1))) { bc = prevC[j]; bl = prevL[j]; }
      if (curC[j - 1] < INF && (bc === INF || curC[j - 1] / (curL[j - 1] + 1) < bc / (bl + 1))) { bc = curC[j - 1]; bl = curL[j - 1]; }
      if (bc === INF) continue;
      curC[j] = bc + d;
      curL[j] = bl + 1;
    }
    [prevC, curC] = [curC, prevC];
    [prevL, curL] = [curL, prevL];
    prevC[0] = INF;
  }
  return prevC[m] < INF ? prevC[m] / prevL[m] : INF;
}

// ───────── 녹화 한 번 → 저장할 모양 ─────────
/**
 * @param {{ t: number, f: object|null }[]} samples 녹화 동안의 프레임 (frameFeature 결과, keepLandmarks 면 미리 보기도)
 * @param {{ minFrames?: number, aspect?: number }} [o]
 * @returns {{ ok: true, rec: { frames: object[], durMs: number }, demo: object|null } | { ok: false, reason: 'few'|'empty' }}
 */
export function buildRecording(samples, { minFrames = 8, aspect = 16 / 9 } = {}) {
  const list = (samples || []).filter((x) => x && x.f);
  if (!list.length) return { ok: false, reason: 'empty' };
  if (list.length < minFrames) return { ok: false, reason: 'few' };
  // 움직임 세기 (손바닥 길이/초) — 위치 변화 + 손 모양 변화
  const palm = median(list.map((x) => x.f.z)) || 0.2;
  const speed = list.map((x, i) => {
    if (!i) return 0;
    const a = list[i - 1], dt = Math.max(1, x.t - a.t) / 1000;
    const dp = Math.hypot(x.f.p[0] - a.f.p[0], x.f.p[1] - a.f.p[1]) / palm;
    const ds = frameDist(x.f.s, a.f.s) * 0.35;
    return (dp + ds) / dt;
  });
  const sm = speed.map((_, i) => mean(speed.slice(Math.max(0, i - 2), i + 3)));
  const active = sm.map((v) => v > 0.9);
  let a0 = active.indexOf(true), a1 = active.lastIndexOf(true);
  let from = 0, to = list.length - 1;
  if (a0 >= 0 && list[a1].t - list[a0].t >= 250) {
    // 움직이는 단어: 움직임 앞뒤로 조금씩만 남김
    const t0 = list[a0].t - 180, t1 = list[a1].t + 180;
    from = list.findIndex((x) => x.t >= t0);
    to = list.length - 1 - list.slice().reverse().findIndex((x) => x.t <= t1);
  } else {
    // 가만히 있는 단어: 가운데 부분 (손 모양이 자리 잡은 뒤)
    const n = list.length;
    from = Math.floor(n * 0.2);
    to = Math.max(from + minFrames - 1, Math.ceil(n * 0.85) - 1);
    to = Math.min(n - 1, to);
  }
  const kept = list.slice(Math.max(0, from), to + 1);
  if (kept.length < Math.min(minFrames, 4)) return { ok: false, reason: 'few' };
  const durMs = Math.max(300, kept[kept.length - 1].t - kept[0].t);
  const rec = { frames: compactFrames(resampleFeatures(kept.map((x) => x.f))), durMs: Math.round(durMs) };
  // 미리 보기용 손 마디
  let demo = null;
  const withLm = kept.filter((x) => x.f.lm && x.f.lm[0]);
  if (withLm.length >= 2) {
    const n = Math.min(DEMO_FRAMES, withLm.length);
    const frames = [];
    for (let i = 0; i < n; i++) {
      const x = withLm[Math.round((i * (withLm.length - 1)) / Math.max(1, n - 1))];
      frames.push(x.f.lm[1] ? [x.f.lm[0], x.f.lm[1]] : [x.f.lm[0]]);
    }
    demo = { durMs: rec.durMs, aspect: r3(aspect), frames };
  }
  return { ok: true, rec, demo };
}

// ───────── 단어 사전 ─────────
const normText = (t) => String(t || '').normalize('NFC').replace(/\s+/g, ' ').trim();
let idSeq = 0;
const newId = () => `w${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/**
 * 사용자가 등록한 수어 단어 모음
 * @returns 단어 추가 · 녹화 추가 · 지우기 · 기준 계산 · 맞춰 보기 · JSON
 */
export function createSignLexicon() {
  /** @type {Map<string, {id, text, recordings: {frames, durMs, at}[], demo, createdAt}>} */
  const words = new Map();
  const cache = new Map(); // id → { mats: [{M, motion, two, durMs}], thr }

  function prepare(w) {
    let c = cache.get(w.id);
    if (c) return c;
    const mats = w.recordings.map((r) => ({ ...sequenceMatrix(r.frames), durMs: r.durMs }));
    // 녹화끼리 거리 → 기준
    const ds = [];
    for (let i = 0; i < mats.length; i++) for (let j = i + 1; j < mats.length; j++) ds.push(dtw(mats[i].M, mats[j].M));
    const intra = ds.length ? Math.max(...ds) : null;
    const thr = intra === null ? DEFAULT_THRESHOLD : clamp(intra * 1.6 + 0.55, MIN_THRESHOLD, MAX_THRESHOLD);
    c = { mats, thr, intra, motion: mean(mats.map((m) => m.motion)), two: mean(mats.map((m) => m.two)) };
    cache.set(w.id, c);
    return c;
  }

  const api = {
    get size() {
      return words.size;
    },
    list() {
      return [...words.values()].sort((a, b) => a.createdAt - b.createdAt);
    },
    get(id) {
      return words.get(id) || null;
    },
    findByText(text) {
      const t = normText(text);
      for (const w of words.values()) if (w.text === t) return w;
      return null;
    },
    /** 단어 만들기 (같은 글이 있으면 그것) */
    addWord(text) {
      const t = normText(text).slice(0, 30);
      if (!t) throw new Error('단어를 써 주세요');
      const old = api.findByText(t);
      if (old) return old;
      const w = { id: newId(), text: t, recordings: [], demo: null, createdAt: Date.now() };
      words.set(w.id, w);
      return w;
    },
    /** 녹화 하나 붙이기 (buildRecording 결과의 rec, demo) */
    addRecording(id, rec, demo = null) {
      const w = words.get(id);
      if (!w || !rec || !Array.isArray(rec.frames) || !rec.frames.length) return false;
      w.recordings.push({ frames: rec.frames, durMs: rec.durMs || 1000, at: Date.now() });
      if (w.recordings.length > 5) w.recordings.shift();
      if (demo && (!w.demo || w.recordings.length === 1)) w.demo = demo;
      cache.delete(id);
      return true;
    },
    clearRecordings(id) {
      const w = words.get(id);
      if (!w) return;
      w.recordings = [];
      w.demo = null;
      cache.delete(id);
    },
    remove(id) {
      words.delete(id);
      cache.delete(id);
    },
    clear() {
      words.clear();
      cache.clear();
    },
    /** 이 단어의 기준 거리 (엄격함 반영) · 녹화끼리 거리 */
    info(id, strictness = 'normal') {
      const w = words.get(id);
      if (!w || !w.recordings.length) return null;
      const c = prepare(w);
      return { threshold: c.thr * (STRICT_FACTOR[strictness] || 1), intra: c.intra, motion: c.motion, two: c.two, durations: c.mats.map((m) => m.durMs) };
    },
    /** 녹화가 있는 단어들의 녹화 길이 (ms) */
    durations() {
      const out = [];
      for (const w of words.values()) for (const r of w.recordings) out.push(r.durMs);
      return out;
    },
    /**
     * 한 구간(다시 뽑은 특징 프레임)과 모든 단어 비교
     * @param {object[]|{M:number[][]}} win resampleFeatures 결과 또는 sequenceMatrix 결과
     * @returns {{ id, text, distance, threshold, pass, confidence }[]} 가까운 순
     */
    rank(win, { strictness = 'normal', durMs = null } = {}) {
      const W = win && win.M ? win : sequenceMatrix(win);
      const k = STRICT_FACTOR[strictness] || 1;
      const out = [];
      for (const w of words.values()) {
        if (!w.recordings.length) continue;
        const c = prepare(w);
        let best = Infinity;
        for (const m of c.mats) {
          // 길이가 너무 다른 창은 건너뜀 (durMs 를 줬을 때)
          if (durMs && (durMs < m.durMs * 0.6 || durMs > m.durMs * 1.7)) continue;
          best = Math.min(best, dtw(W.M, m.M));
        }
        if (best === Infinity) continue;
        const thr = c.thr * k;
        // 움직임 크기도 맞아야 함: 움직이는 단어를 가만히 하거나, 가만히 있는 단어를 크게 움직이면 거절
        const motionOk = c.motion > 0.5 ? W.motion >= c.motion * 0.5 : W.motion <= c.motion + 0.6;
        out.push({ id: w.id, text: w.text, distance: best, threshold: thr, pass: best <= thr && motionOk, motionOk, confidence: clamp(1 - best / (2 * thr), 0, 1) * (motionOk ? 1 : 0.5) });
      }
      return out.sort((a, b) => a.distance - b.distance);
    },
    toJSON() {
      return {
        app: 'Learn 수어',
        kind: 'sonmal-signs',
        version: SIGN_VERSION,
        words: api.list().map((w) => ({ id: w.id, text: w.text, createdAt: w.createdAt, recordings: w.recordings, demo: w.demo })),
      };
    },
    /** JSON → 단어들 (가져온 단어 수). 모양이 틀리면 Error */
    fromJSON(data, { merge = true } = {}) {
      const d = typeof data === 'string' ? JSON.parse(data) : data;
      if (!d || !Array.isArray(d.words)) throw new Error('수어 단어 파일이 아니에요');
      if (d.version && d.version > SIGN_VERSION) throw new Error('더 새로운 판에서 만든 파일이에요');
      if (!merge) api.clear();
      let n = 0;
      for (const x of d.words) {
        const text = normText(x && x.text);
        const recs = Array.isArray(x && x.recordings) ? x.recordings.filter((r) => r && Array.isArray(r.frames) && r.frames.length && r.frames.every((f) => Array.isArray(f.s) && Array.isArray(f.p))) : [];
        if (!text) continue;
        const old = api.findByText(text);
        const w = old || { id: typeof x.id === 'string' && !words.has(x.id) ? x.id : newId(), text, recordings: [], demo: null, createdAt: Number(x.createdAt) || Date.now() };
        if (old) w.recordings = [];
        w.recordings.push(...recs.slice(0, 5).map((r) => ({ frames: r.frames, durMs: Number(r.durMs) || 1000, at: Number(r.at) || Date.now() })));
        w.demo = x.demo && Array.isArray(x.demo.frames) ? x.demo : w.demo;
        words.set(w.id, w);
        cache.delete(w.id);
        n++;
      }
      return n;
    },
  };
  return api;
}

// ───────── 실시간 찾기 ─────────
/**
 * 카메라 프레임 특징을 계속 받아 등록 단어를 찾음
 * @param {{ lexicon, getStrictness?: () => string, stepMs?: number, holdStaticMs?: number, holdMovingMs?: number, releaseMs?: number }} o
 * @returns {{ push(feature|null, t): State, reset(), readonly state }}
 *   State = { candidate: {id,text,distance,threshold,confidence}|null, ranking, progress: 0..1, committed: {id,text}|null, armed, speed }
 */
export function createSignSpotter({ lexicon, getStrictness = () => 'normal', stepMs = 100, holdStaticMs = 500, holdMovingMs = 200, releaseMs = 300, margin = 0.85 } = {}) {
  let buf = []; // { t, f }
  let lastSeen = -Infinity;
  let lastEval = -Infinity;
  let cand = null; // { id, since }
  let armed = true;
  let blocked = null;
  let releaseSince = 0;
  let state = { candidate: null, ranking: [], progress: 0, committed: null, armed: true, speed: 0 };

  function reset() {
    buf = [];
    cand = null;
    armed = true;
    blocked = null;
    releaseSince = 0;
    lastEval = -Infinity;
    state = { candidate: null, ranking: [], progress: 0, committed: null, armed: true, speed: 0 };
  }

  function speedNow() {
    // 최근 0.25초 손 위치 속도 (손바닥 길이/초)
    if (buf.length < 2) return 0;
    const last = buf[buf.length - 1];
    let i = buf.length - 2;
    while (i > 0 && last.t - buf[i].t < 250) i--;
    const a = buf[i];
    const dt = (last.t - a.t) / 1000;
    if (dt <= 0) return 0;
    const palm = last.f.z || 0.2;
    return Math.hypot(last.f.p[0] - a.f.p[0], last.f.p[1] - a.f.p[1]) / palm / dt;
  }

  function evaluate(t) {
    const durs = lexicon.durations();
    if (!durs.length || buf.length < 4) return [];
    // 창 길이 후보 (녹화 길이의 0.75 · 1 · 1.3 배, 150ms 단위로 묶음)
    const lens = new Set();
    for (const d of durs) for (const k of [0.75, 1, 1.3]) lens.add(Math.max(300, Math.round((d * k) / 150) * 150));
    const span = t - buf[0].t;
    const best = new Map();
    for (const L of lens) {
      if (span < L * 0.8) continue;
      const win = buf.filter((x) => x.t >= t - L);
      if (win.length < 4) continue;
      const mat = sequenceMatrix(resampleFeatures(win.map((x) => x.f)));
      const realDur = win[win.length - 1].t - win[0].t;
      for (const r of lexicon.rank(mat, { strictness: getStrictness(), durMs: realDur })) {
        const old = best.get(r.id);
        if (!old || r.distance < old.distance) best.set(r.id, r);
      }
    }
    return [...best.values()].sort((a, b) => a.distance - b.distance);
  }

  function push(f, t) {
    state = { ...state, committed: null };
    if (!f) {
      // 손이 0.3초 넘게 안 보이면 구간을 끊고 다음 단어를 받을 준비
      if (t - lastSeen > 300) {
        buf = [];
        cand = null;
        armed = true;
        blocked = null;
        state = { ...state, candidate: null, ranking: [], progress: 0, armed: true, speed: 0 };
      }
      return state;
    }
    lastSeen = t;
    buf.push({ t, f });
    const maxDur = Math.max(1000, ...lexicon.durations());
    while (buf.length && t - buf[0].t > maxDur * 1.45 + 200) buf.shift();
    const speed = speedNow();
    if (t - lastEval < stepMs) return (state = { ...state, speed });
    lastEval = t;
    const ranking = evaluate(t);
    const top = ranking[0] && ranking[0].pass ? ranking[0] : null;
    const second = ranking[1];
    const clear = top && (!second || !second.pass || top.distance <= second.distance * margin);
    const best = clear ? top : null;
    // 확정한 뒤: 다른 것이 되거나 맞는 단어가 없어야 다시 받음
    if (!armed) {
      if (!best || best.id !== blocked) {
        if (!releaseSince) releaseSince = t;
        if (t - releaseSince >= releaseMs) {
          armed = true;
          blocked = null;
        }
      } else releaseSince = 0;
    }
    if (!best) cand = null;
    else if (!cand || cand.id !== best.id) cand = { id: best.id, since: t };
    let progress = 0;
    let committed = null;
    if (best && armed) {
      const info = lexicon.info(best.id, getStrictness());
      const holdMs = info && info.motion > 0.5 ? holdMovingMs : holdStaticMs;
      progress = clamp((t - cand.since) / holdMs, 0, 1);
      if (progress >= 1) {
        committed = { id: best.id, text: best.text, distance: best.distance, confidence: best.confidence };
        armed = false;
        blocked = best.id;
        releaseSince = 0;
        buf = buf.slice(-2); // 확정한 동작은 다음 비교에 쓰지 않음
        cand = null;
      }
    }
    state = { candidate: best, ranking: ranking.slice(0, 3), progress, committed, armed, speed };
    return state;
  }

  return {
    push,
    reset,
    get state() {
      return state;
    },
  };
}

// ───────── 글 → 수어 순서 ─────────
/**
 * 글을 [등록 단어 | 지문자로 쓸 부분 | 띄어쓰기] 로 나눔. 어절 앞에서부터 가장 긴 등록 단어를 먼저 고르고,
 * 남는 부분(조사 등)은 지문자로. 예) '병원에 가요' + ['병원'] → 병원(단어) · 에(지문자) · ␣ · 가요(지문자)
 * @param {string} text
 * @param {string[]} wordTexts 등록한 단어 글
 * @returns {{ type: 'word'|'spell'|'space', text: string }[]}
 */
export function planTranslation(text, wordTexts = []) {
  const src = normText(text);
  const dict = [...new Set(wordTexts.map(normText).filter(Boolean))].sort((a, b) => b.length - a.length);
  const out = [];
  const pushSpell = (s) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.type === 'spell') last.text += s;
    else out.push({ type: 'spell', text: s });
  };
  let i = 0;
  let atWordStart = true;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ') {
      if (out.length && out[out.length - 1].type !== 'space') out.push({ type: 'space', text: ' ' });
      i++;
      atWordStart = true;
      continue;
    }
    if (atWordStart) {
      const hit = dict.find((w) => src.startsWith(w, i));
      if (hit) {
        out.push({ type: 'word', text: hit });
        i += hit.length;
        atWordStart = src[i] === ' ' || i >= src.length ? true : false;
        // 단어 바로 뒤에 또 등록 단어가 붙어 있으면 그것도 단어로
        if (!atWordStart && dict.some((w) => src.startsWith(w, i))) atWordStart = true;
        continue;
      }
    }
    // 문장 부호 등 지문자가 없는 것은 그대로 지문자 부분에 넣음 (보여 줄 때 건너뜀)
    pushSpell(ch);
    i++;
    atWordStart = false;
  }
  while (out.length && out[out.length - 1].type === 'space') out.pop();
  return out;
}
