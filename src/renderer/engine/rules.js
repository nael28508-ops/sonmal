// 지문자 판정 규칙: 글자(Letter)의 확인 항목(checks)을 손 특징(HandFeatures)에 맞춰 봄
// - 글자는 그냥 데이터: { id, name, checks: [...], motion, pose, ... } (자세한 모양은 README.md)
// - 확인 항목 하나에는 판정 조건(predicate)이 꼭 하나: finger+state / finger+dir / finger+angle /
//   palm / hand / thumb / touch / apart / together / spread / custom
// - 엄격함(strictness)은 아래 TOLERANCE 표 하나로 모든 기준을 넓히거나 좁힘
import { angleBetween, clamp, dirVector } from './geometry.js';
import {
  FINGERS, FINGER_KO, STATE_KO, THUMB_KO, DIR_KO, PALM_KO, THUMB_POSITIONS, stateMargin, pointDistance, spreadBetween,
} from './features.js';

export const STRICTNESS_LEVELS = ['lenient', 'normal', 'strict'];
export const STRICTNESS_KO = { lenient: '너그럽게', normal: '보통', strict: '엄격하게' };

/**
 * 엄격함별 허용 오차 표 (모든 판정 기준이 여기서 나옴)
 * dirDeg: 손가락 · 손 방향 허용 각도, palmDeg: 손바닥 방향 허용 각도,
 * stateDeg: 손가락 상태 경계에 더하는 각도(+ 너그럽게), angleDeg: 관절 각도 범위에 더하는 각도,
 * touch: 손끝이 닿았다고 볼 최대 거리, apart: 떨어졌다고 볼 최소 거리 (손바닥 길이 단위),
 * togetherDeg: 붙였다고 볼 최대 사이각, spreadDeg: 벌림 범위에 더하는 각도,
 * thumbNear: 엄지 위치가 가장 높은 점수가 아니어도 이만큼 가까우면 통과 (null 이면 꼭 1등),
 * thumbMin / thumbGap: 엄지 위치 점수가 이 값 이상 · 다른 위치보다 이만큼 앞서야 통과
 */
export const TOLERANCE = {
  lenient: {
    dirDeg: 50, palmDeg: 55, stateDeg: 12, angleDeg: 15, touch: 0.36, apart: 0.3,
    togetherDeg: 18, spreadDeg: 4, thumbNear: 0.3, thumbMin: 0, thumbGap: -1,
  },
  normal: {
    dirDeg: 40, palmDeg: 45, stateDeg: 0, angleDeg: 0, touch: 0.27, apart: 0.4,
    togetherDeg: 13, spreadDeg: 0, thumbNear: null, thumbMin: 0, thumbGap: -1,
  },
  strict: {
    dirDeg: 30, palmDeg: 35, stateDeg: -8, angleDeg: -8, touch: 0.2, apart: 0.5,
    togetherDeg: 10, spreadDeg: -3, thumbNear: null, thumbMin: 0.5, thumbGap: 0.1,
  },
};

/** 엄격함 이름 → 허용 오차 (모르는 이름이면 보통) */
export function getTolerance(strictness = 'normal') {
  return TOLERANCE[strictness] || TOLERANCE.normal;
}

// 판정마다 "충분히 안쪽"으로 보는 크기 (점수 fit, 모자란 정도 miss 를 같은 눈금으로 맞춤)
const SCALE = {
  state: 25, dir: 30, angle: 20, palm: 30, hand: 30, thumb: 0.3,
  touch: 0.15, apart: 0.15, together: 10, spread: 10, custom: 1,
};

// 가장 고칠 것(worst)을 고를 때 순서: 손가락 상태 → 다른 손가락 조건 → 엄지 위치 · 손바닥 · 손 방향
const GROUP = {
  state: 0, dir: 1, angle: 1, touch: 1, apart: 1, together: 1, spread: 1, custom: 1, thumb: 2, palm: 2, hand: 2,
};

