// 가상 배경의 사람 찾기를 따로 일하는 곳(Web Worker)에서 돌림 → 화면 · 손 인식이 멈칫하지 않음
// (보통 스크립트 워커: MediaPipe 가 importScripts 로 WASM 로더를 불러와야 해서 모듈 워커가 아님)
/* global importScripts, Vision */
importScripts('../../../node_modules/@mediapipe/tasks-vision/vision_bundle.js');

// 오프라인 앱: MediaPipe 사용 통계 전송(odml.pa.googleapis.com)은 보내지 않고 조용히 끝냄
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = String((input && input.url) || input);
  if (/^https?:\/\//i.test(url) &&!url.startsWith(self.location.origin)) return Promise.resolve(new Response(null, { status: 204 }));
  return realFetch(input, init);
};

let segmenter = null;

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'init') {
    try {
      const { FilesetResolver, ImageSegmenter } = Vision;
      const fileset = await FilesetResolver.forVisionTasks(m.wasm);
      const make = (d) =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: m.model, delegate: d },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      let delegate = 'GPU';
      try {
        segmenter = await make('GPU');
      } catch {
        segmenter = await make('CPU');
        delegate = 'CPU';
      }
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  } else if (m.type === 'seg' && segmenter) {
    const t0 = performance.now();
    let out = null;
    try {
      const img = new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h);
      segmenter.segmentForVideo(img, m.ts, (res) => {
        const masks = res && res.confidenceMasks;
        if (!masks || !masks.length) return;
        const data = masks[0].getAsFloat32Array();
        out = new Float32Array(data.length);
        // 가면이 1장이면 '사람일 확률', 여러 장이면 0번이 배경
        if (masks.length === 1) out.set(data);
        else for (let i = 0; i < data.length; i++) out[i] = 1 - data[i];
      });
    } catch (err) {
      self.postMessage({ type: 'fail', id: m.id, message: String((err && err.message) || err) });
      return;
    }
    const cost = performance.now() - t0;
    if (out) self.postMessage({ type: 'mask', id: m.id, mask: out, cost }, [out.buffer]);
    else self.postMessage({ type: 'fail', id: m.id, message: 'no mask' });
  }
};
