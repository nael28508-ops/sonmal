// 배운 기록 · 복습 일정 (DOM 없음, 저장소는 밖에서 넣어 줌)
// - 글자마다: 시도 · 성공 횟수, 걸린 시간, 연속 성공, 복습 상자(라이트너 상자 0~5)와 다음 복습 때
// - 연습한 날짜 목록, "이어서 하기" 위치
// - 저장소 어댑터: { get(key, fallback), set(key, value) } (JSON 값) 또는 { getItem, setItem } (문자열). 없으면 메모리에만
//   core/storage.js 의 adapter 를 그대로 넣으면 됨

export const STORAGE_KEY = 'progress';
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
/** 상자별 다음 복습까지 (상자 0 = 바로, 5 = 30일) */
export const BOX_INTERVALS = [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 30 * DAY];
/** 익힌 글자 기준: 상자 3 이상, 성공 3번 이상, 최근 정확도 80% 이상 */
export const MASTERY = { box: 3, successes: 3, accuracy: 0.8 };
const RECENT = 10; // 최근 몇 번으로 정확도를 볼지

/** 날짜 → 'YYYY-MM-DD' (그 컴퓨터의 시간대) */
export function dayKey(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function emptyData() {
  return { v: 1, letters: {}, days: [], last: null };
}

function emptyStat() {
  return { attempts: 0, successes: 0, streak: 0, recent: [], totalMs: 0, bestMs: null, box: 0, due: 0, lastAt: 0 };
}

function readStore(storage, key) {
  if (!storage) return null;
  try {
    if (typeof storage.get === 'function') return storage.get(key, null);
    if (typeof storage.getItem === 'function') {
      const s = storage.getItem(key);
      return s ? JSON.parse(s) : null;
    }
  } catch {
    /* 못 읽으면 새로 시작 */
  }
  return null;
}

function writeStore(storage, key, data) {
  if (!storage) return;
  try {
    if (typeof storage.set === 'function') storage.set(key, data);
    else if (typeof storage.setItem === 'function') storage.setItem(key, JSON.stringify(data));
  } catch {
    /* 저장 못 해도 계속 */
  }
}

/**
 * @param {{storage?: object, key?: string, now?: () => number}} [o]
 */
export function createProgress({ storage = null, key = STORAGE_KEY, now = () => Date.now() } = {}) {
  let data = sanitize(readStore(storage, key));
  const subs = new Set();

  function sanitize(d) {
    const out = emptyData();
    if (!d || typeof d !== 'object') return out;
    if (d.letters && typeof d.letters === 'object') {
      for (const [id, s] of Object.entries(d.letters)) out.letters[id] = { ...emptyStat(), ...s, recent: Array.isArray(s.recent) ? s.recent.slice(-RECENT) : [] };
    }
    if (Array.isArray(d.days)) out.days = d.days.filter((x) => typeof x === 'string').sort();
    if (d.last && typeof d.last === 'object') out.last = d.last;
    return out;
  }

  function save() {
    writeStore(storage, key, data);
    for (const fn of subs) {
      try { fn(api); } catch (e) { console.error(e); }
    }
  }

  const stat = (id) => data.letters[id] || emptyStat();

  function markDay(t) {
    const k = dayKey(t);
    if (!data.days.includes(k)) {
      data.days.push(k);
      data.days.sort();
    }
  }

  /**
   * 글자 한 번 해 본 결과 기록
   * @param {string} letterId
   * @param {{ok: boolean, ms?: number}} r ms: 걸린 시간
   * @returns {object} 바뀐 기록
   */
  function recordAttempt(letterId, { ok, ms = null } = {}) {
    const t = now();
    const s = { ...stat(letterId) };
    s.attempts += 1;
    s.recent = [...s.recent, ok ? 1 : 0].slice(-RECENT);
    s.lastAt = t;
    if (ok) {
      s.successes += 1;
      s.streak += 1;
      if (Number.isFinite(ms) && ms > 0) {
        s.totalMs += ms;
        s.bestMs = s.bestMs === null ? ms : Math.min(s.bestMs, ms);
      }
      s.box = Math.min(BOX_INTERVALS.length - 1, s.box + 1);
      s.due = t + BOX_INTERVALS[s.box];
    } else {
      s.streak = 0;
      s.box = Math.max(0, s.box - 2);
      s.due = t + BOX_INTERVALS[0];
    }
    data.letters[letterId] = s;
    markDay(t);
    save();
    return summarize(letterId);
  }

  /** 글자 기록 요약 { attempts, successes, accuracy, avgMs, bestMs, box, due, mastered, seen } */
  function summarize(letterId) {
    const s = stat(letterId);
    const accuracy = s.recent.length ? s.recent.reduce((a, b) => a + b, 0) / s.recent.length : 0;
    return {
      letterId,
      attempts: s.attempts,
      successes: s.successes,
      streak: s.streak,
      accuracy,
      avgMs: s.successes ? s.totalMs / s.successes : null,
      bestMs: s.bestMs,
      box: s.box,
      due: s.due,
      lastAt: s.lastAt,
      seen: s.attempts > 0,
      mastered: s.box >= MASTERY.box && s.successes >= MASTERY.successes && accuracy >= MASTERY.accuracy,
    };
  }

  const ids = (list) => (list ? list.map((x) => (typeof x === 'string' ? x : x.id)) : Object.keys(data.letters));

  /** 복습할 때가 된 글자 (해 본 글자만, 오래 밀린 순서) */
  function dueForReview(list = null, t = now()) {
    return ids(list).filter((id) => data.letters[id] && data.letters[id].attempts > 0 && data.letters[id].due <= t)
      .sort((a, b) => data.letters[a].due - data.letters[b].due);
  }

  /** 약한 글자 n 개 (정확도 낮은 순, 해 본 글자만) */
  function weakest(n = 5, list = null) {
    return ids(list).map(summarize).filter((s) => s.seen)
      .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
      .slice(0, n);
  }

  /** 단원 진행 { total, mastered, seen, ratio } (letterIds: 단원의 글자 id 또는 글자 목록) */
  function unitProgress(list) {
    const all = ids(list);
    const sums = all.map(summarize);
    const mastered = sums.filter((s) => s.mastered).length;
    return { total: all.length, mastered, seen: sums.filter((s) => s.seen).length, ratio: all.length ? mastered / all.length : 0 };
  }

  /**
   * 연습할 글자 뽑기: 복습할 때가 된 글자 → 약한 글자 → 안 해 본 글자 → 나머지 (가중 무작위)
   * @param {string[]|object[]} list 고를 후보
   * @param {number} n 몇 개
   * @param {() => number} [rand=Math.random]
   */
  function pickPractice(list, n = 10, rand = Math.random) {
    const pool = ids(list);
    const t = now();
    const weight = (id) => {
      const s = summarize(id);
      if (!s.seen) return 1.5;
      let w = 0.4 + (1 - s.accuracy) * 2;
      if (s.due <= t) w += 2;
      if (s.mastered) w *= 0.5;
      return w;
    };
    const left = pool.map((id) => ({ id, w: weight(id) }));
    const out = [];
    while (out.length < n && left.length) {
      const sum = left.reduce((a, b) => a + b.w, 0);
      let r = rand() * sum;
      let i = 0;
      while (i < left.length - 1 && r >= left[i].w) { r -= left[i].w; i++; }
      out.push(left[i].id);
      left.splice(i, 1);
    }
    return out;
  }

  /** 연속으로 연습한 날 수 (오늘이나 어제까지 이어진 경우) */
  function streakDays(t = now()) {
    const set = new Set(data.days);
    let d = set.has(dayKey(t)) ? t : t - DAY;
    let n = 0;
    while (set.has(dayKey(d))) { n++; d -= DAY; }
    return n;
  }

  const api = {
    recordAttempt,
    stats: summarize,
    /** 기록이 있는 모든 글자 요약 */
    allStats: () => Object.keys(data.letters).map(summarize),
    isMastered: (id) => summarize(id).mastered,
    masteredIds: (list = null) => ids(list).filter((id) => summarize(id).mastered),
    dueForReview,
    reviewCount: (list = null, t = now()) => dueForReview(list, t).length,
    weakest,
    unitProgress,
    pickPractice,
    practiceDays: () => data.days.slice(),
    streakDays,
    /** "이어서 하기" 위치 저장: 예 { screen: 'learn', unitId: 'c1', letterId: 'ㄷ' } */
    setLast(pos) {
      data.last = pos ? { ...pos, at: now() } : null;
      save();
    },
    getLast: () => (data.last ? { ...data.last } : null),
    /** 모두 지우기 */
    reset() {
      data = emptyData();
      save();
    },
    exportJSON: () => JSON.parse(JSON.stringify(data)),
    importJSON(json) {
      data = sanitize(typeof json === 'string' ? JSON.parse(json) : json);
      save();
    },
    /** 기록이 바뀔 때마다 부름 → 그만 듣기 함수 */
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  return api;
}
