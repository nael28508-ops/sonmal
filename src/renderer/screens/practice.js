// 연습: 글자를 보여 주면 손으로 해 보기 (시간 · 정확도 기록)
// - 복습: 간격 반복으로 때가 된 글자 / 약한 글자: 자주 틀린 글자 / 골고루: 아무 글자나
// - 맞히면 기록하고 다음, Space 는 건너뛰기(틀린 것으로 기록), 오래 걸리면 손 그림 힌트
import { h, icon, btn, clear, setText, pct } from '../ui/dom.js';
import { glyph, segmented, stat, callout } from '../ui/components.js';
import { createRefHand } from '../ui/ref-hand.js';
import { createTrainer } from '../ui/trainer.js';
import { allLetters, getLetter, nameOf, speakOf, isDemo } from '../core/content.js';

const ROUND = 10;
const HINT_AFTER_MS = 12000;
const MODES = [
  ['review', '복습'],
  ['weak', '약한 글자'],
  ['mix', '골고루'],
];

let app, root, trainer, ref;
let mode = 'review';
let queue = [];
let idx = 0;
let results = [];
let els = {};
let timerId = 0;
let nextTimer = 0;
let hintShown = false;

const ids = () => allLetters().map((l) => l.id);

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function buildQueue() {
  const p = app.progress;
  let q = [];
  if (mode === 'review') q = p.due(ids());
  else if (mode === 'weak') q = p.weakest(ids(), ROUND).map((s) => s.id);
  if (!q.length || mode === 'mix') q = shuffle(ids());
  // 짧은 목록은 섞어서 채움
  const out = [];
  while (out.length < Math.min(ROUND, Math.max(q.length, 5))) out.push(...shuffle(q));
  return out.slice(0, ROUND).filter((id, i, arr) => i === 0 || id !== arr[i - 1]);
}

function start() {
  queue = buildQueue();
  idx = 0;
  results = [];
  clear(els.summary);
  els.summary.hidden = true;
  els.play.hidden = false;
  showCurrent();
}

function current() {
  return getLetter(queue[idx]);
}

function showCurrent() {
  clearTimeout(nextTimer);
  const l = current();
  if (!l) {
    finish();
    return;
  }
  hintShown = false;
  clear(els.glyph).append(glyph(l, { size: 120 }));
  setText(els.name, nameOf(l));
  setText(els.round, `${idx + 1} / ${queue.length}`);
  els.roundBar.style.width = `${(idx / queue.length) * 100}%`;
  els.refWrap.classList.add('veiled');
  els.hintBtn.disabled = false;
  ref.setPose(l.pose || null, app.settings.get('dominant'));
  trainer.setLetter(l);
}

function revealHint() {
  if (hintShown) return;
  hintShown = true;
  els.refWrap.classList.remove('veiled');
  els.hintBtn.disabled = true;
}

function onSuccess(r, l, ms) {
  results.push({ id: l.id, ok: true, ms, hinted: hintShown });
  app.progress.record(l.id, { ok: !hintShown, ms, mode: 'practice' });
  app.sound.play('success');
  app.speech.speak(speakOf(l));
  trainer.celebrate(nameOf(l), `${(ms / 1000).toFixed(1)}초`, 1100);
  nextTimer = setTimeout(next, 1150);
}

function skip() {
  const l = current();
  if (!l) return;
  results.push({ id: l.id, ok: false, ms: trainer.elapsed, skipped: true });
  app.progress.record(l.id, { ok: false, mode: 'practice' });
  app.sound.play('fail');
  next();
}

function next() {
  idx++;
  if (idx >= queue.length) finish();
  else showCurrent();
}

function finish() {
  trainer.pause(true);
  els.roundBar.style.width = '100%';
  const ok = results.filter((r) => r.ok && !r.hinted).length;
  const times = results.filter((r) => r.ok).map((r) => r.ms);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN;
  els.play.hidden = true;
  els.summary.hidden = false;
  clear(els.summary).append(
    h('div.practice-done-icon', icon('trophy')),
    h('h2', '한 판 끝났어요!'),
    h(
      'div.grid.cols-2',
      stat({ icon: 'check', label: '바로 맞힘', value: ok, unit: `/ ${results.length}` }),
      stat({ icon: 'clock', label: '평균 시간', value: Number.isFinite(avg) ? (avg / 1000).toFixed(1) : '–', unit: '초' }),
    ),
    h('p.muted', results.length ? `정확도 ${pct(ok / results.length)}` : ''),
    h('div.row', btn('한 판 더', { icon: 'refresh', kind: 'primary', size: 'lg', onclick: start }), btn('내 기록 보기', { icon: 'progress', kind: 'ghost', size: 'lg', onclick: () => app.navigate('progress') })),
  );
  trainer.setCoach('ok', '수고했어요!', '“한 판 더”를 누르면 새 글자로 다시 해요.', 'trophy');
  app.refreshBadges();
}

