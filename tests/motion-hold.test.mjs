// 버티기(hold) · 움직임(motion) · 합성 손 인식기로 처음부터 끝까지 시험 (카메라 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHold, createLandmarkSmoother, createOneEuro } from '../src/renderer/engine/filters.js';
import { createMotionTracker, countStrokes } from '../src/renderer/engine/motion.js';
import { extractFeatures, pickHand } from '../src/renderer/engine/features.js';
import { evaluate, classify } from '../src/renderer/engine/rules.js';
import { getLetter, SPELLING_LETTERS } from '../src/renderer/engine/letters.js';
import { PRESETS, poseToHand } from '../src/renderer/engine/handmodel.js';
import { createSyntheticTracker } from '../src/renderer/core/synthetic-tracker.js';

test('hold: 0.6초 버티면 held, 잠깐 틀린 프레임은 괜찮고 많이 틀리면 처음부터', () => {
  const h = createHold({ ms: 600, ratio: 0.8 });
  let r;
  for (let t = 0; t <= 600; t += 33) r = h.push(t !== 300, t);
  r = h.push(true, 633);
  assert.equal(r.held, true);
  const h2 = createHold({ ms: 600, ratio: 0.8 });
  for (let t = 0; t <= 300; t += 33) h2.push(true, t);
  for (let t = 333; t <= 500; t += 33) r = h2.push(false, t);
  assert.equal(r.held, false);
  assert.equal(r.progress, 0);
  assert.equal(h2.active, false);
  assert.deepEqual(createHold().push(false, 0), { held: false, progress: 0, ratio: 0 });
});

test('One Euro · 마디 다듬기: 가만히 있으면 떨림이 줄어듦', () => {
  const f = createOneEuro({ minCutoff: 1, beta: 0 });
  let out = 0;
  for (let i = 0; i < 60; i++) out = f.filter(i % 2 ? 1 : -1, i * 33);
  assert.ok(Math.abs(out) < 0.5);
  const s = createLandmarkSmoother();
  const hand = poseToHand(PRESETS.open);
  const a = s.smooth(hand, 0);
  const b = s.smooth({ ...hand, landmarks: hand.landmarks.map((p) => ({ ...p, x: p.x + 0.01 })) }, 33);
  assert.ok(b.landmarks[0].x > a.landmarks[0].x && b.landmarks[0].x < a.landmarks[0].x + 0.01);
  assert.notEqual(b.landmarks, hand.landmarks);
});

test('countStrokes: 좌우 흔들기 획 세기', () => {
  assert.equal(countStrokes([0, 0.5, 1, 0.5, 0, 0.5, 1], 0.8), 3);
  assert.equal(countStrokes([0, 0.1, -0.1, 0.05], 0.3), 0);
});

// 합성 인식기로 글자 하나를 처음부터 끝까지 (배우기 화면과 같은 흐름)
function runLetter(letter, { side = 'right', dominant = 'right', script = null, ms = 4000 } = {}) {
  const tr = createSyntheticTracker({ side });
  if (script) tr.setScript(script, { loop: false });
  else tr.playLetter(letter);
  const motion = createMotionTracker();
  const hold = createHold({ ms: 600 });
  let success = null, last = null;
  for (let t = 0; t <= ms; t += 33) {
    const fr = tr.tick(t);
    const hand = pickHand(fr.hands, { dominant });
    const f = hand ? extractFeatures(hand, { aspect: fr.videoW / fr.videoH, dominant }) : null;
    motion.push(f, t);
    const ms_ = letter.motion ? motion.check(letter.motion) : null;
    last = evaluate(letter, f, { motionState: ms_ });
    if (hold.push(last.pass, t).held && success === null) success = t;
  }
  return { success, last };
}

test('합성 인식기: 정적 글자 · 된소리 · 흔들기 · 두 동작 모두 성공', () => {
  for (const id of ['ㄱ', 'ㅂ', 'ㄲ', 'ㅃ', 'ㅆ', 'num-10', 'ㅘ', 'ㅙ', 'ㅝ', 'ㅞ']) {
    const { success, last } = runLetter(getLetter(id));
    assert.ok(success !== null, `${id}: ${last.worst && last.worst.msg}`);
  }
});

