// 번역: 수어 ↔ 글 (솔직한 범위: 지문자 + 내가 등록한 수어 단어만)
// - 수어 → 글·음성: 카메라로 지문자(rules.classify)와 등록 단어(engine/signwords.js 의 DTW)를 알아보고 문장으로 모음
// - 글 → 수어: 등록 단어는 녹화한 손 움직임을 다시 보여 주고, 나머지는 지문자 손 그림으로 한 자모씩
// - 단어 등록: 낱말을 쓰고 2~3번 녹화 → 이 컴퓨터에 저장 (영상이 아니라 손 마디 숫자만)
import { h, icon, btn, clear, setText, pct } from '../ui/dom.js';
import { callout, segmented, ring, bar, toast, confirmDialog } from '../ui/components.js';
import { createCameraView } from '../ui/camera-view.js';
import { drawLive, drawReference, fitCanvas, handRenderReady } from '../ui/hand-draw.js';
import { extractFeatures, pickHand } from '../engine/features.js';
import { classify } from '../engine/rules.js';
import { createLandmarkSmoother } from '../engine/filters.js';
import { createComposer, decomposeForSpelling, jamoName } from '../engine/hangul.js';
import { SPELLING_LETTERS, NUMBER_LETTERS, letterForJamo } from '../engine/letters.js';
import { lerpPose } from '../engine/handmodel.js';
import { defaultHint } from '../engine/motion.js';
import { frameFeature, buildRecording, createSignSpotter, planTranslation, unpackLandmarks } from '../engine/signwords.js';
import { signs, saveSigns } from '../core/signs.js';
import { nameOf, glyphOf } from '../core/content.js';

const ACCEPT_MS = 700;
const RELEASE_MS = 350;
const COUNTDOWN_MS = 3000;
const GAP_MS = 2000;
const REPEATS = 3;
const SPEEDS = { slow: 1.5, normal: 1, fast: 0.65 };
const SUGGEST = ['안녕하세요', '감사합니다', '괜찮아요', '병원', '화장실', '도와주세요'];
const LIMIT_NOTE = '등록한 단어와 지문자만 알아들어요. 수어 문장 전체를 번역하지는 못해요.';

let app, root, cam;
let els = {};
let tab = 'sign';
let tickId = 0;
let rafId = 0;

// ───────── 수어 → 글 상태 ─────────
let parts = []; // { type: 'word'|'spell'|'space', text }
let composer = null;
let smoother = null;
let spotter = null;
let mode = 'letters'; // 'letters' | 'numbers'
let cand = { id: null, since: 0 };
let armed = true;
let releaseSince = 0;
let lastAccepted = null;
let lastCommitted = null;

// ───────── 단어 등록 상태 ─────────
let rec = null; // { phase: 'count'|'rec', t0, wait, samples, attempt, wordId, lenMs, fails }
let recLen = 2500;
let selectedWord = null;
let preview = null; // { word, t0 }

// ───────── 글 → 수어 상태 ─────────
let steps = [];
let tokens = [];
let total = 0;
let playT = 0;
let playing = false;
let repeat = false;
let speed = 'normal';
let lastNow = 0;

const settingsOf = () => app.settings.get();
const strictness = () => settingsOf().strictness || 'normal';
const dominant = () => (settingsOf().dominant === 'left' ? 'left' : 'right');
const smoothstep = (u) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};
const isDark = () =>
  document.documentElement.matches('[data-theme="dark"]') ||
  (!document.documentElement.matches('[data-theme="light"]') && window.matchMedia('(prefers-color-scheme: dark)').matches);

// ════════════════ 수어 → 글 · 음성 ════════════════
function flushSpelling() {
  if (composer && composer.text) {
    parts.push({ type: 'spell', text: composer.text });
    composer.reset();
  }
}

function sentenceText() {
  let s = '';
  const all = [...parts, ...(composer && composer.text ? [{ type: 'spell', text: composer.text }] : [])];
  all.forEach((p, i) => {
    const prev = all[i - 1];
    if (p.type === 'space') s += ' ';
    else {
      // 단어 앞뒤는 저절로 띄어 씀
      if (prev && prev.type !== 'space' && (p.type === 'word' || prev.type === 'word') && !s.endsWith(' ')) s += ' ';
      s += p.text;
    }
  });
  return s.replace(/\s+/g, ' ').trim();
}

function renderSentence() {
  const nodes = [];
  for (const p of parts) {
    if (p.type === 'word') nodes.push(h('span.tr-chip', { title: '등록한 수어 단어' }, icon('hand'), p.text));
    else if (p.type === 'space') nodes.push(h('span.tr-gap', { 'aria-hidden': 'true' }));
    else nodes.push(h('span.tr-spell', p.text));
  }
  if (composer && composer.text) nodes.push(h('span.tr-spell.now', composer.text));
  clear(els.sentence).append(...nodes);
  els.sentence.setAttribute('aria-label', sentenceText() || '아직 없음');
  els.sentPlaceholder.hidden = nodes.length > 0;
}

function addSpace() {
  flushSpelling();
  if (parts.length && parts[parts.length - 1].type !== 'space') parts.push({ type: 'space', text: ' ' });
  renderSentence();
}

function backspace() {
  if (composer.length) composer.backspace();
  else {
    const p = parts.pop();
    // 지문자 덩어리는 한 자모씩 지움
    if (p && p.type === 'spell') {
      const jamo = decomposeForSpelling(p.text, { splitFinals: false });
      jamo.pop();
      for (const j of jamo) composer.push(j.jamo);
    }
  }
  renderSentence();
}

