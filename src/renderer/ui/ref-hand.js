// 참고 손 그림: 글자의 손 모양(HandPose)을 거울에 비친 내 손처럼 그림. 크기가 바뀌면 다시 그림
import { h } from './dom.js';
import { drawReference, fitCanvas, handRenderReady } from './hand-draw.js';

/**
 * @param {object|null} pose HandPose
 * @param {{ tag?: string, label?: string, side?: 'right'|'left' }} [o]
 */
export function createRefHand(pose, { tag = '거울에 비친 내 손', label = '참고 손 모양 그림', side = 'right' } = {}) {
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const tagEl = tag ? h('span.ref-hand-tag', tag) : null;
  const el = h('div.ref-hand', { role: 'img', 'aria-label': label }, canvas, tagEl);
  let current = pose;
  let currentSide = side;

  function draw() {
    if (!el.isConnected) return;
    const { ctx, width, height } = fitCanvas(canvas);
    if (!current || width < 4 || height < 4) return;
    const dark = document.documentElement.matches('[data-theme="dark"]')
      || (!document.documentElement.matches('[data-theme="light"]') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    try {
      drawReference(ctx, current, { width, height, side: currentSide, fit: true, zoom: 0.86, theme: dark ? 'dark' : 'light' });
    } catch (err) {
      console.error('참고 손을 그리지 못했어요', err);
    }
  }
  const ro = new ResizeObserver(() => draw());
  ro.observe(el);
  handRenderReady.then(() => requestAnimationFrame(draw));

  return {
    el,
    setPose(p, s = currentSide) {
      current = p;
      currentSide = s;
      draw();
    },
    redraw: draw,
    destroy() {
      ro.disconnect();
    },
  };
}
