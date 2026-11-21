// 흔들림 줄이기 · 잠깐 버티기 판정
// - createOneEuro: 값 하나를 부드럽게 (One Euro 필터: 천천히 움직이면 많이 다듬고, 빨리 움직이면 바로 따라감)
// - createLandmarkSmoother: 손 하나의 마디 21개(landmarks + world)를 한꺼번에 부드럽게
// - createHold: "맞는 모양을 0.6초 동안 유지했나?" (중간에 잠깐 틀린 프레임이 섞여도 괜찮게)
// 시간 t 는 모두 밀리초(performance.now() 같은 값)

const TWO_PI = 2 * Math.PI;
const alpha = (cutoff, dt) => 1 / (1 + 1 / (TWO_PI * cutoff * dt));

/**
 * 값 하나용 One Euro 필터
 * @param {{minCutoff?: number, beta?: number, dCutoff?: number}} [o]
 *   minCutoff(Hz): 가만히 있을 때 얼마나 다듬을지 (작을수록 부드럽지만 느림)
 *   beta: 빨리 움직일 때 얼마나 빨리 따라갈지 (클수록 빠름)
 */
export function createOneEuro({ minCutoff = 1.0, beta = 0, dCutoff = 1.0 } = {}) {
  let x = null, dx = 0, tPrev = null;
  return {
    filter(value, t) {
      if (x === null || tPrev === null || !(t > tPrev)) {
        const first = x === null;
        x = first ? value : x;
        tPrev = t;
        if (first) return value;
        return x;
      }
      const dt = (t - tPrev) / 1000;
      tPrev = t;
      const rawDx = (value - x) / dt;
      dx += alpha(dCutoff, dt) * (rawDx - dx);
      const cutoff = minCutoff + beta * Math.abs(dx);
      x += alpha(cutoff, dt) * (value - x);
      return x;
    },
    reset() {
      x = null; dx = 0; tPrev = null;
    },
  };
}

/**
 * 손 하나의 마디를 부드럽게 (One Euro, 마디마다 3차원 속도로 다듬는 정도를 정함)
 * @param {object} [o]
 * @param {number} [o.minCutoff=1.0] 가만히 있을 때 차단 주파수(Hz)
 * @param {number} [o.beta=10] 영상 좌표(0~1) 속도에 대한 반응 (클수록 빨리 따라감)
 * @param {number} [o.worldBeta=beta*2.2] world(미터) 좌표 속도에 대한 반응
 * @param {number} [o.dCutoff=1.0] 속도를 다듬는 차단 주파수(Hz)
 * @param {number} [o.resetAfterMs=400] 이만큼 손이 안 보였으면 처음부터 다시
 * @returns {{ smooth(hand, t): object, reset(): void }}
 *   smooth 는 { landmarks, world, handedness, score } 를 새 객체로 돌려줌 (원본은 그대로)
 *   손잡이(handedness)가 바뀌면 자동으로 처음부터 다시 다듬음
 */
export function createLandmarkSmoother({ minCutoff = 1.0, beta = 10, worldBeta, dCutoff = 1.0, resetAfterMs = 400 } = {}) {
  const wBeta = Number.isFinite(worldBeta) ? worldBeta : beta * 2.2;
  let state = null; // { t, side, img: {x, dx}, world: {x, dx} }

  const makeTrack = (pts) => ({
    x: Float64Array.from(pts.flatMap((p) => [p.x, p.y, p.z || 0])),
    dx: new Float64Array(pts.length * 3),
  });

  function step(track, pts, dt, b) {
    const out = new Array(pts.length);
    const aD = alpha(dCutoff, dt);
    for (let i = 0; i < pts.length; i++) {
      const o = i * 3;
      const raw = [pts[i].x, pts[i].y, pts[i].z || 0];
      let speed2 = 0;
      for (let a = 0; a < 3; a++) {
        const d = (raw[a] - track.x[o + a]) / dt;
        track.dx[o + a] += aD * (d - track.dx[o + a]);
        speed2 += track.dx[o + a] * track.dx[o + a];
      }
      const aX = alpha(minCutoff + b * Math.sqrt(speed2), dt);
      for (let a = 0; a < 3; a++) track.x[o + a] += aX * (raw[a] - track.x[o + a]);
      out[i] = { x: track.x[o], y: track.x[o + 1], z: track.x[o + 2] };
    }
    return out;
  }

  return {
    smooth(hand, t) {
      if (!hand || !Array.isArray(hand.landmarks)) return hand;
      const hasWorld = Array.isArray(hand.world) && hand.world.length === hand.landmarks.length;
      const side = hand.handedness;
      const fresh = !state || side !== state.side || !(t > state.t) || t - state.t > resetAfterMs
        || hasWorld !== !!state.world || state.img.x.length !== hand.landmarks.length * 3;
      if (fresh) {
        state = { t, side, img: makeTrack(hand.landmarks), world: hasWorld ? makeTrack(hand.world) : null };
        return { ...hand, landmarks: hand.landmarks.map((p) => ({ ...p })), world: hasWorld ? hand.world.map((p) => ({ ...p })) : hand.world };
      }
      const dt = (t - state.t) / 1000;
      state.t = t;
      const landmarks = step(state.img, hand.landmarks, dt, beta);
      const world = hasWorld ? step(state.world, hand.world, dt, wBeta) : hand.world;
      return { ...hand, landmarks, world };
    },
    reset() {
      state = null;
    },
  };
}

/**
 * 버티기 판정: 최근 ms 동안 맞은 프레임 비율이 ratio 이상이면 held
 * @param {{ms?: number, ratio?: number}} [o]
 * @returns {{ push(pass: boolean, t: number): {held: boolean, progress: number, ratio: number}, reset(): void, readonly active: boolean }}
 *   - 처음 맞은 프레임부터 시간을 재고, progress = 지난 시간 / ms (0~1)
 *   - 틀린 프레임이 창(ms) 안에서 (1 - ratio) 몫보다 많아지면 처음부터 다시
 *   - held 는 ms 이상 버텼고 지금 프레임도 맞을 때 true
 */
export function createHold({ ms = 600, ratio = 0.8 } = {}) {
  let since = null;
  let samples = [];
  const idle = (r = 0) => ({ held: false, progress: 0, ratio: r });

  function reset() {
    since = null;
    samples = [];
  }

  function push(pass, t) {
    if (since === null) {
      if (!pass) return idle();
      since = t;
      samples = [];
    }
    samples.push({ t, pass: !!pass });
    while (samples.length > 1 && samples[0].t < t - ms) samples.shift();
    const n = samples.length;
    let fails = 0;
    for (const s of samples) if (!s.pass) fails++;
    const avgDt = n >= 2 ? (samples[n - 1].t - samples[0].t) / (n - 1) : 1000 / 30;
    const windowN = Math.max(n, Math.round(ms / Math.max(avgDt, 1)) + 1);
    const allowed = Math.floor((1 - ratio) * windowN + 1e-9);
    const r = (n - fails) / n;
    if (fails > allowed) {
      reset();
      return idle(r);
    }
    const progress = Math.min(1, Math.max(0, (t - since) / ms));
    return { held: progress >= 1 && !!pass, progress, ratio: r };
  }

  return {
    push,
    reset,
    get active() {
      return since !== null;
    },
  };
}
