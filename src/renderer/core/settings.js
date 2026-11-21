// 설정: 기본값 + 불러오기/저장 + 바뀌면 알려 주기
// 화면 모양 설정(테마 · 글자 크기 · 고대비)은 <html> 의 data-* 속성으로 바로 반영
import { getJSON, setJSON } from './storage.js';

const KEY = 'settings';

export const DEFAULTS = Object.freeze({
  cameraLabel: '', // 고른 카메라 이름 (비어 있으면 이 컴퓨터에 달린 카메라를 먼저)
  dominant: 'right', // 'right' | 'left' — 왼손잡이면 거울로 뒤집어 판정
  strictness: 'normal', // 'lenient' | 'normal' | 'strict'
  voice: true, // 글자 이름 · 고칠 점을 소리로 읽어 주기
  voiceRate: 1, // 0.6 ~ 1.4
  voiceName: '', // 비어 있으면 한국어 목소리(Heami)를 자동으로
  sound: true, // 성공 · 실패 효과음
  silent: false, // 소리 없이 (화면으로만)
  speakHints: false, // 고칠 점도 소리로 (기본은 글자 이름만)
  textSize: 'normal', // 'normal' | 'large' | 'xlarge'
  contrast: 'normal', // 'normal' | 'high'
  theme: 'system', // 'system' | 'light' | 'dark'
  autoAdvance: true, // 맞히면 다음 글자로 저절로
  showFps: true,
});

const ALLOWED = {
  dominant: ['right', 'left'],
  strictness: ['lenient', 'normal', 'strict'],
  textSize: ['normal', 'large', 'xlarge'],
  contrast: ['normal', 'high'],
  theme: ['system', 'light', 'dark'],
};

let current = { ...DEFAULTS };
const listeners = new Set();

// 잘못 저장된 값은 기본값으로
function sanitize(obj) {
  const out = { ...DEFAULTS };
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in obj)) continue;
    const v = obj[k];
    const d = DEFAULTS[k];
    if (ALLOWED[k]) {
      if (ALLOWED[k].includes(v)) out[k] = v;
    } else if (typeof v === typeof d) {
      out[k] = v;
    }
  }
  out.voiceRate = Math.min(1.4, Math.max(0.6, Number(out.voiceRate) || 1));
  return out;
}

export function load() {
  current = sanitize(getJSON(KEY, null));
  applyToDocument();
  return current;
}

export function get(key) {
  return key ? current[key] : { ...current };
}

/** 하나 또는 여러 값을 바꾸고 저장 → 구독자에게 알림 */
export function set(patch, value) {
  const p = typeof patch === 'string' ? { [patch]: value } : patch || {};
  const next = sanitize({ ...current, ...p });
  const changed = Object.keys(next).filter((k) => next[k] !== current[k]);
  if (!changed.length) return current;
  current = next;
  setJSON(KEY, current);
  applyToDocument();
  for (const fn of listeners) {
    try {
      fn(current, changed);
    } catch (err) {
      console.error(err);
    }
  }
  return current;
}

export function reset() {
  return set({ ...DEFAULTS });
}

/** 바뀔 때마다 fn(settings, changedKeys) — 돌려받은 함수를 부르면 구독 끝 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 소리를 내도 되는지 (소리 없이 모드면 언제나 false) */
export function audioAllowed() {
  return !current.silent;
}

export function applyToDocument() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (current.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', current.theme);
  if (current.contrast === 'high') root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');
  if (current.textSize === 'normal') root.removeAttribute('data-text');
  else root.setAttribute('data-text', current.textSize);
  root.toggleAttribute('data-silent', !!current.silent);
}

export default { DEFAULTS, load, get, set, reset, subscribe, audioAllowed, applyToDocument };
