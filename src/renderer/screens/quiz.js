// 퀴즈
// - 그림 보고 맞히기: 참고 손 그림을 보고 어떤 글자인지 넷 중에서 고르기 (1~4 키)
// - 손으로 답하기: 글자를 보여 주면 제한 시간 안에 손으로 하기 (카메라)
import { h, icon, btn, clear, setText } from '../ui/dom.js';
import { glyph, segmented, stat } from '../ui/components.js';
import { createRefHand } from '../ui/ref-hand.js';
import { createTrainer } from '../ui/trainer.js';
import { allLetters, realLetters, nameOf, glyphOf, speakOf } from '../core/content.js';

const COUNT = 8;
const SIGN_LIMIT_MS = 10000;

let app, root;
let mode = 'picture';
let els = {};
let ref = null;
let trainer = null;
let questions = [];
let qi = 0;
let score = 0;
let answered = false;
let timerId = 0;
let nextTimer = 0;
let qStart = 0;
let holdingCamera = false;

const pool = () => (realLetters().length >= 4 ? realLetters() : allLetters());

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function makeQuestions() {
  const p = pool();
  const out = [];
  let bag = [];
  for (let i = 0; i < COUNT; i++) {
    if (!bag.length) bag = shuffle(p);
    const answer = bag.pop();
    // 헷갈리기 쉬운 글자(confusables)를 먼저 보기로
    const conf = (answer.confusables || []).map((id) => p.find((l) => l.id === id)).filter(Boolean);
    const others = shuffle(p.filter((l) => l.id !== answer.id && !conf.includes(l)));
    const choices = shuffle([answer, ...conf.slice(0, 2), ...others].slice(0, Math.min(4, p.length)));
    out.push({ answer, choices });
  }
  return out;
}

function teardownMode() {
  clearInterval(timerId);
  clearTimeout(nextTimer);
  if (trainer) trainer.destroy();
  if (ref) ref.destroy();
  trainer = null;
  ref = null;
  if (holdingCamera) {
    app.vision.release();
    holdingCamera = false;
  }
}

function startMode() {
  teardownMode();
  questions = makeQuestions();
  qi = 0;
  score = 0;
  clear(els.body);
  if (mode === 'picture') buildPicture();
  else buildSign();
  showQuestion();
}

function header() {
  els.progress = h('span.num');
  els.score = h('span.num');
  return h('div.quiz-meta', h('span.badge.primary', icon('quiz'), els.progress), h('span.badge.ok', icon('star'), els.score));
}

function updateMeta() {
  setText(els.progress, `${Math.min(qi + 1, questions.length)} / ${questions.length}`);
  setText(els.score, `${score}점`);
}

// ───────── 그림 보고 맞히기 ─────────
function buildPicture() {
  ref = createRefHand(null, { tag: '거울에 비친 내 손', label: '어떤 글자일까요? 손 모양 그림' });
  els.choices = h('div.quiz-choices', { role: 'group', 'aria-label': '보기' });
  els.feedback = h('div.quiz-feedback', { role: 'status', 'aria-live': 'polite' });
  els.body.append(
    h(
      'div.quiz-picture',
      h('div.card.quiz-figure', header(), h('h2.quiz-q', '이 손 모양은 어떤 글자일까요?'), ref.el),
      h('div.quiz-side', els.choices, els.feedback),
    ),
  );
}

function showPicture(q) {
  answered = false;
  ref.setPose(q.answer.pose || null, app.settings.get('dominant'));
  setText(els.feedback, '');
  els.feedback.dataset.tone = '';
  clear(els.choices).append(
    ...q.choices.map((l, i) =>
      h(
        'button.quiz-choice',
        { type: 'button', dataset: { id: l.id }, onclick: () => choose(l), 'aria-label': `${i + 1}번 ${nameOf(l)}` },
        h('kbd', String(i + 1)),
        h('span.quiz-choice-glyph', glyphOf(l)),
        h('span.quiz-choice-name', nameOf(l)),
      ),
    ),
  );
}

function choose(l) {
  if (answered || mode !== 'picture') return;
  answered = true;
  const q = questions[qi];
  const ok = l.id === q.answer.id;
  if (ok) score++;
  app.progress.record(q.answer.id, { ok, mode: 'quiz' });
  for (const b of els.choices.children) {
    const id = b.dataset.id;
    if (id === q.answer.id) b.classList.add('right');
    else if (id === l.id) b.classList.add('wrong');
    b.disabled = true;
    if (id === q.answer.id) b.prepend(h('span.quiz-mark', icon('check')));
    else if (id === l.id) b.prepend(h('span.quiz-mark', icon('x')));
  }
  els.feedback.dataset.tone = ok ? 'ok' : 'bad';
  setText(els.feedback, ok ? `정답이에요! ${nameOf(q.answer)}` : `아쉬워요. 정답은 “${nameOf(q.answer)}”예요.`);
  app.sound.play(ok ? 'success' : 'fail');
  if (ok) app.speech.speak(speakOf(q.answer));
  updateMeta();
  nextTimer = setTimeout(nextQuestion, ok ? 1100 : 1900);
}

