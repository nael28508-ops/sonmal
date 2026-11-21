// 낱말 쓰기: 낱말이나 이름을 넣으면 지문자 순서(자모)로 나눠서 하나씩 확인
// 맞힌 자모는 바로 모아서 한글 글자로 보여 줌 (두벌식처럼)
import { h, icon, btn, clear, setText } from '../ui/dom.js';
import { callout } from '../ui/components.js';
import { createTrainer } from '../ui/trainer.js';
import { decomposeForSpelling, createComposer, jamoName } from '../engine/hangul.js';
import { letterForJamo, speakOf } from '../core/content.js';
import { WORD_LISTS } from '../data/words.js';

let app, root, trainer;
let els = {};
let word = '';
let seq = []; // decomposeForSpelling 결과
let pos = 0;
let composer = null;
let listId = WORD_LISTS[0].id;
let startedAt = 0;
let doneTimer = 0;

function setWord(w) {
  clearTimeout(doneTimer);
  word = String(w || '').trim().slice(0, 12);
  els.input.value = word;
  seq = word ? decomposeForSpelling(word, { keepSpaces: true }) : [];
  pos = 0;
  composer = createComposer();
  startedAt = performance.now();
  skipSpaces();
  render();
  goCurrent();
}

function skipSpaces() {
  while (seq[pos] && seq[pos].role === 'space') {
    composer.push(' ');
    pos++;
  }
}

function currentItem() {
  return seq[pos] || null;
}

function goCurrent() {
  const it = currentItem();
  if (!it) {
    trainer.setLetter(null);
    trainer.pause(true);
    if (!word) trainer.setCoach('na', '위에서 낱말을 골라 주세요', '이름이나 낱말을 직접 써도 돼요.', 'words');
    return;
  }
  const l = letterForJamo(it.jamo);
  if (l) {
    trainer.setLetter(l);
  } else {
    trainer.setLetter(null);
    trainer.pause(true);
    trainer.setCoach('hint', `‘${it.jamo}’(${jamoName(it.jamo)}) 지문자는 아직 준비 중이에요`, 'Space 키나 “건너뛰기”를 누르면 다음 자모로 넘어가요.', 'info');
  }
}

function accept(viaSkip = false) {
  const it = currentItem();
  if (!it) return;
  composer.push(it.jamo);
  pos++;
  skipSpaces();
  render();
  if (!currentItem()) {
    const ms = performance.now() - startedAt;
    app.sound.play('success');
    app.speech.speak(word);
    trainer.celebrate(word, `${(ms / 1000).toFixed(0)}초 만에 다 썼어요`, 2200);
    trainer.setLetter(null);
    trainer.pause(true);
    trainer.setCoach('ok', `“${word}” 다 썼어요!`, '다른 낱말을 골라 보세요.', 'trophy');
    return;
  }
  if (!viaSkip) app.sound.play('tick');
  goCurrent();
}

function onSuccess(r, l, ms) {
  app.progress.record(l.id, { ok: true, ms, mode: 'words' });
  app.speech.speak(speakOf(l));
  doneTimer = setTimeout(() => accept(), 350);
}

function render() {
  // 자모 순서
  const items = seq.map((it, i) => {
    if (it.role === 'space') return h('span.words-space', { 'aria-hidden': 'true' });
    const state = i < pos ? 'done' : i === pos ? 'now' : 'todo';
    const has = !!letterForJamo(it.jamo);
    return h(
      `span.words-jamo.${state}${has ? '' : '.missing'}`,
      { title: `${jamoName(it.jamo)}${has ? '' : ' (준비 중)'}` },
      h('span.words-jamo-char', it.jamo),
      h('span.words-jamo-name', jamoName(it.jamo)),
    );
  });
  clear(els.seq).append(...(items.length ? items : [h('span.muted', '낱말을 고르면 손으로 할 자모 순서가 여기에 나와요.')]));
  const text = composer ? composer.text : '';
  setText(els.composed, text || ' ');
  els.composed.classList.toggle('empty', !text);
  setText(els.target, word ? `목표: ${word}` : '');
  const missing = seq.filter((it) => it.role !== 'space' && !letterForJamo(it.jamo)).length;
  els.missing.hidden = !missing;
  const it = currentItem();
  const real = seq.filter((x) => x.role !== 'space');
  const done = seq.slice(0, pos).filter((x) => x.role !== 'space').length;
  setText(els.now, it ? `지금: ${it.jamo} (${jamoName(it.jamo)}) · ${done + 1} / ${real.length}` : word ? '다 썼어요' : '');
}