const STATE_NAMES = ['extended', 'hooked', 'bent', 'curled', 'folded'];
const JOINTS = { thumb: ['cmc', 'abd', 'mcp', 'ip'], other: ['mcp', 'pip', 'dip', 'abd'] };
const JOINT_KO = { cmc: '뿌리(CMC)', abd: '벌림', mcp: '첫째 마디(MCP)', pip: '둘째 마디(PIP)', dip: '끝마디(DIP)', ip: '끝마디(IP)' };
const POINT_PARTS = { thumb: ['tip', 'ip', 'mcp', 'cmc'], other: ['tip', 'dip', 'pip', 'mcp'] };

const predicates = new Map();

/**
 * 드문 확인 항목을 위한 직접 판정 함수 등록
 * @param {string} name check.custom 에 쓸 이름
 * @param {(features, check, tolerance) => {ok:boolean, value?:any, target?:any, margin?:number, miss?:number, valueText?:string, targetText?:string}} fn
 *   margin(통과 여유, 0 이상이면 통과)을 주면 점수 계산이 더 부드러워짐
 */
export function registerPredicate(name, fn) {
  if (typeof name !== 'string' || !name) throw new TypeError('registerPredicate: 이름이 필요해요');
  if (typeof fn !== 'function') throw new TypeError('registerPredicate: 함수가 필요해요');
  predicates.set(name, fn);
}

export function hasPredicate(name) {
  return predicates.has(name);
}

export function unregisterPredicate(name) {
  return predicates.delete(name);
}

const arr = (x) => (Array.isArray(x) ? x : [x]);
const r2 = (x) => Math.round(x * 100) / 100;
const PREDICATE_KEYS = ['state', 'dir', 'angle', 'palm', 'hand', 'thumb', 'touch', 'apart', 'together', 'spread', 'custom'];

/** 확인 항목의 종류 ('state'|'dir'|'angle'|'palm'|'hand'|'thumb'|'touch'|'apart'|'together'|'spread'|'custom'|null) */
export function checkKind(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.custom) return 'custom';
  if (c.touch) return 'touch';
  if (c.apart) return 'apart';
  if (c.together) return 'together';
  if (c.spread) return 'spread';
  if (c.palm) return 'palm';
  if (c.hand) return 'hand';
  if (c.thumb) return 'thumb';
  if (c.finger && c.state) return 'state';
  if (c.finger && c.dir) return 'dir';
  if (c.finger && c.angle) return 'angle';
  return null;
}

// ───────── 한국어 문구 도우미 ─────────
/** 받침에 맞는 조사: josa('검지', '을/를') → '검지를' */
export function josa(word, pair) {
  const [withF, withoutF] = pair.split('/');
  const s = String(word);
  const ch = s.charCodeAt(s.length - 1);
  let hasFinal = false;
  if (ch >= 0xac00 && ch <= 0xd7a3) {
    const fin = (ch - 0xac00) % 28;
    hasFinal = fin !== 0;
    if (pair === '으로/로' && fin === 8) hasFinal = false; // ㄹ 받침 + 로
  } else if (/[0-9]$/.test(s)) {
    hasFinal = /[013678]$/.test(s);
  }
  return s + (hasFinal ? withF : withoutF);
}

/** 방향 이름 → 한국어 (거울처럼 판정하는 왼손이면 왼쪽 ↔ 오른쪽) */
export function dirText(dir, mirrored = false, table = DIR_KO) {
  if (!dir) return '';
  return String(dir).split('+').map((d) => {
    const dd = mirrored && (d === 'left' || d === 'right') ? (d === 'left' ? 'right' : 'left') : d;
    return table[dd] || dd;
  }).join(' ');
}

const orText = (list) => list.join(' 또는 ');

