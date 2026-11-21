// 내가 등록한 수어 단어: engine/signwords.js 의 단어 사전 + 이 컴퓨터에 저장(localStorage 'sonmal.signs')
import { createSignLexicon } from '../engine/signwords.js';
import { getJSON, setJSON } from './storage.js';

const KEY = 'signs';
export const signs = createSignLexicon();
const listeners = new Set();

(function load() {
  const d = getJSON(KEY, null);
  if (!d) return;
  try {
    signs.fromJSON(d, { merge: false });
  } catch (err) {
    console.warn('저장된 수어 단어를 읽지 못했어요', err && err.message);
  }
})();

/** 바뀐 내용 저장 (저장 공간이 모자라면 false) */
export function saveSigns() {
  const ok = setJSON(KEY, signs.toJSON());
  for (const fn of listeners) fn();
  return ok;
}

export function onSignsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
