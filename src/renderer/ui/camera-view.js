// 카메라 판: 거울처럼 보이는 영상 + 손 뼈대(손가락마다 초록 / 빨강 / 회색) + 버티기 고리 + 안내
// - 영상(<video>)만 CSS 로 좌우 반전하고, 그림은 좌표를 뒤집어 그림 (글자가 거꾸로 되지 않게)
// - 카메라가 준비 중 · 오류 · 손이 안 보일 때 알기 쉬운 안내를 영상 위에 띄움
import { h, icon, setText, clear } from './dom.js';
import { ring } from './components.js';
import { drawLive, fitCanvas } from './hand-draw.js';
import { BG_MODES } from '../core/background.js';

/**
 * @param {object} app 앱 공용 도구 (vision, settings ...)
 * @param {{ showRing?: boolean, tag?: string }} [o]
 * @returns {{ el, render(result), celebrate(title, sub), hint(text, iconName), destroy() }}
 */
export function createCameraView(app, { showRing = true, tag = '' } = {}) {
  const { vision } = app;
  const canvas = h('canvas.camera-overlay', { 'aria-hidden': 'true' });
  const tagText = h('span');
  const tagEl = h('div.camera-tag', h('span.dot'), tagText);
  const hold = ring({ size: 72, stroke: 7, label: '' });
  const ringEl = h('div.camera-ring', { title: '버티기' }, hold.el);
  ringEl.hidden = !showRing;
  const notice = h('div.camera-notice');
  const hintEl = h('div.camera-hint', { role: 'status' });
  hintEl.hidden = true;
  const celebrateHost = h('div.celebrate-host');
  // 가상 배경: 합성한 그림을 영상 위에 덮음 (손 인식은 원래 영상 그대로)
  const bg = app.background || null;
  const bgCanvas = h('canvas.camera-bg', { 'aria-hidden': 'true' });
  const offBg = bg ? bg.mount(bgCanvas) : () => {};
  const picker = bg ? createBgPicker(app) : null;
  const stage = h('div.camera-stage', vision.synthetic ? null : vision.video, bgCanvas, canvas, tagEl, ringEl, hintEl, picker ? picker.el : null, celebrateHost);
  if (vision.synthetic) stage.classList.add('synthetic');
  const el = h('div.camera-panel', { role: 'img', 'aria-label': '카메라 화면 (거울처럼 보여요)' }, stage, notice);

  let aspect = 16 / 9;
  let lastResult = null;
  let noticeKey = null; // 처음 한 번은 꼭 그리게

  // 판 크기에 맞춰 영상 비율 그대로 가장 크게
  function layout() {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = 0;
    let w = r.width - pad;
    let hh = w / aspect;
    if (hh > r.height - pad) {
      hh = r.height - pad;
      w = hh * aspect;
    }
    stage.style.width = `${Math.floor(w)}px`;
    stage.style.height = `${Math.floor(hh)}px`;
    draw();
  }
  const ro = new ResizeObserver(layout);
  ro.observe(el);

  function draw() {
    const { ctx, width, height } = fitCanvas(canvas);
    const r = lastResult;
    if (r && r.hand) {
      // 영상과 판의 비율이 같고 object-fit: fill 이라서 fit 도 'fill'
      drawLive(ctx, r.hand, r.evaluation, { width, height, videoW: Math.round(aspect * 720), videoH: 720, fit: 'fill', mirror: true });
    }
  }

  function updateNotice(st) {
    let key = '';
    let box = null;
    if (st.camera === 'error' && st.cameraError) {
      key = `err:${st.cameraError.kind}:${st.cameras.length}`;
      const sel = st.cameras.length > 1
        ? h(
            'select.select',
            {
              'aria-label': '카메라 고르기',
              onchange: (e) => vision.selectCamera(e.target.value),
            },
            st.cameras.map((c, i) => h('option', { value: c.deviceId }, c.label || `카메라 ${i + 1}`)),
          )
        : null;
      box = h(
        'div.camera-notice-box',
        icon('cameraOff', 'big'),
        h('h3', st.cameraError.title),
        h('p', st.cameraError.text),
        sel,
        h('button.btn.primary', { type: 'button', onclick: () => vision.retry() }, icon('refresh'), h('span', '다시 시도')),
      );
    } else if (st.camera === 'starting' || st.camera === 'off') {
      key = 'starting';
      box = h('div.camera-notice-box', h('div.spinner'), h('h3', '카메라를 켜고 있어요'), h('p', '잠시만 기다려 주세요.'));
    } else if (st.tracker === 'loading' || st.tracker === 'warming' || st.tracker === 'idle') {
      key = 'loading';
      box = h(
        'div.camera-notice-box',
        h('div.spinner'),
        h('h3', '손 인식을 준비하고 있어요'),
        h('p', '처음 한 번은 몇 초 걸릴 수 있어요.'),
      );
    } else if (st.tracker === 'error') {
      key = 'tracker-error';
      box = h(
        'div.camera-notice-box',
        icon('alert', 'big'),
        h('h3', '손 인식을 시작하지 못했어요'),
        h('p', '프로그램을 다시 켜 주세요. 계속 안 되면 도움말을 봐 주세요.'),
      );
    }
    if (key === noticeKey) return;
    noticeKey = key;
    clear(notice);
    notice.hidden = !box;
    if (box) notice.appendChild(box);
  }

  function updateTag(st) {
    const live = st.camera === 'on' || st.camera === 'synthetic';
    tagEl.classList.toggle('live', live);
    setText(tagText, tag || (st.synthetic ? '가짜 손 · 점검용' : st.cameraLabel ? '내 모습 (거울)' : '카메라'));
  }

  const offState = vision.onState((st) => {
    updateNotice(st);
    updateTag(st);
  });
  const st0 = vision.state();
  updateNotice(st0);
  updateTag(st0);

  let celebrateTimer = 0;

  return {
    el,
    /** 판정 결과(judge.update 의 결과)를 받아 그림 */
    render(result, frame) {
      if (frame && frame.videoW && frame.videoH) {
        const a = frame.videoW / frame.videoH;
        if (Math.abs(a - aspect) > 0.01) {
          aspect = a;
          layout();
        }
      }
      lastResult = result;
      draw();
      if (showRing) {
        const p = result && result.hold ? result.hold.progress : 0;
        const ok = !!(result && result.success);
        hold.set(ok ? 1 : p, ok ? '✓' : p > 0 ? `${Math.round(p * 100)}` : '', ok);
      }
    },
    /** 영상 아래쪽 작은 안내 (null 이면 숨김) */
    hint(text, iconName = 'hand') {
      if (!text) {
        hintEl.hidden = true;
        return;
      }
      if (hintEl.dataset.text !== text) {
        hintEl.dataset.text = text;
        clear(hintEl).append(icon(iconName), h('span', text));
      }
      hintEl.hidden = false;
    },
    /** 성공 축하 (ms 뒤에 저절로 사라짐) */
    celebrate(title, sub = '', ms = 1400) {
      clearTimeout(celebrateTimer);
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const confetti = h('div.confetti', { 'aria-hidden': 'true' });
      if (!reduce) {
        const colors = ['#5fe0cf', '#ffd166', '#ff8a7a', '#9be37a', '#ffffff', '#7fb7ff'];
        for (let i = 0; i < 26; i++) {
          const piece = h('i');
          piece.style.left = `${4 + Math.random() * 92}%`;
          piece.style.background = colors[i % colors.length];
          piece.style.animationDelay = `${Math.random() * 250}ms`;
          piece.style.setProperty('--fall', `${280 + Math.random() * 260}px`);
          piece.style.setProperty('--spin', `${(Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 360)}deg`);
          confetti.appendChild(piece);
        }
      }
      const box = h(
        'div.celebrate',
        { role: 'status' },
        confetti,
        h('div.celebrate-box', h('div.celebrate-check', icon('check')), h('div.celebrate-title', title), sub ? h('div.celebrate-sub', sub) : null),
      );
      clear(celebrateHost).appendChild(box);
      celebrateTimer = setTimeout(() => clear(celebrateHost), ms);
    },
    clearCelebrate() {
      clearTimeout(celebrateTimer);
      clear(celebrateHost);
    },
    destroy() {
      clearTimeout(celebrateTimer);
      ro.disconnect();
      offBg();
      if (picker) picker.destroy();
      offState();
      if (vision.video.parentNode === stage) stage.removeChild(vision.video);
    },
  };
}

