// 손으로 쓰기 (도전 · 베타): 정해진 글자 없이, 지금 손 모양이 어느 글자인지 알아맞혀서 이어 씀
// - 모든 글자를 판정해서 통과한 글자 중 1등이 2등보다 충분히 앞설 때만 (rules.classify 의 margin)
// - 같은 글자가 잠깐(0.7초) 이어지면 적고, 손을 풀거나 다른 모양이 되어야 다음 글자를 받음
import { h, icon, clear, setText, pct } from '../ui/dom.js';
import { callout, bar } from '../ui/components.js';
import { createCameraView } from '../ui/camera-view.js';
import { extractFeatures, pickHand } from '../engine/features.js';
import { classify } from '../engine/rules.js';
import { createLandmarkSmoother } from '../engine/filters.js';
import { createComposer } from '../engine/hangul.js';
import { allLetters, realLetters, nameOf, glyphOf, speakOf } from '../core/content.js';

const ACCEPT_MS = 700;
const RELEASE_MS = 350;

let app, root, cam;
let els = {};
let composer = null;
let smoother = null;
let cand = { id: null, since: 0 };
let armed = true; // 다음 글자를 받을 준비가 되었는지
let releaseSince = 0;
let lastAccepted = null;
let pool = [];

function letterChar(l) {
  return l.jamo || glyphOf(l);
}

function renderText() {
  const t = composer.text;
  setText(els.text, t || '');
  els.text.classList.toggle('empty', !t);
  els.placeholder.hidden = !!t;
}

function accept(l) {
  composer.push(letterChar(l));
  lastAccepted = l.id;
  app.sound.play('tick');
  app.speech.speak(speakOf(l), { interrupt: true });
  renderText();
  els.flash.textContent = `${glyphOf(l)} ${nameOf(l)}`;
  els.flash.classList.remove('show');
  void els.flash.offsetWidth; // 애니메이션 다시 시작
  els.flash.classList.add('show');
}

function renderRanking(ranking, best) {
  const top = ranking.slice(0, 3);
  clear(els.rank).append(
    ...top.map((e) => {
      const l = pool.find((x) => x.id === e.letterId);
      const isBest = best && best.letterId === e.letterId;
      return h(
        `li.write-cand${isBest ? '.best' : ''}`,
        h('span.write-cand-glyph', glyphOf(l)),
        h('span.write-cand-name', nameOf(l)),
        bar(e.score, e.pass ? 'ok' : ''),
        h('span.write-cand-score.num', e.pass ? `✓ ${pct(e.score)}` : pct(e.score)),
      );
    }),
  );
}

