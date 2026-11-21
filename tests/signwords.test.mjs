// 수어 단어 등록 · 알아보기 (engine/signwords.js) — 손 모형으로 만든 가짜 동작으로 시험 (카메라 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameFeature, buildRecording, createSignLexicon, createSignSpotter, planTranslation, dtw,
  resampleFeatures, sequenceMatrix, unpackLandmarks, SIGN_FRAMES,
} from '../src/renderer/engine/signwords.js';
import { PRESETS } from '../src/renderer/engine/handmodel.js';
import { createSyntheticTracker } from '../src/renderer/core/synthetic-tracker.js';

const ASPECT = 1280 / 720;
const FPS_MS = 33;

// ───────── 가짜 동작 대본 ─────────
// 가만히 있는 단어: 손 모양 하나를 잠깐
const staticWord = (pose) => [{ pose, ms: 1400 }];
// 손을 펴고 오른쪽으로 옮겼다가 아래로 (감사합니다 흉내)
const moveRightDown = (pose = PRESETS.flat, k = 1) => [
  { pose, ms: 250 * k },
  { pose, ms: 0, blend: 500 * k, dx: 1.8 },
  { pose, ms: 0, blend: 450 * k, dx: 1.8, dy: -1.6 },
  { pose, ms: 250 * k, dx: 1.8, dy: -1.6 },
];
// 같은 손 모양으로 위로 올렸다가 왼쪽으로 (다른 단어)
const moveUpLeft = (pose = PRESETS.flat, k = 1) => [
  { pose, ms: 250 * k },
  { pose, ms: 0, blend: 500 * k, dy: 1.8 },
  { pose, ms: 0, blend: 450 * k, dx: -1.6, dy: 1.8 },
  { pose, ms: 250 * k, dx: -1.6, dy: 1.8 },
];
// 손 모양이 바뀌는 단어 (주먹 → 손바닥 펴기)
const fistToOpen = () => [{ pose: PRESETS.fist, ms: 400 }, { pose: PRESETS.open, ms: 500, blend: 400 }];

/** 대본 → 녹화 프레임 [{ t, f }] */
function perform(script, { seed = 1, noise = 0.012, center = [0.5, 0.55], size = 0.24, side = 'right', t0 = 0, extraHands = null } = {}) {
  const tr = createSyntheticTracker({ script, loop: false, noise, seed, center, size, side, videoW: 1280, videoH: 720 });
  const dur = tr.duration;
  const out = [];
  for (let t = 0; t <= dur; t += FPS_MS) {
    const fr = tr.frameAt(t, t0 + t);
    const hands = extraHands ? [...fr.hands, ...extraHands(t)] : fr.hands;
    out.push({ t: t0 + t, f: frameFeature(hands, { aspect: ASPECT, keepLandmarks: true }), hands });
  }
  return out;
}

function record(script, opts) {
  const r = buildRecording(perform(script, opts), { aspect: ASPECT });
  assert.equal(r.ok, true, `녹화 실패: ${r.reason}`);
  return r;
}

/** 녹화 3번(조금씩 다르게)으로 단어 등록 */
function register(lex, text, scriptFn, opts = {}) {
  const w = lex.addWord(text);
  const variants = [
    { seed: 11, center: [0.5, 0.55] },
    { seed: 12, center: [0.46, 0.5], size: 0.22 },
    { seed: 13, center: [0.54, 0.6], size: 0.26 },
  ];
  variants.forEach((v, i) => {
    const r = record(scriptFn(i), { ...v, ...opts });
    lex.addRecording(w.id, r.rec, r.demo);
  });
  return w;
}

const windowOf = (frames) => sequenceMatrix(resampleFeatures(frames.map((x) => x.f).filter(Boolean)));

test('frameFeature: 손이 없으면 null, 손 모양 46개 + 위치 + 크기, 두 손이면 다른 손도', () => {
  assert.equal(frameFeature([], { aspect: ASPECT }), null);
  const one = perform(staticWord(PRESETS.open))[0].f;
  assert.equal(one.s.length, 46);
  assert.equal(one.p.length, 2);
  assert.ok(one.z > 0.1 && one.z < 0.5, `palm ${one.z}`);
  assert.equal(one.s2, null);
  const left = createSyntheticTracker({ script: staticWord(PRESETS.fist), side: 'left', center: [0.75, 0.6] });
  const two = perform(staticWord(PRESETS.open), { extraHands: (t) => left.frameAt(t).hands })[0].f;
  assert.equal(two.s2.length, 46);
  assert.ok(two.p2[0] < two.p[0], '왼손은 수어하는 사람의 왼쪽(S.x 작음)');
  const lm = unpackLandmarks(two.lm[0]);
  assert.equal(lm.length, 21);
});