export default {
  id: 'practice',
  title: '연습',
  nav: '연습',
  icon: 'practice',
  camera: true,
  fit: true,
  dueCount(a) {
    return a.progress.due(allLetters().map((l) => l.id)).length;
  },
  mount(r, a, params) {
    app = a;
    root = r;
    els = {};
    if (params.mode && MODES.some(([m]) => m === params.mode)) mode = params.mode;
    else mode = a.progress.due(ids()).length ? 'review' : 'mix';
    els.glyph = h('div.practice-glyph');
    els.name = h('div.practice-name');
    els.round = h('span.num');
    els.roundBar = h('span');
    ref = createRefHand(null, { tag: '힌트: 거울에 비친 내 손' });
    els.hintBtn = btn('손 그림 힌트', { icon: 'eye', kind: 'soft', onclick: revealHint });
    els.refWrap = h('div.practice-ref.veiled', ref.el, h('div.practice-veil', icon('eye'), h('span', '막히면 힌트를 보세요'), els.hintBtn));
    els.summary = h('div.card.practice-summary');
    els.summary.hidden = true;
    els.timer = h('span.num');
    els.play = h(
      'div.practice-play',
      h('div.card.practice-prompt', h('div.practice-prompt-label', '이 글자를 손으로 해 보세요'), h('div.practice-prompt-row', els.glyph, h('div', els.name, h('div.muted.practice-timer', icon('clock'), els.timer)))),
      els.refWrap,
      h(
        'div.tile-row',
        h('button.tile-btn', { type: 'button', onclick: () => app.speech.speak(speakOf(current())), 'aria-label': '이름 듣기 (H)' }, icon('volume'), h('span', '듣기'), h('kbd', 'H')),
        h('button.tile-btn', { type: 'button', onclick: revealHint, 'aria-label': '힌트' }, icon('eye'), h('span', '힌트')),
        h('button.tile-btn.primary', { type: 'button', onclick: skip, 'aria-label': '건너뛰기 (Space)' }, icon('skip'), h('span', '건너뛰기'), h('kbd', 'Space')),
      ),
    );
    const left = h(
      'aside.practice-left',
      h(
        'div.practice-head',
        segmented({ label: '연습 방법', options: MODES, value: mode, onchange: (v) => { mode = v; start(); } }),
        h('div.practice-round', els.round, h('div.bar', els.roundBar)),
      ),
      allLetters().every(isDemo) ? callout('지금은 연습용 손 모양으로만 연습해요.', { tone: 'plain', ic: 'info' }) : null,
      els.play,
      els.summary,
    );
    trainer = createTrainer(app, { onSuccess });
    root.append(h('div.work.practice', left, h('div.practice-right', trainer.el)));
    start();
    timerId = setInterval(() => {
      if (!trainer || els.play.hidden) return;
      const t = trainer.elapsed;
      setText(els.timer, `${(t / 1000).toFixed(0)}초`);
      if (t > HINT_AFTER_MS && !hintShown) revealHint();
    }, 250);
  },
  unmount() {
    clearInterval(timerId);
    clearTimeout(nextTimer);
    if (trainer) trainer.destroy();
    if (ref) ref.destroy();
    trainer = ref = null;
  },
  onFrame(f) {
    if (trainer) trainer.frame(f);
  },
  onKey(e) {
    if (!trainer) return false;
    if (e.key === ' ' || e.key === 'ArrowRight') {
      if (els.play.hidden) start();
      else skip();
      return true;
    }
    if (e.code === 'KeyH') {
      if (current()) app.speech.speak(speakOf(current()));
      return true;
    }
    if (e.code === 'KeyR') {
      start();
      return true;
    }
    return false;
  },
  get letter() {
    return current();
  },
  get trainer() {
    return trainer;
  },
};
