// 지문자 · 지숫자 내용 시험: 데이터 검사, 자기 자세 통과, 혼동 행렬, 왼손 · 엄격함 · 흔들림
import test from 'node:test';
import assert from 'node:assert/strict';
import { LETTERS, UNITS, DEMO_LETTERS, getLetter, lettersOfUnit, letterForJamo, SPELLING_LETTERS, NUMBER_LETTERS, SOURCE, letterScript } from '../src/renderer/engine/letters.js';
import { poseToHand, normalizePose } from '../src/renderer/engine/handmodel.js';
import { extractFeatures } from '../src/renderer/engine/features.js';
import { evaluate, validateLetter, classify } from '../src/renderer/engine/rules.js';
import { seededRandom } from '../src/renderer/engine/geometry.js';

const featOf = (pose, o = {}) => {
  const h = poseToHand(pose, o);
  if (o.imageOnly) delete h.world;
  return extractFeatures(h);
};
const shapeOnly = (l) => ({ ...l, motion: null });

// 손 모양이 같아서 움직임으로만(또는 숫자/글자 모드로만) 구별되는 짝 — README 에도 적음
const MOTION_ONLY = new Set(['ㅓ>num-10', 'ㅝ>num-10']);
function sameShape(a, b) {
  if (a.sameAs.includes(b.id) || b.sameAs.includes(a.id)) return true; // ㅏ=1, ㅑ=2, ㅇ=0, ㄴ=6 (+ ㅘ 끝 모양 = 1 …)
  if (a.base === b.id || b.base === a.id) return true; // 된소리 = 기본 자음 + 오른쪽으로 옮기기
  if (JSON.stringify(a.checks) === JSON.stringify(b.checks)) return true; // ㅘ 끝 = ㅏ, ㅙ 끝 = ㅐ, ㅝ 끝 = ㅓ, ㅞ 끝 = ㅔ
  return MOTION_ONLY.has(`${a.id}>${b.id}`);
}

test('글자 수: 자음 14, 된소리 5, 모음 21, 숫자 0~10', () => {
  const count = (k) => LETTERS.filter((l) => l.kind === k).length;
  assert.equal(count('consonant'), 14);
  assert.equal(count('double'), 5);
  assert.equal(count('vowel') + count('compound'), 21);
  assert.equal(count('number'), 11);
  assert.equal(LETTERS.length, 51);
  assert.equal(SPELLING_LETTERS.length + NUMBER_LETTERS.length, LETTERS.length);
});

test('단원: 정해진 순서와 글자, 연습용 손 모양은 단원에 없음', () => {
  const want = {
    c1: 'ㄱㄴㄷㄹㅁ', c2: 'ㅂㅅㅇㅈㅊ', c3: 'ㅋㅌㅍㅎ', d1: 'ㄲㄸㅃㅆㅉ', v1: 'ㅏㅑㅓㅕㅗ', v2: 'ㅛㅜㅠㅡㅣ', v3: 'ㅐㅒㅔㅖㅚㅟㅢ', v4: 'ㅘㅙㅝㅞ',
  };
  assert.deepEqual(UNITS.map((u) => u.id), ['c1', 'c2', 'c3', 'd1', 'v1', 'v2', 'v3', 'v4', 'n1', 'n2']);
  for (const [u, s] of Object.entries(want)) assert.deepEqual(lettersOfUnit(u).map((l) => l.id), [...s], u);
  assert.deepEqual(lettersOfUnit('n1').map((l) => l.glyph), ['0', '1', '2', '3', '4', '5']);
  assert.deepEqual(lettersOfUnit('n2').map((l) => l.glyph), ['6', '7', '8', '9', '10']);
  for (const d of DEMO_LETTERS) {
    assert.equal(d.unit, null);
    assert.ok(!LETTERS.includes(d));
    assert.equal(getLetter(d.id), d);
  }
  assert.equal(letterForJamo('ㄱ').id, 'ㄱ');
  assert.equal(letterForJamo('7').id, 'num-7');
  assert.equal(letterForJamo('ㄳ'), null);
});

test('글자 데이터 검사 · 필드 · 존댓말 문구 · 출처', () => {
  for (const l of [...LETTERS, ...DEMO_LETTERS]) assert.deepEqual(validateLetter(l), [], l.id);
  for (const l of LETTERS) {
    assert.ok(l.name && l.glyph && l.desc && l.tips.length, l.id);
    assert.equal(l.source, SOURCE);
    assert.match(l.sources[0], /^https:\/\/sldict\.korean\.go\.kr/);
    assert.ok(l.official, `${l.id} 사전 원문`);
    assert.ok(['high', 'medium', 'low'].includes(l.confidence));
    for (const c of l.checks) {
      assert.match(c.msg, /주세요$/, `${l.id} ${c.id}: ${c.msg}`);
      assert.ok(/[가-힣]/.test(c.label), `${l.id} ${c.id} label`);
    }
    for (const id of [...l.confusables, ...l.sameAs]) assert.ok(getLetter(id), `${l.id} → ${id}`);
  }
});