test('buildRecording: 앞뒤 손 없음은 자르고, 움직이는 단어는 움직임 구간만, 너무 짧으면 거절', () => {
  const frames = [
    ...Array.from({ length: 10 }, (_, i) => ({ t: i * FPS_MS, f: null })),
    ...perform(moveRightDown(), { t0: 10 * FPS_MS }),
  ];
  const r = buildRecording(frames, { aspect: ASPECT });
  assert.equal(r.ok, true);
  assert.equal(r.rec.frames.length, SIGN_FRAMES);
  assert.ok(r.rec.durMs >= 700 && r.rec.durMs <= 1600, `dur ${r.rec.durMs}`);
  assert.ok(r.demo && r.demo.frames.length >= 10 && r.demo.frames[0][0].length === 42);
  assert.equal(buildRecording(frames.slice(0, 12)).ok, false);
  assert.equal(buildRecording([]).reason, 'empty');
  const st = buildRecording(perform(staticWord(PRESETS.vee)), { aspect: ASPECT });
  assert.equal(st.ok, true);
  assert.ok(st.rec.durMs >= 600, `static dur ${st.rec.durMs}`);
});

test('dtw: 같은 동작이 느리거나 빨라도 가깝고, 다른 동작은 멀다', () => {
  const a = windowOf(perform(moveRightDown()));
  const slow = windowOf(perform(moveRightDown(PRESETS.flat, 1.4), { seed: 5 }));
  const other = windowOf(perform(moveUpLeft(), { seed: 6 }));
  const dSlow = dtw(a.M, slow.M);
  const dOther = dtw(a.M, other.M);
  assert.ok(dSlow < 0.6, `slow ${dSlow}`);
  assert.ok(dOther > dSlow * 2.5, `other ${dOther} vs slow ${dSlow}`);
  assert.equal(dtw([], a.M), Infinity);
});

test('가만히 있는 단어: 같은 손 모양은 알아보고, 다른 손 모양은 거절', () => {
  const lex = createSignLexicon();
  const w = register(lex, '사랑', () => staticWord(PRESETS.ell));
  const info = lex.info(w.id);
  assert.ok(info.intra !== null && info.threshold >= 0.85, JSON.stringify(info));
  const same = lex.rank(windowOf(perform(staticWord(PRESETS.ell), { seed: 99, center: [0.4, 0.5] })))[0];
  assert.equal(same.id, w.id);
  assert.equal(same.pass, true, `d=${same.distance} thr=${same.threshold}`);
  assert.ok(same.confidence > 0.5);
  for (const p of [PRESETS.fist, PRESETS.open, PRESETS.point]) {
    const r = lex.rank(windowOf(perform(staticWord(p), { seed: 98 })))[0];
    assert.equal(r.pass, false, `다른 손 모양이 통과함 d=${r.distance} thr=${r.threshold}`);
  }
  // 같은 손 모양이라도 크게 움직이면 거절
  const moving = lex.rank(windowOf(perform(moveRightDown(PRESETS.ell), { seed: 97 })))[0];
  assert.equal(moving.pass, false, `움직임이 통과함 d=${moving.distance}`);
});

test('움직이는 단어 둘: 손 모양이 같아도 움직임으로 구별', () => {
  const lex = createSignLexicon();
  const a = register(lex, '감사합니다', () => moveRightDown());
  const b = register(lex, '안녕하세요', () => moveUpLeft());
  const ra = lex.rank(windowOf(perform(moveRightDown(PRESETS.flat, 1.2), { seed: 50, center: [0.45, 0.5] })));
  assert.equal(ra[0].id, a.id);
  assert.equal(ra[0].pass, true, `d=${ra[0].distance} thr=${ra[0].threshold}`);
  assert.ok(ra[1].distance > ra[0].distance * 1.5);
  const rb = lex.rank(windowOf(perform(moveUpLeft(PRESETS.flat, 0.85), { seed: 51 })));
  assert.equal(rb[0].id, b.id);
  assert.equal(rb[0].pass, true);
  // 손 모양이 바뀌는 단어 · 엉뚱한 동작은 둘 다 거절
  const odd = lex.rank(windowOf(perform(fistToOpen(), { seed: 52 })));
  assert.ok(odd.every((r) => !r.pass), JSON.stringify(odd.map((r) => [r.text, r.distance.toFixed(2), r.threshold.toFixed(2)])));
  // 같은 손 모양을 가만히 보여 주기만 하면 (너그럽게여도) 거절
  const still = lex.rank(windowOf(perform(staticWord(PRESETS.flat), { seed: 53 })), { strictness: 'lenient' });
  assert.ok(still.every((r) => !r.pass && !r.motionOk), JSON.stringify(still.map((r) => [r.text, r.distance.toFixed(2)])));
  // 엄격하게 하면 기준이 좁아짐
  assert.ok(lex.info(a.id, 'strict').threshold < lex.info(a.id, 'lenient').threshold);
});

test('두 손 단어와 한 손 단어를 구별', () => {
  const lex = createSignLexicon();
  const leftHand = (seed) => {
    const tr = createSyntheticTracker({ script: staticWord(PRESETS.flat), side: 'left', center: [0.72, 0.62], seed, noise: 0.01 });
    return (t) => tr.frameAt(t).hands;
  };
  const two = register(lex, '병원', () => staticWord(PRESETS.vee), { extraHands: leftHand(3) });
  const one = register(lex, '화장실', () => staticWord(PRESETS.vee));
  const r2 = lex.rank(windowOf(perform(staticWord(PRESETS.vee), { seed: 70, extraHands: leftHand(4) })));
  assert.equal(r2[0].id, two.id);
  assert.equal(r2[0].pass, true);
  const r1 = lex.rank(windowOf(perform(staticWord(PRESETS.vee), { seed: 71 })));
  assert.equal(r1[0].id, one.id);
  assert.equal(r1[0].pass, true);
});