// ───────── 손으로 답하기 ─────────
function buildSign() {
  els.signGlyph = h('div.quiz-sign-glyph');
  els.signName = h('div.quiz-sign-name');
  els.timeBar = h('span');
  els.timeText = h('span.num');
  trainer = createTrainer(app, { onSuccess: onSignSuccess, showChecklist: false, compact: true });
  els.body.append(
    h(
      'div.quiz-sign',
      h(
        'aside.card.quiz-sign-left',
        header(),
        h('h2.quiz-q', '이 글자를 손으로 해 보세요'),
        els.signGlyph,
        els.signName,
        h('div.quiz-time', icon('clock'), h('div.bar.hint', els.timeBar), els.timeText),
        h('div.tile-row', h('button.tile-btn.primary', { type: 'button', onclick: () => signTimeout(true), 'aria-label': '건너뛰기 (Space)' }, icon('skip'), h('span', '건너뛰기'), h('kbd', 'Space'))),
      ),
      h('div.quiz-sign-right', trainer.el),
    ),
  );
  holdingCamera = true; // 이 방식에서만 카메라를 씀
  app.vision.acquire();
  timerId = setInterval(tickSign, 100);
}

function showSign(q) {
  answered = false;
  clear(els.signGlyph).append(glyph(q.answer, { size: 120 }));
  setText(els.signName, nameOf(q.answer));
  qStart = performance.now();
  trainer.setLetter(q.answer);
}

function tickSign() {
  if (answered || !questions[qi]) return;
  const left = Math.max(0, SIGN_LIMIT_MS - (performance.now() - qStart));
  els.timeBar.style.width = `${(left / SIGN_LIMIT_MS) * 100}%`;
  setText(els.timeText, `${Math.ceil(left / 1000)}초`);
  if (left <= 0) signTimeout(false);
}

function onSignSuccess(r, l, ms) {
  if (answered) return;
  answered = true;
  score++;
  app.progress.record(l.id, { ok: true, ms, mode: 'quiz' });
  app.sound.play('success');
  app.speech.speak(speakOf(l));
  trainer.celebrate(nameOf(l), `${(ms / 1000).toFixed(1)}초`, 1000);
  updateMeta();
  nextTimer = setTimeout(nextQuestion, 1100);
}

function signTimeout(skipped) {
  if (answered) return;
  answered = true;
  const q = questions[qi];
  app.progress.record(q.answer.id, { ok: false, mode: 'quiz' });
  app.sound.play('fail');
  trainer.pause(true);
  trainer.setCoach('hint', skipped ? '다음 문제로 넘어가요' : '시간이 다 됐어요', `“${nameOf(q.answer)}”는 연습에서 다시 해 봐요.`, 'clock');
  nextTimer = setTimeout(nextQuestion, 1200);
}

// ───────── 공통 ─────────
function showQuestion() {
  updateMeta();
  const q = questions[qi];
  if (!q) return finish();
  if (mode === 'picture') showPicture(q);
  else showSign(q);
}

function nextQuestion() {
  qi++;
  if (qi >= questions.length) finish();
  else showQuestion();
}

function finish() {
  const total = questions.length;
  teardownMode();
  const great = score >= total * 0.8;
  clear(els.body).append(
    h(
      'div.card.quiz-result',
      h('div.practice-done-icon', icon(great ? 'trophy' : 'star')),
      h('h2', great ? '아주 잘했어요!' : '수고했어요!'),
      h('div.quiz-result-stats', stat({ icon: 'check', label: '맞힌 문제', value: score, unit: `/ ${total}` })),
      h('p.muted', great ? '다른 퀴즈도 도전해 보세요.' : '틀린 글자는 연습의 “약한 글자”에서 다시 만날 수 있어요.'),
      h('div.row', btn('다시 하기', { icon: 'refresh', kind: 'primary', size: 'lg', onclick: startMode }), btn('연습하러 가기', { icon: 'practice', kind: 'ghost', size: 'lg', onclick: () => app.navigate('practice', { mode: 'weak' }) })),
    ),
  );
  app.refreshBadges();
}

export default {
  id: 'quiz',
  title: '퀴즈',
  nav: '퀴즈',
  icon: 'quiz',
  fit: true,
  mount(r, a, params) {
    app = a;
    root = r;
    els = {};
    if (params.mode === 'sign' || params.mode === 'picture') mode = params.mode;
    els.body = h('div.quiz-body');
    root.append(
      h(
        'div.work.quiz',
        h(
          'div.page-head.quiz-head',
          h('div', h('h1', '퀴즈'), h('p.lead', '배운 글자를 얼마나 기억하는지 확인해 봐요.')),
          (els.seg = segmented({
            label: '퀴즈 종류',
            options: [
              ['picture', '그림 보고 맞히기'],
              ['sign', '손으로 답하기'],
            ],
            value: mode,
            onchange: (v) => {
              mode = v;
              startMode();
            },
          })),
        ),
        els.body,
      ),
    );
    startMode();
  },
  unmount() {
    teardownMode();
  },
  onFrame(f) {
    if (trainer) trainer.frame(f);
  },
  onKey(e) {
    if (mode === 'picture' && /^[1-4]$/.test(e.key)) {
      const q = questions[qi];
      const l = q && q.choices[Number(e.key) - 1];
      if (l) choose(l);
      return true;
    }
    if (mode === 'sign' && (e.key === ' ' || e.key === 'ArrowRight')) {
      signTimeout(true);
      return true;
    }
    if (e.code === 'KeyR') {
      startMode();
      return true;
    }
    return false;
  },
  get mode() {
    return mode;
  },
  get letter() {
    return questions[qi] ? questions[qi].answer : null;
  },
  get trainer() {
    return trainer;
  },
  choose: (l) => choose(l),
  setMode(m) {
    if (els.seg) els.seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(['picture', 'sign'][i] === m)));
    mode = m;
    startMode();
  },
};
