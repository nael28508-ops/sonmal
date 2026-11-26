// Learn 수어 — 화면 쪽 시작점
// - 공용 도구(설정 · 저장 · 목소리 · 효과음 · 카메라와 손 인식 · 기록)를 만들고
// - 위쪽 메뉴 · 상태 표시(카메라 / 손 / 속도) · 화면 바꾸기(#/화면) · 키보드 단축키를 맡음
// - 자동 점검(?selftest=1)이면 가짜 손을 쓰고 test/selftest.js 를 돌림
import settings from './core/settings.js';
import * as storage from './core/storage.js';
import { createSpeech } from './core/speech.js';
import { createSound } from './core/sound.js';
import { createVision } from './core/vision.js';
import { createBackground } from './core/background.js';
import { createProgressStore } from './core/progress-store.js';
import { h, icon, setText, clear } from './ui/dom.js';
import { toast } from './ui/components.js';
import { diag } from './core/diag.js';

import home from './screens/home.js';
import learn from './screens/learn.js';
import practice from './screens/practice.js';
import words from './screens/words.js';
import write from './screens/write.js';
import quiz from './screens/quiz.js';
import progressScreen from './screens/progress.js';
import teacher from './screens/teacher.js';
import settingsScreen from './screens/settings.js';
import help from './screens/help.js';
import translate from './screens/translate.js';

const host = window.sonmalHost || null;
const SELFTEST = !!(host && host.isSelftest) || new URLSearchParams(location.search).has('selftest');

// 메뉴 순서 (null = 구분선)
const SCREENS = [home, learn, practice, words, write, translate, quiz, null, progressScreen, teacher, settingsScreen, help];
const BY_ID = new Map(SCREENS.filter(Boolean).map((s) => [s.id, s]));

settings.load();
if (SELFTEST) document.documentElement.setAttribute('data-motion', 'reduce');

const speech = createSpeech({ getSettings: () => settings.get(), stub: SELFTEST });
const sound = createSound({ getSettings: () => settings.get(), disabled: SELFTEST });
const vision = createVision({ synthetic: SELFTEST, settings });
const background = createBackground({ video: vision.video, settings, synthetic: SELFTEST, toast }); // 카메라 배경 (보이는 화면만 바꿈)
const progress = createProgressStore(storage.adapter);

const screenHost = document.getElementById('screen-host');
const navEl = document.getElementById('nav');
const statusEl = document.getElementById('status');
const announcer = document.getElementById('announcer');

let current = null; // { screen, root, params, cameraHeld }
let navToken = 0;

/** 화면들이 함께 쓰는 도구 */
const app = {
  selftest: SELFTEST,
  host,
  settings,
  storage,
  speech,
  sound,
  vision,
  background,
  progress,
  toast,
  navigate,
  back,
  announce(text) {
    setText(announcer, '');
    requestAnimationFrame(() => setText(announcer, text));
  },
  refreshBadges,
  get current() {
    return current ? current.screen.id : null;
  },
  get currentScreen() {
    return current ? current.screen : null;
  },
};
window.sonmal = app; // 점검 · 개발자 도구에서 쓰려고

// ───────── 위쪽 메뉴 ─────────
const navItems = new Map();
for (const s of SCREENS) {
  if (!s) {
    navEl.appendChild(h('span.nav-sep', { 'aria-hidden': 'true' }));
    continue;
  }
  const badge = h('span.nav-badge');
  badge.hidden = true;
  const a = h('a.nav-item', { href: `#/${s.id}`, title: s.title }, icon(s.icon), h('span', s.nav || s.title), badge);
  navItems.set(s.id, { a, badge });
  navEl.appendChild(a);
}

function refreshBadges() {
  const item = navItems.get('practice');
  if (!item) return;
  let n = 0;
  try {
    n = practice.dueCount ? practice.dueCount(app) : 0;
  } catch {
    n = 0;
  }
  item.badge.hidden = !n;
  setText(item.badge, n > 9 ? '9+' : String(n));
  item.a.setAttribute('aria-label', n ? `${practice.nav}, 복습할 글자 ${n}개` : practice.nav);
}
progress.onChange(refreshBadges);

// ───────── 상태 표시 (카메라 · 손 · 속도) ─────────
function pill(ic, cls = '') {
  const label = h('span.pill-label');
  const el = h(`span.pill${cls ? `.${cls}` : ''}`, h('span.dot'), icon(ic), label);
  statusEl.appendChild(el);
  return { el, label };
}
const camPill = pill('camera');
const handPill = pill('hand');
const fpsPill = pill('gauge', 'pill-fps');

function renderStatus(st = vision.state()) {
  let cs = 'na';
  let ct = '카메라 꺼짐';
  if (st.synthetic) {
    cs = 'ok';
    ct = '가짜 손';
  } else if (st.camera === 'on') {
    if (st.tracker === 'running') {
      cs = 'ok';
      ct = '카메라 켜짐';
    } else if (st.tracker === 'error') {
      cs = 'bad';
      ct = '인식 오류';
    } else {
      cs = 'busy';
      ct = '준비 중';
    }
  } else if (st.camera === 'starting') {
    cs = 'busy';
    ct = '켜는 중';
  } else if (st.camera === 'error') {
    cs = 'bad';
    ct = '카메라 오류';
  }
  camPill.el.dataset.state = cs;
  setText(camPill.label, ct);
  camPill.el.title = st.cameraLabel ? `카메라: ${st.cameraLabel}` : '카메라';

  const live = st.active && (st.tracker === 'running' || st.synthetic);
  handPill.el.dataset.state = !live ? 'na' : st.hand ? 'ok' : 'busy';
  setText(handPill.label, !live ? '손 –' : st.hand ? '손 보임' : '손을 보여 주세요');

  const fps = live ? Math.round(st.fps || 0) : 0;
  fpsPill.el.dataset.state = !live ? 'na' : fps >= 20 ? 'ok' : fps >= 10 ? 'busy' : 'bad';
  setText(fpsPill.label, live ? `${fps} fps` : '– fps');
  fpsPill.el.title = st.delegate ? `처리 속도 (${st.delegate === 'GPU' ? '그래픽 카드' : st.delegate === 'CPU' ? 'CPU' : st.delegate})` : '처리 속도';
  fpsPill.el.hidden = !settings.get('showFps');
}
vision.onState(renderStatus);
setInterval(() => renderStatus(), 1000);
settings.subscribe(() => renderStatus());

