// 가상 배경의 계산 부분 (화면 · DOM 없이 Node 에서도 돌아가는 순수 함수들)
// - 사람 가면(mask)의 떨림 줄이기: 움직이는 곳은 바로 따라가고, 가만있는 곳은 천천히 + 0.5 근처 머뭇거림(히스테리시스)
// - 손 지키기: 손 마디 21점으로 손가락 · 손바닥 · 손목을 감싸는 캡슐(둥근 막대) 목록을 만듦
// - 사진을 화면에 꽉 차게(cover) 놓는 위치 계산

/** 사람 찾기 모델: 가로 화면용 selfie segmenter (입력 256×144, 16:9 웹캠에 딱 맞고 빠름) */
export const SEG_MODEL = Object.freeze({ file: 'selfie_segmenter_landscape.tflite', w: 256, h: 144 });

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * 가면 떨림 줄이기.
 * update(prob, luma) — prob: 사람일 확률(0~1, w×h), luma: 같은 크기의 밝기(0~255, 움직임 판단용)
 * 돌려줌: Uint8Array(w×h) 0~255
 * @param {number} w @param {number} h
 * @param {{ still?: number, gain?: number, hi?: number, lo?: number, soft?: number }} [o]
 */
export function createMaskFilter(w, h, o = {}) {
  const n = w * h;
  const still = o.still ?? 0.3; // 가만있을 때 새 값을 섞는 비율 (작을수록 더 차분)
  const gain = o.gain ?? 14; // 밝기 변화(0~1) 당 섞는 비율 증가
  const hi = o.hi ?? 0.62; // 이보다 크면 '사람'으로 굳힘
  const lo = o.lo ?? 0.38; // 이보다 작으면 '배경'으로 굳힘
  const soft = o.soft ?? 0.22; // 경계 부드러움 (가운데에서 ± 이만큼)
  const prev = new Float32Array(n);
  const state = new Uint8Array(n);
  const prevLuma = new Float32Array(n);
  const diff = new Float32Array(n);
  const out = new Uint8Array(n);
  let first = true;
  let share = 0;

  function update(prob, luma) {
    // 1) 움직임: 앞 프레임과 밝기 차이 (이웃 4칸 중 가장 큰 값으로 살짝 넓힘)
    if (luma) {
      for (let i = 0; i < n; i++) {
        diff[i] = first ? 1 : Math.abs(luma[i] - prevLuma[i]) / 255;
        prevLuma[i] = luma[i];
      }
    } else diff.fill(first ? 1 : 0);
    let sum = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let m = diff[i];
        if (x > 0 && diff[i - 1] > m) m = diff[i - 1];
        if (x < w - 1 && diff[i + 1] > m) m = diff[i + 1];
        if (y > 0 && diff[i - w] > m) m = diff[i - w];
        if (y < h - 1 && diff[i + w] > m) m = diff[i + w];
        const p = clamp01(prob[i]);
        // 2) 움직이는 곳은 빨리, 가만있는 곳은 천천히 따라감 (잔상 없이 떨림만 줄임)
        const a = first ? 1 : Math.min(1, still + Math.max(0, m - 0.01) * gain);
        const s = prev[i] + a * (p - prev[i]);
        prev[i] = s;
        // 3) 히스테리시스: 한번 사람이면 조금 낮아져도 사람, 배경도 마찬가지
        if (s > hi) state[i] = 1;
        else if (s < lo) state[i] = 0;
        const c = state[i] ? 0.5 - (hi - 0.5) * 0.65 : 0.5 + (hi - 0.5) * 0.65;
        const v = smooth(c - soft, c + soft, s);
        out[i] = Math.round(v * 255);
        sum += v;
      }
    }
    first = false;
    share = sum / n;
    return out;
  }

  return {
    update,
    reset() {
      first = true;
      prev.fill(0);
      state.fill(0);
    },
    get share() {
      return share;
    },
    w,
    h,
  };
}