/** 거울 판정(왼손)일 때 글자 문구의 '왼쪽' ↔ '오른쪽' 을 맞바꿈 (글자 데이터는 오른손 기준으로 씀) */
export function swapLR(text) {
  return String(text).replace(/왼쪽|오른쪽/g, (m) => (m === '왼쪽' ? '오른쪽' : '왼쪽'));
}
const pointKo = (name) => {
  if (name === 'palm') return '손바닥';
  if (name === 'wrist') return '손목';
  const [f, part] = String(name).split('.');
  const base = FINGER_KO[f] || f;
  if (!part || part === 'tip') return `${base} 끝`;
  return `${base} ${JOINT_KO[part] || part}`;
};

// ───────── 확인 항목 하나 판정 ─────────
function fingersOf(c, kind) {
  const pick = (name) => String(name).split('.')[0];
  switch (kind) {
    case 'state': case 'dir': case 'angle': return [c.finger];
    case 'thumb': return ['thumb'];
    case 'touch': case 'apart': case 'together':
      return arr(c[kind]).map(pick).filter((f) => FINGERS.includes(f));
    case 'spread': return [c.spread.a, c.spread.b].filter((f) => FINGERS.includes(f));
    case 'custom': return c.finger ? arr(c.finger).filter((f) => FINGERS.includes(f)) : [];
    default: return [];
  }
}