test('실시간 찾기: 한 번 하면 한 번만 확정, 가만히 있으면 다시 안 함, 엉뚱한 동작은 무시', () => {
  const lex = createSignLexicon();
  register(lex, '감사합니다', () => moveRightDown());
  register(lex, '사랑', () => staticWord(PRESETS.ell));
  const sp = createSignSpotter({ lexicon: lex });
  const commits = [];
  let maxProgress = 0;
  const feed = (frames) => {
    for (const x of frames) {
      const s = sp.push(x.f, x.t);
      maxProgress = Math.max(maxProgress, s.progress);
      if (s.committed) commits.push(s.committed.text);
    }
  };
  let t = 0;
  const run = (script, opts = {}) => {
    const fr = perform(script, { t0: t, seed: 30 + commits.length, ...opts });
    feed(fr);
    t = fr[fr.length - 1].t + FPS_MS;
  };
  const rest = (ms) => {
    for (let k = 0; k < ms; k += FPS_MS) feed([{ t: (t += FPS_MS), f: null }]);
  };
  rest(500);
  run(moveRightDown(PRESETS.flat, 1.1));
  assert.deepEqual(commits, ['감사합니다']);
  assert.ok(maxProgress >= 1);
  // 끝 모양 그대로 1.5초 → 다시 확정하지 않음
  run([{ pose: PRESETS.flat, ms: 1500 }], { center: [0.5 - (1.8 * 0.24) / ASPECT, 0.55 + 1.6 * 0.24] });
  assert.deepEqual(commits, ['감사합니다']);
  rest(500);
  // 엉뚱한 동작: 주먹 → 펴기, 검지로 위 · 아래
  run(fistToOpen());
  run([{ pose: PRESETS.point, ms: 200 }, { pose: PRESETS.point, ms: 0, blend: 300, dy: 1.5 }, { pose: PRESETS.point, ms: 200, blend: 300 }]);
  assert.deepEqual(commits, ['감사합니다']);
  rest(500);
  // 가만히 있는 단어 → 한 번만
  run(staticWord(PRESETS.ell).map((k) => ({ ...k, ms: 2500 })));
  assert.deepEqual(commits, ['감사합니다', '사랑']);
  rest(500);
  run(moveRightDown());
  assert.deepEqual(commits, ['감사합니다', '사랑', '감사합니다']);
  sp.reset();
  assert.equal(sp.state.candidate, null);
});

test('단어 사전: JSON 내보내기 · 가져오기, 같은 글은 하나로, 잘못된 파일은 오류', () => {
  const lex = createSignLexicon();
  const w = register(lex, ' 감사합니다 ', () => moveRightDown());
  assert.equal(w.text, '감사합니다');
  assert.equal(lex.addWord('감사합니다').id, w.id);
  assert.equal(w.recordings.length, 3);
  const json = JSON.stringify(lex.toJSON());
  const lex2 = createSignLexicon();
  assert.equal(lex2.fromJSON(json), 1);
  assert.equal(lex2.list()[0].text, '감사합니다');
  assert.equal(lex2.list()[0].recordings.length, 3);
  const r = lex2.rank(windowOf(perform(moveRightDown(), { seed: 77 })))[0];
  assert.equal(r.pass, true);
  assert.throws(() => lex2.fromJSON({ nope: 1 }));
  lex2.clearRecordings(lex2.list()[0].id);
  assert.equal(lex2.rank(windowOf(perform(moveRightDown()))).length, 0);
  lex2.remove(lex2.list()[0].id);
  assert.equal(lex2.size, 0);
  assert.throws(() => lex2.addWord('  '));
});

test('planTranslation: 등록 단어는 단어로, 나머지는 지문자로', () => {
  const words = ['안녕하세요', '병원', '화장실', '감사합니다'];
  assert.deepEqual(planTranslation('안녕하세요 병원에 가요', words), [
    { type: 'word', text: '안녕하세요' },
    { type: 'space', text: ' ' },
    { type: 'word', text: '병원' },
    { type: 'spell', text: '에' },
    { type: 'space', text: ' ' },
    { type: 'spell', text: '가요' },
  ]);
  assert.deepEqual(planTranslation('  화장실   어디  ', words), [
    { type: 'word', text: '화장실' },
    { type: 'space', text: ' ' },
    { type: 'spell', text: '어디' },
  ]);
  // 어절 가운데에 있는 단어는 단어로 보지 않음 (대학병원 → 지문자)
  assert.deepEqual(planTranslation('대학병원', words), [{ type: 'spell', text: '대학병원' }]);
  assert.deepEqual(planTranslation('', words), []);
  assert.deepEqual(planTranslation('감사합니다', []), [{ type: 'spell', text: '감사합니다' }]);
});