function clearAll() {
  parts = [];
  composer.reset();
  renderSentence();
}

function speakSentence() {
  const t = sentenceText();
  if (!t) {
    toast('먼저 수어로 글을 만들어 주세요', { tone: 'hint' });
    return;
  }
  const s = settingsOf();
  if (s.silent || !s.voice) toast('소리 없는 설정이라 읽지 않았어요', { tone: 'hint' });
  app.speech.speak(t);
}

async function copySentence() {
  const t = sentenceText();
  if (!t) {
    toast('복사할 글이 없어요', { tone: 'hint' });
    return;
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(t);
    ok = true;
  } catch {
    try {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } });
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch {
      ok = false;
    }
  }
  toast(ok ? '글을 복사했어요' : '복사하지 못했어요', { tone: ok ? 'ok' : 'bad' });
}

function flash(text) {
  els.flash.textContent = text;
  els.flash.classList.remove('show');
  void els.flash.offsetWidth;
  els.flash.classList.add('show');
}

function acceptLetter(l) {
  composer.push(l.jamo || glyphOf(l));
  lastAccepted = l.id;
  app.sound.play('tick');
  renderSentence();
  flash(`${glyphOf(l)} ${nameOf(l)}`);
}

function acceptWord(w) {
  flushSpelling();
  parts.push({ type: 'word', text: w.text });
  lastCommitted = w.text;
  app.sound.play('success');
  renderSentence();
  flash(`“${w.text}”`);
  app.announce(w.text);
}

function renderCandidate(kind, text, sub, conf, progress) {
  els.candRing.set(progress, progress > 0 ? `${Math.round(progress * 100)}` : '', progress >= 1);
  els.candKind.hidden = !kind;
  setText(els.candKind, kind === 'word' ? '수어 단어' : kind === 'letter' ? '지문자' : '');
  els.candKind.dataset.kind = kind || '';
  setText(els.candText, text || '–');
  els.candText.classList.toggle('none', !text);
  setText(els.candSub, sub || '');
  clear(els.candBar).append(bar(conf || 0, conf >= 0.5 ? 'ok' : ''));
  setText(els.candPct, text ? pct(conf || 0) : '');
}

function onSignFrame(frame) {
  const s = settingsOf();
  const aspect = frame.videoW / frame.videoH || 16 / 9;
  const dom = dominant();
  const t = frame.t;
  // 1) 등록 단어
  const sf = signs.size ? frameFeature(frame.hands, { aspect, dominant: dom }) : null;
  const st = spotter.push(sf, t);
  if (st.committed) acceptWord(st.committed);
  // 2) 지문자 (write.js 와 같은 방법 · 단어 후보가 있거나 손이 움직이는 동안은 받지 않음)
  const raw = pickHand(frame.hands, { dominant: dom, aspect });
  const hand = raw ? smoother.smooth(raw, t) : null;
  if (!raw) smoother.reset();
  const features = hand ? extractFeatures(hand, { aspect, dominant: dom }) : null;
  const pool = mode === 'numbers' ? NUMBER_LETTERS : SPELLING_LETTERS;
  const { best, ranking } = features ? classify(features, pool, { strictness: s.strictness }) : { best: null, ranking: [] };
  const wordBusy = !!st.candidate || st.speed > 1.6;
  const bestId = best && !wordBusy ? best.letterId : null;
  if (!armed) {
    if (bestId !== lastAccepted) {
      if (!releaseSince) releaseSince = t;
      if (t - releaseSince >= RELEASE_MS) armed = true;
    } else releaseSince = 0;
  }
  if (bestId !== cand.id) cand = { id: bestId, since: t };
  let lp = 0;
  if (armed && bestId) {
    lp = Math.min(1, (t - cand.since) / ACCEPT_MS);
    if (lp >= 1) {
      const l = pool.find((x) => x.id === bestId);
      if (l) acceptLetter(l);
      armed = false;
      releaseSince = 0;
    }
  }
  // 3) 화면
  let state;
  if (st.candidate) {
    renderCandidate('word', st.candidate.text, `등록한 단어 · 거리 ${st.candidate.distance.toFixed(2)}`, st.candidate.confidence, st.progress);
    state = st.armed ? '그대로 잠깐…' : '좋아요! 다음 단어를 하려면 손을 바꾸거나 잠깐 내려 주세요';
  } else if (bestId) {
    const l = pool.find((x) => x.id === bestId);
    const e = ranking.find((x) => x.letterId === bestId);
    renderCandidate('letter', glyphOf(l), nameOf(l), e ? e.score : 0, armed ? lp : 0);
    state = armed ? `“${nameOf(l)}” 같아요. 그대로 잠깐…` : '좋아요! 다음 글자를 하려면 손 모양을 바꿔 주세요';
  } else {
    const near = st.ranking && st.ranking[0];
    renderCandidate(null, '', near ? `가장 가까운 단어: ${near.text} (기준 밖)` : '', 0, 0);
    state = !features ? '손을 보여 주세요' : wordBusy ? '움직임을 보고 있어요…' : '아는 단어나 지문자를 찾고 있어요';
  }
  setText(els.state, state);
  const ev = !st.candidate && (best || ranking[0]) ? best || ranking[0] : null;
  cam.render({ hand, features, evaluation: ev, hold: { progress: Math.max(lp, st.progress || 0) }, success: false }, frame);
}