function judge(kind, c, f, tol) {
  const mir = f.mirrored;
  switch (kind) {
    case 'state': {
      const j = f.fingers[c.finger];
      const targets = arr(c.state);
      const margin = Math.max(...targets.map((t) => stateMargin(c.finger, j, t, tol.stateDeg)));
      return {
        margin, value: j.state, target: targets,
        valueText: STATE_KO[j.state], targetText: orText(targets.map((t) => STATE_KO[t] || t)),
      };
    }
    case 'dir': {
      const fd = f.fingers[c.finger];
      const targets = arr(c.dir);
      const ang = Math.min(...targets.map((t) => angleBetween(fd.dirVec, dirVector(t) || [0, 0, 0])));
      return {
        margin: tol.dirDeg - ang, value: fd.dir, target: targets, angle: Math.round(ang),
        valueText: dirText(fd.dir, mir), targetText: orText(targets.map((t) => dirText(t, mir))),
      };
    }
    case 'angle': {
      const j = f.fingers[c.finger];
      const { joint, min = -Infinity, max = Infinity } = c.angle;
      const v = j[joint];
      if (!Number.isFinite(v)) return { margin: -SCALE.angle, value: null, target: c.angle, valueText: '?', targetText: '' };
      const margin = Math.min(v - (min - tol.angleDeg), max + tol.angleDeg - v);
      const range = Number.isFinite(min) && Number.isFinite(max) ? `${min}°~${max}°`
        : Number.isFinite(min) ? `${min}° 이상` : `${max}° 이하`;
      return { margin, value: Math.round(v), target: { joint, min, max }, valueText: `${Math.round(v)}°`, targetText: range };
    }
    case 'palm': case 'hand': {
      const vec = kind === 'palm' ? f.palm.normal : f.hand.vec;
      const now = kind === 'palm' ? f.palm.facing : f.hand.dir;
      const targets = arr(c[kind]);
      const ang = Math.min(...targets.map((t) => angleBetween(vec, dirVector(t) || [0, 0, 0])));
      const table = kind === 'palm' ? PALM_KO : DIR_KO;
      return {
        margin: (kind === 'palm' ? tol.palmDeg : tol.dirDeg) - ang, value: now, target: targets, angle: Math.round(ang),
        valueText: dirText(now, mir, table), targetText: orText(targets.map((t) => dirText(t, mir, table))),
      };
    }
    case 'thumb': {
      const targets = arr(c.thumb);
      const sc = f.thumbScores;
      const st = Math.max(...targets.map((t) => sc[t] ?? 0));
      const others = THUMB_POSITIONS.filter((p) => !targets.includes(p));
      const so = others.length ? Math.max(...others.map((p) => sc[p] ?? 0)) : 0;
      const inTarget = targets.includes(f.thumbPos);
      let ok = inTarget && st >= tol.thumbMin && st - so >= tol.thumbGap;
      if (!ok && tol.thumbNear !== null && st > 0 && st >= so - tol.thumbNear) ok = true;
      // 여유: 통과면 점수 차이(0 이상), 아니면 모자란 정도(음수)
      let margin = st - so;
      if (ok) margin = Math.max(margin, 0.001);
      else if (margin >= 0) margin = Math.min(-0.01, st - Math.max(tol.thumbMin, so + tol.thumbGap));
      return {
        margin, ok, value: f.thumbPos, target: targets,
        valueText: THUMB_KO[f.thumbPos], targetText: orText(targets.map((t) => THUMB_KO[t] || t)),
      };
    }
    case 'touch': case 'apart': {
      const [a, b] = c[kind];
      const d = pointDistance(f, a, b);
      const margin = kind === 'touch' ? tol.touch - d : d - tol.apart;
      return {
        margin: Number.isFinite(margin) ? margin : -SCALE.touch, value: r2(d),
        target: kind === 'touch' ? { max: tol.touch } : { min: tol.apart },
        valueText: kind === 'touch' ? (margin >= 0 ? '닿음' : '떨어짐') : margin >= 0 ? '떨어짐' : '붙음',
        targetText: kind === 'touch' ? '닿기' : '떼기',
      };
    }
    case 'together': {
      const [a, b] = c.together.map((x) => String(x).split('.')[0]);
      const ang = spreadBetween(f, a, b);
      return {
        margin: tol.togetherDeg - ang, value: Math.round(ang), target: { maxDeg: tol.togetherDeg },
        valueText: ang <= tol.togetherDeg ? '붙음' : `${Math.round(ang)}° 벌어짐`, targetText: '나란히 붙이기',
      };
    }
    case 'spread': {
      const { a, b, min = -Infinity, max = Infinity } = c.spread;
      const ang = spreadBetween(f, a, b);
      const margin = Math.min(ang - (min - tol.spreadDeg), max + tol.spreadDeg - ang);
      const range = Number.isFinite(min) && Number.isFinite(max) ? `${min}°~${max}°`
        : Number.isFinite(min) ? `${min}° 이상` : `${max}° 이하`;
      return { margin, value: Math.round(ang), target: { min, max }, valueText: `${Math.round(ang)}°`, targetText: range };
    }
    case 'custom': {
      const fn = predicates.get(c.custom);
      if (!fn) return { margin: -1, value: null, target: c.custom, valueText: '?', targetText: c.custom, missing: true };
      const res = fn(f, c, tol) || {};
      const ok = !!res.ok;
      let margin = Number.isFinite(res.margin) ? res.margin : ok ? 0.5 : -(Number.isFinite(res.miss) ? res.miss : 1);
      if (ok && margin < 0) margin = 0;
      if (!ok && margin >= 0) margin = -0.01;
      return {
        margin, ok, value: res.value ?? null, target: res.target ?? null,
        valueText: res.valueText ?? (res.value == null ? '' : String(res.value)),
        targetText: res.targetText ?? (res.target == null ? '' : String(res.target)),
      };
    }
    default:
      return { margin: -1, value: null, target: null, valueText: '', targetText: '' };
  }
}

/**
 * 확인 항목 하나 판정
 * @returns {{id, label, msg, weight, kind, finger, fingers, ok, value, target, valueText, targetText, margin, miss, fit}}
 */
export function evaluateCheck(check, features, tol = TOLERANCE.normal) {
  const kind = checkKind(check);
  const lr = features && features.mirrored ? swapLR : (s) => s;
  const res = kind ? judge(kind, check, features, tol) : judge(null, check, features, tol);
  const ok = res.ok !== undefined ? res.ok : res.margin >= 0;
  const scale = SCALE[kind] || 1;
  const fingers = kind ? fingersOf(check, kind) : [];
  return {
    id: check.id,
    label: lr(check.label || ''),
    msg: lr(check.msg || ''),
    weight: Number.isFinite(check.weight) ? check.weight : 1,
    kind,
    finger: fingers.length === 1 ? fingers[0] : fingers.length ? fingers : null,
    fingers,
    ok,
    value: res.value,
    target: res.target,
    valueText: res.valueText,
    targetText: res.targetText,
    angle: res.angle,
    margin: res.margin,
    miss: ok ? 0 : Math.max(0, -res.margin) / scale,
    fit: clamp(0.5 + (0.5 * res.margin) / scale, 0, 1),
  };
}

