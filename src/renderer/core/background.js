// 카메라 배경(가상 배경): 화상 통화(줌)처럼 내 뒤쪽만 흐리게 · 단색 · 그림 · 내 사진으로 자연스럽게 바꿔 보여 줌
// - 보이는 화면만 바꿈. 손 인식(tracker.js)은 언제나 원래 영상(<video>)을 그대로 씀
// - 사람 찾기: MediaPipe ImageSegmenter + 가로 화면용 selfie segmenter(256×144, 16:9 그대로, 빠름). "원래대로"가 아닐 때만 처음 불러옴
// - 가면 다듬기 · 합성은 그래픽 카드(WebGL2, bg-gl.js)에서 매 프레임: 영상 색을 따라 가장자리를 키우고, 손 마디로 손가락을 지키고,
//   빛 번짐 · 색 맞추기로 자연스럽게. WebGL2 가 없으면 Canvas2D 로 간단히
// - 사람은 거울처럼(좌우 반전) 그리고, 그림 · 사진 배경은 뒤집지 않음 (글자가 거꾸로 되지 않게)
import { getRaw, setRaw, remove } from './storage.js';
import { SEG_MODEL, createMaskFilter, handCapsules, coverRect, tintFromMean } from './bg-mask.js';
import { createGLCompositor } from './bg-gl.js';
import { paintScene } from './bg-scenes.js';

export { paintScene };

const WASM_PATH = new URL('../../../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href;
const MODEL_PATH = new URL(`../../../models/${SEG_MODEL.file}`, import.meta.url).href;
const BUNDLE = '../../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
const WORKER_URL = new URL('./bg-worker.js', import.meta.url).href;

export const BG_MODES = [
  ['none', '원래대로'],
  ['blur', '흐리게'],
  ['color', '단색'],
  ['scene', '그림'],
  ['photo', '내 사진'],
];

// 피부 · 손과 잘 구별되는 차분한 색 (주황 · 살구색은 피함)
export const BG_COLORS = [
  ['#24483f', '짙은 초록'],
  ['#1f3354', '남색'],
  ['#3d3357', '보라'],
  ['#4a5a66', '회청색'],
  ['#d9e2e4', '밝은 회색'],
];

export const BG_SCENES = [
  ['sky', '맑은 하늘'],
  ['mint', '민트 방'],
  ['board', '칠판'],
  ['forest', '숲'],
  ['dusk', '저녁 노을'],
  ['night', '밤하늘'],
];

const PHOTO_KEY = 'bgPhoto';
export const PHOTO_MAX_CHARS = 1_800_000; // localStorage 를 너무 많이 차지하지 않게 (JPEG 약 1.3MB)
const OUT_MAX_W = 960; // 합성 화면 크기 (영상이 더 커도 이만큼만)
const HANDS_MAX_AGE = 400; // ms: 이보다 오래된 손 마디는 쓰지 않음

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}


