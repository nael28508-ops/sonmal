// 저장소: localStorage 를 감싼 작은 도우미
// - 모든 키 앞에 'sonmal.' 을 붙임
// - 저장 공간이 막혀 있어도(사생활 모드 등) 앱이 멈추지 않도록 모든 접근을 try/catch 로 감쌈
const PREFIX = 'sonmal.';

/** 문자열 그대로 읽기 (없거나 못 읽으면 fallback) */
export function getRaw(key, fallback = null) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** 문자열 그대로 쓰기 (성공하면 true) */
export function setRaw(key, value) {
  try {
    localStorage.setItem(PREFIX + key, String(value));
    return true;
  } catch {
    return false;
  }
}

/** JSON 으로 읽기 */
export function getJSON(key, fallback = null) {
  const raw = getRaw(key, null);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** JSON 으로 쓰기 */
export function setJSON(key, value) {
  try {
    return setRaw(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
    return true;
  } catch {
    return false;
  }
}

/** 이 앱이 쓰는 키 목록 (앞의 'sonmal.' 은 뗀 이름) */
export function keys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* 못 읽으면 빈 목록 */
  }
  return out;
}

/** engine/progress.js 같은 순수 모듈에 넘겨 줄 저장소 어댑터 { get, set, remove } */
export const adapter = {
  get: (key, fallback = null) => getJSON(key, fallback),
  set: (key, value) => setJSON(key, value),
  remove: (key) => remove(key),
  getItem: (key) => getRaw(key, null),
  setItem: (key, value) => setRaw(key, value),
  removeItem: (key) => remove(key),
};

export default { getRaw, setRaw, getJSON, setJSON, remove, keys, adapter };
