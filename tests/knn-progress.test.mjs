// 선생님 손 본뜨기(knn) · 배운 기록(progress) 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import { vectorize, createTemplateStore, VECTOR_LENGTH, distance } from '../src/renderer/engine/knn.js';
import { createProgress, BOX_INTERVALS, dayKey } from '../src/renderer/engine/progress.js';
import { LETTERS, getLetter } from '../src/renderer/engine/letters.js';
import { poseToHand, normalizePose } from '../src/renderer/engine/handmodel.js';
import { extractFeatures } from '../src/renderer/engine/features.js';
import { seededRandom } from '../src/renderer/engine/geometry.js';

const vecOf = (pose, o) => vectorize(extractFeatures(poseToHand(pose, o)));

test('vectorize: 길이 고정 · 손 크기 · 위치와 상관없음', () => {
  const p = getLetter('ㄱ').pose;
  const a = vecOf(p, { size: 0.2, center: [0.4, 0.5] });
  const b = vecOf(p, { size: 0.3, center: [0.6, 0.6] });
  assert.equal(a.length, VECTOR_LENGTH);
  assert.ok(distance(a, b) < 0.05, `거리 ${distance(a, b)}`);
  assert.equal(vectorize(null), null);
});

test('knn: 흔들린 본으로 각 글자를 맞힘 · 내보내기/가져오기', () => {
  const rnd = seededRandom(3);
  const jit = (p) => {
    const q = normalizePose(p);
    for (const k of ['yaw', 'pitch', 'roll']) q.rot[k] += (rnd() * 2 - 1) * 6;
    for (const f of ['index', 'middle', 'ring', 'pinky']) q[f].pip += (rnd() * 2 - 1) * 6;
    return q;
  };
  const statics = LETTERS.filter((l) => !l.motion && !l.sameAs.length);
  const store = createTemplateStore();
  for (const l of statics) for (let i = 0; i < 3; i++) store.addTemplate(l.id, vecOf(jit(l.pose)));
  assert.equal(store.size, statics.length * 3);
  let right = 0;
  for (const l of statics) {
    const m = store.match(vecOf(jit(l.pose)), 3);
    if (m.letterId === l.id) right++;
  }
  assert.ok(right / statics.length > 0.95, `${right}/${statics.length}`);
  const json = JSON.stringify(store.toJSON());
  const copy = createTemplateStore();
  assert.equal(copy.fromJSON(json), statics.length * 3);
  assert.equal(copy.match(vecOf(getLetter('ㅂ').pose)).letterId, 'ㅂ');
  assert.ok(Number.isFinite(copy.distanceTo(vecOf(getLetter('ㅂ').pose), 'ㅂ')));
  assert.equal(copy.distanceTo(vecOf(getLetter('ㅂ').pose), '없는글자'), Infinity);
  assert.equal(copy.removeTemplates('ㅂ'), 3);
  assert.throws(() => copy.fromJSON({ kind: 'other' }));
  assert.throws(() => copy.addTemplate('ㄱ', [1, 2, 3]));
  assert.equal(createTemplateStore().match(vecOf(getLetter('ㄱ').pose)), null);
});

function memoryStorage() {
  const m = new Map();
  return { get: (k, d = null) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)), raw: m };
}

test('progress: 기록 · 정확도 · 익힘 · 저장소에 남음', () => {
  let t = new Date(2026, 10, 21, 10, 0).getTime();
  const storage = memoryStorage();
  const p = createProgress({ storage, now: () => t });
  p.recordAttempt('ㄱ', { ok: false });
  for (let i = 0; i < 4; i++) p.recordAttempt('ㄱ', { ok: true, ms: 2000 + i * 100 });
  const s = p.stats('ㄱ');
  assert.equal(s.attempts, 5);
  assert.equal(s.successes, 4);
  assert.equal(s.bestMs, 2000);
  assert.ok(Math.abs(s.accuracy - 0.8) < 1e-9);
  assert.equal(s.mastered, true);
  assert.deepEqual(p.masteredIds(['ㄱ', 'ㄴ']), ['ㄱ']);
  const again = createProgress({ storage, now: () => t });
  assert.equal(again.stats('ㄱ').successes, 4);
  assert.deepEqual(again.unitProgress(['ㄱ', 'ㄴ', 'ㄷ']), { total: 3, mastered: 1, seen: 1, ratio: 1 / 3 });
});

test('progress: 복습 상자 · 복습할 글자 · 약한 글자 · 연습 뽑기', () => {
  let t = new Date(2026, 10, 21, 10, 0).getTime();
  const p = createProgress({ now: () => t });
  p.recordAttempt('ㄴ', { ok: true });
  assert.equal(p.stats('ㄴ').box, 1);
  assert.equal(p.stats('ㄴ').due, t + BOX_INTERVALS[1]);
  p.recordAttempt('ㄷ', { ok: false });
  assert.deepEqual(p.dueForReview(), ['ㄷ']);
  t += BOX_INTERVALS[1] + 1;
  assert.deepEqual(p.dueForReview().sort(), ['ㄴ', 'ㄷ']);
  assert.equal(p.reviewCount(['ㄴ']), 1);
  assert.equal(p.weakest(1)[0].letterId, 'ㄷ');
  const pick = p.pickPractice(['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], 3, seededRandom(5));
  assert.equal(pick.length, 3);
  assert.equal(new Set(pick).size, 3);
});

test('progress: 연습한 날 · 연속 일수 · 이어서 하기 · 초기화', () => {
  let t = new Date(2026, 10, 19, 9, 0).getTime();
  const p = createProgress({ now: () => t });
  p.recordAttempt('ㄱ', { ok: true });
  t += 24 * 3600 * 1000;
  p.recordAttempt('ㄱ', { ok: true });
  t += 24 * 3600 * 1000;
  p.recordAttempt('ㄱ', { ok: true });
  assert.equal(p.practiceDays().length, 3);
  assert.equal(p.practiceDays()[2], dayKey(t));
  assert.equal(p.streakDays(), 3);
  p.setLast({ screen: 'learn', unitId: 'c1', letterId: 'ㄷ' });
  assert.equal(p.getLast().letterId, 'ㄷ');
  let calls = 0;
  const off = p.subscribe(() => calls++);
  p.reset();
  off();
  assert.equal(calls, 1);
  assert.equal(p.allStats().length, 0);
  assert.equal(p.getLast(), null);
});

test('progress: 망가진 저장값 · 문자열 저장소(getItem/setItem)', () => {
  const bad = { get: () => ({ letters: 'x', days: 5 }), set() {} };
  assert.equal(createProgress({ storage: bad }).allStats().length, 0);
  const m = new Map();
  const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  createProgress({ storage: s }).recordAttempt('ㅏ', { ok: true });
  assert.equal(createProgress({ storage: s }).stats('ㅏ').successes, 1);
  const throwing = { get() { throw new Error('x'); }, set() { throw new Error('y'); } };
  assert.doesNotThrow(() => createProgress({ storage: throwing }).recordAttempt('ㅏ', { ok: true }));
});