function buildSignTab() {
  els.sentence = h('div.tr-sentence', { 'aria-live': 'polite' });
  els.sentPlaceholder = h('div.write-placeholder', '수어 단어나 지문자를 하면 여기에 글이 써져요');
  els.flash = h('div.write-flash', { 'aria-hidden': 'true' });
  els.candRing = ring({ size: 64, stroke: 7 });
  els.candKind = h('span.tr-cand-kind');
  els.candText = h('div.tr-cand-text');
  els.candSub = h('div.tr-cand-sub');
  els.candBar = h('div.tr-cand-bar');
  els.candPct = h('span.tr-cand-pct.num');
  els.state = h('div.write-state', { role: 'status' });
  const modeSeg = segmented({
    label: '지문자 종류',
    options: [['letters', '글자'], ['numbers', '숫자']],
    value: mode,
    onchange: (v) => {
      mode = v;
      cand = { id: null, since: 0 };
    },
  });
  const tile = (ic, label, key, fn, primary = false) =>
    h(`button.tile-btn${primary ? '.primary' : ''}`, { type: 'button', onclick: fn, 'aria-label': key ? `${label} (${key})` : label }, icon(ic), h('span', label), key ? h('kbd', key) : null);
  const left = h(
    'aside.tr-left',
    callout(LIMIT_NOTE, { tone: 'plain', ic: 'info' }),
    h('div.card.tr-board', h('div.row.between', h('div.tr-label', '알아들은 글'), h('span.muted.tr-hint', '단어 칩 = 등록한 수어')), els.sentPlaceholder, els.sentence, els.flash),
    h(
      'div.card.tight.tr-cand',
      h('div.tr-cand-main', els.candRing.el, h('div.tr-cand-body', h('div.row', els.candKind, els.candText), els.candSub), h('div.tr-cand-conf', els.candBar, els.candPct)),
      h('div.row.between.tr-cand-foot', els.state, modeSeg),
    ),
    h(
      'div.tile-row.tr-tiles',
      tile('space', '띄어쓰기', 'Space', addSpace),
      tile('backspace', '지우기', '←', backspace),
      tile('trash', '모두 지우기', 'R', clearAll),
      tile('copy', '복사', '', copySentence),
      tile('volume', '말하기', 'H', speakSentence, true),
    ),
  );
  els.camSign = h('div.tr-right');
  return h('div.tr-pane.tr-sign', left, els.camSign);
}

// ════════════════ 단어 등록 ════════════════
function renderWordList() {
  const list = signs.list();
  setText(els.wordCount, list.length ? `${list.length}개` : '');
  if (!list.length) {
    clear(els.wordList).append(h('div.tr-empty', icon('hand'), h('strong', '아직 등록한 단어가 없어요'), h('p', '위에 낱말을 쓰고 “3번 녹화”를 눌러 보세요.')));
    return;
  }
  clear(els.wordList).append(
    ...list.map((w) => {
      const n = w.recordings.length;
      const sel = selectedWord === w.id;
      return h(
        `div.tr-word${sel ? '.selected' : ''}`,
        h('button.tr-word-name', { type: 'button', onclick: () => selectWord(w.id), 'aria-pressed': String(sel) }, h('strong', w.text), h('span.tr-dots', { 'aria-label': `녹화 ${n}번` }, ...Array.from({ length: Math.max(REPEATS, n) }, (_, i) => h(`i${i < n ? '.on' : ''}`)))),
        h('div.tr-word-actions',
          h('button.icon-btn', { type: 'button', title: '미리 보기', 'aria-label': `${w.text} 미리 보기`, disabled: !w.demo, onclick: () => startPreview(w.id) }, icon('eye')),
          h('button.icon-btn', { type: 'button', title: '다시 녹화', 'aria-label': `${w.text} 다시 녹화`, onclick: () => startRecording(w.text, { fresh: true }) }, icon('refresh')),
          h('button.icon-btn.danger', { type: 'button', title: '지우기', 'aria-label': `${w.text} 지우기`, onclick: () => removeWord(w.id) }, icon('trash')),
        ),
      );
    }),
  );
}

function selectWord(id) {
  selectedWord = id;
  const w = signs.get(id);
  if (w && !rec) els.wordInput.value = w.text;
  renderWordList();
}

async function removeWord(id) {
  const w = signs.get(id);
  if (!w) return;
  if (!(await confirmDialog({ title: `“${w.text}”을 지울까요?`, body: '녹화한 손 움직임도 함께 지워져요.', ok: '지우기', danger: true }))) return;
  signs.remove(id);
  if (selectedWord === id) selectedWord = null;
  saveSigns();
  renderWordList();
}

function startRecording(text = els.wordInput.value, { fresh = false } = {}) {
  if (rec) return false;
  const t = String(text || '').trim();
  if (!t) {
    toast('먼저 등록할 낱말을 써 주세요', { tone: 'hint' });
    els.wordInput.focus();
    return false;
  }
  if (tab !== 'register') setTab('register');
  const w = signs.addWord(t);
  if (fresh) signs.clearRecordings(w.id);
  saveSigns();
  els.wordInput.value = w.text;
  selectedWord = w.id;
  stopPreview();
  rec = { phase: 'count', t0: performance.now(), wait: COUNTDOWN_MS, samples: [], attempt: 1, wordId: w.id, lenMs: recLen, fails: 0, aspect: 16 / 9 };
  els.recBtn.disabled = true;
  els.cancelBtn.hidden = false;
  app.sound.play('start');
  renderWordList();
  renderRec();
  return true;
}

