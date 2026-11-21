// 배우기: 한 번에 한 글자씩
// 왼쪽: 큰 글자 · 이름 · 참고 손 그림(거울 보기) · 설명과 요령
// 오른쪽: 거울 카메라 + 손가락마다 색 + 고칠 점 하나 + 체크리스트
// 맞는 모양을 잠깐 버티면 축하 → 글자 이름을 읽어 주고 → 잠시 뒤 다음 글자로
import { h, icon, clear, setText } from '../ui/dom.js';
import { glyph, callout } from '../ui/components.js';
import { createRefHand } from '../ui/ref-hand.js';
import { createTrainer } from '../ui/trainer.js';
import { units, lettersOfUnit, getLetter, getUnit, neighbor, nextUnitFirst, isDemo, nameOf, speakOf, glyphOf } from '../core/content.js';
import { DEMO_NOTICE } from '../engine/letters.js';

const ADVANCE_MS = 1700;

let app = null;
let root = null;
let trainer = null;
let ref = null;
let letter = null;
let advanceTimer = 0;
let els = {};

function pickStart(params) {
  if (params.letter && getLetter(params.letter)) return getLetter(params.letter);
  if (params.unit && lettersOfUnit(params.unit).length) return lettersOfUnit(params.unit)[0];
  const last = app.progress.last;
  if (last && last.letter && getLetter(last.letter)) return getLetter(last.letter);
  const u = units()[0];
  return u ? lettersOfUnit(u.id)[0] : null;
}

function build() {
  els.unitName = h('span.learn-unit-name');
  els.count = h('span.learn-count.num');
  els.dots = h('div.learn-dots', { 'aria-hidden': 'true' });
  els.glyphHost = h('div.learn-glyph');
  els.name = h('h1.learn-name');
  els.desc = h('p.learn-desc');
  els.badges = h('div.row.learn-badges');
  els.demo = h('div.learn-demo');
  ref = createRefHand(null, { tag: '거울에 비친 내 손' });
  els.tips = h('ul.learn-tips');
  els.prev = h('button.tile-btn', { type: 'button', onclick: () => go(-1), 'aria-label': '이전 글자 (←)' }, icon('left'), h('span', '이전'), h('kbd', '←'));
  const hintBtn = h('button.tile-btn', { type: 'button', onclick: hint, 'aria-label': '이름 듣기 (H)' }, icon('volume'), h('span', '듣기'), h('kbd', 'H'));
  const restartBtn = h('button.tile-btn', { type: 'button', onclick: restart, 'aria-label': '다시 하기 (R)' }, icon('refresh'), h('span', '다시'), h('kbd', 'R'));
  els.next = h('button.tile-btn.primary', { type: 'button', onclick: () => go(1), 'aria-label': '다음 글자 (→ 또는 Space)' }, icon('right'), h('span', '다음'), h('kbd', '→'));

  const left = h(
    'aside.learn-left',
    h(
      'div.card.learn-card',
      h('div.learn-unit', h('span.badge.primary', icon('learn'), els.unitName), els.count),
      els.dots,
      h('div.learn-hero', els.glyphHost, h('div.learn-hero-text', els.name, els.desc, els.badges)),
      els.demo,
    ),
    h('div.card.learn-ref', ref.el, els.tips),
    h('div.tile-row.learn-controls', els.prev, hintBtn, restartBtn, els.next),
  );

  trainer = createTrainer(app, { onSuccess });
  const right = h('div.learn-right', trainer.el);
  root.append(h('div.work.learn', left, right));
}

