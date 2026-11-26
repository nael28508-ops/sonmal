// 단어 수어 배우기: 갈래 · 찾기 → 단어 하나 (시연 그림 + 사전 설명 원문 + 사전 링크) → 카메라로 따라 하기 (모양 / 위치 / 움직임 확인)
// - 지문자(손가락 글자)와 다른 갈래: 뜻마다 정해진 동작을 배움
// - 얼굴 찾기(FaceDetector)는 이 화면에서만 불러옴. 점검(selftest) 중에는 카메라 대신 시연 대본을 판정기에 넣음
import { h, icon, clear, setText } from '../ui/dom.js';
import { coach } from '../ui/components.js';
import { createCameraView } from '../ui/camera-view.js';
import { WORDS, WORD_CATEGORIES } from '../engine/words-data.js';
import { createWordJudge, wordKeyframes, keyframeAt, handPoseAt, syntheticWordFrame, wordDuration, fromBody, compileWord, MOVE_KO } from '../engine/wordsign.js';
import { LOCS } from '../engine/word-shapes.js';
import { createFaceFinder } from '../core/face.js';
import { handRenderReady, fitCanvas } from '../ui/hand-draw.js';
import { drawReferenceHand } from '../ui/hand-render.js';

let app, root, els = {}, word = null, cat = 'all', query = '', judge = null, cam = null, co = null, face = null;
let raf = 0, t0 = 0, synthT0 = 0, keys = [], doneIds = new Set();

const TIER_KO = { judged: '모양 · 위치 · 움직임 판정', follow: '보고 따라 하기' };
const STORE = 'sonmal.words.done';

function loadDone() {
  try { doneIds = new Set(JSON.parse(localStorage.getItem(STORE) || '[]')); } catch { doneIds = new Set(); }
}
function saveDone() {
  try { localStorage.setItem(STORE, JSON.stringify([...doneIds])); } catch { /* 저장 못 해도 계속 */ }
}

function filtered() {
  const q = query.trim();
  return WORDS.filter((w) => (cat === 'all' || w.cat === cat) && (!q || w.label.includes(q) || (w.headwords || '').includes(q)));
}

function renderList() {
  const list = filtered();
  clear(els.list).append(
    ...list.map((w) => h(`button.wl-item${word && word.id === w.id ? '.now' : ''}`, { type: 'button', onclick: () => setWord(w), 'aria-current': word && word.id === w.id ? 'true' : null },
      h('span.wl-item-name', w.label),
      doneIds.has(w.id) ? h('span.wl-done', { title: '해 봤어요' }, icon('check')) : null,
      h(`span.wl-tier.${w.tier}`, w.tier === 'judged' ? '판정' : '따라'))),
  );
  if (!list.length) els.list.append(h('p.card-sub', '찾는 단어가 없어요.'));
  setText(els.count, `${list.length}개`);
}

function renderCats() {
  const all = [{ id: 'all', name: '전체' }, ...WORD_CATEGORIES];
  clear(els.cats).append(...all.map((c) => {
    const n = c.id === 'all' ? WORDS.length : WORDS.filter((w) => w.cat === c.id).length;
    const d = c.id === 'all' ? doneIds.size : WORDS.filter((w) => w.cat === c.id && doneIds.has(w.id)).length;
    return h(`button.wl-cat${cat === c.id ? '.now' : ''}`, { type: 'button', onclick: () => { cat = c.id; renderCats(); renderList(); }, 'aria-pressed': String(cat === c.id) }, h('span', c.name), h('span.wl-cat-n', `${d}/${n}`));
  }));
}

function setWord(w) {
  word = w;
  keys = wordKeyframes(w);
  t0 = performance.now();
  synthT0 = performance.now();
  if (judge) judge.reset();
  const c = compileWord(w);
  setText(els.name, w.label);
  clear(els.badges).append(
    h(`span.badge.${w.tier === 'judged' ? 'ok' : 'hint'}`, icon(w.tier === 'judged' ? 'check' : 'eye'), TIER_KO[w.tier]),
    h('span.badge.outline', (WORD_CATEGORIES.find((x) => x.id === w.cat) || {}).name || ''),
    h('span.badge.outline', c.hands === 2 ? '두 손' : '한 손'),
  );
  clear(els.official).append(...w.official.map((t) => h('p.wl-official-text', `“${t}”`)));
  setText(els.headwords, `사전 표제어: ${w.headwords}`);
  clear(els.notes);
  if (w.spec.nm) els.notes.append(h('li', icon('heart'), h('span', `표정: ${w.spec.nm} — 표정은 판정하지 않아요.`)));
  else els.notes.append(h('li', icon('info'), h('span', '수어는 손과 함께 표정도 중요해요. 표정은 판정하지 않아요.')));
  if (w.spec.note) els.notes.append(h('li', icon('info'), h('span', w.spec.note)));
  if (w.tier === 'follow') els.notes.append(h('li', icon('eye'), h('span', c.segments.length > 1 ? '여러 동작으로 된 단어예요. 앱은 첫 동작의 손 모양과 위치만 너그럽게 봐요.' : '움직임은 판정하지 않아요. 그림과 사전 영상을 보고 따라 해 보세요.')));
  co.set('na', '그림처럼 해 보세요', `${c.segments.map((s) => MOVE_KO[s.mv.type]).join(' → ')}`, 'hand');
  renderChecks(null);
  renderList();
  app.announce(`${w.label}. ${w.official[0]}`);
}

