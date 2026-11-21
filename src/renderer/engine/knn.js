// 선생님 손 본뜨기 (k-최근접 이웃)
// - vectorize(features): 손 특징 → 숫자 목록 (손 크기 · 위치와 상관없고, 왼손은 거울 판정된 상태)
// - createTemplateStore(): 글자별 본(template)을 모아 두고 가장 비슷한 글자를 찾음 · JSON 으로 내보내기/가져오기
// - 모듈 함수 addTemplate / match / … 는 기본 저장소 하나를 씀 (앱 전체에서 같이 쓰기 쉬움)
import { LONG_FINGERS } from './handmodel.js';

export const VECTOR_VERSION = 1;

// 묶음별 무게 (값의 크기를 비슷하게 맞춘 뒤 곱함)
const W = { joint: 1.0, abd: 0.6, thumb: 0.8, dir: 1.2, palm: 1.4, hand: 0.8, tip: 0.8 };

/**
 * 손 특징 → 숫자 목록 (길이 고정)
 * 관절 각도(90° = 1), 벌림, 엄지, 손가락 방향 · 손바닥 방향 · 손 방향(단위 벡터), 엄지 끝 위치, 엄지와 손끝 거리
 */
export function vectorize(f) {
  if (!f || !f.fingers) return null;
  const v = [];
  for (const k of LONG_FINGERS) {
    const j = f.fingers[k];
    v.push((j.mcp / 90) * W.joint, (j.pip / 90) * W.joint, (j.dip / 90) * W.joint, (j.abd / 30) * W.abd);
  }
  const t = f.fingers.thumb;
  v.push((t.cmc / 60) * W.thumb, (t.abd / 60) * W.thumb, (t.mcp / 60) * W.thumb, (t.ip / 60) * W.thumb);
  for (const k of ['thumb', ...LONG_FINGERS]) v.push(...f.fingers[k].dirVec.map((x) => x * W.dir));
  v.push(...f.palm.normal.map((x) => x * W.palm));
  v.push(...f.hand.vec.map((x) => x * W.hand));
  const g = f.thumbGeom || { tip: [0, 0, 0] };
  v.push(...g.tip.map((x) => x * W.tip));
  v.push(f.tipDist['thumb-index'] * W.tip, f.tipDist['thumb-middle'] * W.tip);
  return v.map((x) => (Number.isFinite(x) ? x : 0));
}

export const VECTOR_LENGTH = 4 * 4 + 4 + 5 * 3 + 3 + 3 + 3 + 2;

/** 두 숫자 목록 사이 거리 (유클리드) */
export function distance(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * 본 저장소
 * @returns {{
 *   addTemplate(letterId: string, vector: number[], meta?: object): object,
 *   removeTemplates(letterId?: string): number, templatesOf(letterId): object[], letters(): string[],
 *   match(vector: number[], k?: number, opts?: {letters?: string[], maxDistance?: number}): {letterId, distance, votes, confidence, neighbors}|null,
 *   distanceTo(vector, letterId, k?): number, clear(): void, toJSON(): object, fromJSON(json, {merge?}): number, readonly size: number }}
 */
export function createTemplateStore() {
  let items = []; // { letterId, v, meta }

  function addTemplate(letterId, vector, meta = {}) {
    if (!letterId || !Array.isArray(vector) || vector.length !== VECTOR_LENGTH) {
      throw new TypeError(`addTemplate: 글자 id 와 길이 ${VECTOR_LENGTH} 숫자 목록이 필요해요`);
    }
    const item = { letterId: String(letterId), v: vector.slice(), meta: { t: Date.now(), ...meta } };
    items.push(item);
    return item;
  }

  function removeTemplates(letterId) {
    const before = items.length;
    items = letterId === undefined ? [] : items.filter((x) => x.letterId !== letterId);
    return before - items.length;
  }

  /**
   * 가장 비슷한 글자 (k 개 이웃의 거리 가중 투표)
   * confidence: 1등 글자가 받은 표의 몫 (0~1)
   */
  function match(vector, k = 5, { letters = null, maxDistance = Infinity } = {}) {
    if (!Array.isArray(vector) || !items.length) return null;
    const pool = letters ? items.filter((x) => letters.includes(x.letterId)) : items;
    const near = pool
      .map((x) => ({ letterId: x.letterId, distance: distance(vector, x.v) }))
      .filter((x) => x.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(1, k));
    if (!near.length) return null;
    const votes = {};
    let total = 0;
    for (const n of near) {
      const w = 1 / (n.distance + 1e-3);
      votes[n.letterId] = (votes[n.letterId] || 0) + w;
      total += w;
    }
    const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    const bestDist = Math.min(...near.filter((n) => n.letterId === best).map((n) => n.distance));
    return { letterId: best, distance: bestDist, votes, confidence: votes[best] / total, neighbors: near };
  }

  /** 한 글자의 본들까지 가장 가까운 k 개 평균 거리 (본이 없으면 Infinity) */
  function distanceTo(vector, letterId, k = 3) {
    const ds = items.filter((x) => x.letterId === letterId).map((x) => distance(vector, x.v)).sort((a, b) => a - b).slice(0, k);
    return ds.length ? ds.reduce((s, d) => s + d, 0) / ds.length : Infinity;
  }

  return {
    addTemplate,
    removeTemplates,
    templatesOf: (id) => items.filter((x) => x.letterId === id),
    letters: () => [...new Set(items.map((x) => x.letterId))],
    match,
    distanceTo,
    clear() { items = []; },
    /** 다른 컴퓨터로 옮길 수 있는 JSON 모양 */
    toJSON() {
      return { kind: 'sonmal-templates', version: VECTOR_VERSION, length: VECTOR_LENGTH, templates: items.map((x) => ({ ...x, v: x.v.map((n) => Math.round(n * 1e4) / 1e4) })) };
    },
    /**
     * JSON 가져오기 (모양이 다르면 Error). merge 가 false 면 기존 본을 지우고 바꿈
     * @returns {number} 가져온 본 개수
     */
    fromJSON(json, { merge = true } = {}) {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data || data.kind !== 'sonmal-templates' || !Array.isArray(data.templates)) throw new Error('손말 첫걸음 선생님 손 파일이 아니에요');
      if (data.version !== VECTOR_VERSION || data.length !== VECTOR_LENGTH) throw new Error('다른 판의 선생님 손 파일이라 읽을 수 없어요');
      const ok = data.templates.filter((x) => x && x.letterId && Array.isArray(x.v) && x.v.length === VECTOR_LENGTH && x.v.every(Number.isFinite));
      if (!merge) items = [];
      for (const x of ok) items.push({ letterId: String(x.letterId), v: x.v.slice(), meta: x.meta || {} });
      return ok.length;
    },
    get size() { return items.length; },
  };
}

// ───────── 기본 저장소 ─────────
const defaultStore = createTemplateStore();
export const templates = defaultStore;
export const addTemplate = (letterId, vector, meta) => defaultStore.addTemplate(letterId, vector, meta);
export const match = (vector, k, opts) => defaultStore.match(vector, k, opts);
export const removeTemplates = (letterId) => defaultStore.removeTemplates(letterId);
export const clearTemplates = () => defaultStore.clear();
export const exportTemplates = () => defaultStore.toJSON();
export const importTemplates = (json, opts) => defaultStore.fromJSON(json, opts);