export default {
  id: 'write',
  title: '손으로 쓰기 (도전)',
  nav: '손으로 쓰기',
  icon: 'write',
  camera: true,
  fit: true,
  mount(r, a) {
    app = a;
    root = r;
    els = {};
    composer = createComposer();
    smoother = createLandmarkSmoother({ minCutoff: 1.2, beta: 12 });
    cand = { id: null, since: 0 };
    armed = true;
    pool = realLetters();
    const demoOnly = pool.length === 0;
    if (demoOnly) pool = allLetters();
    cam = createCameraView(app, { showRing: true });
    els.text = h('div.write-text', { 'aria-live': 'polite' });
    els.placeholder = h('div.write-placeholder', '손 모양을 만들면 여기에 글자가 써져요');
    els.flash = h('div.write-flash', { 'aria-hidden': 'true' });
    els.rank = h('ol.write-rank', { 'aria-label': '지금 손 모양과 가까운 글자' });
    els.state = h('div.write-state');
    const left = h(
      'aside.write-left',
      h('div.row', h('span.badge.hint', icon('sparkles'), '도전 · 베타'), h('span.muted', '아무 글자나 손으로 해 보세요')),
      h('div.card.write-board', els.placeholder, els.text, els.flash),
      demoOnly ? callout('지금은 연습용 손 모양만 알아맞혀요. 지문자 자료가 들어오면 한글을 쓸 수 있어요.', { tone: 'plain', ic: 'info' }) : null,
      h('div.card.tight.write-cands', h('div.write-cands-title', '가까운 글자'), els.rank, els.state),
      h(
        'div.tile-row',
        h('button.tile-btn', { type: 'button', onclick: () => { composer.backspace(); renderText(); }, 'aria-label': '하나 지우기 (←)' }, icon('backspace'), h('span', '지우기'), h('kbd', '←')),
        h('button.tile-btn', { type: 'button', onclick: () => { composer.reset(); renderText(); }, 'aria-label': '모두 지우기 (R)' }, icon('trash'), h('span', '모두 지우기'), h('kbd', 'R')),
        h('button.tile-btn', { type: 'button', onclick: () => { composer.push(' '); renderText(); }, 'aria-label': '띄어쓰기 (Space)' }, icon('arrowRight'), h('span', '띄어쓰기'), h('kbd', 'Space')),
        h('button.tile-btn.primary', { type: 'button', onclick: () => app.speech.speak(composer.text), 'aria-label': '읽어 주기 (H)' }, icon('volume'), h('span', '읽기'), h('kbd', 'H')),
      ),
    );
    root.append(h('div.work.write', left, h('div.write-right', cam.el)));
    renderText();
    renderRanking([], null);
    setText(els.state, '손을 보여 주세요');
  },
  unmount() {
    if (cam) cam.destroy();
    cam = null;
  },
  onFrame(frame) {
    if (!cam) return;
    const s = app.settings.get();
    const aspect = frame.videoW / frame.videoH || 16 / 9;
    const raw = pickHand(frame.hands, { dominant: s.dominant, aspect });
    const hand = raw ? smoother.smooth(raw, frame.t) : null;
    if (!raw) smoother.reset();
    const features = hand ? extractFeatures(hand, { aspect, dominant: s.dominant }) : null;
    const { best, ranking, ambiguous } = features ? classify(features, pool, { strictness: s.strictness }) : { best: null, ranking: [], ambiguous: false };
    const t = frame.t;
    // 손을 풀었거나 다른 모양이 되면 다음 글자를 받을 준비
    const bestId = best ? best.letterId : null;
    if (!armed) {
      if (bestId !== lastAccepted) {
        if (!releaseSince) releaseSince = t;
        if (t - releaseSince >= RELEASE_MS) armed = true;
      } else releaseSince = 0;
    }
    if (bestId !== cand.id) cand = { id: bestId, since: t };
    let progress = 0;
    if (armed && bestId) {
      progress = Math.min(1, (t - cand.since) / ACCEPT_MS);
      if (progress >= 1) {
        const l = pool.find((x) => x.id === bestId);
        if (l) accept(l);
        armed = false;
        releaseSince = 0;
      }
    }
    const fake = best || (ranking[0] && { ...ranking[0], fingerStatus: ranking[0].fingerStatus });
    cam.render({ hand, features, evaluation: fake || null, hold: { progress }, success: false }, frame);
    renderRanking(ranking, best);
    setText(
      els.state,
      !features ? '손을 보여 주세요' : ambiguous ? '두 글자가 비슷해요. 모양을 더 또렷하게 해 주세요' : !best ? '맞는 글자를 찾고 있어요' : !armed ? '좋아요! 다음 글자를 하려면 손 모양을 바꿔 주세요' : `“${nameOf(pool.find((x) => x.id === bestId))}” 같아요. 그대로 잠깐…`,
    );
  },
  onKey(e) {
    if (!cam) return false;
    if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      composer.backspace();
      renderText();
      return true;
    }
    if (e.key === ' ') {
      composer.push(' ');
      renderText();
      return true;
    }
    if (e.code === 'KeyR') {
      composer.reset();
      renderText();
      return true;
    }
    if (e.code === 'KeyH') {
      app.speech.speak(composer.text);
      return true;
    }
    return false;
  },
  get text() {
    return composer ? composer.text : '';
  },
};
