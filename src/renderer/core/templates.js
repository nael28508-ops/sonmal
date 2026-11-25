// 선생님 손 본(템플릿): engine/knn.js 의 본 저장소 + 이 컴퓨터에 저장 + 파일로 내보내기 · 가져오기
// 본이 있는 글자는 판정이 선생님 손을 따라감 (core/judge.js)
import { createTemplateStore, vectorize } from '../engine/knn.js';
import { getJSON, setJSON } from './storage.js';

const KEY = 'teacher';
/** 얼마나 가까워야 "선생님 손과 같다"고 볼지 (knn 거리) */
export const MAX_DISTANCE = { lenient: 1.5, normal: 1.15, strict: 0.85 };

const store = createTemplateStore();
let teacherName = '';
const listeners = new Set();

(function load() {
  const d = getJSON(KEY, null);
  if (!d) return;
  try {
    if (d.data) store.fromJSON(d.data, { merge: false });
    teacherName = String(d.teacher || '');
  } catch (err) {
    console.warn('저장된 선생님 손을 읽지 못했어요', err && err.message);
  }
})();

function save() {
  setJSON(KEY, { teacher: teacherName, data: store.toJSON() });
  for (const fn of listeners) fn();
}

export const templates = {
  vectorize,
  count: (letterId) => store.templatesOf(letterId).length,
  letters: () => store.letters(),
  get size() {
    return store.size;
  },
  get teacher() {
    return teacherName;
  },
  setTeacher(name) {
    teacherName = String(name || '').slice(0, 40);
    save();
  },
  /** 한 글자의 본을 바꿔 넣음 (vectors: 숫자 목록들) */
  replace(letterId, vectors) {
    store.removeTemplates(letterId);
    for (const v of vectors) store.addTemplate(letterId, v, { teacher: teacherName });
    save();
  },
  remove(letterId) {
    store.removeTemplates(letterId);
    save();
  },
  clear() {
    store.clear();
    save();
  },
  /** 파일로 내보낼 JSON */
  exportJSON() {
    return { ...store.toJSON(), teacher: teacherName, exportedAt: new Date().toISOString(), app: 'Learn 수어' };
  },
  /** 파일에서 가져오기 → 가져온 본 개수 (모양이 틀리면 Error) */
  importJSON(json, { merge = true } = {}) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const n = store.fromJSON(data, { merge });
    if (data && data.teacher) teacherName = String(data.teacher).slice(0, 40);
    save();
    return n;
  },
  /**
   * 지금 손이 이 글자의 선생님 손과 같은지
   * @returns {null | { ok: boolean, distance: number, confidence: number }} 본이 없으면 null
   */
  judge(features, letterId, strictness = 'normal') {
    if (!features || !store.templatesOf(letterId).length) return null;
    const v = vectorize(features);
    const m = store.match(v, 5);
    const d = store.distanceTo(v, letterId, 3);
    const ok = !!m && m.letterId === letterId && m.confidence >= 0.6 && d <= (MAX_DISTANCE[strictness] || MAX_DISTANCE.normal);
    return { ok, distance: d, confidence: m ? m.confidence : 0 };
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
