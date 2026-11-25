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
      // 축하 표시는 잠깐만 보이므로 처음부터 지켜봄 (스크린샷 찍는 사이에 지나가도 놓치지 않게)
      let celebrated = false;
      const mo = new MutationObserver(() => { if (root.querySelector('.celebrate')) celebrated = true; });
      mo.observe(root, { childList: true, subtree: true });
      if (scr.letter) vision.playSyntheticLetter(scr.letter);
      await waitFor(() => scr.trainer && scr.trainer.last && scr.trainer.last.features, 4000);
      await sleep(300);
      await shot('05-practice');
      const ok = await waitFor(() => celebrated || root.querySelector('.celebrate'), 8000);
      mo.disconnect();
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

    // 번역: 지문자 → 글, 등록 단어 알아보기, 글 → 수어, 단어 등록 녹화
    if (want('translate')) {
      await open('translate', {}, 400);
      const scr = app.currentScreen;
      await waitFor(() => vision.tracker && vision.state().active, 4000);
      const tr = vision.tracker;
      const { createSyntheticTracker } = await import('../core/synthetic-tracker.js');
      const { frameFeature } = await import('../engine/signwords.js');
      const byJamo = (j) => allLetters().find((l) => l.jamo === j);
      // A-1) 지문자 ㄱ → ㅏ = 가
      tr.setScript([{ pose: byJamo('ㄱ').pose, ms: 1500 }, { pose: byJamo('ㅏ').pose, ms: 1500, blend: 300 }], { loop: false });
      const spelled = await waitFor(() => scr.text.includes('가'), 8000);
      check('translate composes fingerspelled jamo into Hangul', spelled, scr.text);
      // A-2) 가짜 손으로 만든 녹화 3개로 단어 등록 → 같은 동작을 하면 알아봄
      const flat = PRESETS.flat;
      const wordScript = (k = 1) => [
        { pose: flat, ms: 300 },
        { pose: flat, ms: 0, blend: 500 * k, dx: 1.8 },
        { pose: flat, ms: 0, blend: 450 * k, dx: 1.8, dy: -1.6 },
        { pose: flat, ms: 300, dx: 1.8, dy: -1.6 },
      ];
      const samplesOf = (seed, center) => {
        const st = createSyntheticTracker({ script: wordScript(), loop: false, noise: 0.01, seed, center });
        const out = [];
        for (let t = 0; t <= st.duration; t += 33) out.push({ t, f: frameFeature(st.frameAt(t).hands, { aspect: 1280 / 720, keepLandmarks: true }) });
        return out;
      };
      const n = scr.registerSamples('감사합니다', [samplesOf(1, [0.5, 0.55]), samplesOf(2, [0.46, 0.5]), samplesOf(3, [0.54, 0.6])], 1280 / 720);
      check('translate registers a synthetic sign word', n === 3, n);
      // 숨김 창이 바쁠 때 프레임이 빠질 수 있어 최대 3번까지 다시 보여 줌
      let got = false;
      for (let attempt = 0; attempt < 3 && !got; attempt++) {
        tr.setScript([{ pose: null, ms: 400 }, ...wordScript(1.1), { pose: null, ms: 1500 }], { loop: false });
        got = await waitFor(() => scr.lastCommitted === '감사합니다', 5000);
      }
      check('translate recognizes the registered sign word', got, scr.text);
      check('sentence has word chip + spelled text', document.querySelector('.tr-chip') && scr.text === '가 감사합니다', scr.text);
      // 말하기 (목소리는 기록만)
      document.querySelector('.tr-tiles .tile-btn.primary').click();
      check('speak button sends the sentence to speech (stub)', app.speech.log.some((x) => x.text === '가 감사합니다'));
      vision.setSyntheticPose(byJamo('ㅎ').pose);
      await sleep(450);
      await shot('19-translate-sign');

      // B) 글 → 수어
      scr.setTab('text');
      scr.showText('감사합니다 병원에 가요');
      await sleep(300);
      const p = scr.player;
      check('text→sign plans registered word + fingerspelling', p.steps[0] && p.steps[0].kind === 'word' && p.steps.filter((s) => s.kind === 'letter').length === 12, JSON.stringify(p.steps.map((s) => s.jamo || s.text || s.kind)));
      const painted = () => {
        const c = scr.canvas;
        if (!c || !c.width) return false;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let k = 0;
        for (let i = 3; i < d.length; i += 64) if (d[i] > 0) k++;
        return k > 100;
      };
      check('text→sign draws the recorded word', await waitFor(painted, 3000));
      const li = p.steps.findIndex((s) => s.kind === 'letter');
      scr.setPlaying(false);
      scr.seekStep(li + 3);
      await sleep(400);
      check('text→sign draws a fingerspelling hand', painted() && document.querySelector('.tr-sylls .now'));
      await shot('20-translate-text');

      // C) 단어 등록: 진짜 녹화 흐름 (카운트다운 → 녹화 3번)
      scr.setTab('register');
      tr.setScript(wordScript(), { loop: true });
      scr.startRecording('안녕하세요');
      await sleep(4300);
      await shot('21-translate-register');
      const recorded = await waitFor(() => !scr.recording, 20000);
      const w = scr.words.find((x) => x.text === '안녕하세요');
      check('register flow records the sign 3 times', recorded && w && w.recordings === 3, JSON.stringify(scr.words));
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

    // 카메라 배경 (가상 배경): 설정 화면 + 카메라 판에서 모든 배경을 합성해 봄
    if (want('settings') && app.background) {
      const bg = app.background;
      await open('settings', { focus: 'background' }, 400);
      const group = document.querySelector('#setting-background');
      check('background settings group is shown', group && group.querySelectorAll('.segmented [role="radio"]').length === 5);
      const pickMode = (text) => [...group.querySelectorAll('.segmented [role="radio"]')].find((b) => b.textContent === text);
      pickMode('단색').click();
      await sleep(100);
      check('color mode shows swatches + custom picker', app.settings.get('bg') === 'color' && group.querySelectorAll('.bg-swatch').length === 6 && group.querySelector('input[type="color"]'));
      group.querySelectorAll('.bg-swatch')[1].click();
      check('choosing a swatch saves the color', app.settings.get('bgColor') === '#1f3354', app.settings.get('bgColor'));
      // 내 사진: 코드로 만든 그림을 파일로 넘겨 저장해 봄 (2000×1500 → 1280×720 안으로)
      const pc = document.createElement('canvas');
      pc.width = 2000;
      pc.height = 1500;
      const g = pc.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 2000, 1500);
      grd.addColorStop(0, '#20476b');
      grd.addColorStop(1, '#6b8fb0');
      g.fillStyle = grd;
      g.fillRect(0, 0, 2000, 1500);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.font = '700 220px sans-serif';
      g.fillText('내 사진 →', 200, 800); // 글자가 거꾸로 나오지 않는지 눈으로 확인
      const blob = await new Promise((r) => pc.toBlob(r, 'image/png'));
      const size = await bg.savePhoto(new File([blob], 'test.png', { type: 'image/png' }));
      const img = new Image();
      img.src = bg.photoUrl();
      await img.decode();
      check('photo is resized to fit 1280x720 and stored', bg.hasPhoto() && img.naturalWidth <= 1280 && img.naturalHeight <= 720 && size <= 1800000, `${img.naturalWidth}x${img.naturalHeight}, ${size} chars`);
      pickMode('그림').click();
      await sleep(150);
      check('scene mode shows generated scene tiles', group.querySelectorAll('canvas.bg-scene-thumb').length === 6);
      group.querySelectorAll('.bg-swatch')[2].click();
      await sleep(150);
      group.scrollIntoView({ block: 'start' });
      await shot('22-background-settings');

      // 카메라 판: 가짜 사람 영상으로 배경마다 합성
      await open('learn', { letter: first.id }, 300);
      vision.setSyntheticPose(first.pose);
      const t0 = performance.now();
      const ready = await waitFor(() => bg.status === 'error' || bg.stats().frameCount > 3, 60000);
      const st0 = bg.stats();
      check('background segmenter loads and composites', ready && st0.status === 'ready', `${JSON.stringify(st0)} in ${Math.round(performance.now() - t0)} ms`);
      const cv = document.querySelector('.camera-stage canvas.camera-bg');
      check('composite canvas is visible over the video', cv && !cv.hidden && cv.width > 0);
      check('segmenter finds the test person', st0.personShare > 0.03, st0.personShare);
      check('segmentation is throttled when slow (not every frame)', st0.segEvery >= 33, `every ${st0.segEvery} ms, ${st0.segCost} ms each`);
      // 거울 확인: 원본 x≈0.6 에 있는 얼굴이 화면 x≈0.4 에 피부색으로 보여야 함
      app.settings.set({ bg: 'color', bgColor: '#1f3354' });
      await sleep(400);
      const px = (fx, fy) => Array.from(cv.getContext('2d').getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data);
      const L = px(0.4, 0.42);
      const R = px(0.6, 0.42);
      const skinish = (c) => c[0] > 150 && c[0] > c[2] + 30;
      check('person is mirrored like the video (face on the left)', skinish(L) && !skinish(R), `left=${L} right=${R}`);
      for (const m of ['blur', 'color', 'scene', 'photo']) {
        app.settings.set('bg', m);
        const f0 = bg.stats().frameCount;
        const ok = await waitFor(() => bg.stats().frameCount > f0 + 3, 4000);
        check(`background mode ${m} renders`, ok && !cv.hidden, JSON.stringify(bg.stats()));
      }
      // 빠른 고르기 메뉴
      const pickBtn = document.querySelector('.camera-bg-btn');
      pickBtn.click();
      await sleep(100);
      const items = [...document.querySelectorAll('.camera-bg-menu [role="menuitemradio"]')];
      items.find((b) => b.textContent.includes('그림')).click();
      await sleep(200);
      check('camera quick picker switches the background', app.settings.get('bg') === 'scene' && document.querySelector('.camera-bg-menu').hidden);
      app.settings.set('bgScene', 'mint');
      await sleep(600);
      await shot('23-background-camera');
      app.settings.set('bg', 'none');
      await sleep(200);
      check('original mode hides the composite', cv.hidden);
      bg.clearPhoto();
      vision.clearSyntheticPose();
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