function renderChecks(r) {
  const c = word && compileWord(word);
  const rows = r ? r.checks : [];
  clear(els.checks).append(...rows.map((k) => {
    const st = k.ok === true ? 'ok' : k.ok === false ? 'bad' : 'na';
    return h('li', h('div.check', { dataset: { state: st } }, h('span.check-icon', st === 'ok' ? icon('check') : st === 'bad' ? icon('x') : h('span', '·')), h('span', k.label)));
  }));
  if (!rows.length && c) els.checks.append(h('li', h('div.check', { dataset: { state: 'na' } }, h('span.check-icon', '·'), h('span', '모양 → 위치 → 움직임 차례로 봐요'))));
}

// ───────── 시연 그림: 몸 · 얼굴 윤곽 + 손 (거울처럼) ─────────
function drawDemo() {
  raf = requestAnimationFrame(drawDemo);
  if (!word || !els.demo.isConnected) return;
  const { ctx, width: W, height: H } = fitCanvas(els.demo);
  const dur = keys.length ? keys[keys.length - 1].t + 600 : 1;
  const reduce = app.selftest || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = reduce ? Math.min(900, dur) : (performance.now() - t0) % dur;
  const fh = H * 0.2; // 얼굴 높이
  const fx = W / 2, fy = H * 0.2;
  const P = (b) => ({ x: fx + b.x * fh, y: fy - b.y * fh }); // 거울: 오른손이 화면 오른쪽
  const dark = document.documentElement.matches('[data-theme="dark"]') || (!document.documentElement.matches('[data-theme="light"]') && matchMedia('(prefers-color-scheme: dark)').matches);
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(30,60,80,0.10)';
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.28)' : 'rgba(30,60,80,0.28)';
  ctx.lineWidth = 2;
  // 몸통 · 어깨
  ctx.beginPath();
  ctx.moveTo(fx - fh * 0.3, fy + fh * 0.75);
  ctx.quadraticCurveTo(fx - fh * 1.3, fy + fh * 0.9, fx - fh * 1.35, fy + fh * 1.6);
  ctx.lineTo(fx - fh * 1.2, H);
  ctx.lineTo(fx + fh * 1.2, H);
  ctx.lineTo(fx + fh * 1.35, fy + fh * 1.6);
  ctx.quadraticCurveTo(fx + fh * 1.3, fy + fh * 0.9, fx + fh * 0.3, fy + fh * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 얼굴
  ctx.beginPath();
  ctx.ellipse(fx, fy, fh * 0.42, fh * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  for (const ex of [-0.17, 0.17]) { ctx.beginPath(); ctx.arc(fx + ex * fh, fy - 0.12 * fh, fh * 0.035, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(fx - 0.12 * fh, fy + 0.27 * fh); ctx.lineTo(fx + 0.12 * fh, fy + 0.27 * fh); ctx.stroke();
  // 처음 자리 표시
  const c = compileWord(word);
  const L0 = LOCS[c.start.R.loc];
  if (L0) {
    const q = P(L0);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = dark ? '#5fe0cf' : '#0b7a70';
    ctx.beginPath(); ctx.arc(q.x, q.y, fh * 0.22, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  const st = keyframeAt(keys, t);
  if (!st) return;
  for (const [k, side] of [['L', 'left'], ['R', 'right']]) {
    const hnd = st[k];
    if (!hnd) continue;
    const box = fh * 0.58 * 2.9 * (hnd.k || 1);
    const q = P(hnd.pos);
    try {
      drawReferenceHand(ctx, handPoseAt(hnd, 'right'), { x: q.x - box / 2, y: q.y - box / 2, width: box, height: box, side, view: { yaw: 0, pitch: 0 }, shadow: false, theme: dark ? 'dark' : 'light' });
    } catch (e) { /* 그림 실패는 넘어감 */ }
  }
}

function onFrame(frame) {
  if (!word || !judge) return;
  let fr = frame;
  if (app.selftest) {
    // 점검: 카메라 대신 단어 시연 대본 (진짜 카메라 안 씀)
    const tt = performance.now() - synthT0;
    fr = syntheticWordFrame(word, Math.min(tt, wordDuration(word) + 400), { keys });
    fr.t = tt;
  } else if (face) fr = { ...frame, face: face.face };
  const r = judge.update(fr, word);
  cam.render({ hand: r.hands[0] ? r.hands[0].hand : null, evaluation: r.hands[0] ? { fingerStatus: r.hands[0].fingerStatus } : null, hold: { progress: r.moveProgress }, success: r.success }, fr);
  co.set(r.tone === 'ok' ? 'ok' : r.tone === 'bad' ? 'bad' : r.tone === 'na' ? 'na' : 'hint', r.msg, r.face ? '' : '얼굴이 화면에 보이면 위치도 확인해요', r.success ? 'check' : 'hand');
  renderChecks(r);
  if (r.success && !doneIds.has(word.id)) {
    doneIds.add(word.id);
    saveDone();
    app.progress.record(`word:${word.id}`, { ok: true, ms: 0, mode: 'word' });
    app.sound.play('success');
    cam.celebrate(word.label, '잘했어요!', 1600);
    renderList();
    renderCats();
  }
}

export default {
  id: 'wordlearn',
  title: '단어 배우기',
  nav: '단어 배우기',
  icon: 'book',
  track: 'word',
  camera: true,
  fit: true,
  mount(r, a, params) {
    app = a;
    root = r;
    els = {};
    loadDone();
    judge = createWordJudge({ getStrictness: () => app.settings.get('strictness'), getDominant: () => app.settings.get('dominant') });
    if (!app.selftest) { face = createFaceFinder(app.vision.video); face.start(); } else face = null;
    els.cats = h('div.wl-cats', { role: 'group', 'aria-label': '갈래' });
    els.search = h('input.input.wl-search', { type: 'search', placeholder: '단어 찾기 (예: 사랑)', 'aria-label': '단어 찾기', oninput: (e) => { query = e.target.value; renderList(); } });
    els.count = h('span.card-sub');
    els.list = h('div.wl-list');
    els.name = h('h1.wl-name');
    els.badges = h('div.row.wl-badges');
    els.demo = h('canvas.wl-demo', { 'aria-hidden': 'true' });
    els.official = h('div.wl-official');
    els.headwords = h('p.card-sub');
    els.notes = h('ul.learn-tips.wl-notes');
    els.checks = h('ul.checklist.wl-checks', { 'aria-label': '모양 · 위치 · 움직임 확인' });
    const link = h('button.btn', { type: 'button', onclick: () => {
      if (!word) return;
      if (app.host && app.host.openDict) app.host.openDict(word.url);
      else window.open(word.url, '_blank', 'noopener');
    } }, icon('link'), h('span', '한국수어사전에서 영상 보기'));
    const replay = h('button.btn.ghost', { type: 'button', onclick: () => { t0 = performance.now(); synthT0 = performance.now(); if (judge) judge.reset(); } }, icon('refresh'), h('span', '다시 보기 · 다시 하기'));
    co = coach();
    cam = createCameraView(app, { showRing: true, tag: '' });
    root.append(h('div.work.wordlearn',
      h('aside.wl-left.card', h('div.track-tag.word', icon('book'), '단어 수어'), els.search, els.cats, h('div.row', h('strong', '단어'), h('span.spacer'), els.count), els.list),
      h('section.wl-mid.card', h('div.wl-head', els.name, els.badges), h('div.wl-demo-wrap', els.demo, h('span.ref-hand-tag', '거울에 비친 나')), h('div.row', replay, link),
        h('div.wl-source', h('strong', '국립국어원 한국수어사전 수형 설명'), els.official, els.headwords), els.notes),
      h('section.wl-right', cam.el, co.el, els.checks),
    ));
    renderCats();
    const first = (params.word && WORDS.find((w) => w.id === params.word)) || WORDS[0];
    setWord(first);
    handRenderReady.then(() => { cancelAnimationFrame(raf); drawDemo(); });
  },
  unmount() {
    cancelAnimationFrame(raf);
    if (cam) cam.destroy();
    if (face) face.stop();
    cam = null; judge = null; face = null;
  },
  onFrame,
  get word() { return word; },
  /** 점검용 */
  select(id) { const w = WORDS.find((x) => x.id === id || x.label === id); if (w) setWord(w); return !!w; },
  setCategory(id) { cat = id; renderCats(); renderList(); },
  get faceFinder() { return face; },
};
