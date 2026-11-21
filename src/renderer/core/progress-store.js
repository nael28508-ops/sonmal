// 학습 기록: engine/progress.js(순수 통계 · 간격 반복)를 화면에서 쓰기 좋게 감쌈
// - 저장은 core/storage.js 의 어댑터 ('sonmal.progress')
import { createProgress } from '../engine/progress.js';

/**
 * @param {{ get(key, fallback), set(key, value) }} storage 저장소 어댑터
 */
export function createProgressStore(storage) {
  const p = createProgress({ storage });

  /** 화면용 요약: 해 본 적 없으면 accuracy 는 NaN */
  function stat(id) {
    const s = p.stats(id);
    return {
      ...s,
      success: s.successes,
      fails: s.attempts - s.successes,
      accuracy: s.seen ? s.accuracy : NaN,
      avgMs: s.avgMs ?? NaN,
      bestMs: s.bestMs ?? NaN,
    };
  }

  return {
    /** 한 번 해 본 결과: ok(맞힘), ms(걸린 시간) */
    record(id, { ok, ms = null } = {}) {
      if (id) p.recordAttempt(id, { ok: !!ok, ms });
    },
    stat,
    /** 지금 복습할 글자 id */
    due: (ids) => p.dueForReview(ids),
    /** 약한 글자 (정확도 낮은 순, 90% 미만만) */
    weakest: (ids, n = 5) => p.weakest(ids.length, ids).filter((s) => s.accuracy < 0.9).slice(0, n).map((s) => stat(s.letterId)),
    mastered: (ids) => p.masteredIds(ids),
    pickPractice: (ids, n) => p.pickPractice(ids, n),
    streak: () => p.streakDays(),
    get days() {
      return p.practiceDays();
    },
    get last() {
      const l = p.getLast();
      return l ? { unit: l.unitId, letter: l.letterId } : null;
    },
    setLast({ unit, letter } = {}) {
      p.setLast({ screen: 'learn', unitId: unit, letterId: letter });
    },
    totals() {
      const all = p.allStats();
      const attempts = all.reduce((s, e) => s + e.attempts, 0);
      const success = all.reduce((s, e) => s + e.successes, 0);
      return { attempts, success, accuracy: attempts ? success / attempts : NaN, letters: all.length, days: p.practiceDays().length };
    },
    reset: () => p.reset(),
    exportData: () => p.exportJSON(),
    onChange: (fn) => p.subscribe(fn),
  };
}
