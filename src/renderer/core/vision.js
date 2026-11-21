// 보는 눈: 카메라 + 손 인식기를 하나로 묶어서 화면들에 HandFrame 을 나눠 줌
// - 보통: 웹캠(camera.js) + MediaPipe(tracker.js)
// - 자동 점검(selftest): 진짜 카메라는 절대 켜지 않고 가짜 손(synthetic-tracker.js)을 씀
// - 카메라를 쓰는 화면에 들어가면 켜고, 다른 화면으로 가면 잠시 뒤 끔 (사생활 · 전기 아끼기)
import { createCamera } from './camera.js';
import { loadSynthetic, pick } from './optional.js';
import { poseToHand } from '../engine/handmodel.js';

const IDLE_OFF_MS = 4000;

/**
 * @param {{ synthetic: boolean, settings: object }} o
 */
export function createVision({ synthetic = false, settings }) {
  const video = document.createElement('video');
  video.className = 'camera-video';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');

  const camera = synthetic
    ? null
    : createCamera({
        video,
        getSavedLabel: () => settings.get('cameraLabel'),
        saveLabel: (label) => settings.set('cameraLabel', label),
      });

  let tracker = null; // 진짜(MediaPipe) 또는 가짜 손
  let trackerPromise = null;
  let users = 0;
  let offTimer = 0;
  let lastFrame = null;
  let handSeen = false;
  const frameCbs = new Set();
  const stateCbs = new Set();

  const emitState = () => {
    const s = state();
    for (const fn of stateCbs) {
      try {
        fn(s);
      } catch (err) {
        console.error(err);
      }
    }
  };
  if (camera) camera.onChange(emitState);

  function onFrame(frame) {
    lastFrame = frame;
    const seen = frame.hands.length > 0;
    if (seen !== handSeen) {
      handSeen = seen;
      emitState();
    }
    for (const fn of frameCbs) {
      try {
        fn(frame);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function getTracker() {
    if (tracker) return tracker;
    if (!trackerPromise) {
      trackerPromise = (async () => {
        if (synthetic) {
          const mod = await loadSynthetic();
          const make = pick(mod, 'createSyntheticTracker', 'createTracker');
          tracker = make ? make({ loop: false }) : createFallbackSynthetic();
        } else {
          const { createTracker } = await import('./tracker.js');
          tracker = createTracker({ video });
        }
        tracker.onFrame(onFrame);
        if (tracker.onStatus) tracker.onStatus(emitState);
        return tracker;
      })();
    }
    return trackerPromise;
  }

  /** 카메라를 쓰는 화면이 들어올 때 */
  async function acquire() {
    users++;
    clearTimeout(offTimer);
    const t = await getTracker();
    if (camera) {
      const ok = await camera.start();
      if (!ok) {
        emitState();
        return false;
      }
    }
    if (users > 0) await t.start();
    emitState();
    return true;
  }

  /** 그 화면이 나갈 때 */
  function release() {
    users = Math.max(0, users - 1);
    if (users > 0) return;
    clearTimeout(offTimer);
    offTimer = setTimeout(() => {
      if (users > 0) return;
      if (tracker) tracker.stop();
      if (camera) camera.stop();
      handSeen = false;
      emitState();
    }, IDLE_OFF_MS);
  }

  async function retry() {
    if (camera) await camera.start(camera.current || undefined);
    if (tracker && users > 0) await tracker.start();
    emitState();
  }

  function state() {
    const ts = tracker ? tracker.status : 'idle';
    return {
      synthetic,
      camera: synthetic ? 'synthetic' : camera.status, // 'off' | 'starting' | 'on' | 'error' | 'synthetic'
      cameraError: camera ? camera.error : null,
      cameraLabel: camera && camera.current ? camera.current.label : synthetic ? '가짜 손(점검용)' : '',
      cameras: camera ? camera.cameras : [],
      tracker: ts,
      delegate: tracker && tracker.delegate ? tracker.delegate : '',
      fps: tracker ? tracker.fps || 0 : 0,
      hand: handSeen,
      active: users > 0,
    };
  }

  /** 가짜 손에게 자세를 줌 (점검 · 시연용). pose: HandPose, opts: { side, center, size } */
  function setSyntheticPose(pose, opts = {}) {
    if (!synthetic || !tracker) return false;
    const fn = tracker.setPose || tracker.pose || tracker.show;
    if (typeof fn === 'function') {
      fn.call(tracker, pose, opts);
      return true;
    }
    return false;
  }

  /** 가짜 손을 숨김 (손 없음) */
  function clearSyntheticPose() {
    if (!synthetic || !tracker) return;
    const fn = tracker.clear || tracker.hide;
    if (typeof fn === 'function') fn.call(tracker);
    else if (tracker.setPose) tracker.setPose(null);
  }

  /** 가짜 손이 글자 하나를 해 보임 (움직임 포함). 대본 기능이 없으면 자세만 */
  function playSyntheticLetter(letter, opts = {}) {
    if (!synthetic || !tracker || !letter) return false;
    if (typeof tracker.playLetter === 'function') {
      tracker.playLetter(letter, opts);
      return true;
    }
    return setSyntheticPose(letter.pose, opts);
  }

  return {
    video,
    camera,
    acquire,
    release,
    retry,
    state,
    setSyntheticPose,
    clearSyntheticPose,
    playSyntheticLetter,
    get synthetic() {
      return synthetic;
    },
    get lastFrame() {
      return lastFrame;
    },
    get tracker() {
      return tracker;
    },
    onFrame(fn) {
      frameCbs.add(fn);
      return () => frameCbs.delete(fn);
    },
    onState(fn) {
      stateCbs.add(fn);
      return () => stateCbs.delete(fn);
    },
    nextCamera() {
      return camera ? camera.next().then(emitState) : Promise.resolve();
    },
    selectCamera(id) {
      return camera ? camera.select(id).then(emitState) : Promise.resolve();
    },
  };
}

// synthetic-tracker.js 가 아직 없을 때 쓰는 아주 작은 가짜 손 (handmodel 로 손을 만들어 30fps 로 보냄)
function createFallbackSynthetic() {
  let pose = null;
  let opts = {};
  let timer = 0;
  let status = 'idle';
  const cbs = new Set();
  const W = 1280;
  const H = 720;
  function tick() {
    const t = performance.now();
    const hands = pose ? [poseToHand(pose, { aspect: W / H, ...opts })] : [];
    for (const fn of cbs) fn({ t, videoW: W, videoH: H, hands, source: 'synthetic' });
  }
  return {
    start() {
      if (timer) return;
      status = 'running';
      timer = setInterval(tick, 33);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
      status = 'stopped';
    },
    setPose(p, o = {}) {
      pose = p;
      opts = o;
    },
    clear() {
      pose = null;
    },
    onFrame(fn) {
      cbs.add(fn);
      return () => cbs.delete(fn);
    },
    ready: Promise.resolve(),
    get status() {
      return status;
    },
    get fps() {
      return timer ? 30 : 0;
    },
    delegate: 'synthetic',
  };
}
