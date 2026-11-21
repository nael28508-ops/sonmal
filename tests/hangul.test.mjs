// 한글 낱자 시험: 지문자 순서로 나누기(겹받침 나눔 · 한국수어 겹모음은 그대로) · 모아쓰기 · 지우기
import test from 'node:test';
import assert from 'node:assert/strict';
import { decomposeForSpelling, compose, createComposer, splitSyllable, makeSyllable, jamoName } from '../src/renderer/engine/hangul.js';
import { letterForJamo } from '../src/renderer/engine/letters.js';

const seq = (text, o) => decomposeForSpelling(text, o).map((x) => x.jamo).join('');

test('기본 나누기: 겹받침은 나누고, 한국수어에 따로 있는 겹모음 · 된소리는 그대로', () => {
  assert.equal(seq('값'), 'ㄱㅏㅂㅅ');
  assert.equal(seq('닭'), 'ㄷㅏㄹㄱ');
  assert.equal(seq('왔'), 'ㅇㅘㅆ');
  assert.equal(seq('의사'), 'ㅇㅢㅅㅏ');
  assert.equal(seq('꽃'), 'ㄲㅗㅊ');
  assert.equal(seq('읽다'), 'ㅇㅣㄹㄱㄷㅏ');
  assert.equal(seq('웨'), 'ㅇㅞ');
  assert.equal(seq('개구리'), 'ㄱㅐㄱㅜㄹㅣ');
  assert.equal(seq('없어'), 'ㅇㅓㅂㅅㅇㅓ');
});

test('나누기 결과 자모는 모두 배울 글자가 있음', () => {
  for (const w of ['값', '닭', '왔', '의사', '꽃', '읽다', '웨', '괜찮아요', '앉아', '많이', '삶', '짧다', '훑다', '읊다', '싫어', '뛰어', '쐐기']) {
    for (const x of decomposeForSpelling(w)) assert.ok(letterForJamo(x.jamo), `${w}: ${x.jamo}`);
  }
});

test('자리 정보: 음절 번호 · 초성/중성/종성 · 겹받침 출처', () => {
  const r = decomposeForSpelling('닭 값', { keepSpaces: true });
  assert.deepEqual(r.map((x) => x.role), ['initial', 'medial', 'final', 'final', 'space', 'initial', 'medial', 'final', 'final']);
  assert.deepEqual(r.map((x) => x.syllableIndex), [0, 0, 0, 0, 1, 2, 2, 2, 2]);
  assert.equal(r[2].from, 'ㄺ');
  assert.equal(seq('닭 값'), 'ㄷㅏㄹㄱㄱㅏㅂㅅ');
});

test('선택: 겹모음 나누기 · 된소리 나누기 · 겹받침 그대로', () => {
  assert.equal(seq('왔', { splitVowels: true }), 'ㅇㅗㅏㅆ');
  assert.equal(seq('왔', { splitDoubles: true }), 'ㅇㅘㅅㅅ');
  assert.equal(seq('값', { splitFinals: false }), 'ㄱㅏㅄ');
  assert.equal(seq('개', { splitVowels: ['ㅐ'] }), 'ㄱㅏㅣ');
});

test('모아쓰기: 겹받침 · 겹모음 · 된소리', () => {
  assert.equal(compose([...'ㄱㅏㅂㅅ']), '값');
  assert.equal(compose([...'ㄷㅏㄹㄱ']), '닭');
  assert.equal(compose([...'ㅇㅘㅆ']), '왔');
  assert.equal(compose([...'ㅇㅗㅏㅆ']), '왔');
  assert.equal(compose([...'ㅇㅢㅅㅏ']), '의사');
  assert.equal(compose([...'ㄲㅗㅊ']), '꽃');
  assert.equal(compose([...'ㅇㅣㄹㄱㄷㅏ']), '읽다');
  assert.equal(compose([...'ㅇㅞ']), '웨');
});

test('도깨비불: 받침이 다음 글자 첫소리로 넘어감', () => {
  assert.equal(compose([...'ㄷㅏㄹㄱㅇㅣ']), '닭이');
  assert.equal(compose([...'ㄷㅏㄹㄱㅣ']), '달기');
  assert.equal(compose([...'ㄱㅏㅂㅅㅣ']), '갑시');
  assert.equal(compose([...'ㅎㅏㄴㄱㅡㄹ']), '한글');
  assert.equal(compose([...'ㅅㅏㄹㅏㅇ']), '사랑');
});

test('입력기: 하나씩 넣고 지우기', () => {
  const c = createComposer();
  for (const j of 'ㄱㅏㅂㅅ') c.push(j);
  assert.equal(c.text, '값');
  assert.equal(c.backspace(), '갑');
  assert.equal(c.backspace(), '가');
  assert.equal(c.backspace(), 'ㄱ');
  assert.equal(c.backspace(), '');
  assert.equal(c.backspace(), '');
  for (const j of ['ㅇ', 'ㅘ', 'ㅆ']) c.push(j);
  assert.equal(c.text, '왔');
  assert.equal(c.composing, '왔');
  c.push('ㅇ'); c.push('ㅓ');
  assert.equal(c.text, '왔어');
  c.backspace();
  assert.equal(c.text, '왔ㅇ');
  c.reset();
  assert.equal(c.text, '');
  assert.equal(c.length, 0);
});

test('음절 쪼개기 · 만들기 · 이름', () => {
  assert.deepEqual(splitSyllable('닭'), { cho: 'ㄷ', jung: 'ㅏ', jong: 'ㄺ' });
  assert.equal(makeSyllable('ㄷ', 'ㅏ', 'ㄺ'), '닭');
  assert.equal(makeSyllable('ㄸ', 'ㅏ', 'ㄸ'), null);
  assert.equal(jamoName('ㅆ'), '쌍시옷');
});
