// 판정기: 손 인식 한 프레임 → 고른 손 → 다듬기 → 손 특징 → 글자 판정 → 버티기 · 움직임
// 배우기 · 연습 · 낱말 · 퀴즈 화면이 모두 이 하나를 씀
import { extractFeatures, pickHand, qualityMessage } from '../engine/features.js';
import { evaluate } from '../engine/rules.js';
import { createHold, createLandmarkSmoother } from '../engine/filters.js';
import { createMotionTracker } from '../engine/motion.js';
import { diag } from './diag.js';
import { templates } from './templates.js';

/**
 * @param {{ getSettings: () => object, holdMs?: number }} o
 * @returns {{ update(frame, letter), reset(), readonly last }}
 */
export function createJudge({ getSettings, holdMs = 600 } = {}) {
  const smoother = createLandmarkSmoother({ minCutoff: 1.2, beta: 12 });
  const hold = createHold({ ms: holdMs, ratio: 0.8 });
  const motion = createMotionTracker();
  let letterId = null;
  let succeeded = false;
  let last = null;
  // 움직임 글자: 손을 옮기는 동안 손목이 살짝 돌아가 모양이 잠깐 흐트러져도 되도록
  // "최근에 모양을 제대로 만들어 버텼는지"를 시간과 함께 기억함
  let shapeOkAt = -Infinity; // 마지막으로 모양이 맞았던 때
  let heldAt = -Infinity; // 마지막으로 모양을 충분히 버텼던 때 (hold 30% 이상)

  function reset() {
    shapeOkAt = -Infinity;
    heldAt = -Infinity;
    smoother.reset();
    hold.reset();
    motion.reset();
    succeeded = false;
    last = null;
  }

  /**
   * @param {object} frame HandFrame
   * @param {object|null} letter
   * @returns {{ hand, features, evaluation, quality: string, hold: {held, progress}, motion, success: boolean, justSucceeded: boolean }}
   */
  function update(frame, letter) {
    if (!letter) return null;
    if (letter.id !== letterId) {
      letterId = letter.id;
      reset();
    }
    const s = getSettings();
    const aspect = frame.videoW && frame.videoH ? frame.videoW / frame.videoH : 16 / 9;
    const dominant = s.dominant === 'left' ? 'left' : 'right';
    const raw = pickHand(frame.hands, { dominant, aspect });
    const hand = raw ? smoother.smooth(raw, frame.t) : null;
    if (!raw) smoother.reset();
    const features = hand ? extractFeatures(hand, { aspect, dominant }) : null;
    if (features) motion.push(features, frame.t);
    const motionState = letter.motion ? motion.check(letter.motion) : null;
    let evaluation = evaluate(letter, features, { strictness: s.strictness, motionState });
    // 선생님 손 본이 있으면: 규칙 판정이 조금 달라도 선생님 손과 같으면 통과
    const teacher = templates.judge(features, letter.id, s.strictness);
    if (teacher && teacher.ok && !evaluation.shapePass && evaluation.score >= 0.5) {
      const checks = evaluation.checks.map((c) => (c.kind === 'motion' ? c : { ...c, ok: true }));
      const fingerStatus = Object.fromEntries(Object.entries(evaluation.fingerStatus).map(([k, v]) => [k, v === 'na' ? 'na' : 'ok']));
      const motionOk = !letter.motion || (motionState && motionState.done);
      evaluation = { ...evaluation, checks, fingerStatus, shapePass: true, pass: !!motionOk, worst: motionOk ? null : checks.find((c) => c.kind === 'motion') || null, teacher };
    } else if (teacher) evaluation = { ...evaluation, teacher };
    const quality = features && features.quality && !features.quality.ok ? qualityMessage(features) : features ? '' : qualityMessage(null);
    // 움직임이 있는 글자는 모양(shapePass)을 버티는 동안 움직임까지 해야 성공
    const shapeOk = letter.motion ? evaluation.shapePass : evaluation.pass;
    const h = hold.push(!!shapeOk, frame.t);
    let justSucceeded = false;
    const motionDone = !letter.motion || (motionState && motionState.done);
    if (shapeOk) shapeOkAt = frame.t;
    if (shapeOk && h.progress >= 0.3) heldAt = frame.t;
    const within = (letter.motion && letter.motion.within) || 1500;
    // 실제 손 실험(2026-11-25): 옮기는 끝에서 손목이 돌아가 모양이 깨져서 ㄲ 이 안 됐음
    // → 움직임을 마쳤을 때 모양이 0.5초 안에 맞았고, 움직임 시작 무렵에 모양을 버텼으면 성공
    const ok = letter.motion
      ? motionDone && frame.t - shapeOkAt <= 500 && frame.t - heldAt <= within + 500
      : h.held;
    if (ok && !succeeded) {
      succeeded = true;
      justSucceeded = true;
    }
    last = { hand, features, evaluation, quality, hold: h, motion: motionState, success: succeeded, justSucceeded, aspect };
    if (diag.on) diag.push(letter, frame, last);
    return last;
  }

  return {
    update,
    reset,
    get last() {
      return last;
    },
  };
}
