// 합성 손 인식기: 카메라 없이 손 모형(HandPose) 대본으로 HandFrame 을 만들어 보냄
// - core/tracker.js 와 같은 모양 { start, stop, onFrame, onStatus, ready, status, fps, delegate, source }
// - 자체 시험(--selftest) · 시연 · 단위 테스트용. 실제 카메라는 절대 켜지 않음
// - 대본(script): 장면 목록 [{ pose, ms, blend, dx, dy, center, size }]
//   · pose: HandPose (null 이면 그동안 손이 안 보임)
//   · blend: 앞 장면에서 이 장면으로 바뀌는 데 걸리는 시간(ms), ms: 바뀐 뒤 머무는 시간(ms)
//   · dx, dy: 수어하는 사람 기준 손 위치 옮김 (손바닥 길이 단위, + 오른쪽 / + 위)
//   · center, size: 이 장면의 손 위치(원본 영상 0~1)와 크기(영상 높이 대비 손바닥 길이)
import { poseToHand, lerpPose } from '../engine/handmodel.js';
import { seededRandom } from '../engine/geometry.js';
import { letterScript } from '../engine/letters.js';

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * @param {object} [o]
 * @param {object[]} [o.script=[]] 대본 (위 설명)
 * @param {boolean} [o.loop=true] 대본이 끝나면 처음부터
 * @param {number} [o.fps=30] 초당 프레임
 * @param {number} [o.videoW=1280] [o.videoH=720] 가짜 영상 크기
 * @param {'right'|'left'} [o.side='right'] 손
 * @param {number[]} [o.center=[0.5,0.55]] 기본 손 위치 (원본 영상 0~1)
 * @param {number} [o.size=0.24] 기본 손바닥 길이 (영상 높이 대비)
 * @param {number} [o.noise=0] 마디 떨림 크기 (손바닥 길이 대비, 예: 0.01)
 * @param {number} [o.seed=1] 떨림 난수 씨앗
 * @param {boolean} [o.world=true] world 마디도 만듦
 * @param {() => number} [o.now] 시계 (시험용)
 */