// 카메라 판 오른쪽 아래의 작은 "배경" 버튼 + 고르기 메뉴
function createBgPicker(app) {
  const { settings, background } = app;
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  const label = h('span');
  const button = h('button.camera-bg-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: '카메라 배경 바꾸기' }, icon('image'), label);
  const menu = h('div.camera-bg-menu', { role: 'menu', 'aria-label': '카메라 배경' });
  menu.hidden = true;
  const el = h('div.camera-bg-pick', button, menu, fileInput);

  const choose = (v) => {
    if (v === 'photo' && !background.hasPhoto()) {
      fileInput.click();
      return;
    }
    settings.set('bg', v);
    close();
  };
  function render() {
    const cur = background.mode();
    setText(label, `배경: ${(BG_MODES.find(([v]) => v === cur) || BG_MODES[0])[1]}`);
    clear(menu).append(
      ...BG_MODES.map(([v, text]) =>
        h(
          'button.camera-bg-item',
          { type: 'button', role: 'menuitemradio', 'aria-checked': String(v === cur), onclick: () => choose(v) },
          h('span.camera-bg-check', v === cur ? '✓' : ''),
          h('span', v === 'photo' && !background.hasPhoto() ? '내 사진 고르기…' : text),
        ),
      ),
      h('button.camera-bg-item.more', { type: 'button', role: 'menuitem', onclick: () => { close(); app.navigate('settings', { focus: 'background' }); } }, h('span.camera-bg-check'), h('span', '자세히 설정…')),
    );
  }
  function open() {
    render();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (first) first.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }
  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  }
  const outside = (e) => {
    if (!el.contains(e.target)) close();
  };
  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      close();
      button.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else return;
    e.preventDefault();
    e.stopPropagation(); // 화살표가 글자 넘기기로 가지 않게
  });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      await background.savePhoto(f);
      settings.set('bg', 'photo');
      app.toast('내 사진을 배경으로 했어요');
    } catch (err) {
      app.toast(`사진을 쓰지 못했어요: ${err.message}`, { tone: 'bad' });
    }
    close();
    render();
  });
  const off = settings.subscribe((_s, changed) => {
    if (changed.some((k) => k.startsWith('bg'))) render();
  });
  render();
  return {
    el,
    destroy() {
      close();
      off();
    },
  };
}
