// 손 인식기: MediaPipe HandLandmarker 를 VIDEO 모드로, 좌우를 뒤집지 않은 원본 영상에 돌림
// - 손 2개까지, 그래픽 카드(GPU)로 먼저 해 보고 안 되면 CPU 로
// - 매 프레임 HandFrame { t, videoW, videoH, hands, source: 'camera' } 을 알려 줌
// - 영상을 거울처럼 보이게 하는 건 CSS 의 몫 (여기서는 원본 그대로)
import { FilesetResolver, HandLandmarker } from '../../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

const WASM_PATH = new URL('../../../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href;
const MODEL_PATH = new URL('../../../models/hand_landmarker.task', import.meta.url).href;

/**
 * @param {{ video: HTMLVideoElement }} o
 * @returns Tracker { start(), stop(), onFrame(cb) -> unsubscribe, onStatus(cb), ready, status, fps, delegate }
 *   status: 'idle' | 'loading' | 'warming'(첫 프레임 준비 중) | 'running' | 'stopped' | 'error'
 */
export function createTracker({ video }) {
  let landmarker = null;
  let delegate = 'GPU';
  let status = 'idle';
  let running = false;
  let rafId = 0;
  let lastVideoTime = -1;
  let frames = 0;
  let fps = 0;
  let fpsT = performance.now();
  let firstFrameDone = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => {}); // 처리 안 된 거절 경고 막기
  const frameCbs = new Set();
  const statusCbs = new Set();

  const setStatus = (s) => {
    if (status === s) return;
    status = s;
    for (const fn of statusCbs) {
      try {
        fn(s);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const create = (fileset, d) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: d },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let loading = null;
  function load() {
    if (loading) return loading;
    setStatus('loading');
    loading = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      try {
        landmarker = await create(fileset, 'GPU');
        delegate = 'GPU';
      } catch (err) {
        console.warn('GPU 손 인식을 못 써서 CPU 로 바꿔요:', err && err.message);
        landmarker = await create(fileset, 'CPU');
        delegate = 'CPU';
      }
      setStatus('warming'); // GPU 는 첫 프레임이 몇 초 걸림 (셰이더 준비)
      return landmarker;
    })().catch((err) => {
      console.error('손 인식 모델을 불러오지 못했어요', err);
      setStatus('error');
      rejectReady(err);
      throw err;
    });
    return loading;
  }

  function emit(frame) {
    for (const fn of frameCbs) {
      try {
        fn(frame);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (!landmarker || video.readyState < 2 || !video.videoWidth) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const t = performance.now();
    let r;
    try {
      r = landmarker.detectForVideo(video, t);
    } catch (err) {
      console.warn('손 인식 한 프레임 실패', err && err.message);
      return;
    }
    if (!firstFrameDone) {
      firstFrameDone = true;
      setStatus('running');
      resolveReady();
    }
    frames++;
    if (t - fpsT >= 1000) {
      fps = (frames * 1000) / (t - fpsT);
      frames = 0;
      fpsT = t;
    }
    const hands = [];
    const n = (r && r.landmarks && r.landmarks.length) || 0;
    for (let i = 0; i < n; i++) {
      const h = (r.handedness && r.handedness[i] && r.handedness[i][0]) || {};
      hands.push({
        landmarks: r.landmarks[i],
        world: (r.worldLandmarks && r.worldLandmarks[i]) || [],
        // tasks-vision 1.2.0 은 원본 영상에서 사람 기준 좌우가 맞음 (바꾸지 않음)
        handedness: h.categoryName === 'Left' ? 'Left' : 'Right',
        score: Number(h.score) || 0,
      });
    }
    emit({ t, videoW: video.videoWidth, videoH: video.videoHeight, hands, source: 'camera' });
  }

  async function start() {
    if (running) return;
    running = true;
    try {
      await load();
    } catch {
      running = false;
      return;
    }
    if (!running) return;
    if (status === 'stopped') setStatus(firstFrameDone ? 'running' : 'warming');
    cancelAnimationFrame(rafId);
    loop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    if (status !== 'error' && status !== 'idle') setStatus('stopped');
  }

  return {
    start,
    stop,
    ready,
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onStatus(cb) {
      statusCbs.add(cb);
      return () => statusCbs.delete(cb);
    },
    get status() {
      return status;
    },
    get fps() {
      return fps;
    },
    get delegate() {
      return delegate;
    },
    get source() {
      return 'camera';
    },
  };
}
