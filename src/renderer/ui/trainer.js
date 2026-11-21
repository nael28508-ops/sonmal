// 손 모양 연습 판: 카메라 + 고칠 점 하나(큰 글씨) + 체크리스트
// 배우기 · 연습 · 낱말 쓰기 · 퀴즈(손으로 답하기)가 함께 씀
// - 매 프레임 판정하고, 안내 문구는 너무 자주 바뀌지 않게 잠깐 머물렀다 바꿈
// - 모양이 맞고 잠깐(약 0.6초) 버티면(움직임이 있으면 움직임까지) onSuccess
import { h } from './dom.js';
import { coach, checklist } from './components.js';
import { createCameraView } from './camera-view.js';
import { createJudge } from '../core/judge.js';

const STABLE_MS = 280; // 안내 문구가 바뀌기 전에 머무는 시간
const SPEAK_HINT_AFTER_MS = 2500; // 같은 고칠 점이 이만큼 이어지면 소리로도 (설정에서 켰을 때)
const SPEAK_HINT_EVERY_MS = 5000;

/**
 * @param {object} app
 * @param {{ onSuccess?: (result, letter) => void, showChecklist?: boolean, compact?: boolean, tag?: string }} [o]
 */
export function createTrainer(app, { onSuccess, showChecklist = true, compact = false, tag = '' } = {}) {
  const cam = createCameraView(app, { showRing: true, tag });
  const co = coach();
  const cl = checklist();
  if (!showChecklist) cl.el.hidden = true;
  const el = h(`div.trainer${compact ? '.compact' : ''}`, cam.el, co.el, cl.el);

  let letter = null;
  let paused = false;
  let shown = { key: '', since: 0 };
  let pending = { key: '', since: 0 };
  let lastSpoken = 0;
  let startedAt = performance.now();
  let lastResult = null;
  const judge = createJudge({ getSettings: () => app.settings.get() });

  function idleCoach() {
    co.set('na', '손을 카메라에 보여 주세요', '어깨 앞에서 손바닥 전체가 화면에 들어오게 해 주세요.', 'hand');
  }
  idleCoach();

  // 판정 결과 → { tone, msg, sub, icon, key }
  function describe(r) {
    const e = r.evaluation;
    if (r.success) return { tone: 'ok', msg: '잘했어요!', sub: '', icon: 'check', key: 'success' };
    if (!r.features) return { tone: 'hint', msg: '손을 카메라에 보여 주세요', sub: '손목까지 화면 안에 들어오게 해 주세요.', icon: 'hand', key: 'nohand' };
    if (r.quality) return { tone: 'hint', msg: r.quality, sub: '', icon: 'eye', key: `q:${r.quality}` };
    const total = e.checks.length;
    const okN = e.checks.filter((c) => c.ok).length;
    const sub = `${total}개 중 ${okN}개 맞았어요`;
    if (letter.motion && e.shapePass && r.motion && !r.motion.done) {
      return { tone: 'hint', msg: r.motion.hint || letter.motion.desc || '손을 움직여 주세요', sub: '모양은 좋아요! 이제 움직여 보세요.', icon: 'move', key: `m:${r.motion.hint}` };
    }
    if (e.pass || (letter.motion ? e.shapePass : false)) return { tone: 'ok', msg: '좋아요! 그대로 잠깐 멈춰 주세요', sub, icon: 'check', key: 'hold' };
    if (e.worst) return { tone: 'bad', msg: e.worst.msg || e.worst.label, sub, icon: 'x', key: `w:${e.worst.id}` };
    return { tone: 'na', msg: '손 모양을 만들어 보세요', sub, icon: 'hand', key: 'none' };
  }

  function updateCoach(r, now) {
    const d = describe(r);
    if (d.key !== pending.key) pending = { key: d.key, since: now };
    // 성공 · 손 없음은 바로, 나머지는 잠깐 이어질 때만 바꿈 (깜빡임 막기)
    const urgent = d.key === 'success' || d.key === 'hold' || shown.key === '';
    if (d.key !== shown.key && (urgent || now - pending.since >= STABLE_MS)) {
      shown = { key: d.key, since: now };
      co.set(d.tone, d.msg, d.sub, d.icon);
    } else if (d.key === shown.key) {
      co.set(d.tone, d.msg, d.sub, d.icon); // 맞은 개수(sub)는 바로 바꿈
    }
    const s = app.settings.get();
    if (s.speakHints && d.tone === 'bad' && shown.key === d.key && now - shown.since > SPEAK_HINT_AFTER_MS && now - lastSpoken > SPEAK_HINT_EVERY_MS) {
      lastSpoken = now;
      app.speech.speak(d.msg, { interrupt: false });
    }
  }

  return {
    el,
    camera: cam,
    get letter() {
      return letter;
    },
    get last() {
      return lastResult;
    },
    /** 연습할 글자 바꾸기 */
    setLetter(l) {
      letter = l;
      paused = false;
      judge.reset();
      shown = { key: '', since: 0 };
      pending = { key: '', since: 0 };
      startedAt = performance.now();
      cam.clearCelebrate();
      cl.update(null, l);
      idleCoach();
      cam.hint(l && l.motion ? l.motion.desc || '이 글자는 움직임이 있어요' : null, 'move');
    },
    /** 처음부터 다시 */
    restart() {
      this.setLetter(letter);
    },
    /** 성공 뒤 다음 글자로 갈 때까지 판정을 멈춤 */
    pause(v = true) {
      paused = v;
    },
    get elapsed() {
      return performance.now() - startedAt;
    },
    frame(frame) {
      if (!letter) {
        cam.render(null, frame);
        return null;
      }
      if (paused) {
        cam.render(lastResult && { ...lastResult, hold: { progress: 1 }, success: true }, frame);
        return lastResult;
      }
      const r = judge.update(frame, letter);
      lastResult = r;
      cam.render(r, frame);
      cl.update(r.features ? r.evaluation : null, letter);
      updateCoach(r, performance.now());
      if (r.justSucceeded) {
        paused = true;
        if (onSuccess) onSuccess(r, letter, performance.now() - startedAt);
      }
      return r;
    },
    celebrate(title, sub, ms) {
      cam.celebrate(title, sub, ms);
    },
    setCoach(tone, msg, sub, ic) {
      shown = { key: `custom:${msg}`, since: performance.now() };
      co.set(tone, msg, sub, ic);
    },
    destroy() {
      cam.destroy();
    },
  };
}