// 자동 점검용 가짜 사람 (진짜 카메라를 쓰지 않으므로): 벽 앞의 얼굴 · 어깨
function drawTestPerson(ctx, w, h, t) {
  ctx.fillStyle = '#c8c2b6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#a99f8f';
  ctx.fillRect(w * 0.06, h * 0.12, w * 0.2, h * 0.36); // 벽에 걸린 액자
  // 가운데에서 조금 오른쪽(원본 x≈0.6) → 거울 화면에서는 왼쪽(x≈0.4)에 보여야 함
  const cx = w * 0.6 + Math.sin(t / 900) * w * 0.005;
  ctx.fillStyle = '#2f4a7a'; // 몸 · 어깨
  ctx.beginPath();
  ctx.ellipse(cx, h * 1.08, w * 0.27, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9a27e'; // 목
  ctx.fillRect(cx - w * 0.035, h * 0.52, w * 0.07, h * 0.14);
  ctx.fillStyle = '#2a1d17'; // 머리카락
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.36, w * 0.095, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e1ad89'; // 얼굴
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.41, w * 0.08, h * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a1d17'; // 눈
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.03, h * 0.39, w * 0.008, h * 0.012, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + w * 0.03, h * 0.39, w * 0.008, h * 0.012, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9c5a4a'; // 입
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.beginPath();
  ctx.arc(cx, h * 0.45, w * 0.025, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
}


/**
 * @param {{ video: HTMLVideoElement, settings: object, synthetic?: boolean, toast?: Function }} o
 */
export function createBackground({ video, settings, synthetic = false, toast = () => {}, useWorker = true }) {
  const views = new Set(); // 붙어 있는 화면 캔버스들
  let segmenter = null;
  let worker = null;
  let pending = null; // 워커에 보낸 뒤 결과를 기다리는 것
  let segId = 0;
  let segLatency = 0;
  let srcGen = 0; // 영상 바뀔 때마다 늘림
  let loadPromise = null;
  let status = 'off'; // 'off' | 'loading' | 'ready' | 'error'
  let delegate = '';
  let rafId = 0;
  let lastTs = 0;
  let segEvery = 33; // 몇 ms 마다 사람을 찾을지 (느리면 늘림)
  let lastSegAt = -1e9;
  let segCost = 0;
  let segCount = 0;
  let frameCount = 0;
  let composeCost = 0;
  let fps = 0;
  let fpsFrames = 0;
  let fpsT = performance.now();
  let failCount = 0;
  let warned = false;
  let lastVideoTime = -1;
  let dirty = true;
  const statusCbs = new Set();

  let outW = 0;
  let outH = 0;
  const SW = SEG_MODEL.w;
  const SH = SEG_MODEL.h;
  const segCanvas = makeCanvas(SW, SH);
  const segCtx = segCanvas.getContext('2d', { willReadFrequently: true });
  const filter = createMaskFilter(SW, SH);
  const prob = new Float32Array(SW * SH);
  const luma = new Uint8Array(SW * SH);
  let hasMask = false;

  // 손 마디 (원본 영상 기준 0~1)
  let hands = [];
  let handsAt = -1e9;
  let caps = { caps: null, count: 0 };

  // 합성기: WebGL2 → 안 되면 Canvas2D
  let gl = null;
  let glTried = false;
  let glError = '';
  // Canvas2D 로 할 때 쓰는 것들
  const maskCanvas = makeCanvas(SW, SH);
  const maskCtx = maskCanvas.getContext('2d');
  let maskData = null;
  let lastMask = null;
  const person = makeCanvas(16, 9);
  const personCtx = person.getContext('2d');
  const blurSmall = makeCanvas(16, 9);
  const blurCtx = blurSmall.getContext('2d');

  // 배경 그림 (화면 크기로 cover 맞춤)
  const bgCanvas = makeCanvas(16, 9);
  const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });
  let bgKey = '';
  let tint = [1, 1, 1];
  let photoImg = null;
  let photoLoaded = null;

  // 점검용 영상: 가짜 사람(기본) 또는 setTestSource 로 넣은 사진
  let testSrc = null; // { el, canvas, hands, motion, shift }
  const testCanvas = synthetic ? makeCanvas(640, 360) : null;
  const testCtx = testCanvas ? testCanvas.getContext('2d') : null;

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

  function hasPhoto() {
    return !!getRaw(PHOTO_KEY, null);
  }

  /** 지금 쓰는 배경 (내 사진인데 사진이 없으면 원래대로) */
  function mode() {
    const m = settings.get('bg') || 'none';
    return m === 'photo' && !hasPhoto() ? 'none' : m;
  }

  function source(now) {
    if (testSrc) {
      const c = testSrc.canvas;
      // 사진을 아주 조금씩 좌우로 움직여 실제 영상처럼 (움직임 판단 · 떨림 확인용)
      const sx = 1.02;
      const dx = (testSrc.motion ? Math.sin(now / 600) * 0.006 : 0) - 0.01;
      testSrc.shift = { dx, sx };
      c.getContext('2d').drawImage(testSrc.el, dx * c.width, 0, c.width * sx, c.height);
      return { el: c, w: c.width, h: c.height };
    }
    if (testCanvas) return { el: testCanvas, w: testCanvas.width, h: testCanvas.height };
    if (video.readyState >= 2 && video.videoWidth > 0) return { el: video, w: video.videoWidth, h: video.videoHeight };
    return null;
  }

  // ───────── 모델 불러오기 (처음 한 번, GPU → CPU) ─────────
  function load() {
    if (loadPromise) return loadPromise;
    setStatus('loading');
    loadPromise = (async () => {
      // 1) 따로 일하는 곳(워커)에서 → 화면이 멈칫하지 않음
      if (useWorker && typeof Worker === 'function') {
        try {
          worker = await startWorker();
          setStatus('ready');
          kick();
          return worker;
        } catch (err) {
          console.warn('배경: 워커를 못 써서 화면 쪽에서 사람을 찾아요', err && err.message);
          worker = null;
        }
      }
      // 2) 화면 쪽(메인 스레드)에서
      const { FilesetResolver, ImageSegmenter } = await import(BUNDLE);
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const make = (d) =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: d },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      try {
        segmenter = await make('GPU');
        delegate = 'GPU';
      } catch (err) {
        console.warn('배경: GPU 를 못 써서 CPU 로 바꿔요', err && err.message);
        segmenter = await make('CPU');
        delegate = 'CPU';
      }
      setStatus('ready');
      kick();
      return segmenter;
    })().catch((err) => {
      console.error('배경 모델을 불러오지 못했어요', err);
      fail();
      return null;
    });
    return loadPromise;
  }

  function startWorker() {
    return new Promise((resolve, reject) => {
      let w;
      try {
        w = new Worker(WORKER_URL);
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => {
        w.terminate();
        reject(new Error('워커 준비 시간 초과'));
      }, 30000);
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'ready') {
          clearTimeout(timer);
          delegate = `${m.delegate} (worker)`;
          w.onmessage = onWorkerMessage;
          resolve(w);
        } else if (m.type === 'error') {
          clearTimeout(timer);
          w.terminate();
          reject(new Error(m.message));
        }
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        w.terminate();
        reject(new Error(e.message || '워커 오류'));
      };
      w.postMessage({ type: 'init', wasm: WASM_PATH, model: MODEL_PATH });
    });
  }

  function onWorkerMessage(e) {
    const m = e.data || {};
    if (!pending || m.id !== pending.id) return;
    const p = pending;
    pending = null;
    if (m.type !== 'mask') return;
    if (segCount >= 2) segCost = segCost ? segCost * 0.8 + m.cost * 0.2 : m.cost;
    segLatency = performance.now() - p.t;
    segEvery = Math.min(160, Math.max(33, segCost * 1.2));
    segCount++;
    if (p.gen !== srcGen) return; // 그사이 영상이 바뀜
    applyMask(m.mask, p.luma, p.px);
  }

  function fail() {
    setStatus('error');
    hideAll();
    if (!warned) {
      warned = true;
      toast('배경을 바꾸지 못해서 원래 화면으로 보여 드려요', { tone: 'hint', ms: 3600 });
    }
  }

  function hideAll() {
    for (const c of views) c.hidden = true;
  }

  function compositor() {
    if (!glTried) {
      glTried = true;
      try {
        gl = createGLCompositor();
      } catch (err) {
        glError = String(err && err.message);
        console.warn('배경: WebGL2 합성을 못 써서 간단한 방식으로 해요', err);
        gl = null;
      }
    }
    if (gl && gl.lost) {
      gl = null;
      glError = 'context lost';
    }
    return gl;
  }

  // ───────── 사람 찾기 ─────────
  function segment(src, now) {
    segCtx.drawImage(src.el, 0, 0, SW, SH);
    const px = segCtx.getImageData(0, 0, SW, SH).data;
    for (let i = 0, j = 0; i < luma.length; i++, j += 4) luma[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    const ts = Math.max(Math.round(now), lastTs + 1);
    lastTs = ts;
    if (worker) {
      // 결과는 onWorkerMessage 에서 (한 번에 하나만 보냄)
      pending = { id: ++segId, t: performance.now(), luma: luma.slice(), px, gen: srcGen };
      worker.postMessage({ type: 'seg', id: segId, ts, w: SW, h: SH, buf: px.buffer.slice(0) });
      return;
    }
    const t0 = performance.now();
    segmenter.segmentForVideo(segCanvas, ts, (res) => {
      const masks = res && res.confidenceMasks;
      if (!masks || !masks.length) return;
      // 가면이 1장이면 '사람일 확률', 여러 장이면 0번이 배경
      const single = masks.length === 1;
      const data = masks[0].getAsFloat32Array();
      const p = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) p[i] = single ? data[i] : 1 - data[i];
      applyMask(p, luma, px);
    });
    const cost = performance.now() - t0;
    // 처음 몇 번은 GPU 준비(셰이더) 때문에 아주 느림 → 빼고 셈
    if (segCount >= 2) segCost = segCost ? segCost * 0.8 + cost * 0.2 : cost;
    // 느리면 덜 자주 (최대 초당 약 6번까지 줄임). 합성은 매 프레임 그대로
    segEvery = Math.min(160, Math.max(33, segCost * 2));
    segCount++;
  }

  function applyMask(p, lum, px) {
    const n = Math.min(p.length, prob.length);
    for (let i = 0; i < n; i++) prob[i] = p[i];
    const m = filter.update(prob, lum);
    lastMask = m;
    const g = compositor();
    if (g) g.uploadMask(m, px, SW, SH);
    else putMask2D(m);
    hasMask = true;
    dirty = true;
  }

  function putMask2D(m) {
    if (!maskData) maskData = maskCtx.createImageData(SW, SH);
    const d = maskData.data;
    for (let i = 0; i < m.length; i++) {
      d[i * 4] = 255;
      d[i * 4 + 1] = 255;
      d[i * 4 + 2] = 255;
      d[i * 4 + 3] = m[i];
    }
    maskCtx.putImageData(maskData, 0, 0);
  }

  // ───────── 배경 그림 ─────────
  function loadedPhoto() {
    const url = getRaw(PHOTO_KEY, null);
    if (url !== photoLoaded) {
      photoLoaded = url;
      photoImg = null;
      if (url) {
        photoImg = new Image();
        photoImg.onload = () => {
          bgKey = '';
          dirty = true;
          kick();
        };
        photoImg.src = url;
      }
    }
    return photoImg && photoImg.complete && photoImg.naturalWidth ? photoImg : null;
  }

  /** 그림 · 사진 · 단색 배경을 화면 크기 캔버스에 준비 (바뀔 때만). 바뀌었으면 true */
  function prepareBackground(m) {
    const img = m === 'photo' ? loadedPhoto() : null;
    const what = m === 'color' ? settings.get('bgColor') : m === 'scene' ? settings.get('bgScene') : m === 'photo' ? `${photoLoaded ? photoLoaded.length : 0}:${!!img}` : '';
    const key = `${m}:${what}:${outW}x${outH}`;
    if (key === bgKey) return false;
    bgKey = key;
    if (bgCanvas.width !== outW || bgCanvas.height !== outH) {
      bgCanvas.width = outW;
      bgCanvas.height = outH;
    }
    const ctx = bgCtx;
    ctx.save();
    if (m === 'color') {
      ctx.fillStyle = settings.get('bgColor') || BG_COLORS[0][0];
      ctx.fillRect(0, 0, outW, outH);
    } else if (m === 'scene') {
      paintScene(ctx, settings.get('bgScene') || 'sky', outW, outH);
    } else if (m === 'photo' && img) {
      // 화상 통화 배경처럼 꽉 차게 (뒤집지 않음)
      const r = coverRect(img.naturalWidth, img.naturalHeight, outW, outH);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = BG_COLORS[3][0];
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.restore();
    // 평균 색 → 사람 색을 살짝 맞춤
    try {
      const d = ctx.getImageData(0, 0, outW, outH).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let k = 0;
      for (let i = 0; i < d.length; i += 4 * 97) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        k++;
      }
      tint = tintFromMean(r / k / 255, g / k / 255, b / k / 255);
    } catch {
      tint = [1, 1, 1];
    }
    return true;
  }

  // ───────── 합성 ─────────
  /** 손 캡슐 (원본 영상 방향, 화면 픽셀 크기 w×h) */
  function currentCaps(w, h) {
    let list;
    if (testSrc) {
      // 점검용 사진은 움직인 만큼 손 마디도 같이 옮김
      const s = testSrc.shift || { dx: 0, sx: 1 };
      list = testSrc.hands.map((hd) => ({ landmarks: hd.landmarks.map((p) => ({ x: s.dx + p.x * s.sx, y: p.y })) }));
    } else list = performance.now() - handsAt < HANDS_MAX_AGE ? hands : [];
    caps = handCapsules(list, w, h, caps.caps || undefined);
    return caps;
  }

  function sizeViews(w, h) {
    const live = [...views].filter((c) => c.isConnected);
    for (const c of live) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
    return live;
  }

  const blurK = () => Math.min(24, Math.max(4, Number(settings.get('bgBlur')) || 12));

  function composeGL(g, src, m, live) {
    g.resize(outW, outH);
    g.uploadVideo(src.el);
    if (m !== 'blur' && (prepareBackground(m) || !g.hasBg)) g.setBackground(bgCanvas);
    const cp = currentCaps(outW, outH);
    const ok = g.render({
      mode: m === 'blur' ? 'blur' : 'image',
      blurPasses: Math.round(blurK() / 3),
      caps: cp.caps,
      capCount: cp.count,
      tint,
      harmonize: settings.get('bgHarmonize') === false ? 0 : 0.6,
      wrap: settings.get('bgHarmonize') === false ? 0.08 : 0.32,
      decon: 0.85,
    });
    if (!ok) return false;
    for (const c of live) c.getContext('2d').drawImage(g.canvas, 0, 0);
    return true;
  }

  // WebGL2 가 없을 때: 작은 가면을 흐리게 키우고 손 캡슐을 더해 오려 냄
  function compose2D(src, m, live) {
    const w = outW;
    const h = outH;
    if (person.width !== w || person.height !== h) {
      person.width = w;
      person.height = h;
    }
    personCtx.globalCompositeOperation = 'source-over';
    personCtx.clearRect(0, 0, w, h);
    personCtx.filter = 'blur(2px)';
    personCtx.drawImage(maskCanvas, 0, 0, w, h);
    personCtx.filter = 'none';
    const cp = currentCaps(w, h);
    personCtx.strokeStyle = '#fff';
    personCtx.lineCap = 'round';
    for (let i = 0; i < cp.count; i++) {
      const o = i * 6;
      personCtx.lineWidth = cp.caps[o + 4] * 2.6;
      personCtx.beginPath();
      personCtx.moveTo(cp.caps[o], cp.caps[o + 1]);
      personCtx.lineTo(cp.caps[o + 2], cp.caps[o + 3]);
      personCtx.stroke();
    }
    personCtx.globalCompositeOperation = 'source-in';
    personCtx.drawImage(src.el, 0, 0, w, h);
    personCtx.globalCompositeOperation = 'source-over';
    const ctx = live[0].getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (m === 'blur') {
      const k = blurK();
      const bw = Math.max(16, Math.round(w / 6));
      const bh = Math.max(9, Math.round(h / 6));
      if (blurSmall.width !== bw || blurSmall.height !== bh) {
        blurSmall.width = bw;
        blurSmall.height = bh;
      }
      blurCtx.filter = `blur(${(k / 6).toFixed(1)}px)`;
      blurCtx.drawImage(src.el, 0, 0, bw, bh);
      blurCtx.filter = 'none';
      ctx.save();
      ctx.setTransform(-1, 0, 0, 1, w, 0);
      ctx.filter = `blur(${Math.round(k / 3)}px)`;
      ctx.drawImage(blurSmall, -w * 0.03, -h * 0.03, w * 1.06, h * 1.06);
      ctx.restore();
    } else {
      prepareBackground(m);
      ctx.drawImage(bgCanvas, 0, 0);
    }
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(person, 0, 0);
    ctx.restore();
    for (const c of live.slice(1)) c.getContext('2d').drawImage(live[0], 0, 0);
    return true;
  }

  function compose(src, m) {
    const w = Math.min(OUT_MAX_W, src.w);
    const h = Math.round((w * src.h) / src.w);
    const live = sizeViews(w, h);
    if (!live.length) return;
    outW = w;
    outH = h;
    const t0 = performance.now();
    const g = compositor();
    let ok = false;
    if (g) {
      try {
        ok = composeGL(g, src, m, live);
      } catch (err) {
        console.warn('배경: WebGL2 합성 실패 → 간단한 방식으로', err);
        glError = String(err && err.message);
        gl = null;
        if (lastMask) putMask2D(lastMask);
      }
    }
    if (!ok && !gl) ok = compose2D(src, m, live);
    if (!ok) return;
    const now = performance.now();
    composeCost = composeCost ? composeCost * 0.9 + (now - t0) * 0.1 : now - t0;
    for (const c of live) c.hidden = false;
    frameCount++;
    fpsFrames++;
    if (now - fpsT >= 1000) {
      fps = (fpsFrames * 1000) / (now - fpsT);
      fpsFrames = 0;
      fpsT = now;
    }
  }

  function tick() {
    rafId = 0;
    if (!views.size) return;
    const m = mode();
    if (m === 'none' || status === 'error') {
      hideAll();
      return;
    }
    if (status !== 'ready') {
      hideAll();
      load(); // 다 불러오면 다시 kick
      return;
    }
    const now = performance.now();
    if (testCtx && !testSrc) drawTestPerson(testCtx, testCanvas.width, testCanvas.height, now);
    const src = source(now);
    if (src) {
      try {
        // 진짜 카메라는 새 프레임이 왔을 때만 (같은 그림을 두 번 그리지 않게)
        const fresh = src.el !== video || video.currentTime !== lastVideoTime;
        if (src.el === video) lastVideoTime = video.currentTime;
        if (pending && now - pending.t > 2000) pending = null; // 워커가 답이 없으면 다시 보냄
        if (fresh && !pending && now - lastSegAt >= segEvery) {
          lastSegAt = now;
          segment(src, now);
        }
        if (hasMask && (fresh || dirty)) {
          dirty = false;
          compose(src, m);
        } else if (!hasMask) hideAll();
        failCount = 0;
      } catch (err) {
        console.error('배경 합성 실패', err);
        if (++failCount > 5) {
          fail();
          return;
        }
      }
    } else hideAll();
    rafId = requestAnimationFrame(tick);
  }

  function kick() {
    if (!rafId && views.size) rafId = requestAnimationFrame(tick);
  }

  settings.subscribe((_s, changed) => {
    if (!changed.some((k) => k.startsWith('bg'))) return;
    if (changed.includes('bg') && status === 'error' && mode() !== 'none') {
      // 한 번 실패했어도 사용자가 다시 고르면 다시 해 봄
      loadPromise = null;
      warned = false;
      setStatus('off');
    }
    dirty = true;
    if (mode() === 'none') hideAll();
    kick();
  });

  // ───────── 내 사진 ─────────
  /** 고른 사진을 1280×720 안으로 줄여 JPEG 로 저장 (너무 크면 화질을 낮춤). 저장한 글자 수를 돌려줌 */
  async function savePhoto(file) {
    if (!file || (file.type && !/^image\//.test(file.type))) throw new Error('사진 파일이 아니에요');
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error('이 사진은 열 수 없어요');
    }
    const k = Math.min(1, 1280 / bmp.width, 720 / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const c = makeCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    let url = '';
    for (const q of [0.85, 0.72, 0.6, 0.45]) {
      url = c.toDataURL('image/jpeg', q);
      if (url.length <= PHOTO_MAX_CHARS) break;
    }
    if (url.length > PHOTO_MAX_CHARS) throw new Error('사진이 너무 커요');
    if (!setRaw(PHOTO_KEY, url)) throw new Error('저장 공간이 모자라요');
    bgKey = '';
    dirty = true;
    kick();
    return url.length;
  }

  function clearPhoto() {
    remove(PHOTO_KEY);
    photoLoaded = null;
    photoImg = null;
    bgKey = '';
    if (settings.get('bg') === 'photo') settings.set('bg', 'none');
  }

  return {
    /** 카메라 판의 캔버스를 붙임. 돌려받은 함수를 부르면 뗌 */
    mount(canvas) {
      canvas.hidden = true;
      views.add(canvas);
      dirty = true;
      kick();
      return () => {
        views.delete(canvas);
        canvas.hidden = true;
      };
    },
    /** 손 인식 결과(원본 영상 기준 손 마디)를 받음 → 손가락이 배경에 묻히지 않게 지킴 */
    setHands(list) {
      hands = Array.isArray(list) ? list : [];
      handsAt = performance.now();
    },
    /**
     * 점검용: 카메라 대신 그림(사진)을 영상으로 씀. null 이면 원래대로
     * @param {HTMLCanvasElement|HTMLImageElement|null} el
     * @param {{ hands?: Array, motion?: boolean }} [o]
     */
    setTestSource(el, o = {}) {
      testSrc = el ? { el, canvas: makeCanvas(el.naturalWidth || el.width, el.naturalHeight || el.height), hands: o.hands || [], motion: !!o.motion, shift: null } : null;
      filter.reset();
      srcGen++;
      pending = null;
      hasMask = false;
      dirty = true;
      kick();
    },
    mode,
    hasPhoto,
    photoUrl: () => getRaw(PHOTO_KEY, null),
    savePhoto,
    clearPhoto,
    load,
    onStatus(fn) {
      statusCbs.add(fn);
      return () => statusCbs.delete(fn);
    },
    get status() {
      return status;
    },
    /** 점검용 수치 */
    stats: () => ({
      status,
      delegate,
      model: SEG_MODEL.file,
      compositor: gl ? 'webgl2' : glTried ? `canvas2d${glError ? ` (${glError.slice(0, 80)})` : ''}` : '',
      segCount,
      frameCount,
      fps: Math.round(fps * 10) / 10,
      segCost: Math.round(segCost * 10) / 10,
      segLatency: Math.round(segLatency),
      composeCost: Math.round(composeCost * 10) / 10,
      segEvery: Math.round(segEvery),
      hasMask,
      hands: caps.count,
      personShare: Math.round(filter.share * 1000) / 1000,
      mode: mode(),
    }),
  };
}
