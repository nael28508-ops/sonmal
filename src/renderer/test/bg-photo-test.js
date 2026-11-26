// 자동 점검: 진짜 사람 사진(퍼블릭 도메인 CC0, tests/assets)을 카메라 대신 넣어 가상 배경을 확인
// - 사진에서 손 마디를 HandLandmarker(IMAGE)로 찾아 배경에 넘김 (실제 앱에서는 손 인식 결과를 매 프레임 넘김)
// - 모드마다 합성 화면을 모아 한 장(25), 머리카락 · 손가락 가장자리를 크게(26) 찍음
const BUNDLE = '../../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
const WASM = new URL('../../../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href;
const HAND_MODEL = new URL('../../../models/hand_landmarker.task', import.meta.url).href;

// [파일, 자를 x, y, 너비, 높이] — 16:9 로 잘라 웹캠처럼
export const PHOTOS = {
  waving: ['waving-man.jpg', 0, 60, 1280, 720],
  interp: ['sign-interpreter.jpg', 120, 170, 800, 450],
};

export async function loadPhoto(key, w = 1280) {
  const [f, x, y, cw, ch] = PHOTOS[key];
  const img = new Image();
  img.src = new URL(`../../../tests/assets/${f}`, import.meta.url).href;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((w * ch) / cw);
  c.getContext('2d').drawImage(img, x, y, cw, ch, 0, 0, c.width, c.height);
  return c;
}

// 한 번 만들어 계속 씀 (close() 하면 MediaPipe 가 막힌 통계 전송을 시도해 오류 기록이 남음)
let landmarker = null;
export async function findHands(canvases) {
  if (!landmarker) {
    const { FilesetResolver, HandLandmarker } = await import(BUNDLE);
    const fs = await FilesetResolver.forVisionTasks(WASM);
    landmarker = await HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' }, runningMode: 'IMAGE', numHands: 2 });
  }
  return canvases.map((c) => {
    const r = landmarker.detect(c);
    return (r.landmarks || []).map((landmarks) => ({ landmarks }));
  });
}

const nextFrames = (n) => new Promise((res) => {
  const step = () => (--n <= 0 ? res() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

/**
 * @param {object} t { app, check, shot, sleep, waitFor, log }
 */
export async function runPhotoTest({ app, check, shot, sleep, waitFor, log }) {
  const bg = app.background;
  const cv = document.querySelector('.camera-stage canvas.camera-bg');
  const waving = await loadPhoto('waving');
  const interp = await loadPhoto('interp');
  const [hW, hI] = await findHands([waving, interp]);
  check('hand landmarks found in the test photos', hW.length >= 1 && hI.length >= 1, `waving=${hW.length} interpreter=${hI.length}`);

  const grab = () => {
    const c = document.createElement('canvas');
    c.width = cv.width;
    c.height = cv.height;
    c.getContext('2d').drawImage(cv, 0, 0);
    return c;
  };
  const settle = async (frames = 24) => {
    const f0 = bg.stats().frameCount;
    await waitFor(() => bg.stats().frameCount > f0 + frames, 6000, 30);
  };

  // 1) 손 흔드는 사람: 모드마다
  bg.setTestSource(waving, { hands: hW, motion: true });
  const tiles = [];
  const modes = [
    ['blur', { bg: 'blur', bgBlur: 12 }, '흐리게'],
    ['color', { bg: 'color', bgColor: '#1f3354' }, '단색 (남색)'],
    ['scene', { bg: 'scene', bgScene: 'mint' }, '그림 (민트 방)'],
    ['photo', { bg: 'photo' }, '내 사진'],
  ];
  for (const [id, set, label] of modes) {
    app.settings.set(set);
    await settle(id === 'blur' ? 40 : 24);
    tiles.push([grab(), label]);
    check(`photo test: ${id} composites`, !cv.hidden && bg.stats().mode === id, JSON.stringify(bg.stats()));
  }

  // 손가락이 살아 있는지: 단색 배경에서 손가락 마디 위치의 색이 원래 사진 색과 같아야 함 (거울 좌표)
  app.settings.set({ bg: 'color', bgColor: '#1f3354' });
  bg.setTestSource(waving, { hands: hW, motion: false });
  await settle(30);
  const comp = grab().getContext('2d');
  const src = document.createElement('canvas');
  src.width = cv.width;
  src.height = cv.height;
  // 움직임 없는 사진도 합성기 안에서 1.02 배 · -1% 옮겨 그림 → 같은 변환으로 비교
  src.getContext('2d').drawImage(waving, -0.01 * cv.width, 0, cv.width * 1.02, cv.height);
  const sctx = src.getContext('2d');
  const hand = hW[0].landmarks;
  let bad = [];
  for (const i of [4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20]) {
    const rx = (-0.01 + hand[i].x * 1.02) * cv.width;
    const ry = hand[i].y * cv.height;
    const a = sctx.getImageData(Math.round(rx), Math.round(ry), 1, 1).data;
    const b = comp.getImageData(Math.round(cv.width - 1 - rx), Math.round(ry), 1, 1).data;
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    if (d > 60) bad.push(`${i}:${d}`);
  }
  check('fingers stay in the foreground (finger joints keep the photo color)', bad.length === 0, bad.join(' '));
  // 먼 배경(원본 오른쪽 위 벽)은 새 배경색이어야 함
  const far = comp.getImageData(Math.round(cv.width * 0.04), Math.round(cv.height * 0.08), 1, 1).data;
  check('far background is replaced', Math.abs(far[0] - 0x1f) + Math.abs(far[1] - 0x33) + Math.abs(far[2] - 0x54) < 30, String(Array.from(far)));
  // 손가락 사이 빈틈(검지 · 중지 끝 사이)은 배경이어야 함 (손 지키기가 너무 넓지 않게)
  const gx = ((hand[8].x + hand[12].x) / 2) * 1.02 - 0.01;
  const gy = (hand[8].y + hand[12].y) / 2;
  const gap = comp.getImageData(Math.round(cv.width - 1 - gx * cv.width), Math.round(gy * cv.height), 1, 1).data;
  check('gap between spread fingers shows the background', Math.abs(gap[0] - 0x1f) + Math.abs(gap[1] - 0x33) + Math.abs(gap[2] - 0x54) < 60, String(Array.from(gap)));

  // 속도: 움직이는 사진으로 3초 동안
  app.settings.set({ bg: 'scene', bgScene: 'mint' });
  bg.setTestSource(waving, { hands: hW, motion: true });
  await sleep(3200);
  const st = bg.stats();
  log(`BG_PERF ${JSON.stringify(st)}`);
  // 목표는 24fps 이상(한가한 컴퓨터에서 30fps = 점검 창 최대). 다른 프로그램이 그래픽 카드를 쓰면 느려질 수 있어 15 아래만 실패로 봄
  check('background composites smoothly (target 24+ fps, fail below 15)', st.fps >= 15 && st.compositor === 'webgl2', `fps=${st.fps} compose=${st.composeCost}ms seg=${st.segCost}ms every ${st.segEvery}ms, ${st.compositor}, ${st.delegate}`);

  // 2) 수어 통역사 (어두운 · 복잡한 배경, 긴 머리카락)
  bg.setTestSource(interp, { hands: hI, motion: true });
  app.settings.set({ bg: 'scene', bgScene: 'sky' });
  await settle(30);
  const interpSky = grab();
  app.settings.set({ bg: 'blur', bgBlur: 16 });
  await settle(40);
  const interpBlur = grab();

  // 25: 네 모드 한눈에 (손 흔드는 사람)
  const W = 640;
  const H = 360;
  const sheet = document.createElement('canvas');
  sheet.width = W * 2;
  sheet.height = H * 2;
  const g = sheet.getContext('2d');
  g.imageSmoothingQuality = 'high';
  tiles.forEach(([c, label], i) => {
    const x = (i % 2) * W;
    const y = Math.floor(i / 2) * H;
    g.drawImage(c, x, y, W, H);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x + 10, y + 10, 170, 34);
    g.fillStyle = '#fff';
    g.font = '600 18px "Malgun Gothic", sans-serif';
    g.fillText(label, x + 20, y + 34);
  });
  await showSheet(sheet, shot, '25-background-modes');

  // 26: 가장자리 크게 — 손가락 · 머리카락 (손 흔드는 사람 그림 배경) + 통역사 (하늘 · 흐림)
  const edges = document.createElement('canvas');
  edges.width = 1280;
  edges.height = 720;
  const e = edges.getContext('2d');
  e.fillStyle = '#111';
  e.fillRect(0, 0, 1280, 720);
  // 거울 화면 기준 비율 (가로 · 세로 같은 비율로 잘라 16:9 그대로)
  const crop = (c, fx, fy, f, dx, dy, label) => {
    e.drawImage(c, fx * c.width, fy * c.height, f * c.width, f * c.height, dx, dy, 640, 360);
    e.fillStyle = 'rgba(0,0,0,0.55)';
    e.fillRect(dx + 6, dy + 6, 210, 28);
    e.fillStyle = '#fff';
    e.font = '600 15px "Malgun Gothic", sans-serif';
    e.fillText(label, dx + 14, dy + 26);
  };
  crop(tiles[1][0], 0.66, 0.4, 0.3, 0, 0, '손가락 (단색)');
  crop(tiles[2][0], 0.3, 0, 0.36, 640, 0, '머리카락 (민트 방)');
  crop(interpSky, 0.42, 0.12, 0.55, 0, 360, '통역사 (맑은 하늘)');
  crop(interpBlur, 0.42, 0.12, 0.55, 640, 360, '통역사 (흐리게)');
  await showSheet(edges, shot, '26-background-edges');

  bg.setTestSource(null);
  return { hW, hI };
}

async function showSheet(sheet, shot, name) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;display:flex;align-items:center;justify-content:center';
  sheet.style.cssText = 'max-width:100%;max-height:100%';
  wrap.appendChild(sheet);
  document.body.appendChild(wrap);
  await nextFrames(3);
  await shot(name);
  wrap.remove();
}