function renderLetter() {
  if (!letter) {
    clear(root).append(
      h('div.page', h('div.empty', icon('learn'), h('strong', '아직 배울 글자가 없어요'), h('p', '글자 자료가 들어오면 여기에서 배울 수 있어요.'))),
    );
    return;
  }
  const unit = getUnit(letter.unit);
  const list = lettersOfUnit(letter.unit);
  const i = list.findIndex((l) => l.id === letter.id);
  setText(els.unitName, unit ? unit.name : '');
  setText(els.count, `${i + 1} / ${list.length}`);
  clear(els.dots).append(
    ...list.map((l, k) => {
      const st = app.progress.stat(l.id);
      const cls = k === i ? 'now' : st.success > 0 ? 'done' : '';
      return h(`span.learn-dot${cls ? `.${cls}` : ''}`, { title: nameOf(l) });
    }),
  );
  clear(els.glyphHost).append(glyph(letter, { size: 112 }));
  setText(els.name, nameOf(letter));
  setText(els.desc, letter.desc || '');
  clear(els.badges);
  const st = app.progress.stat(letter.id);
  if (letter.motion) els.badges.append(h('span.badge.hint', icon('move'), letter.motion.desc || '움직임이 있어요'));
  if (st.mastered) els.badges.append(h('span.badge.ok', icon('star'), '다 익혔어요'));
  else if (st.success > 0) els.badges.append(h('span.badge.ok', icon('check'), `${st.success}번 맞혔어요`));
  if (letter.confidence && letter.confidence !== 'high') els.badges.append(h('span.badge.outline', { title: '자료마다 조금씩 다를 수 있어요' }, '자료 확인 중'));
  clear(els.demo);
  if (isDemo(letter)) els.demo.append(callout(DEMO_NOTICE, { tone: 'warm', ic: 'info' }));
  ref.setPose(letter.pose || null, app.settings.get('dominant'));
  clear(els.tips).append(...(letter.tips || []).slice(0, 2).map((t) => h('li', icon('bulb'), h('span', t))));
  ref.el.setAttribute('aria-label', `참고 손 모양 그림. ${letter.viewNote || '거울에 비친 내 손처럼 그렸어요.'}`);
  ref.el.title = letter.viewNote || '';
  els.prev.disabled = !neighbor(letter, -1);
  trainer.setLetter(letter);
  app.progress.setLast({ unit: letter.unit, letter: letter.id });
  app.announce(`${nameOf(letter)}. ${letter.desc || ''}`);
}

function setLetter(l) {
  clearTimeout(advanceTimer);
  letter = l;
  renderLetter();
}

function go(d) {
  if (!letter) return;
  const n = neighbor(letter, d) || (d > 0 ? nextUnitFirst(letter.unit) : null);
  if (n) setLetter(n);
  else if (d > 0) finishUnit();
}

function finishUnit() {
  trainer.pause(true);
  const unit = getUnit(letter.unit);
  trainer.setCoach('ok', `${unit ? unit.name : '단원'}을 모두 마쳤어요!`, '처음 화면에서 다른 단원을 고르거나 연습에서 복습해 보세요.', 'trophy');
}

function hint() {
  if (!letter) return;
  const said = app.speech.speak(`${speakOf(letter)}. ${letter.desc || ''}`, { force: false });
  if (!said) app.toast(app.settings.get('silent') ? '소리 없이 모드예요. 설명을 화면으로 보여 드려요.' : '목소리가 꺼져 있어요 (설정 또는 M 키)', { tone: 'hint' });
}

function restart() {
  clearTimeout(advanceTimer);
  if (trainer) trainer.restart();
}

function onSuccess(result, l, ms) {
  app.progress.record(l.id, { ok: true, ms, mode: 'learn' });
  app.sound.play('success');
  app.speech.speak(speakOf(l));
  const n = neighbor(l, 1);
  trainer.celebrate(`${glyphOf(l).length <= 2 && !isDemo(l) ? `${glyphOf(l)} ` : ''}${nameOf(l)}`, n ? '잘했어요! 다음 글자로 넘어가요' : '잘했어요! 이 단원의 마지막 글자예요', ADVANCE_MS);
  renderBadgesOnly();
  if (app.settings.get('autoAdvance')) {
    advanceTimer = setTimeout(() => {
      if (letter && letter.id === l.id) go(1);
    }, ADVANCE_MS);
  }
}

function renderBadgesOnly() {
  const list = lettersOfUnit(letter.unit);
  const i = list.findIndex((x) => x.id === letter.id);
  const dot = els.dots.children[i];
  if (dot) dot.classList.add('done');
}

export default {
  id: 'learn',
  title: '배우기',
  nav: '배우기',
  icon: 'learn',
  camera: true,
  fit: true,
  mount(r, a, params) {
    app = a;
    root = r;
    els = {};
    letter = pickStart(params);
    if (!letter) {
      renderLetter();
      return;
    }
    build();
    renderLetter();
  },
  unmount() {
    clearTimeout(advanceTimer);
    if (trainer) trainer.destroy();
    if (ref) ref.destroy();
    trainer = null;
    ref = null;
  },
  onFrame(frame) {
    if (trainer) trainer.frame(frame);
  },
  onKey(e) {
    if (!trainer) return false;
    if (e.key === 'ArrowRight' || e.key === ' ') {
      go(1);
      return true;
    }
    if (e.key === 'ArrowLeft') {
      go(-1);
      return true;
    }
    if (e.code === 'KeyH') {
      hint();
      return true;
    }
    if (e.code === 'KeyR') {
      restart();
      return true;
    }
    return false;
  },
  /** 점검용: 지금 글자 */
  get letter() {
    return letter;
  },
  get trainer() {
    return trainer;
  },
};