export function createSyntheticTracker(o = {}) {
  const {
    fps: targetFps = 30, videoW = 1280, videoH = 720, side = 'right', center = [0.5, 0.55], size = 0.24,
    noise = 0, seed = 1, world = true, now = nowMs,
  } = o;
  const aspect = videoW / videoH;
  let script = normalizeScript(o.script || []);
  let loop = o.loop !== false;
  let status = 'idle';
  let timer = null;
  let t0 = null;
  let fps = 0;
  let lastEmit = null;
  const frameCbs = new Set();
  const statusCbs = new Set();
  const endCbs = new Set();
  let ended = false;
  const rand = seededRandom(seed);

  const setStatus = (s) => {
    if (status === s) return;
    status = s;
    for (const fn of statusCbs) {
      try { fn(s); } catch (e) { console.error(e); }
    }
  };

  function normalizeScript(list) {
    return (Array.isArray(list) ? list : [list]).map((k) => ({
      pose: k.pose === undefined ? null : k.pose,
      ms: Math.max(0, k.ms ?? 1000),
      blend: Math.max(0, k.blend ?? 0),
      dx: k.dx || 0, dy: k.dy || 0,
      center: k.center || null,
      size: k.size || null,
    }));
  }

  const totalMs = () => script.reduce((s, k) => s + k.blend + k.ms, 0);

  // 장면 k 의 손 위치 (원본 영상 좌표)
  function placeOf(k) {
    const sz = k.size || size;
    const c = k.center || center;
    // S.x(+오른쪽) 는 원본 영상에서 왼쪽(-x), S.y(+위) 는 영상 위(-y)
    // 왼손이면 대본(오른손 기준)을 거울처럼: 오른쪽으로 옮기기 → 왼쪽으로 옮기기
    const dx = side === 'left' ? -k.dx : k.dx;
    return { c: [c[0] - (dx * sz) / aspect, c[1] - k.dy * sz], sz };
  }

  /** 대본 시작부터 t ms 지났을 때의 손 상태 { pose, center, size } (손이 없으면 null) */
  function stateAt(t) {
    if (!script.length) return null;
    const total = totalMs();
    let tt = t;
    if (total <= 0) tt = 0;
    else if (loop) tt = ((t % total) + total) % total;
    else if (t >= total) tt = total - 1e-6;
    let acc = 0;
    for (let i = 0; i < script.length; i++) {
      const k = script[i];
      const prev = script[i - 1] || (loop ? script[script.length - 1] : k);
      const dur = k.blend + k.ms;
      if (tt < acc + dur || i === script.length - 1) {
        const local = tt - acc;
        if (k.pose === null) return null;
        const pk = placeOf(k);
        if (local < k.blend && prev && prev.pose !== null) {
          const u = smooth(local / k.blend);
          const pp = placeOf(prev);
          return {
            pose: lerpPose(prev.pose, k.pose, u),
            center: [pp.c[0] + (pk.c[0] - pp.c[0]) * u, pp.c[1] + (pk.c[1] - pp.c[1]) * u],
            size: pp.sz + (pk.sz - pp.sz) * u,
          };
        }
        return { pose: k.pose, center: pk.c, size: pk.sz };
      }
      acc += dur;
    }
    return null;
  }

  /** t ms 시점의 HandFrame (보내지는 않음) */
  function frameAt(t, stamp = t) {
    const st = stateAt(t);
    const hands = [];
    if (st) {
      const h = poseToHand(st.pose, { center: st.center, size: st.size, aspect, side });
      if (noise > 0) {
        const j = () => (rand() * 2 - 1) * noise * st.size;
        for (const p of h.landmarks) { p.x += j() / aspect; p.y += j(); }
        for (const p of h.world) { p.x += j() * 0.3; p.y += j() * 0.3; p.z += j() * 0.3; }
      }
      if (!world) delete h.world;
      hands.push(h);
    }
    return { t: stamp, videoW, videoH, hands, source: 'synthetic' };
  }

  function emit(frame) {
    if (lastEmit !== null && frame.t > lastEmit) {
      const inst = 1000 / (frame.t - lastEmit);
      fps = fps ? fps * 0.9 + inst * 0.1 : inst;
    }
    lastEmit = frame.t;
    for (const fn of frameCbs) {
      try { fn(frame); } catch (e) { console.error(e); }
    }
  }

  /** 시험용: 지금 시계(또는 주어진 t)로 한 프레임 만들어 바로 보냄 */
  function tick(t = now()) {
    if (t0 === null) t0 = t;
    const rel = t - t0;
    const frame = frameAt(rel, t);
    emit(frame);
    if (!loop && !ended && rel >= totalMs()) {
      ended = true;
      for (const fn of endCbs) {
        try { fn(); } catch (e) { console.error(e); }
      }
    }
    return frame;
  }

  function start() {
    if (timer) return;
    setStatus('running');
    const period = 1000 / targetFps;
    const step = () => {
      tick();
      timer = setTimeout(step, period);
    };
    step();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (status !== 'idle') setStatus('stopped');
  }

  /** 대본 바꾸기 (처음부터 다시) */
  function setScript(list, opts = {}) {
    script = normalizeScript(list);
    if (opts.loop !== undefined) loop = !!opts.loop;
    t0 = null;
    ended = false;
  }

  return {
    start,
    stop,
    tick,
    frameAt,
    stateAt,
    setScript,
    /** 한 자세를 계속 보여 줌 */
    setPose(pose, opts = {}) {
      setScript([{ pose, ms: 1000, ...opts }], { loop: true });
    },
    /** 손을 치움 (손이 안 보이는 화면) */
    clear() {
      setScript([{ pose: null, ms: 1000 }], { loop: true });
    },
    /** 글자 하나를 해 보임 (움직임 · 두 동작 포함). 끝나면 마지막 모양에서 멈춤 (loop 를 주면 되풀이) */
    playLetter(letter, opts = {}) {
      setScript(letterScript(letter, opts), { loop: !!opts.loop });
    },
    /** 대본이 끝났을 때 (loop 가 false 일 때만) */
    onEnd(cb) {
      endCbs.add(cb);
      return () => endCbs.delete(cb);
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onStatus(cb) {
      statusCbs.add(cb);
      return () => statusCbs.delete(cb);
    },
    ready: Promise.resolve(),
    get status() { return status; },
    get fps() { return Math.round(fps); },
    get delegate() { return 'synthetic'; },
    get source() { return 'synthetic'; },
    get duration() { return totalMs(); },
  };
}

const smooth = (u) => u * u * (3 - 2 * u);