test('합성 인식기: 왼손잡이(왼손, 거울 판정)도 된소리 · 두 동작 성공', () => {
  for (const id of ['ㄲ', 'ㅝ', 'ㄴ']) {
    const { success, last } = runLetter(getLetter(id), { side: 'left', dominant: 'left' });
    assert.ok(success !== null, `${id}: ${last.worst && last.worst.msg}`);
  }
});

test('움직임이 없으면 된소리 · 두 동작 글자는 성공하지 않음', () => {
  const g = getLetter('ㄱ');
  const r1 = runLetter(getLetter('ㄲ'), { script: [{ pose: g.pose, ms: 3000 }] });
  assert.equal(r1.success, null);
  assert.equal(r1.last.worst.id, 'motion');
  assert.match(r1.last.worst.msg, /오른쪽/);
  const r2 = runLetter(getLetter('ㅘ'), { script: [{ pose: getLetter('ㅏ').pose, ms: 3000 }] });
  assert.equal(r2.success, null);
  assert.match(r2.last.worst.msg, /ㅗ/);
  // 반대 방향(왼쪽)으로 옮기면 ㄲ 이 아님
  const r3 = runLetter(getLetter('ㄲ'), { script: [{ pose: g.pose, ms: 300 }, { pose: g.pose, ms: 1500, blend: 300, dx: -1.2 }] });
  assert.equal(r3.success, null);
});

test('움직임 move: 손이 오른쪽으로 옮겨 가는 정도', () => {
  const tr = createSyntheticTracker();
  tr.setScript([{ pose: PRESETS.fist, ms: 200 }, { pose: PRESETS.fist, ms: 500, blend: 400, dx: 1.2 }], { loop: false });
  const m = createMotionTracker();
  for (let t = 0; t <= 1100; t += 33) m.push(extractFeatures(tr.tick(t).hands[0]), t);
  const r = m.check({ type: 'move', dir: 'right', minDist: 0.8 });
  assert.equal(r.done, true);
  assert.equal(m.check({ type: 'move', dir: 'left', minDist: 0.8 }).done, false);
  m.reset();
  assert.equal(m.check({ type: 'move', dir: 'right' }).progress, 0);
});

test('자유 쓰기 분류: 움직임까지 맞은 ㄲ 이 ㄱ 보다 먼저', () => {
  const tr = createSyntheticTracker();
  tr.playLetter(getLetter('ㄲ'));
  const motion = createMotionTracker();
  let r = null;
  for (let t = 0; t <= 1500; t += 33) {
    const f = extractFeatures(tr.tick(t).hands[0]);
    motion.push(f, t);
    r = classify(f, SPELLING_LETTERS, { motionFor: (l) => motion.check(l.motion) });
  }
  assert.equal(r.best && r.best.letterId, 'ㄲ');
});

test('합성 인식기: 인터페이스 · 손 없음 장면 · 끝 알림 · 타이머 시작/멈춤', async () => {
  const tr = createSyntheticTracker({ noise: 0.005, seed: 2 });
  assert.equal(tr.source, 'synthetic');
  await tr.ready;
  tr.setScript([{ pose: null, ms: 100 }, { pose: PRESETS.open, ms: 100 }], { loop: false });
  let ended = 0;
  tr.onEnd(() => ended++);
  assert.equal(tr.tick(0).hands.length, 0);
  assert.equal(tr.tick(150).hands.length, 1);
  tr.tick(250);
  assert.equal(ended, 1);
  const frames = [];
  const off = tr.onFrame((f) => frames.push(f));
  const statuses = [];
  tr.onStatus((s) => statuses.push(s));
  tr.setPose(PRESETS.fist);
  tr.start();
  await new Promise((r) => setTimeout(r, 120));
  tr.stop();
  off();
  assert.ok(frames.length >= 2, `프레임 ${frames.length}`);
  assert.equal(frames[0].source, 'synthetic');
  assert.deepEqual(statuses, ['running', 'stopped']);
  assert.equal(extractFeatures(frames[1].hands[0]).fingers.index.state, 'curled');
});