function renderLists() {
  const list = WORD_LISTS.find((l) => l.id === listId) || WORD_LISTS[0];
  clear(els.tabs).append(
    ...WORD_LISTS.map((l) =>
      h('button.chip', { type: 'button', 'aria-pressed': String(l.id === listId), onclick: () => { listId = l.id; renderLists(); } }, l.name),
    ),
  );
  clear(els.words).append(
    ...list.words.map((w) => h('button.chip.words-word', { type: 'button', 'aria-pressed': String(w === word), onclick: () => { setWord(w); renderLists(); } }, w)),
  );
  els.words.title = list.desc;
}

export default {
  id: 'words',
  title: '낱말 쓰기',
  nav: '낱말 쓰기',
  icon: 'words',
  camera: true,
  fit: true,
  mount(r, a, params) {
    app = a;
    root = r;
    els = {};
    els.input = h('input.input.big.words-input', {
      type: 'text',
      placeholder: '이름이나 낱말을 써 보세요',
      maxLength: 12,
      'aria-label': '연습할 낱말',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          setWord(els.input.value);
          renderLists();
          els.input.blur();
        }
      },
    });
    els.tabs = h('div.row.words-tabs', { role: 'group', 'aria-label': '낱말 묶음' });
    els.words = h('div.row.words-list');
    els.seq = h('div.words-seq', { 'aria-label': '자모 순서' });
    els.composed = h('div.words-composed', { 'aria-live': 'polite' });
    els.target = h('div.muted.words-target');
    els.now = h('div.words-now');
    els.missing = callout('아직 지문자 자료가 없는 자모는 흐리게 보여요. 건너뛰기로 넘어갈 수 있어요.', { tone: 'plain', ic: 'info' });
    const left = h(
      'aside.words-left',
      h('div.card.tight.words-pick', h('div.row.words-input-row', els.input, btn('시작', { icon: 'play', kind: 'primary', onclick: () => { setWord(els.input.value); renderLists(); } })), els.tabs, els.words),
      h('div.card.words-board', h('div.row.between', h('div.words-label', '손으로 쓴 글자'), els.target), els.composed, els.seq, els.now),
      els.missing,
      h(
        'div.tile-row',
        h('button.tile-btn', { type: 'button', onclick: () => { if (composer && pos > 0) { setWord(word); } }, 'aria-label': '처음부터 (R)' }, icon('refresh'), h('span', '처음부터'), h('kbd', 'R')),
        h('button.tile-btn', { type: 'button', onclick: () => app.speech.speak(word), 'aria-label': '낱말 듣기 (H)' }, icon('volume'), h('span', '듣기'), h('kbd', 'H')),
        h('button.tile-btn.primary', { type: 'button', onclick: () => accept(true), 'aria-label': '이 자모 건너뛰기 (Space)' }, icon('skip'), h('span', '건너뛰기'), h('kbd', 'Space')),
      ),
    );
    trainer = createTrainer(app, { onSuccess, tag: '' });
    root.append(h('div.work.words', left, h('div.words-right', trainer.el)));
    renderLists();
    setWord(params.word || '');
  },
  unmount() {
    clearTimeout(doneTimer);
    if (trainer) trainer.destroy();
    trainer = null;
  },
  onFrame(f) {
    if (trainer) trainer.frame(f);
  },
  onKey(e) {
    if (!trainer) return false;
    if (e.key === ' ' || e.key === 'ArrowRight') {
      accept(true);
      return true;
    }
    if (e.code === 'KeyR') {
      setWord(word);
      return true;
    }
    if (e.code === 'KeyH') {
      app.speech.speak(word);
      return true;
    }
    return false;
  },
  get letter() {
    return trainer ? trainer.letter : null;
  },
  get trainer() {
    return trainer;
  },
  // 점검용
  setWord: (w) => setWord(w),
  get composed() {
    return composer ? composer.text : '';
  },
};