// 고칠 것 순서: 움직임은 맨 끝 → 무게 큰 것 → 손가락 상태 먼저 → 많이 틀린 것
// (틀린 정도가 거의 같으면 글자에 적힌 순서대로)
function worstOrder(a, b) {
  const am = a.kind === 'motion' ? 1 : 0, bm = b.kind === 'motion' ? 1 : 0;
  if (am !== bm) return am - bm;
  if (a.weight !== b.weight) return b.weight - a.weight;
  const ga = GROUP[a.kind] ?? 1, gb = GROUP[b.kind] ?? 1;
  if (ga !== gb) return ga - gb;
  const qa = Math.round(a.miss * 10), qb = Math.round(b.miss * 10);
  if (qa !== qb) return qb - qa;
  return a.order - b.order;
}

/**
 * 글자 하나 판정
 * @param {object} letter
 * @param {object|null} features extractFeatures 결과 (null 이면 손 없음)
 * @param {{strictness?: string, motionState?: {done:boolean, progress:number, hint:string}|null}} [opts]
 * @returns Evaluation { letterId, pass, shapePass, score, checks, worst, fingerStatus, palmStatus, strictness, noHand }
 */
export function evaluate(letter, features, { strictness = 'normal', motionState = null } = {}) {
  const fingerStatus = { thumb: 'na', index: 'na', middle: 'na', ring: 'na', pinky: 'na' };
  const base = { letterId: letter.id, strictness, fingerStatus, palmStatus: 'na' };
  if (!features) {
    return { ...base, pass: false, shapePass: false, score: 0, checks: [], worst: null, noHand: true };
  }
  const tol = getTolerance(strictness);
  const checks = (letter.checks || []).map((c) => evaluateCheck(c, features, tol));
  const shapePass = checks.every((c) => c.ok);

  if (letter.motion) {
    const ms = motionState;
    const done = !!(ms && ms.done);
    const progress = ms && Number.isFinite(ms.progress) ? clamp(ms.progress, 0, 1) : 0;
    checks.push({
      id: 'motion', kind: 'motion', label: letter.motion.desc || '움직임',
      msg: (ms && ms.hint) || letter.motion.desc || '손을 움직여 주세요',
      weight: 1, finger: null, fingers: [], ok: done, value: r2(progress), target: 1,
      valueText: `${Math.round(progress * 100)}%`, targetText: letter.motion.desc || '',
      margin: done ? 0.5 : progress - 1, miss: done ? 0 : 1 - progress, fit: done ? 1 : 0.5 * progress,
    });
  }

  let palmStatus = 'na';
  for (const c of checks) {
    for (const f of c.fingers) {
      if (!c.ok) fingerStatus[f] = 'bad';
      else if (fingerStatus[f] === 'na') fingerStatus[f] = 'ok';
    }
    if (c.kind === 'palm' || c.kind === 'hand') {
      if (!c.ok) palmStatus = 'bad';
      else if (palmStatus === 'na') palmStatus = 'ok';
    }
  }
  const wsum = checks.reduce((s, c) => s + c.weight, 0);
  const score = wsum > 0 ? checks.reduce((s, c) => s + c.weight * c.fit, 0) / wsum : 0;
  const order = new Map(checks.map((c, i) => [c, i]));
  const failing = checks
    .filter((c) => !c.ok)
    .sort((a, b) => worstOrder({ ...a, order: order.get(a) }, { ...b, order: order.get(b) }));
  return {
    ...base,
    palmStatus,
    pass: checks.length > 0 && failing.length === 0,
    shapePass,
    score,
    checks,
    worst: failing[0] || null,
    noHand: false,
  };
}

