// 얼굴 찾기: MediaPipe FaceDetector(BlazeFace short range, Apache-2.0) — 단어 수어 화면에서만 필요할 때 불러옴
// - 손 인식과 같은 원본(거울 반전 전) 영상에서 얼굴 상자를 찾아 { cx, cy, w, h, score } (0~1) 로 알려 줌
// - 단어 수어의 "몸 위치"(턱 · 이마 · 가슴 …)를 얼굴 기준으로 재는 데 씀
const MODEL = new URL('../../../models/blaze_face_short_range.tflite', import.meta.url).href;
const WASM = new URL('../../../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href;

export function createFaceFinder(video) {
  let detector = null, loading = null, timer = 0, latest = null, lastT = 0, error = null;
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const { FilesetResolver, FaceDetector } = await import('../../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks(WASM);
      detector = await FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 });
      return detector;
    })().catch((e) => { error = e; console.warn('얼굴 찾기를 시작하지 못했어요', e && e.message); return null; });
    return loading;
  }
  function tick() {
    if (!detector || !video || video.readyState < 2 || !video.videoWidth) return;
    const t = Math.max(performance.now(), lastT + 1);
    lastT = t;
    try {
      const r = detector.detectForVideo(video, t);
      const d = r && r.detections && r.detections[0];
      if (d && d.boundingBox) {
        const W = video.videoWidth, H = video.videoHeight, b = d.boundingBox;
        latest = { cx: (b.originX + b.width / 2) / W, cy: (b.originY + b.height / 2) / H, w: b.width / W, h: b.height / H, score: (d.categories && d.categories[0] && d.categories[0].score) || 0, t };
      } else latest = null;
    } catch (e) { /* 한 프레임 실패는 넘어감 */ }
  }
  return {
    async start() { await load(); clearInterval(timer); timer = setInterval(tick, 120); },
    stop() { clearInterval(timer); timer = 0; latest = null; },
    /** 가장 최근 얼굴 (0.6초보다 오래되면 null) */
    get face() { return latest && performance.now() - latest.t < 600 ? latest : null; },
    get error() { return error; },
    /** 점검용: 모델만 불러 보기 */
    load,
  };
}