// ───────── 화면 바꾸기 ─────────
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { id: BY_ID.has(id) ? id : 'home', params };
}

/** navigate('learn', { letter: 'demo-open' }) */
function navigate(id, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const hash = `#/${id}${q ? `?${q}` : ''}`;
  if (location.hash === hash) show(id, params);
  else location.hash = hash;
}

function back() {
  if (current && current.screen.id !== 'home') navigate('home');
}

async function show(id, params) {
  const screen = BY_ID.get(id) || home;
  const token = ++navToken;
  if (current) {
    try {
      if (current.screen.unmount) current.screen.unmount();
    } catch (err) {
      console.error(err);
    }
    if (current.cameraHeld) vision.release();
    speech.stop();
  }
  clear(screenHost);
  const root = h('section.screen', { 'aria-label': screen.title, dataset: { screen: screen.id } });
  if (screen.fit) root.classList.add('fit');
  screenHost.appendChild(root);
  current = { screen, root, params, cameraHeld: false };
  for (const [sid, item] of navItems) {
    if (sid === screen.id) item.a.setAttribute('aria-current', 'page');
    else item.a.removeAttribute('aria-current');
  }
  document.title = screen.id === 'home' ? 'Learn 수어' : `${screen.title} · Learn 수어`;
  try {
    await screen.mount(root, app, params || {});
  } catch (err) {
    console.error(`화면을 열지 못했어요: ${screen.id}`, err);
  }
  if (token !== navToken) return;
  if (screen.camera) {
    current.cameraHeld = true;
    vision.acquire();
  }
  renderStatus();
}

window.addEventListener('hashchange', () => {
  const { id, params } = parseHash();
  show(id, params);
});

// 손 인식 프레임은 지금 화면에만
vision.onFrame((frame) => {
  background.setHands(frame.hands); // 가상 배경이 손가락을 지키게 손 마디를 넘겨 줌
  if (current && current.screen.onFrame) current.screen.onFrame(frame);
});

// ───────── 키보드 ─────────
// ←/→ 이전/다음 글자, Space 다음/건너뛰기, H 힌트(읽어 주기), M 소리 끄기, R 다시, Esc 뒤로, F11 전체 화면, C 카메라
const typing = (el) => el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  if (document.querySelector('.modal-backdrop')) return;
  const inField = typing(e.target);
  if (inField && e.key !== 'Escape') return;
  // 단추에 초점이 있을 때 Space 는 그 단추를 누르는 것
  if (e.key === ' ' && e.target && e.target.tagName === 'BUTTON' && !e.target.closest('[data-space-ok]')) return;
  const scr = current && current.screen;
  if (scr && scr.onKey) {
    try {
      if (scr.onKey(e, app) === true) {
        e.preventDefault();
        return;
      }
    } catch (err) {
      console.error(err);
    }
  }
  // 한글 입력 상태여도 되도록 키 위치(code)로 확인
  if (e.code === 'KeyC') {
    if (vision.synthetic) toast('점검 중에는 카메라를 바꾸지 않아요', { tone: 'hint' });
    else if (vision.state().cameras.length < 2) toast('바꿀 수 있는 다른 카메라가 없어요', { tone: 'hint' });
    else vision.nextCamera().then(() => toast(`카메라: ${vision.state().cameraLabel}`));
    e.preventDefault();
  } else if (e.code === 'KeyD' && !inField) {
    // 진단 기록 켜기/끄기
    if (!diag.on) {
      diag.start();
      document.body.classList.add('diag-on');
      toast('진단 기록을 시작했어요. 다 하면 D 를 다시 눌러 주세요', { tone: 'hint' });
    } else {
      document.body.classList.remove('diag-on');
      diag.stop({ route: location.hash }).then((p) => toast(p ? `진단 기록을 저장했어요: ${p.split(/[\/]/).slice(-2).join('/')}` : '저장하지 못했어요', { tone: p ? 'ok' : 'error' }));
    }
    e.preventDefault();
  } else if (e.code === 'KeyM') {
    const on = !settings.get('voice');
    settings.set({ voice: on, sound: on });
    if (!on) speech.stop();
    toast(on ? '소리를 켰어요' : '소리를 껐어요', { tone: 'hint' });
    e.preventDefault();
  } else if (e.key === 'Escape') {
    if (inField) e.target.blur();
    else back();
    e.preventDefault();
  } else if (e.key === 'F11' && host && host.toggleFullscreen) {
    // 보통은 메인 프로세스가 F11 을 먼저 처리함
  }
});

// ───────── 시작 ─────────
const first = parseHash();
show(first.id, first.params);
refreshBadges();
if (host && host.log) host.log(`app started (selftest=${SELFTEST})`);

if (SELFTEST) {
  import('./test/selftest.js')
    .then((m) => m.run(app, { screens: SCREENS.filter(Boolean).map((s) => s.id) }))
    .catch((err) => {
      console.error('selftest crashed', err);
      if (host) host.done({ ok: false, error: String((err && err.stack) || err) });
    });
}