/**
 * 여러 글자 중 지금 손 모양에 맞는 글자 고르기 (열린 집합: 아무것도 아닐 수 있음)
 * @param {object|null} features
 * @param {object[]} letters
 * @param {{strictness?: string, margin?: number, motionFor?: (letter) => object|null}} [opts]
 *   margin: 통과한 글자가 여럿이면 1등이 2등보다 점수가 이만큼 앞서야 함
 * @returns {{ best: Evaluation|null, ranking: Evaluation[], ambiguous: boolean }}
 */
export function classify(features, letters, { strictness = 'normal', margin = 0.06, motionFor = null } = {}) {
  const ranking = letters
    .map((l) => evaluate(l, features, { strictness, motionState: motionFor && l.motion ? motionFor(l) : null }))
    .sort((a, b) => (a.pass !== b.pass ? (a.pass ? -1 : 1) : b.score - a.score));
  let passing = ranking.filter((e) => e.pass);
  // 같은 손 모양에 움직임까지 맞은 글자(ㄲ, ㅘ …)가 있으면 그 글자가 먼저 (ㄱ, ㅏ 보다 구체적)
  const withMotion = passing.filter((e) => e.checks.some((c) => c.kind === 'motion'));
  if (withMotion.length) passing = withMotion;
  let best = null, ambiguous = false;
  if (passing.length === 1) best = passing[0];
  else if (passing.length > 1) {
    if (passing[0].score - passing[1].score >= margin) best = passing[0];
    else ambiguous = true;
  }
  return { best, ranking, ambiguous };
}

/**
 * 판정 결과 하나를 문장으로: "검지 끝이 위쪽을 향해야 해요 — 지금은 앞쪽(화면 쪽)"
 * (글자에 적힌 msg 가 첫째 안내이고, 이 문장은 "지금 어떤지"를 덧붙일 때 씀)
 */
export function explainCheck(r) {
  if (!r) return '';
  if (r.ok) return `${r.label || ''} ✓`.trim();
  const fk = (f) => FINGER_KO[f] || f;
  switch (r.kind) {
    case 'state':
      return `${fk(r.finger)}: ${r.targetText} — 지금은 ${r.valueText}`;
    case 'dir':
      return `${josa(`${fk(r.finger)} 끝`, '이/가')} ${josa(r.targetText, '을/를')} 향해야 해요 — 지금은 ${r.valueText}`;
    case 'palm':
      return `${josa('손바닥', '이/가')} ${josa(r.targetText, '을/를')} 봐야 해요 — 지금은 ${r.valueText}`;
    case 'hand':
      return `${josa('손', '이/가')} ${josa(r.targetText, '을/를')} 향해야 해요 — 지금은 ${r.valueText}`;
    case 'thumb':
      return `엄지: ${r.targetText} — 지금은 ${r.valueText}`;
    case 'touch': {
      const [a, b] = r.fingers.length === 2 ? r.fingers : [r.fingers[0], r.fingers[0]];
      return `${josa(fk(a), '와/과')} ${fk(b)} 끝을 맞대 주세요 — 지금은 떨어져 있어요`;
    }
    case 'apart': {
      const [a, b] = r.fingers;
      return `${josa(fk(a), '와/과')} ${josa(fk(b), '을/를')} 떼어 주세요 — 지금은 붙어 있어요`;
    }
    case 'together': {
      const [a, b] = r.fingers;
      return `${josa(fk(a), '와/과')} ${josa(fk(b), '을/를')} 나란히 붙여 주세요 — 지금은 ${r.valueText}`;
    }
    case 'spread': {
      const [a, b] = r.fingers;
      return `${josa(fk(a), '와/과')} ${fk(b)} 사이 각도: ${r.targetText} — 지금은 ${r.valueText}`;
    }
    case 'angle':
      return `${fk(r.finger)} ${JOINT_KO[r.target && r.target.joint] || ''} 각도: ${r.targetText} — 지금은 ${r.valueText}`;
    case 'motion':
      return r.msg;
    default:
      return r.msg || r.label || '';
  }
}

