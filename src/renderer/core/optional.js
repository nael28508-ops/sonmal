// 따로 만들어지는 모듈(손 그림 · 가짜 손 · 선생님 손 · 기록)을 불러오는 곳
// 없으면 null 을 돌려줘서, 앱이 멈추지 않고 대신할 방법을 쓰게 함
const cache = new Map();

function load(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      import(path).catch((err) => {
        console.warn(`모듈을 불러오지 못했어요: ${path}`, err && err.message);
        return null;
      }),
    );
  }
  return cache.get(path);
}

export const loadHandRender = () => load('../ui/hand-render.js');
export const loadSynthetic = () => load('./synthetic-tracker.js');

/** 모듈에서 이름이 맞는 함수 찾기 (이름이 조금 달라도 쓰도록) */
export function pick(mod, ...names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}