function cancelRecording() {
  if (!rec) return;
  rec = null;
  cam.hint(null);
  els.recBtn.disabled = false;
  els.cancelBtn.hidden = true;
  els.recBar.style.width = '0%';
  setText(els.recState, '녹화를 멈췄어요');
  renderRec();
}

function renderRec() {
  const w = rec ? signs.get(rec.wordId) : selectedWord ? signs.get(selectedWord) : null;
  setText(els.recWord, w ? w.text : '낱말을 써 주세요');
  const n = w ? w.recordings.length : 0;
  clear(els.recDots).append(...Array.from({ length: REPEATS }, (_, i) => h(`i${rec ? (i < rec.attempt - 1 ? '.on' : i === rec.attempt - 1 ? '.now' : '') : i < n ? '.on' : ''}`)));
}

function recTick() {
  if (!rec) return;
  const now = performance.now();
  const t = now - rec.t0;
  if (rec.phase === 'count') {
    const left = Math.ceil((rec.wait - t) / 1000);
    cam.hint(`${rec.attempt}번째 · ${left}초 뒤에 녹화해요. 손을 내리고 준비해 주세요`, 'clock');
    setText(els.recState, `${rec.attempt} / ${REPEATS} · 준비… ${left}`);
    els.recBar.style.width = '0%';
    if (t >= rec.wait) {
      rec.phase = 'rec';
      rec.t0 = now;
      rec.samples = [];
      app.sound.play('tick');
    }
  } else {
    const left = Math.max(0, (rec.lenMs - t) / 1000);
    cam.hint(`녹화 중 ${left.toFixed(1)}초 · 수어를 한 번 해 주세요`, 'record');
    setText(els.recState, `${rec.attempt} / ${REPEATS} · 녹화 중 (${rec.samples.filter((x) => x.f).length}프레임)`);
    els.recBar.style.width = `${Math.min(100, (t / rec.lenMs) * 100)}%`;
    if (t >= rec.lenMs) finishAttempt();
  }
}

function finishAttempt() {
  const r = buildRecording(rec.samples, { aspect: rec.aspect });
  const w = signs.get(rec.wordId);
  if (!r.ok || !w) {
    rec.fails++;
    app.sound.play('fail');
    toast('손이 잘 보이지 않았어요. 한 번 더 할게요', { tone: 'bad' });
    if (rec.fails >= 3) {
      cancelRecording();
      setText(els.recState, '손이 잘 안 보여서 멈췄어요. 손을 화면 가운데에 보여 주세요');
      return;
    }
  } else {
    signs.addRecording(w.id, r.rec, r.demo);
    if (!saveSigns()) toast('저장 공간이 모자라요. 쓰지 않는 단어를 지워 주세요', { tone: 'bad', ms: 4000 });
    rec.attempt++;
  }
  renderWordList();
  if (rec.attempt > REPEATS) {
    const text = w ? w.text : '';
    rec = null;
    cam.hint(null);
    els.recBtn.disabled = false;
    els.cancelBtn.hidden = true;
    els.recBar.style.width = '0%';
    setText(els.recState, `“${text}” 등록 끝! 번역 화면에서 해 보세요`);
    toast(`“${text}”을 등록했어요`);
    app.sound.play('success');
    renderRec();
    return;
  }
  rec.phase = 'count';
  rec.t0 = performance.now();
  rec.wait = GAP_MS;
  renderRec();
}

function onRegisterFrame(frame) {
  const aspect = frame.videoW / frame.videoH || 16 / 9;
  const raw = pickHand(frame.hands, { dominant: dominant(), aspect });
  cam.render({ hand: raw, features: null, evaluation: null, hold: { progress: 0 }, success: false }, frame);
  if (rec && rec.phase === 'rec') {
    rec.aspect = aspect;
    rec.samples.push({ t: frame.t, f: frameFeature(frame.hands, { aspect, dominant: dominant(), keepLandmarks: true }) });
  }
}