// ───────── 글자 데이터 검사 (내용을 쓰는 사람을 위한 도우미) ─────────
const LETTER_KINDS = ['consonant', 'double', 'vowel', 'compound', 'number', 'demo'];
const CONFIDENCE = ['high', 'medium', 'low'];
const MOTION_TYPES = ['move', 'shake', 'twist', 'sequence'];

function validDir(d) {
  return arr(d).every((x) => dirVector(x) !== null);
}

function validPoint(name) {
  if (name === 'palm' || name === 'wrist') return true;
  const [f, part = 'tip'] = String(name).split('.');
  if (!FINGERS.includes(f)) return false;
  return (f === 'thumb' ? POINT_PARTS.thumb : POINT_PARTS.other).includes(part);
}

/** 확인 항목 하나의 문제점 목록 (문제없으면 빈 배열) */
export function validateCheck(c) {
  const errs = [];
  if (!c || typeof c !== 'object') return ['확인 항목이 객체가 아니에요'];
  const where = `check ${c.id ?? '(id 없음)'}`;
  if (!c.id) errs.push(`${where}: id 가 필요해요`);
  if (!c.label) errs.push(`${where}: label 이 필요해요`);
  if (!c.msg) errs.push(`${where}: msg 가 필요해요`);
  if (c.weight !== undefined && !(Number.isFinite(c.weight) && c.weight > 0)) errs.push(`${where}: weight 는 0보다 큰 수`);
  const present = PREDICATE_KEYS.filter((k) => c[k] !== undefined && c[k] !== null);
  if (present.length !== 1) errs.push(`${where}: 판정 조건은 꼭 하나 (지금: ${present.join(', ') || '없음'})`);
  const kind = checkKind(c);
  if (!kind) {
    errs.push(`${where}: 판정 종류를 알 수 없어요`);
    return errs;
  }
  if (['state', 'dir', 'angle'].includes(kind) && !FINGERS.includes(c.finger)) errs.push(`${where}: finger 이름이 틀렸어요 (${c.finger})`);
  if (kind === 'state' && !arr(c.state).every((s) => STATE_NAMES.includes(s))) errs.push(`${where}: state 이름이 틀렸어요`);
  if (kind === 'dir' && !validDir(c.dir)) errs.push(`${where}: dir 이름이 틀렸어요`);
  if ((kind === 'palm' || kind === 'hand') && !validDir(c[kind])) errs.push(`${where}: ${kind} 방향 이름이 틀렸어요`);
  if (kind === 'angle') {
    const joints = c.finger === 'thumb' ? JOINTS.thumb : JOINTS.other;
    if (!c.angle || !joints.includes(c.angle.joint)) errs.push(`${where}: angle.joint 는 ${joints.join('/')} 중 하나`);
    if (c.angle && c.angle.min === undefined && c.angle.max === undefined) errs.push(`${where}: angle 에 min 또는 max 가 필요해요`);
  }
  if (kind === 'thumb' && !arr(c.thumb).every((t) => THUMB_POSITIONS.includes(t))) errs.push(`${where}: thumb 위치 이름이 틀렸어요`);
  if (['touch', 'apart'].includes(kind)) {
    if (!Array.isArray(c[kind]) || c[kind].length !== 2 || !c[kind].every(validPoint)) errs.push(`${where}: ${kind} 는 [손가락, 손가락] (예: ['thumb', 'index.pip'])`);
  }
  if (kind === 'together') {
    if (!Array.isArray(c.together) || c.together.length !== 2 || !c.together.every((f) => FINGERS.includes(f))) errs.push(`${where}: together 는 [손가락, 손가락]`);
  }
  if (kind === 'spread') {
    const s = c.spread;
    if (!FINGERS.includes(s.a) || !FINGERS.includes(s.b)) errs.push(`${where}: spread.a / spread.b 는 손가락 이름`);
    if (s.min === undefined && s.max === undefined) errs.push(`${where}: spread 에 min 또는 max 가 필요해요`);
  }
  if (kind === 'custom' && !predicates.has(c.custom)) errs.push(`${where}: 등록되지 않은 custom 판정 (${c.custom})`);
  return errs;
}

