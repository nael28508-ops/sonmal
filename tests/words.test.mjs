// 단어 수어: 자료 점검 · 손 모양 사전 · 판정기(자기 대본 통과, 다른 단어와 안 헷갈림)
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS, WORD_CATEGORIES, WORDS_SKIPPED } from '../src/renderer/engine/words-data.js';
import { SHAPES, LOCS, judgeShape, shapePose } from '../src/renderer/engine/word-shapes.js';
import { compileWord, createWordJudge, syntheticWordFrame, wordKeyframes, wordDuration, MOVE_TYPES, toBody, fromBody, SYNTH_FACE } from '../src/renderer/engine/wordsign.js';
import { poseToHand } from '../src/renderer/engine/handmodel.js';
import { extractFeatures } from '../src/renderer/engine/features.js';
import { seededRandom } from '../src/renderer/engine/geometry.js';

const JUDGED = WORDS.filter((w) => w.tier === 'judged');

/** 단어 대본을 판정기에 30fps 로 넣어 성공하는지 */
const FRAMES = new Map();
function framesOf(word, noise = 0, seed = 1) {
  const key = word.id + ':' + noise + ':' + seed;
  if (FRAMES.has(key)) return FRAMES.get(key);
  const keys = wordKeyframes(word);
  const dur = wordDuration(word) + 300;
  const rand = noise ? seededRandom(seed) : null;
  const jitter = rand ? () => (rand() * 2 - 1) * noise : null;
  const out = [];
  for (let t = 0; t <= dur; t += 33) out.push(syntheticWordFrame(word, t, { keys, jitter }));
  FRAMES.set(key, out);
  return out;
}
function runWord(word, target, { strictness = 'normal', noise = 0, seed = 1 } = {}) {
  const judge = createWordJudge({ getStrictness: () => strictness });
  for (const fr of framesOf(word, noise, seed)) {
    const r = judge.update(fr, target);
    if (r.success) return { ok: true, t: fr.t, r };
  }
  return { ok: false };
}

test('단어 자료: 모든 단어에 사전 원문 · 주소 · 갈래 · 올바른 손 정의가 있음', () => {
  assert.ok(WORDS.length >= 80, `단어 ${WORDS.length}개`);
  const cats = new Set(WORD_CATEGORIES.map((c) => c.id));
  const ids = new Set();
  for (const w of WORDS) {
    assert.ok(!ids.has(w.id), `id 겹침 ${w.id}`);
    ids.add(w.id);
    assert.match(w.url, /^https:\/\/sldict\.korean\.go\.kr\/front\/sign\/signContentsView\.do\?origin_no=\d+&top_category=CTE$/, w.label);
    assert.ok(Array.isArray(w.official) && w.official.length && w.official.every((s) => s.length > 8), `설명 ${w.label}`);
    assert.ok(cats.has(w.cat), `갈래 ${w.label}`);
    assert.ok(w.label && w.headwords, w.label);
    const c = compileWord(w);
    for (const seg of c.segments) {
      for (const h of [seg.R, seg.L, seg.R2, seg.L2].filter(Boolean)) {
        assert.ok(SHAPES[h.shape], `${w.label}: 모양 ${h.shape}`);
        assert.ok(LOCS[h.loc], `${w.label}: 위치 ${h.loc}`);
        assert.match(h.orient, /^[udlrfb]+:[udlrfb]+$/, `${w.label}: 방향 ${h.orient}`);
      }
      assert.ok(MOVE_TYPES.includes(seg.mv.type), `${w.label}: 움직임 ${seg.mv.type}`);
    }
    assert.ok(wordKeyframes(w).length >= 3, w.label);
  }
  for (const c of WORD_CATEGORIES) assert.ok(WORDS.some((w) => w.cat === c.id), `빈 갈래 ${c.name}`);
  assert.ok(JUDGED.length >= 30, `판정 단어 ${JUDGED.length}개`);
  assert.ok(WORDS_SKIPPED.length > 0);
});

test('손 모양 사전: 모든 모양이 자기 판정을 통과하고 다른 모양과 섞이지 않음', () => {
  for (const orient of ['u:f', 'u:b', 'f:d', 'l:b', 'u:l']) {
    for (const id of Object.keys(SHAPES)) {
      const f = extractFeatures(poseToHand(shapePose(id, orient)), {});
      for (const lv of ['lenient', 'normal', 'strict']) assert.ok(judgeShape(f, id, lv).ok, `${id} ${orient} ${lv}`);
      const others = Object.keys(SHAPES).filter((j) => j !== id && !(SHAPES[id].accept || []).includes(j) && !(SHAPES[j].accept || []).includes(id));
      for (const j of others) assert.ok(!judgeShape(f, j, 'lenient').ok, `${id} 가 ${j} 로 통과함 (${orient})`);
    }
  }
});

test('몸 좌표: 원본 영상 ↔ B 좌표가 서로 되돌아감', () => {
  const p = fromBody({ x: 0.4, y: -1.2 }, SYNTH_FACE, 16 / 9);
  const b = toBody(p, SYNTH_FACE, 16 / 9);
  assert.ok(Math.abs(b.x - 0.4) < 1e-9 && Math.abs(b.y + 1.2) < 1e-9);
  // 수어하는 사람의 오른쪽은 원본 영상에서 왼쪽(작은 x)
  assert.ok(p.x < SYNTH_FACE.cx);
});

test('모든 단어가 자기 시연 대본으로 성공 (보통 · 너그럽게, 떨림 조금)', () => {
  for (const w of WORDS) {
    for (const st of ['normal', 'lenient']) {
      const r = runWord(w, w, { strictness: st, noise: 1, seed: w.no });
      assert.ok(r.ok, `${w.label} (${w.tier}, ${st}) 가 자기 대본으로 통과하지 못함`);
    }
  }
});

test('판정 단어끼리 서로의 대본으로 통과하지 않음 (혼동 없음)', () => {
  const bad = [];
  for (const a of JUDGED) {
    for (const b of JUDGED) {
      if (a === b) continue;
      if (runWord(a, b).ok) bad.push(`${a.label} → ${b.label}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('얼굴이 안 보이면 위치는 "확인 못 함"으로 두고 판정은 이어감', () => {
  const w = WORDS.find((x) => x.label === '좋다');
  const judge = createWordJudge();
  const fr = syntheticWordFrame(w, 600);
  delete fr.face;
  const r = judge.update(fr, w);
  const loc = r.checks.find((c) => c.id === 'loc');
  assert.equal(loc.ok, null);
  assert.match(loc.msg, /얼굴/);
});

test('틀린 모양이면 손가락 고칠 점을 알려 줌', () => {
  const w = WORDS.find((x) => x.label === '괜찮아요'); // 새끼손가락
  const judge = createWordJudge();
  const fr = syntheticWordFrame(w, 300);
  fr.hands = [poseToHand(shapePose('fist', 'u:b'), { center: [0.5, 0.5] })];
  const r = judge.update(fr, w);
  assert.equal(r.checks[0].ok, false);
  assert.match(r.msg, /새끼손가락/);
});

test('움직임 없이 멈춰 있기만 하면 움직이는 단어는 성공하지 않음', () => {
  const w = WORDS.find((x) => x.label === '화나다');
  const judge = createWordJudge();
  let ok = false;
  for (let t = 0; t < 5000; t += 33) {
    const fr = syntheticWordFrame(w, 300, {});
    fr.t = t;
    if (judge.update(fr, w).success) ok = true;
  }
  assert.equal(ok, false);
});