function exportFile() {
  if (!signs.size) {
    toast('내보낼 단어가 없어요', { tone: 'hint' });
    return;
  }
  const blob = new Blob([JSON.stringify(signs.toJSON())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const a = h('a', { href: url, download: `sonmal-signs-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function importFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const n = signs.fromJSON(String(reader.result), { merge: true });
      saveSigns();
      toast(`수어 단어 ${n}개를 가져왔어요`);
      renderWordList();
    } catch (err) {
      toast(err && err.message ? err.message : '파일을 읽지 못했어요', { tone: 'bad', ms: 4000 });
    }
  };
  reader.readAsText(file);
}

function buildRegisterTab() {
  els.wordInput = h('input.input.big.tr-word-input', {
    type: 'text',
    placeholder: '예: 안녕하세요',
    maxLength: 30,
    'aria-label': '등록할 낱말',
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        els.wordInput.blur();
        startRecording();
      }
    },
  });
  els.wordList = h('div.tr-words');
  els.wordCount = h('span.muted');
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { importFile(e.target.files[0]); e.target.value = ''; } });
  const lenSeg = segmented({ label: '녹화 길이', options: [[1500, '1.5초'], [2500, '2.5초'], [3000, '3초']], value: recLen, onchange: (v) => { recLen = v; } });
  els.recBtn = btn('3번 녹화', { icon: 'record', kind: 'primary', size: 'lg', onclick: () => startRecording() });
  els.cancelBtn = btn('멈추기', { icon: 'x', kind: 'ghost', onclick: cancelRecording });
  els.cancelBtn.hidden = true;
  els.recWord = h('div.tr-rec-word');
  els.recDots = h('div.tr-dots.big', { 'aria-hidden': 'true' });
  els.recState = h('div.teacher-rec-state', { role: 'status' }, '낱말을 쓰고 “3번 녹화”를 누르면 3초 뒤에 녹화해요');
  els.recBar = h('span');
  const left = h(
    'aside.tr-left.tr-reg-left',
    h(
      'div.card.tight.tr-reg-form',
      h('div.tr-label', '등록할 낱말'),
      els.wordInput,
      h('div.row.tr-suggest', ...SUGGEST.map((w) => h('button.chip', { type: 'button', onclick: () => { els.wordInput.value = w; } }, w))),
      h('div.row.between', h('span.field-label', '한 번 녹화 길이'), lenSeg),
    ),
    h('div.card.tight.tr-reg-list', h('div.row.between', h('strong', '내 수어 단어'), els.wordCount), els.wordList),
    h(
      'div.row.teacher-files',
      btn('파일로 내보내기', { icon: 'download', kind: 'soft', onclick: exportFile }),
      btn('파일 가져오기', { icon: 'upload', kind: 'soft', onclick: () => fileInput.click() }),
      fileInput,
    ),
  );
  els.camReg = h('div.tr-cam-slot');
  els.previewCanvas = h('canvas', { 'aria-hidden': 'true' });
  els.previewTitle = h('strong');
  els.preview = h('div.tr-preview', { role: 'img', 'aria-label': '녹화한 손 움직임 미리 보기' }, h('div.tr-preview-head', icon('eye'), els.previewTitle, h('span.spacer'), btn('닫기', { icon: 'x', kind: 'ghost', size: 'sm', onclick: stopPreview })), els.previewCanvas);
  els.preview.hidden = true;
  const right = h(
    'div.tr-right.tr-reg-right',
    h('div.tr-cam-wrap', els.camReg, els.preview),
    h(
      'div.card.tr-rec',
      h('div.row.between', h('div', h('div.muted.tr-small', '녹화할 낱말'), els.recWord), els.recDots),
      h('div.bar', els.recBar),
      h('div.row.between', els.recState, h('div.row', els.cancelBtn, els.recBtn)),
    ),
    callout('같은 수어를 3번 녹화하면 그 차이로 “같은 단어” 기준을 정해요. 영상은 저장하지 않고 손 마디 숫자만 이 컴퓨터에 저장해요.', { tone: 'plain', ic: 'info' }),
  );
  return h('div.tr-pane.tr-reg', left, right);
}

function startPreview(id) {
  const w = signs.get(id);
  if (!w || !w.demo) return;
  selectedWord = id;
  preview = { word: w, t0: performance.now() };
  setText(els.previewTitle, `“${w.text}” 녹화한 손`);
  els.preview.hidden = false;
  renderWordList();
}

function stopPreview() {
  preview = null;
  if (els.preview) els.preview.hidden = true;
}

// ════════════════ 손 움직임 그리기 (녹화 재생) ════════════════
const demoBoxes = new WeakMap();
function demoBox(demo) {
  let b = demoBoxes.get(demo);
  if (b) return b;
  const a = demo.aspect || 16 / 9;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const fr of demo.frames) {
    for (const arr of fr) {
      if (!arr) continue;
      for (let i = 0; i < 42; i += 2) {
        x0 = Math.min(x0, arr[i] * a); x1 = Math.max(x1, arr[i] * a);
        y0 = Math.min(y0, arr[i + 1]); y1 = Math.max(y1, arr[i + 1]);
      }
    }
  }
  b = { a, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(0.05, x1 - x0), h: Math.max(0.05, y1 - y0) };
  demoBoxes.set(demo, b);
  return b;
}

/** 녹화한 손 마디를 캔버스 가운데에 크게 (거울처럼) */
function drawDemo(ctx, W, H, demo, u) {
  if (!demo || !demo.frames.length) return;
  const b = demoBox(demo);
  const s = Math.min((W * 0.72) / b.w, (H * 0.72) / b.h, H * 2.2);
  const n = demo.frames.length;
  const k = Math.max(0, Math.min(n - 1, Math.floor(u * n)));
  const map = (arr) =>
    unpackLandmarks(arr).map((p) => ({ x: 0.5 + ((p.x * b.a - b.cx) * s) / W, y: 0.5 + ((p.y - b.cy) * s) / H, z: 0 }));
  // 지나온 길 (손바닥 가운데)
  ctx.save();
  ctx.strokeStyle = isDark() ? 'rgba(95, 224, 207, 0.45)' : 'rgba(11, 122, 112, 0.35)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.setLineDash([2, 12]);
  ctx.beginPath();
  for (let i = 0; i <= k; i++) {
    const lm = map(demo.frames[i][0]);
    const x = (1 - (lm[0].x + lm[9].x) / 2) * W, y = ((lm[0].y + lm[9].y) / 2) * H;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
  const fr = demo.frames[k];
  const opts = { width: W, height: H, videoW: W, videoH: H, fit: 'fill', mirror: true };
  const allOk = { fingerStatus: { thumb: 'ok', index: 'ok', middle: 'ok', ring: 'ok', pinky: 'ok' }, palmStatus: 'ok' };
  if (fr[1]) drawLive(ctx, { landmarks: map(fr[1]) }, allOk, { ...opts, colors: { ok: '#d9774b', palm: '#f0c2a8' } });
  drawLive(ctx, { landmarks: map(fr[0]) }, allOk, { ...opts, colors: { ok: '#0b8a7e', palm: '#9fd9d1' } });
}

// ════════════════ 글 → 수어 ════════════════
function buildSteps(text) {
  const wordTexts = signs.list().filter((w) => w.demo && w.recordings.length).map((w) => w.text);
  tokens = planTranslation(text, wordTexts);
  steps = [];
  tokens.forEach((tk, ti) => {
    if (tk.type === 'space') {
      steps.push({ kind: 'space', token: ti, dur: 500 });
      return;
    }
    if (tk.type === 'word') {
      const w = signs.findByText(tk.text);
      steps.push({ kind: 'word', token: ti, word: w, dur: (w.demo.durMs || 1500) + 600 });
      return;
    }
    // 지문자: 한 글자씩 (숫자는 지숫자)
    Array.from(tk.text).forEach((ch, ci) => {
      if (/\d/.test(ch)) {
        const l = letterForJamo(ch);
        if (l) steps.push({ kind: 'letter', token: ti, syll: ci, jamo: ch, letter: l, dur: l.motion ? 1700 : 1150 });
        return;
      }
      for (const it of decomposeForSpelling(ch)) {
        const l = letterForJamo(it.jamo);
        if (l) steps.push({ kind: 'letter', token: ti, syll: ci, jamo: it.jamo, letter: l, dur: l.motion ? 1700 : 1150 });
      }
    });
  });
  let acc = 0;
  for (const s of steps) {
    s.start = acc;
    acc += s.dur;
  }
  total = acc;
  playT = 0;
}

function stepAt(t) {
  if (!steps.length) return -1;
  for (let i = steps.length - 1; i >= 0; i--) if (t >= steps[i].start) return i;
  return 0;
}

function showText() {
  const text = els.textInput.value.trim();
  if (!text) {
    toast('보여 줄 글을 써 주세요', { tone: 'hint' });
    return;
  }
  buildSteps(text);
  if (!steps.length) {
    toast('보여 줄 수 있는 한글이 없어요', { tone: 'hint' });
    return;
  }
  playing = true;
  renderTokens();
  renderPlayerChrome();
}

function setPlaying(v) {
  playing = !!v && steps.length > 0;
  if (playing && playT >= total - 1) playT = 0;
  renderPlayerChrome();
}

function jump(d) {
  if (!steps.length) return;
  const i = Math.max(0, Math.min(steps.length - 1, stepAt(playT) + d));
  playT = steps[i].start;
}

function renderTokens() {
  clear(els.tokens).append(
    ...tokens.map((tk, i) =>
      tk.type === 'space'
        ? h('span.tr-gap', { 'aria-hidden': 'true' })
        : h(`span.tr-token.${tk.type}`, { dataset: { i: String(i) } }, tk.type === 'word' ? icon('hand') : null, tk.text),
    ),
  );
  if (!tokens.length) els.tokens.append(h('span.muted', '글을 쓰고 “보여 주기”를 누르면 순서가 여기에 나와요.'));
  setText(els.planNote, tokens.length ? `등록 단어 ${tokens.filter((x) => x.type === 'word').length}개 · 지문자 ${steps.filter((s) => s.kind === 'letter').length}자모` : '');
}

function renderPlayerChrome() {
  clear(els.playBtn).append(icon(playing ? 'pause' : 'play'), h('span', playing ? '멈춤' : '재생'), h('kbd', 'Space'));
  els.playBtn.setAttribute('aria-label', playing ? '멈춤 (Space)' : '재생 (Space)');
  els.repeatBtn.setAttribute('aria-pressed', String(repeat));
  els.repeatBtn.classList.toggle('on', repeat);
  els.scrub.max = String(Math.max(1, Math.round(total)));
  els.scrub.disabled = !steps.length;
}

let lastStepShown = -2;
function renderStepInfo(i) {
  if (i === lastStepShown) return;
  lastStepShown = i;
  const s = steps[i];
  els.tokens.querySelectorAll('.tr-token').forEach((el) => el.classList.toggle('now', s && el.dataset.i === String(s.token)));
  setText(els.stepCount, s ? `${i + 1} / ${steps.length}` : '');
  if (!s) {
    setText(els.bigGlyph, '');
    setText(els.bigName, '');
    setText(els.stageCaption, '글을 쓰고 “보여 주기”를 눌러 주세요');
    clear(els.sylls);
    els.stage.dataset.kind = 'none';
    return;
  }
  els.stage.dataset.kind = s.kind;
  if (s.kind === 'letter') {
    setText(els.bigGlyph, s.jamo);
    setText(els.bigName, nameOf(s.letter) || jamoName(s.jamo));
    setText(els.stageCaption, s.letter.motion ? defaultHint(s.letter.motion) : '지문자');
    const tk = tokens[s.token];
    clear(els.sylls).append(...Array.from(tk.text).map((ch, ci) => h(`span${ci === s.syll ? '.now' : ci < s.syll ? '.done' : ''}`, ch)));
  } else if (s.kind === 'word') {
    setText(els.bigGlyph, '');
    setText(els.bigName, s.word.text);
    setText(els.stageCaption, '내가 등록한 수어 단어 (녹화한 손 움직임)');
    clear(els.sylls);
  } else {
    setText(els.bigGlyph, '');
    setText(els.bigName, '');
    setText(els.stageCaption, '띄어쓰기 · 잠깐 쉬어요');
    clear(els.sylls);
  }
}

function drawLetter(ctx, W, H, s, u) {
  const l = s.letter;
  const m = l.motion;
  let pose = l.pose;
  let dx = 0;
  if (m && m.type === 'sequence' && l.startPose) pose = lerpPose(l.startPose, l.pose, smoothstep((u - 380) / 450));
  else if (m && m.type === 'move') {
    const dir = { right: 1, left: -1 }[m.dir] ?? 1;
    dx = dir * smoothstep((u - 350) / 500) * W * 0.16 - dir * W * 0.08;
  } else if (m && m.type === 'shake') dx = u > 250 ? Math.sin((u - 250) / 85) * W * 0.04 : 0;
  if (dominant() === 'left') dx = -dx;
  drawReference(ctx, pose, { width: W, height: H, x: dx, y: 0, view: l.refView || undefined, side: dominant(), zoom: 0.8, theme: isDark() ? 'dark' : 'light' });
}

function frameLoop(now) {
  rafId = requestAnimationFrame(frameLoop);
  const dt = lastNow ? Math.min(100, now - lastNow) : 0;
  lastNow = now;
  if (tab === 'register' && preview && !els.preview.hidden) {
    const { ctx, width, height } = fitCanvas(els.previewCanvas);
    const d = preview.word.demo;
    const dur = (d.durMs || 1500) + 600;
    const u = ((now - preview.t0) % dur) / (d.durMs || 1500);
    drawDemo(ctx, width, height, d, Math.min(1, u));
    return;
  }
  if (tab !== 'text') return;
  if (playing && steps.length) {
    playT += dt / SPEEDS[speed];
    if (playT >= total) {
      if (repeat) playT = 0;
      else {
        playT = total - 1;
        playing = false;
        renderPlayerChrome();
      }
    }
  }
  const i = stepAt(playT);
  renderStepInfo(i);
  if (document.activeElement !== els.scrub) els.scrub.value = String(Math.round(playT));
  const { ctx, width, height: fullH } = fitCanvas(els.canvas);
  const s = steps[i];
  if (!s || width < 4) return;
  // 아래쪽 글자 줄(지금 글자 · 안내)을 가리지 않게 그 위에만 그림
  const height = Math.max(40, fullH - 96);
  const u = playT - s.start;
  try {
    if (s.kind === 'letter') drawLetter(ctx, width, height, s, u);
    else if (s.kind === 'word') drawDemo(ctx, width, height, s.word.demo, Math.min(1, u / (s.word.demo.durMs || 1500)));
  } catch (err) {
    console.error('손을 그리지 못했어요', err);
  }
}

function buildTextTab() {
  els.textInput = h('textarea.input.tr-textarea', { rows: 2, maxLength: 120, placeholder: '예: 안녕하세요 병원에 가요', 'aria-label': '수어로 보여 줄 글' });
  els.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      showText();
    }
  });
  els.tokens = h('div.tr-tokens', { 'aria-label': '보여 줄 순서' });
  els.planNote = h('span.muted.tr-small');
  els.playBtn = h('button.tile-btn.primary', { type: 'button', onclick: () => setPlaying(!playing) });
  els.repeatBtn = h('button.tile-btn.tr-toggle', { type: 'button', 'aria-label': '되풀이', onclick: () => { repeat = !repeat; renderPlayerChrome(); } }, icon('repeat'), h('span', '되풀이'));
  els.scrub = h('input.tr-scrub', { type: 'range', min: '0', max: '1', step: '10', value: '0', 'aria-label': '재생 위치' });
  els.scrub.addEventListener('input', () => {
    playT = Number(els.scrub.value) || 0;
  });
  const speedSeg = segmented({ label: '빠르기', options: [['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']], value: speed, onchange: (v) => { speed = v; } });
  const left = h(
    'aside.tr-left',
    h(
      'div.card.tight.tr-text-form',
      h('div.tr-label', '수어로 보여 줄 글'),
      els.textInput,
      h('div.row.between', h('span.muted.tr-small', '등록한 단어는 그 수어로, 나머지는 지문자로 보여 줘요'), btn('보여 주기', { icon: 'play', kind: 'primary', onclick: showText })),
    ),
    h('div.card.tight.tr-plan', h('div.row.between', h('div.tr-label', '순서'), els.planNote), els.tokens),
    h('div.card.tight.tr-controls', h('div.row.tr-controls-row', speedSeg, els.scrub)),
    h(
      'div.tile-row',
      h('button.tile-btn', { type: 'button', onclick: () => jump(-1), 'aria-label': '이전 (←)' }, icon('left'), h('span', '이전'), h('kbd', '←')),
      els.playBtn,
      h('button.tile-btn', { type: 'button', onclick: () => jump(1), 'aria-label': '다음 (→)' }, icon('right'), h('span', '다음'), h('kbd', '→')),
      els.repeatBtn,
    ),
  );
  els.canvas = h('canvas.tr-canvas', { 'aria-hidden': 'true' });
  els.bigGlyph = h('div.tr-big-glyph');
  els.bigName = h('div.tr-big-name');
  els.stageCaption = h('div.tr-stage-caption');
  els.sylls = h('div.tr-sylls', { 'aria-label': '지금 글자' });
  els.stepCount = h('span.tr-step-count.num');
  els.stage = h(
    'div.tr-stage',
    { role: 'img', 'aria-label': '수어 손 그림' },
    els.canvas,
    h('div.tr-stage-top', h('div', els.bigGlyph, els.bigName), h('span.spacer'), els.stepCount),
    h('div.tr-stage-bottom', els.sylls, els.stageCaption),
    h('span.ref-hand-tag', '거울에 비친 내 손'),
  );
  return h('div.tr-pane.tr-text', left, h('div.tr-right', els.stage));
}

// ════════════════ 탭 ════════════════
function setTab(id) {
  if (rec && id !== 'register') cancelRecording();
  tab = id;
  for (const [k, el] of Object.entries(els.panes)) el.hidden = k !== id;
  els.tabSeg.querySelectorAll('button').forEach((b, i) => {
    const on = ['sign', 'text', 'register'][i] === id;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  // 카메라 판은 하나만 만들어 두고 옮겨 붙임
  if (id === 'sign') els.camSign.appendChild(cam.el);
  else if (id === 'register') els.camReg.appendChild(cam.el);
  if (id !== 'register') stopPreview();
  spotter.reset();
  cam.hint(null);
  if (id === 'register') {
    renderWordList();
    renderRec();
  }
  if (id === 'text') lastStepShown = -2;
}

export default {
  id: 'translate',
  title: '번역 (지문자 · 등록 단어)',
  nav: '번역',
  icon: 'translate',
  camera: true,
  fit: true,
  mount(r, a, params) {
    app = a;
    root = r;
    els = {};
    parts = [];
    composer = createComposer();
    smoother = createLandmarkSmoother({ minCutoff: 1.2, beta: 12 });
    spotter = createSignSpotter({ lexicon: signs, getStrictness: strictness });
    cand = { id: null, since: 0 };
    armed = true;
    rec = null;
    preview = null;
    steps = [];
    tokens = [];
    total = 0;
    playT = 0;
    playing = false;
    lastStepShown = -2;
    cam = createCameraView(app, { showRing: true });
    els.tabSeg = segmented({
      label: '번역 방향',
      options: [['sign', '수어 → 글·음성'], ['text', '글 → 수어'], ['register', '수어 단어 등록']],
      value: 'sign',
      onchange: (v) => setTab(v),
    });
    els.tabSeg.classList.add('tr-tabs');
    els.panes = { sign: buildSignTab(), text: buildTextTab(), register: buildRegisterTab() };
    const head = h('div.tr-head', els.tabSeg, h('span.spacer'), h('span.badge.hint.tr-scope', icon('info'), '지문자 + 내가 등록한 단어만'));
    root.append(h('div.work.translate', head, h('div.tr-panes', ...Object.values(els.panes))));
    renderSentence();
    renderCandidate(null, '', '', 0, 0);
    setText(els.state, '손을 보여 주세요');
    renderTokens();
    renderPlayerChrome();
    setTab(['sign', 'text', 'register'].includes(params.tab) ? params.tab : 'sign');
    if (params.text) els.textInput.value = params.text;
    tickId = setInterval(recTick, 100);
    lastNow = 0;
    rafId = requestAnimationFrame(frameLoop);
    handRenderReady.then(() => { lastStepShown = -2; });
  },
  unmount() {
    clearInterval(tickId);
    cancelAnimationFrame(rafId);
    rec = null;
    playing = false;
    if (cam) cam.destroy();
    cam = null;
  },
  onFrame(frame) {
    if (!cam) return;
    if (tab === 'sign') onSignFrame(frame);
    else if (tab === 'register') onRegisterFrame(frame);
  },
  onKey(e) {
    if (!cam) return false;
    if (tab === 'sign') {
      if (e.key === ' ') { addSpace(); return true; }
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') { backspace(); return true; }
      if (e.code === 'KeyR') { clearAll(); return true; }
      if (e.code === 'KeyH') { speakSentence(); return true; }
    } else if (tab === 'text') {
      if (e.key === ' ') { setPlaying(!playing); return true; }
      if (e.key === 'ArrowLeft') { jump(-1); return true; }
      if (e.key === 'ArrowRight') { jump(1); return true; }
    } else if (tab === 'register' && e.key === ' ' && !rec) {
      startRecording();
      return true;
    }
    return false;
  },
  // ───── 점검용 ─────
  setTab: (id) => setTab(id),
  get tab() {
    return tab;
  },
  get text() {
    return sentenceText();
  },
  get lastCommitted() {
    return lastCommitted;
  },
  get recording() {
    return !!rec;
  },
  startRecording: (text) => startRecording(text),
  /** 녹화 프레임 목록들로 단어를 바로 등록 (samples: [{t, f}] 의 목록) */
  registerSamples(text, list, aspect = 16 / 9) {
    const w = signs.addWord(text);
    signs.clearRecordings(w.id);
    let n = 0;
    for (const samples of list) {
      const r = buildRecording(samples, { aspect });
      if (r.ok && signs.addRecording(w.id, r.rec, r.demo)) n++;
    }
    saveSigns();
    renderWordList();
    return n;
  },
  showText(text) {
    if (text !== undefined) els.textInput.value = text;
    showText();
  },
  seekStep(i) {
    if (steps[i]) playT = steps[i].start + 600;
  },
  setPlaying: (v) => setPlaying(v),
  get player() {
    return { steps: steps.map((s) => ({ kind: s.kind, jamo: s.jamo || null, text: s.word ? s.word.text : null })), index: stepAt(playT), playing, total };
  },
  get canvas() {
    return els.canvas;
  },
  previewWord: (id) => startPreview(id),
  get words() {
    return signs.list().map((w) => ({ id: w.id, text: w.text, recordings: w.recordings.length }));
  },
};