/** 글자 데이터 전체 검사 → 문제점 목록 (문제없으면 빈 배열) */
export function validateLetter(letter) {
  const errs = [];
  if (!letter || typeof letter !== 'object') return ['글자가 객체가 아니에요'];
  const where = `letter ${letter.id ?? '(id 없음)'}`;
  for (const k of ['id', 'name', 'kind']) if (!letter[k]) errs.push(`${where}: ${k} 가 필요해요`);
  if (!letter.unit && letter.kind !== 'demo') errs.push(`${where}: unit 이 필요해요`);
  if (letter.kind && !LETTER_KINDS.includes(letter.kind)) errs.push(`${where}: kind 는 ${LETTER_KINDS.join('/')} 중 하나`);
  if (letter.confidence && !CONFIDENCE.includes(letter.confidence)) errs.push(`${where}: confidence 는 high/medium/low`);
  if (!Array.isArray(letter.checks) || !letter.checks.length) errs.push(`${where}: checks 가 비었어요`);
  else {
    const ids = new Set();
    for (const c of letter.checks) {
      errs.push(...validateCheck(c).map((e) => `${where} ${e}`));
      if (c && c.id) {
        if (ids.has(c.id)) errs.push(`${where}: check id 가 겹쳐요 (${c.id})`);
        ids.add(c.id);
      }
    }
  }
  if (letter.motion) {
    const m = letter.motion;
    if (!MOTION_TYPES.includes(m.type)) errs.push(`${where}: motion.type 은 move/shake/twist`);
    if (m.type !== 'twist' && m.type !== 'sequence' && m.dir && !validDir(m.dir)) errs.push(`${where}: motion.dir 이름이 틀렸어요`);
    if (m.type === 'move' && !m.dir) errs.push(`${where}: move 움직임에는 dir 이 필요해요`);
    if (m.type === 'sequence') {
      if (!Array.isArray(m.from) || !m.from.length) errs.push(`${where}: sequence 움직임에는 from(처음 모양 확인 항목)이 필요해요`);
      else for (const c of m.from) errs.push(...validateCheck(c).map((e) => `${where} motion.from ${e}`));
    }
  }
  if (!letter.pose || typeof letter.pose !== 'object') errs.push(`${where}: pose (그림 · 시험용 자세)가 필요해요`);
  for (const k of ['tips', 'sources', 'confusables']) {
    if (letter[k] !== undefined && !Array.isArray(letter[k])) errs.push(`${where}: ${k} 는 배열`);
  }
  return errs;
}

// ───────── 기본으로 들어 있는 직접 판정 ─────────
/**
 * 'halfBent': 손가락을 "반쯤" 굽힘 (ㅍ 처럼 펴지도 주먹 쥐지도 않은 상태)
 * check: { custom: 'halfBent', finger: 'index', min?: 0.18, max?: 0.8 } — curl(0 곧게 ~ 1 꼭 쥠) 범위
 */
registerPredicate('halfBent', (f, c, tol) => {
  const j = f.fingers[c.finger];
  if (!j) return { ok: false, miss: 1 };
  const widen = (tol.stateDeg || 0) / 250;
  const lo = (c.min ?? 0.18) - widen, hi = (c.max ?? 0.8) + widen;
  const margin = Math.min(j.curl - lo, hi - j.curl);
  return {
    ok: margin >= 0, margin: margin * 4, value: r2(j.curl), target: { min: lo, max: hi },
    valueText: j.curl < lo ? '너무 펴짐' : j.curl > hi ? '너무 많이 굽힘' : '반쯤 굽힘', targetText: '반쯤 굽히기',
  };
});