// 손 마디 연결 (MediaPipe 21점): [시작, 끝, 안쪽 반지름, 바깥 반지름] (반지름은 손바닥 길이에 대한 비율)
// 안쪽(core)은 무조건 사람, 바깥(outer)까지는 손 색과 비슷한 곳만 사람으로 봄 → 손가락 가장자리가 또렷
const FINGER = [0.075, 0.18];
const THUMB = [0.085, 0.2];
const PALM = [0.13, 0.22];
export const HAND_BONES = [
  [1, 2, ...THUMB], [2, 3, ...THUMB], [3, 4, ...THUMB],
  [5, 6, ...FINGER], [6, 7, ...FINGER], [7, 8, ...FINGER],
  [9, 10, ...FINGER], [10, 11, ...FINGER], [11, 12, ...FINGER],
  [13, 14, ...FINGER], [14, 15, ...FINGER], [15, 16, ...FINGER],
  [17, 18, ...FINGER], [18, 19, ...FINGER], [19, 20, ...FINGER],
  [0, 1, ...PALM], [0, 5, ...PALM], [0, 9, ...PALM], [0, 13, ...PALM], [0, 17, ...PALM],
  [1, 5, ...PALM], [5, 9, ...PALM], [9, 13, ...PALM], [13, 17, ...PALM],
];
const TIPS = new Set([4, 8, 12, 16, 20]);
export const CAPS_PER_HAND = HAND_BONES.length + 1; // + 손목 아래 팔뚝 한 토막
export const MAX_HANDS = 2;

/**
 * 손 캡슐 목록. 좌표는 원본(뒤집지 않은) 영상 기준 픽셀 (W×H 크기).
 * @param {Array<{landmarks: Array<{x:number,y:number}>}>} hands
 * @param {number} W @param {number} H
 * @param {Float32Array} [out] 6개씩: ax, ay, bx, by, rCore, rOuter
 * @returns {{ caps: Float32Array, count: number }}
 */
export function handCapsules(hands, W, H, out) {
  const caps = out || new Float32Array(MAX_HANDS * CAPS_PER_HAND * 6);
  let k = 0;
  const list = Array.isArray(hands) ? hands.slice(0, MAX_HANDS) : [];
  for (const hand of list) {
    const lm = hand && hand.landmarks;
    if (!lm || lm.length < 21) continue;
    const P = (i) => [lm[i].x * W, lm[i].y * H];
    const d = (i, j) => Math.hypot((lm[i].x - lm[j].x) * W, (lm[i].y - lm[j].y) * H);
    // 손바닥 길이: 카메라 쪽을 가리켜 짧아 보여도 너무 작아지지 않게 여러 길이 중 큰 값
    const L = Math.max(d(0, 9), d(5, 17) * 1.35, d(0, 5) * 1.05, d(0, 17) * 1.1, 4);
    const push = (a, b, rc, ro) => {
      caps[k++] = a[0];
      caps[k++] = a[1];
      caps[k++] = b[0];
      caps[k++] = b[1];
      caps[k++] = rc * L;
      caps[k++] = ro * L;
    };
    for (const [i, j, rc, ro] of HAND_BONES) {
      let b = P(j);
      if (TIPS.has(j)) {
        // 손끝 마디는 끝을 안쪽(core 반지름만큼)으로 당김 → 둥근 끝이 손가락 끝을 넘어 벽까지 잡지 않게
        const a = P(i);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const k = Math.min(0.6, (rc * L) / len);
        b = [b[0] - (b[0] - a[0]) * k, b[1] - (b[1] - a[1]) * k];
      }
      push(P(i), b, rc, ro);
    }
    // 팔뚝: 손목에서 (손목 - 가운데 손가락 뿌리) 방향으로 조금
    const w0 = P(0);
    const m9 = P(9);
    const len = Math.hypot(w0[0] - m9[0], w0[1] - m9[1]) || 1;
    const fa = [w0[0] + ((w0[0] - m9[0]) / len) * L * 0.55, w0[1] + ((w0[1] - m9[1]) / len) * L * 0.55];
    push(w0, fa, 0.17, 0.27);
  }
  return { caps, count: k / 6 };
}

/** 점 p 에서 선분 ab 까지 거리 (손 가면 · 시험용) */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** 캡슐 안쪽(core)에 들어가는지 (0~1, 가장자리는 부드럽게) */
export function handCoreAt(px, py, caps, count) {
  let v = 0;
  for (let c = 0; c < count; c++) {
    const o = c * 6;
    const dd = segDist(px, py, caps[o], caps[o + 1], caps[o + 2], caps[o + 3]);
    v = Math.max(v, 1 - smooth(caps[o + 4] - 1.5, caps[o + 4] + 0.5, dd));
  }
  return v;
}

/** 그림을 화면에 꽉 차게(넘치는 쪽은 잘라 냄, 화상 통화 배경처럼) 놓을 위치 */
export function coverRect(sw, sh, dw, dh) {
  const s = Math.max(dw / sw, dh / sh);
  const w = sw * s;
  const h = sh * s;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

/** 배경색의 평균 → 사람 색을 살짝 맞출 때 쓰는 색조(밝기는 그대로, 각 채널 0.85~1.15) */
export function tintFromMean(r, g, b) {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  if (l < 1e-3) return [1, 1, 1];
  const f = (c) => Math.min(1.15, Math.max(0.85, c / l));
  return [f(r), f(g), f(b)];
}
