// 카메라 판: 거울처럼 보이는 영상 + 손 뼈대(손가락마다 초록 / 빨강 / 회색) + 버티기 고리 + 안내
// - 영상(<video>)만 CSS 로 좌우 반전하고, 그림은 좌표를 뒤집어 그림 (글자가 거꾸로 되지 않게)
// - 카메라가 준비 중 · 오류 · 손이 안 보일 때 알기 쉬운 안내를 영상 위에 띄움
import { h, icon, setText, clear } from './dom.js';
import { ring } from './components.js';
import { drawLive, fitCanvas } from './hand-draw.js';

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
  const stage = h('div.camera-stage', vision.synthetic ? null : vision.video, canvas, tagEl, ringEl, hintEl, celebrateHost);
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
      offState();
      if (vision.video.parentNode === stage) stage.removeChild(vision.video);
    },
  };
}
