// 배울 내용 도우미: 글자 · 단원 목록을 화면에서 쓰기 좋게 (engine/letters.js 를 감쌈)
import { LETTERS, UNITS, getLetter, getUnit, lettersOfUnit } from '../engine/letters.js';
import { jamoName } from '../engine/hangul.js';

export { getLetter, getUnit, lettersOfUnit };

/** 단원 목록 (order 순서, 글자가 하나라도 있는 것만) */
export function units() {
  return UNITS.slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((u) => lettersOfUnit(u.id).length > 0);
}

export function allLetters() {
  return LETTERS.slice();
}

/** 연습용(demo) 손 모양인지 */
export const isDemo = (l) => !!l && (l.kind === 'demo' || (getUnit(l.unit) || {}).kind === 'demo');

/** 진짜 지문자 · 지숫자 (연습용 제외) */
export const realLetters = () => LETTERS.filter((l) => !isDemo(l));

/** 화면에 크게 쓸 글자 */
export const glyphOf = (l) => (l && (l.glyph || l.jamo)) || '?';

/** 글자 이름 (기역 · 손바닥 펴기 …) */
export const nameOf = (l) => (l && (l.name || jamoName(l.jamo || l.glyph))) || '';

/** 소리로 읽을 말 */
export const speakOf = (l) => (l && (l.say || l.name || jamoName(l.jamo || l.glyph))) || '';

/** 자모(ㄱ, ㅏ …)에 맞는 글자 정의 찾기 (없으면 null) */
export function letterForJamo(jamo) {
  if (!jamo) return null;
  return LETTERS.find((l) => !isDemo(l) && (l.jamo === jamo || l.glyph === jamo)) || null;
}

/** 단원 안에서 다음 · 이전 글자 */
export function neighbor(letter, d) {
  if (!letter) return null;
  const list = lettersOfUnit(letter.unit);
  const i = list.findIndex((l) => l.id === letter.id);
  return list[i + d] || null;
}

/** 다음 단원의 첫 글자 */
export function nextUnitFirst(unitId) {
  const us = units();
  const i = us.findIndex((u) => u.id === unitId);
  const u = us[i + 1];
  return u ? lettersOfUnit(u.id)[0] || null : null;
}

/** 단원 종류별 이름 */
export const UNIT_KIND_KO = { demo: '맛보기', consonant: '자음', vowel: '모음', number: '숫자', double: '된소리', compound: '겹모음' };
