// 가상 배경 계산 시험: 가면 떨림 줄이기 · 손 캡슐 · cover 위치 (화면 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaskFilter, handCapsules, handCoreAt, coverRect, tintFromMean, CAPS_PER_HAND, SEG_MODEL } from '../src/renderer/core/bg-mask.js';
import { poseToHand, PRESETS } from '../src/renderer/engine/handmodel.js';

const W = 8;
const H = 4;
const fill = (v) => new Float32Array(W * H).fill(v);
const luma = (v) => new Uint8Array(W * H).fill(v);

test('segmenter model is the landscape selfie model at its native 256x144', () => {
  assert.equal(SEG_MODEL.file, 'selfie_segmenter_landscape.tflite');
  assert.equal(SEG_MODEL.w / SEG_MODEL.h, 256 / 144);
});

test('mask filter: first frame passes through, clear values stay clear', () => {
  const f = createMaskFilter(W, H);
  assert.equal(f.update(fill(1), luma(100))[0], 255);
  const g = createMaskFilter(W, H);
  assert.equal(g.update(fill(0), luma(100))[0], 0);
});

test('mask filter: hysteresis keeps a person pixel stable when it flickers around 0.5', () => {
  const f = createMaskFilter(W, H);
  f.update(fill(0.95), luma(100));
  const outs = [];
  for (let i = 0; i < 20; i++) outs.push(f.update(fill(i % 2 ? 0.45 : 0.55), luma(100))[0]);
  const late = outs.slice(10);
  assert.ok(Math.min(...late) > 150, `stays mostly person: ${late}`);
  assert.ok(Math.max(...late) - Math.min(...late) < 40, `small flicker: ${late}`);
});

test('mask filter: still image smooths, moving image follows immediately (no ghost)', () => {
  const still = createMaskFilter(W, H);
  still.update(fill(0), luma(100));
  const s1 = still.update(fill(1), luma(100))[0]; // 밝기 그대로인데 갑자기 사람 → 천천히
  const moving = createMaskFilter(W, H);
  moving.update(fill(0), luma(100));
  const m1 = moving.update(fill(1), luma(160))[0]; // 영상이 크게 바뀜 → 바로 따라감
  assert.ok(s1 < 128, `still follows slowly: ${s1}`);
  assert.equal(m1, 255);
  // 가만있어도 몇 프레임 뒤에는 따라옴
  let v = s1;
  for (let i = 0; i < 8; i++) v = still.update(fill(1), luma(100))[0];
  assert.ok(v > 240, `catches up: ${v}`);
});

test('hand capsules cover every finger tip and the palm, and nothing far away', () => {
  const hand = poseToHand(PRESETS.open || Object.values(PRESETS)[0], { aspect: 16 / 9 });
  const { caps, count } = handCapsules([hand], 1280, 720);
  assert.equal(count, CAPS_PER_HAND);
  const lm = hand.landmarks;
  for (const i of [0, 2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 9]) {
    assert.ok(handCoreAt(lm[i].x * 1280, lm[i].y * 720, caps, count) > 0.99, `landmark ${i} inside`);
  }
  // 손끝은 안쪽 경계 근처까지만 (둥근 끝이 손가락 끝을 넘어 벽까지 잡지 않게)
  for (const i of [4, 8, 12, 16, 20]) {
    const v = handCoreAt(lm[i].x * 1280, lm[i].y * 720, caps, count);
    assert.ok(v > 0.05 && v < 0.9, `tip ${i} at the edge: ${v}`);
  }
  // 손목과 가운데 손가락 뿌리 사이 (손바닥 한가운데)
  const px = ((lm[0].x + lm[9].x) / 2) * 1280;
  const py = ((lm[0].y + lm[9].y) / 2) * 720;
  assert.ok(handCoreAt(px, py, caps, count) > 0.99, 'palm center');
  assert.equal(handCoreAt(5, 5, caps, count), 0);
  assert.equal(handCapsules([], 100, 100).count, 0);
  assert.equal(handCapsules([hand, hand, hand], 100, 100).count, CAPS_PER_HAND * 2, 'two hands at most');
});

test('cover fit fills the frame and keeps the aspect ratio', () => {
  const r = coverRect(1000, 1000, 1600, 900);
  assert.deepEqual(r, { x: 0, y: -350, w: 1600, h: 1600 });
  const t = coverRect(4000, 1000, 1600, 900);
  assert.equal(t.h, 900);
  assert.ok(t.x < 0 && Math.abs(t.w / t.h - 4) < 1e-9);
});

test('tint from background mean keeps brightness and stays subtle', () => {
  assert.ok(tintFromMean(0.5, 0.5, 0.5).every((c) => Math.abs(c - 1) < 1e-9));
  const t = tintFromMean(0.2, 0.3, 0.9);
  assert.ok(t.every((c) => c >= 0.85 && c <= 1.15));
  assert.ok(t[2] > 1 && t[0] < 1);
});
