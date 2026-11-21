// 자동 점검 (electron . --selftest)
// - 진짜 카메라 대신 가짜 손(synthetic-tracker)을 쓰고, 목소리는 기록만 함 (소리 없음)
// - 모든 화면을 차례로 열어 화면 사진을 찍고, 배우기 화면은 가짜 손으로 글자를 맞혀 성공까지 가 봄
// - 결과는 sonmalHost.done(result) 로 보냄 (메인이 SELFTEST_RESULT 한 줄을 출력)
import { units, lettersOfUnit, allLetters } from '../core/content.js';
import { PRESETS } from '../engine/handmodel.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function waitFor(fn, ms = 8000, step = 50) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    try {
      const v = fn();
      if (v) return v;
    } catch {
      /* 아직 */
    }
    await sleep(step);
  }
  return null;
}

export async function run(app, { screens }) {
  const host = app.host;
  const log = (m) => host && host.log(m);
  const checks = [];
  const shots = [];
  const errors = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => {
    errors.push(String(e.reason && e.reason.stack ? e.reason.stack : e.reason));
    console.error('unhandled rejection', e.reason);
  });

  const only = host && host.args && Array.isArray(host.args.screens) && host.args.screens.length ? host.args.screens : null;
  const want = (id) => !only || only.includes(id);

  async function shot(name) {
    document.querySelectorAll('.toast').forEach((t) => t.remove()); // 지난 화면의 알림이 사진을 가리지 않게
    await nextPaint();
    await sleep(120);
    try {
      const file = await host.screenshot(name);
      shots.push(file);
    } catch (err) {
      check(`screenshot ${name}`, false, err && err.message);
    }
  }

  async function open(id, params = {}, settle = 500) {
    app.navigate(id, params);
    await waitFor(() => app.current === id && document.querySelector(`[data-screen="${id}"]`), 4000);
    await sleep(settle);
    const root = document.querySelector(`[data-screen="${id}"]`);
    check(`mount ${id}`, root && root.childElementCount > 0, root ? '' : 'no root');
    return root;
  }

  const first = units()[0] ? lettersOfUnit(units()[0].id)[0] : allLetters()[0];
  const second = first ? lettersOfUnit(first.unit)[1] : null;
  const vision = app.vision;

  try {
    // 처음 화면 (기록 없음)
    if (want('home')) {
      await open('home');
      await shot('01-home-empty');
    }

    // 배우기: 틀린 손 → 빨강 + 고칠 점, 맞는 손 → 성공
    if (want('learn') && first) {
      app.settings.set('autoAdvance', false);
      await open('learn', { letter: first.id }, 300);
      await waitFor(() => vision.tracker && vision.state().active, 4000);
      const learn = app.currentScreen;
      // 다른 글자의 손 모양을 먼저 보여 줌
      const wrong = allLetters().find((l) => l.id !== first.id && l.pose) || null;
      vision.setSyntheticPose(wrong ? wrong.pose : PRESETS.fist);
      const gotWrong = await waitFor(() => learn.trainer && learn.trainer.last && learn.trainer.last.features && !learn.trainer.last.evaluation.pass && learn.trainer.last, 4000);
      await sleep(600);
      check('learn shows a failing check for a wrong pose', gotWrong && document.querySelector('.coach[data-tone="bad"], .coach[data-tone="hint"]'), gotWrong ? gotWrong.evaluation.worst && gotWrong.evaluation.worst.msg : 'no frame');
      await shot('02-learn-wrong');

      vision.playSyntheticLetter(first);
      const t0 = performance.now();
      const success = await waitFor(() => learn.trainer && learn.trainer.last && learn.trainer.last.success, 12000);
      check('learn reaches success with the letter pose', success, success ? `${Math.round(performance.now() - t0)} ms` : learn.trainer && learn.trainer.last ? JSON.stringify(learn.trainer.last.evaluation.checks.filter((c) => !c.ok).map((c) => c.id)) : 'no result');
      await sleep(250);
      await shot('03-learn-success');
      const said = app.speech.log.map((x) => x.text);
      check('speech stub recorded the letter name (no real speech)', said.some((t) => t.includes(first.name)), said.join(' / '));
      check('progress recorded the success', app.progress.stat(first.id).success >= 1);

      // 다음 글자로 (→ 키)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      await sleep(400);
      check('arrow key moves to the next letter', !second || (learn.letter && learn.letter.id === second.id), learn.letter && learn.letter.id);
      if (second) {
        vision.playSyntheticLetter(second);
        await waitFor(() => learn.trainer.last && learn.trainer.last.hold && learn.trainer.last.hold.progress > 0.3 && !learn.trainer.last.success, 5000, 20);
        await shot('04-learn-holding');
        await waitFor(() => learn.trainer.last && learn.trainer.last.success, 8000);
      }
      app.settings.set('autoAdvance', true);
    }

    // 연습: 지금 글자 손 모양을 보여 줌
    if (want('practice')) {
      const root = await open('practice', { mode: 'mix' }, 300);
      const scr = app.currentScreen;
      if (scr.letter) vision.playSyntheticLetter(scr.letter);
      await waitFor(() => scr.trainer && scr.trainer.last && scr.trainer.last.features, 4000);
      await sleep(300);
      await shot('05-practice');
      const ok = await waitFor(() => root.querySelector('.celebrate'), 8000);
      check('practice drill succeeds with the shown letter', ok);
    }

    // 낱말 쓰기
    if (want('words')) {
      await open('words', { word: '엄마' }, 400);
      const scr = app.currentScreen;
      check('words decomposes into jamo', document.querySelectorAll('.words-jamo').length === 5, document.querySelectorAll('.words-jamo').length);
      for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      await sleep(200);
      check('words composes skipped jamo into Hangul', scr.composed === '엄마', scr.composed);
      scr.setWord('사랑해');
      await sleep(300);
      await shot('06-words');
    }

    // 손으로 쓰기
    if (want('write')) {
      await open('write', {}, 300);
      const scr = app.currentScreen;
      const l = first;
      vision.setSyntheticPose(l.pose);
      const wrote = await waitFor(() => scr.text.length > 0, 6000);
      check('free write recognizes a letter and appends it', wrote, scr.text);
      await sleep(300);
      await shot('07-write');
    }

    // 퀴즈: 그림 보고 맞히기 → 손으로 답하기
    if (want('quiz')) {
      await open('quiz', { mode: 'picture' }, 600);
      await shot('08-quiz-picture');
      const scr = app.currentScreen;
      const ans = scr.letter;
      if (ans) scr.choose(ans);
      await sleep(250);
      check('quiz marks the right answer', document.querySelector('.quiz-choice.right'));
      await shot('09-quiz-answered');
      scr.setMode('sign');
      await sleep(300);
      if (scr.letter) vision.setSyntheticPose(scr.letter.pose);
      await waitFor(() => scr.trainer && scr.trainer.last && scr.trainer.last.features, 4000);
      await sleep(300);
      await shot('10-quiz-sign');
      scr.setMode('picture');
    }

    // 선생님 손: 녹화까지
    if (want('teacher')) {
      await open('teacher', {}, 400);
      const scr = app.currentScreen;
      if (scr.selected) vision.setSyntheticPose(scr.selected.pose);
      scr.startRecording();
      await sleep(4500);
      await shot('11-teacher-recording');
      const done = await waitFor(() => !scr.recording, 5000);
      await sleep(200);
      check('teacher recording stores templates', done && document.querySelector('.teacher-tile.has'));
    }

    vision.clearSyntheticPose();

    if (want('progress')) {
      await open('progress', {}, 300);
      await shot('12-progress');
    }
    if (want('settings')) {
      await open('settings', {}, 300);
      await shot('13-settings');
    }
    if (want('help')) {
      await open('help', {}, 300);
      await shot('14-help');
    }
    if (want('home')) {
      await open('home', {}, 300);
      await shot('15-home');
      // 어두운 테마 · 고대비
      app.settings.set('theme', 'dark');
      await sleep(200);
      await shot('16-home-dark');
      if (first) {
        await open('learn', { letter: first.id }, 300);
        vision.setSyntheticPose(PRESETS.fist);
        await sleep(800);
        await shot('17-learn-dark');
        vision.clearSyntheticPose();
      }
      app.settings.set({ theme: 'system', contrast: 'high', textSize: 'large' });
      await open('home', {}, 300);
      await shot('18-home-contrast-large');
      app.settings.reset();
    }

    for (const id of screens) if (!want(id)) log(`skip ${id}`);
    check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  } catch (err) {
    check('selftest ran to the end', false, err && err.stack ? err.stack : err);
  }

  const ok = checks.every((c) => c.ok);
  host.done({ ok, checks, shots, speech: app.speech.log.length, sounds: app.sound.log.length });
}