test('모든 글자는 자기 자세로 통과 (보통 · 엄격 · 너그럽게, 오른손 · 왼손, world · 영상 마디)', () => {
  for (const l of LETTERS) {
    for (const strictness of ['lenient', 'normal', 'strict']) {
      for (const o of [{}, { side: 'left' }, { imageOnly: true }, { side: 'left', imageOnly: true }]) {
        const e = evaluate(shapeOnly(l), featOf(l.pose, o), { strictness });
        const bad = e.checks.filter((c) => !c.ok).map((c) => `${c.id}=${c.valueText}`).join(', ');
        assert.ok(e.pass, `${l.id} ${strictness} ${JSON.stringify(o)}: ${bad}`);
      }
    }
  }
});

test('혼동 행렬: 글자 자세는 다른 글자 확인 항목을 통과하지 않음 (같은 모양 짝 빼고)', () => {
  const feats = new Map(LETTERS.map((l) => [l.id, featOf(l.pose)]));
  const confusions = [];
  const samePass = [];
  for (const strictness of ['lenient', 'normal', 'strict']) {
    for (const a of LETTERS) {
      for (const b of LETTERS) {
        if (a === b) continue;
        const e = evaluate(shapeOnly(b), feats.get(a.id), { strictness });
        if (!e.pass) continue;
        if (sameShape(a, b)) samePass.push(`${a.id}>${b.id}`);
        else confusions.push(`${strictness}: ${a.id} 자세가 ${b.id} 통과`);
      }
    }
  }
  assert.deepEqual(confusions, []);
  // 같은 모양 짝은 실제로 서로 통과해야 맞음 (예: ㅏ ↔ 1)
  for (const pair of ['ㅏ>num-1', 'num-1>ㅏ', 'ㅑ>num-2', 'ㅇ>num-0', 'ㄴ>num-6', 'ㄱ>ㄲ', 'ㅏ>ㅘ']) assert.ok(samePass.includes(pair), pair);
});

test('흔들린 자세에서도 대부분 통과하고, 다른 글자로 넘어가지 않음', () => {
  const rnd = seededRandom(11);
  const J = (a) => (rnd() * 2 - 1) * a;
  const jit = (p) => {
    const q = normalizePose(p);
    for (const k of ['yaw', 'pitch', 'roll']) q.rot[k] += J(10);
    for (const f of ['index', 'middle', 'ring', 'pinky']) for (const k of ['mcp', 'pip', 'dip']) q[f][k] += J(7);
    for (const k of ['cmcFlex', 'cmcAbd', 'mcp', 'ip']) q.thumb[k] += J(7);
    return q;
  };
  let pass = 0, total = 0;
  const wrong = [];
  for (const l of LETTERS) {
    for (let i = 0; i < 12; i++) {
      const f = featOf(jit(l.pose), { center: [0.4 + rnd() * 0.2, 0.5 + rnd() * 0.1], size: 0.18 + rnd() * 0.1 });
      total++;
      if (evaluate(shapeOnly(l), f).pass) pass++;
      for (const b of LETTERS) if (b !== l && !sameShape(l, b) && evaluate(shapeOnly(b), f).pass) wrong.push(`${l.id}>${b.id}`);
    }
  }
  assert.ok(pass / total > 0.95, `통과율 ${pass}/${total}`);
  assert.deepEqual(wrong, []);
});

test('고칠 점 하나: 약지를 펴면 "약지를 접어 주세요"', () => {
  const l = getLetter('ㄷ');
  const p = normalizePose(l.pose);
  p.ring = { mcp: 3, pip: 4, dip: 2, abd: 10 };
  const e = evaluate(l, featOf(p));
  assert.equal(e.pass, false);
  assert.equal(e.worst.msg, '약지를 접어 주세요');
  assert.equal(e.fingerStatus.ring, 'bad');
  assert.equal(e.fingerStatus.index, 'ok');
});

test('왼손이면 문구의 왼쪽 ↔ 오른쪽이 바뀜', () => {
  const l = getLetter('ㅡ');
  const p = normalizePose(l.pose);
  p.rot.roll = 0; // 검지가 위를 보게 (틀리게)
  const e = evaluate(l, featOf(p, { side: 'left' }));
  const c = e.checks.find((x) => x.id === 'index-dir');
  assert.equal(c.ok, false);
  assert.match(c.msg, /오른쪽/);
  const er = evaluate(l, featOf(p));
  assert.match(er.checks.find((x) => x.id === 'index-dir').msg, /왼쪽/);
});

test('열린 집합 분류: 지문자만 놓고 보면 각 글자 자세가 그 글자로', () => {
  const statics = SPELLING_LETTERS.filter((l) => !l.motion);
  for (const l of statics) {
    const r = classify(featOf(l.pose), statics);
    assert.equal(r.best && r.best.letterId, l.id, `${l.id} → ${r.best && r.best.letterId}`);
  }
});

test('letterScript: 움직임 글자는 여러 장면', () => {
  assert.equal(letterScript(getLetter('ㄱ')).length, 1);
  assert.ok(letterScript(getLetter('ㄲ')).length >= 2);
  assert.equal(letterScript(getLetter('ㅘ'))[0].pose, getLetter('ㅗ').pose);
  assert.ok(letterScript(getLetter('num-10')).length > 4);
});
