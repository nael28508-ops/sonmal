// 카메라 배경(가상 배경): 화상 통화처럼 내 뒤쪽만 흐리게 · 단색 · 그림 · 내 사진으로 바꿔 보여 줌
// - 보이는 화면만 바꿈. 손 인식(tracker.js)은 언제나 원래 영상(<video>)을 그대로 씀
// - MediaPipe ImageSegmenter(selfie segmenter)로 사람 영역을 찾음. "원래대로"가 아닐 때만 처음 불러옴
// - 작은 크기(256×144)로 사람을 찾고, 느리면 덜 자주 찾음. 실패하면 원래 영상 + 알림
// - 사람은 거울처럼(좌우 반전) 그리고, 그림 · 사진 배경은 뒤집지 않음 (글자가 거꾸로 되지 않게)
import { getRaw, setRaw, remove } from './storage.js';

const WASM_PATH = new URL('../../../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href;
const MODEL_PATH = new URL('../../../models/selfie_segmenter.tflite', import.meta.url).href;
const BUNDLE = '../../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

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
const SEG_W = 256; // 사람 찾기는 작은 크기로

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// 시드가 있는 의사 난수 (그림 배경이 매번 같게)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 코드로 만드는 그림 배경 (저작권 걱정 없는 부드러운 그라데이션 · 무늬, 차가운 색 위주라 손과 잘 구별됨) */
export function paintScene(ctx, id, w, h) {
  const r = rng(id.length * 977 + id.charCodeAt(0) * 31);
  const lin = (stops, x0 = 0, y0 = 0, x1 = 0, y1 = h) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  };
  const blob = (x, y, rad, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  ctx.save();
  if (id === 'sky') {
    ctx.fillStyle = lin([[0, '#3f78b5'], [0.7, '#86b6de'], [1, '#b9d6ec']]);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = r() * w;
      const y = h * (0.1 + r() * 0.45);
      for (let k = 0; k < 4; k++) blob(x + (k - 1.5) * w * 0.05, y + (r() - 0.5) * h * 0.04, w * (0.06 + r() * 0.05), 'rgba(255,255,255,0.35)');
    }
  } else if (id === 'mint') {
    ctx.fillStyle = lin([[0, '#2f7f78'], [1, '#1c514d']], 0, 0, w, h);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) blob(r() * w, r() * h, w * (0.04 + r() * 0.09), `rgba(190,255,240,${(0.08 + r() * 0.12).toFixed(2)})`);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
  } else if (id === 'board') {
    ctx.fillStyle = '#5b4632';
    ctx.fillRect(0, 0, w, h);
    const m = Math.round(w * 0.035);
    ctx.fillStyle = lin([[0, '#2c4a3c'], [1, '#203a2f']]);
    ctx.fillRect(m, m, w - m * 2, h - m * 2);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(h * 0.09)}px "Malgun Gothic", sans-serif`;
    const jamo = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ';
    for (let i = 0; i < 18; i++) ctx.fillText(jamo[Math.floor(r() * jamo.length)], m * 2 + r() * (w - m * 5), m * 3 + r() * (h - m * 5));
    ctx.globalAlpha = 1;
  } else if (id === 'forest') {
    ctx.fillStyle = lin([[0, '#2f5b4a'], [1, '#14302a']]);
    ctx.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['rgba(20,60,45,0.55)', 'rgba(15,45,35,0.65)', 'rgba(10,32,26,0.75)'][layer];
      for (let i = 0; i < 9; i++) ctx.fillRect(r() * w, 0, w * (0.025 + r() * 0.03), h);
    }
    for (let i = 0; i < 10; i++) blob(r() * w, r() * h * 0.6, w * (0.03 + r() * 0.05), 'rgba(210,240,200,0.12)');
  } else if (id === 'dusk') {
    ctx.fillStyle = lin([[0, '#2a2f5c'], [0.6, '#5b4a86'], [1, '#8a6a9e']]);
    ctx.fillRect(0, 0, w, h);
    blob(w * 0.78, h * 0.78, w * 0.3, 'rgba(255,200,230,0.18)');
    ctx.fillStyle = 'rgba(20,20,45,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 1; x += w / 12) ctx.lineTo(x, h * (0.8 + r() * 0.08));
    ctx.lineTo(w, h);
    ctx.fill();
  } else {
    // night
    ctx.fillStyle = lin([[0, '#0d1530'], [1, '#1d2b52']]);
    ctx.fillRect(0, 0, w, h);
    const u = Math.max(1, w / 1280);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(0.25 + r() * 0.6).toFixed(2)})`;
      const s = (r() < 0.9 ? 1.2 : 2.4) * u;
      ctx.fillRect(r() * w, r() * h * 0.85, s, s);
    }
    blob(w * 0.18, h * 0.2, w * 0.07, 'rgba(255,250,220,0.5)');
  }
  ctx.restore();
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
export function createBackground({ video, settings, synthetic = false, toast = () => {} }) {
  const views = new Set(); // 붙어 있는 화면 캔버스들
  let segmenter = null;
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
  let failCount = 0;
  let warned = false;
  const statusCbs = new Set();

  let outW = 0;
  let outH = 0;
  const segCanvas = makeCanvas(SEG_W, 144);
  const segCtx = segCanvas.getContext('2d');
  const maskCanvas = makeCanvas(SEG_W, 144);
  const maskCtx = maskCanvas.getContext('2d');
  let maskData = null;
  let prevMask = null;
  let hasMask = false;
  let personShare = 0; // 사람으로 본 넓이 비율 (점검용)
  const person = makeCanvas(16, 9);
  const personCtx = person.getContext('2d');
  const blurSmall = makeCanvas(16, 9);
  const blurCtx = blurSmall.getContext('2d');
  const sceneCache = new Map();
  let photoImg = null;
  let photoLoaded = null;

  // 점검용 가짜 영상
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

  function source() {
    if (testCanvas) return { el: testCanvas, w: testCanvas.width, h: testCanvas.height };
    if (video.readyState >= 2 && video.videoWidth > 0) return { el: video, w: video.videoWidth, h: video.videoHeight };
    return null;
  }

  // ───────── 모델 불러오기 (처음 한 번, GPU → CPU) ─────────
  function load() {
    if (loadPromise) return loadPromise;
    setStatus('loading');
    loadPromise = (async () => {
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

  // ───────── 사람 찾기 ─────────
  function segment(src, now) {
    const sh = Math.max(8, Math.round((SEG_W * src.h) / src.w));
    if (segCanvas.height !== sh) {
      segCanvas.height = sh;
      maskCanvas.height = sh;
      maskData = null;
      prevMask = null;
    }
    segCtx.drawImage(src.el, 0, 0, SEG_W, sh);
    const ts = Math.max(Math.round(now), lastTs + 1);
    lastTs = ts;
    const t0 = performance.now();
    segmenter.segmentForVideo(segCanvas, ts, (res) => {
      const masks = res && res.confidenceMasks;
      if (!masks || !masks.length) return;
      // 가면이 1장이면 '사람일 확률', 여러 장이면 0번이 배경
      const single = masks.length === 1;
      const data = masks[0].getAsFloat32Array();
      const n = Math.min(data.length, SEG_W * sh);
      if (!maskData || maskData.height !== sh) maskData = maskCtx.createImageData(SEG_W, sh);
      if (!prevMask || prevMask.length !== n) prevMask = new Float32Array(n);
      const px = maskData.data;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        let p = single ? data[i] : 1 - data[i];
        // 부드러운 경계 (0.3 ~ 0.7 사이를 매끄럽게)
        p = Math.min(1, Math.max(0, (p - 0.3) / 0.4));
        p = p * p * (3 - 2 * p);
        // 떨림 줄이기: 앞 프레임과 섞음
        const v = prevMask[i] * 0.35 + p * 0.65;
        prevMask[i] = v;
        sum += v;
        const j = i * 4;
        px[j] = 255;
        px[j + 1] = 255;
        px[j + 2] = 255;
        px[j + 3] = v * 255;
      }
      personShare = sum / n;
      maskCtx.putImageData(maskData, 0, 0);
      hasMask = true;
    });
    const cost = performance.now() - t0;
    // 처음 몇 번은 GPU 준비(셰이더) 때문에 아주 느림 → 빼고 셈
    if (segCount >= 2) segCost = segCost ? segCost * 0.8 + cost * 0.2 : cost;
    // 느리면 덜 자주 (최대 초당 약 6번까지 줄임). 합성은 매 프레임 그대로
    segEvery = Math.min(160, Math.max(33, segCost * 2));
    segCount++;
  }

  // ───────── 배경 그리기 ─────────
  function sceneCanvas(id) {
    const key = `${id}:${outW}x${outH}`;
    let c = sceneCache.get(key);
    if (!c) {
      c = makeCanvas(outW, outH);
      paintScene(c.getContext('2d'), id, outW, outH);
      sceneCache.clear();
      sceneCache.set(key, c);
    }
    return c;
  }

  function loadedPhoto() {
    const url = getRaw(PHOTO_KEY, null);
    if (url !== photoLoaded) {
      photoLoaded = url;
      photoImg = null;
      if (url) {
        photoImg = new Image();
        photoImg.src = url;
      }
    }
    return photoImg && photoImg.complete && photoImg.naturalWidth ? photoImg : null;
  }

  function drawBackground(ctx, m, src) {
    if (m === 'blur') {
      // 작게 줄였다가 키우면 값싸게 흐려짐 + 조금 더 흐림
      const k = Math.min(24, Math.max(4, Number(settings.get('bgBlur')) || 12));
      const bw = Math.max(16, Math.round(outW / 6));
      const bh = Math.max(9, Math.round(outH / 6));
      if (blurSmall.width !== bw || blurSmall.height !== bh) {
        blurSmall.width = bw;
        blurSmall.height = bh;
      }
      blurCtx.filter = `blur(${(k / 6).toFixed(1)}px)`;
      blurCtx.drawImage(src.el, 0, 0, bw, bh);
      blurCtx.filter = 'none';
      ctx.save();
      ctx.setTransform(-1, 0, 0, 1, outW, 0); // 영상이니 거울처럼
      ctx.filter = `blur(${Math.round(k / 3)}px)`;
      ctx.drawImage(blurSmall, -outW * 0.03, -outH * 0.03, outW * 1.06, outH * 1.06);
      ctx.restore();
    } else if (m === 'color') {
      ctx.fillStyle = settings.get('bgColor') || BG_COLORS[0][0];
      ctx.fillRect(0, 0, outW, outH);
    } else if (m === 'scene') {
      ctx.drawImage(sceneCanvas(settings.get('bgScene') || 'sky'), 0, 0);
    } else if (m === 'photo') {
      const img = loadedPhoto();
      if (img) {
        const s = Math.max(outW / img.naturalWidth, outH / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        ctx.drawImage(img, (outW - w) / 2, (outH - h) / 2, w, h);
      } else {
        ctx.fillStyle = BG_COLORS[3][0];
        ctx.fillRect(0, 0, outW, outH);
      }
    }
  }

  function compose(src) {
    const w = Math.min(OUT_MAX_W, src.w);
    const h = Math.round((w * src.h) / src.w);
    const live = [...views].filter((c) => c.isConnected);
    if (!live.length) return;
    outW = w;
    outH = h;
    for (const c of live) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
    if (person.width !== w || person.height !== h) {
      person.width = w;
      person.height = h;
    }
    // 1) 사람만 오려 냄 (원본 방향 그대로)
    personCtx.globalCompositeOperation = 'source-over';
    personCtx.clearRect(0, 0, w, h);
    personCtx.drawImage(src.el, 0, 0, w, h);
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.filter = 'blur(2px)'; // 가장자리를 살짝 부드럽게
    personCtx.drawImage(maskCanvas, 0, 0, w, h);
    personCtx.filter = 'none';
    personCtx.globalCompositeOperation = 'source-over';
    // 2) 배경 → 사람(거울)
    const first = live[0];
    const ctx = first.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground(ctx, mode(), src);
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(person, 0, 0);
    ctx.restore();
    for (const c of live.slice(1)) c.getContext('2d').drawImage(first, 0, 0);
    for (const c of live) c.hidden = false;
    frameCount++;
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
    if (testCtx) drawTestPerson(testCtx, testCanvas.width, testCanvas.height, now);
    const src = source();
    if (src) {
      try {
        if (now - lastSegAt >= segEvery) {
          lastSegAt = now;
          segment(src, now);
        }
        if (hasMask) compose(src);
        else hideAll();
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
    kick();
    return url.length;
  }

  function clearPhoto() {
    remove(PHOTO_KEY);
    photoLoaded = null;
    photoImg = null;
    if (settings.get('bg') === 'photo') settings.set('bg', 'none');
  }

  return {
    /** 카메라 판의 캔버스를 붙임. 돌려받은 함수를 부르면 뗌 */
    mount(canvas) {
      canvas.hidden = true;
      views.add(canvas);
      kick();
      return () => {
        views.delete(canvas);
        canvas.hidden = true;
      };
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
    stats: () => ({ status, delegate, segCount, frameCount, segCost: Math.round(segCost * 10) / 10, segEvery: Math.round(segEvery), hasMask, personShare: Math.round(personShare * 1000) / 1000, mode: mode() }),
  };
}
