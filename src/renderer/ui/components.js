// 작은 화면 부품들: 알림(토스트) · 대화상자 · 진행 고리 · 체크리스트 · 큰 안내 · 큰 글자 · 고르기 단추 · 스위치 · 통계
import { h, icon, setText, clear } from './dom.js';

// ───────── 알림 (토스트) ─────────
let toastHost = null;
/** toast('저장했어요', { tone: 'ok' | 'bad' | 'hint', ms }) */
export function toast(text, { tone = 'ok', ms = 2600 } = {}) {
  if (!toastHost) {
    toastHost = document.getElementById('toasts') || document.body.appendChild(h('div#toasts.toasts'));
  }
  const ic = tone === 'bad' ? 'alert' : tone === 'hint' ? 'bulb' : 'check';
  const el = h(`div.toast.${tone}`, { role: 'status' }, icon(ic), h('span', text));
  toastHost.appendChild(el);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, ms);
  return el;
}

// ───────── 대화상자 ─────────
/**
 * confirmDialog({ title, body, ok: '지우기', cancel: '취소', danger }) → Promise<boolean>
 */
export function confirmDialog({ title, body, ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close(false);
      }
    };
    const okBtn = h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, ok);
    const backdrop = h(
      'div.modal-backdrop',
      { onclick: (e) => e.target === backdrop && close(false) },
      h(
        'div.modal',
        { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
        h('h2#modal-title', title),
        h('div.modal-body', typeof body === 'string' ? h('p', body) : body),
        h('div.modal-actions', cancel ? h('button.btn.ghost', { type: 'button', onclick: () => close(false) }, cancel) : null, okBtn),
      ),
    );
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    okBtn.focus();
  });
}

// ───────── 진행 고리 ─────────
/** ring({ size, stroke, label }) → { el, set(progress 0..1, label?, ok?) } */
export function ring({ size = 64, stroke = 7, label = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  const mk = (cls) => {
    const e = document.createElementNS(NS, 'circle');
    e.setAttribute('class', cls);
    e.setAttribute('cx', size / 2);
    e.setAttribute('cy', size / 2);
    e.setAttribute('r', r);
    e.setAttribute('stroke-width', stroke);
    return e;
  };
  const track = mk('ring-track');
  const bar = mk('ring-bar');
  bar.setAttribute('stroke-dasharray', c.toFixed(2));
  bar.setAttribute('stroke-dashoffset', c.toFixed(2));
  svg.append(track, bar);
  const lab = h('span.ring-label', label);
  const el = h('div.ring', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, svg, lab);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  let lastP = -1;
  return {
    el,
    set(p, text, ok = false) {
      const v = Math.max(0, Math.min(1, Number(p) || 0));
      if (Math.abs(v - lastP) > 0.005) {
        bar.setAttribute('stroke-dashoffset', (c * (1 - v)).toFixed(2));
        el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
        lastP = v;
      }
      if (text !== undefined) setText(lab, text);
      el.classList.toggle('ok', !!ok);
    },
  };
}

/** 가로 막대: bar(0.4, 'ok') */
export function bar(value, tone = '') {
  const span = h('span');
  span.style.width = `${Math.round(Math.max(0, Math.min(1, value || 0)) * 100)}%`;
  return h(`div.bar${tone ? `.${tone}` : ''}`, { role: 'img', 'aria-label': `${Math.round((value || 0) * 100)}%` }, span);
}

// ───────── 체크리스트 ─────────
/** checklist() → { el, update(evaluation, letter) } — ✓/✗ 를 글자와 함께 */
export function checklist() {
  const el = h('ul.checklist', { 'aria-label': '확인할 점' });
  let key = '';
  let items = [];
  function build(checks) {
    clear(el);
    items = checks.map((c) => {
      const ic = h('span.check-icon');
      const lab = h('span', c.label || '');
      const li = h('li', h('div.check', { dataset: { state: 'na' } }, ic, lab));
      el.appendChild(li);
      return { box: li.firstChild, ic, lab, state: '' };
    });
  }
  return {
    el,
    /** checks: 글자 정의의 checks (판정 전) 또는 evaluation.checks */
    update(evaluation, letter) {
      const checks = evaluation && evaluation.checks && evaluation.checks.length ? evaluation.checks : (letter && letter.checks) || [];
      const k = checks.map((c) => c.id + (c.label || '')).join('|');
      if (k !== key) {
        key = k;
        build(checks);
      }
      const judged = !!(evaluation && evaluation.checks && evaluation.checks.length);
      checks.forEach((c, i) => {
        const it = items[i];
        if (!it) return;
        let state = 'na';
        if (judged) state = c.ok ? 'ok' : evaluation.worst && evaluation.worst.id === c.id ? 'worst' : 'bad';
        if (state === it.state) return;
        it.state = state;
        it.box.dataset.state = state;
        clear(it.ic);
        if (state === 'ok') it.ic.appendChild(icon('check'));
        else if (state === 'bad' || state === 'worst') it.ic.appendChild(icon('x'));
        else it.ic.appendChild(h('span', { 'aria-hidden': 'true' }, '·'));
        it.box.setAttribute('aria-label', `${c.label || ''}: ${state === 'ok' ? '맞아요' : state === 'na' ? '아직 몰라요' : '고쳐 주세요'}`);
      });
    },
  };
}

// ───────── 한 줄 큰 안내 ─────────
/** coach() → { el, set(tone, msg, sub, iconName) } tone: 'bad' | 'ok' | 'hint' | 'na' */
export function coach() {
  const ic = h('div.coach-icon');
  const msg = h('div.coach-msg');
  const sub = h('div.coach-sub');
  const el = h('div.coach', { role: 'status', 'aria-live': 'polite', dataset: { tone: 'na' } }, ic, h('div.coach-text', msg, sub));
  let lastIcon = '';
  return {
    el,
    set(tone, text, subText = '', iconName) {
      const name = iconName || (tone === 'ok' ? 'check' : tone === 'bad' ? 'x' : tone === 'hint' ? 'bulb' : 'hand');
      el.dataset.tone = tone;
      setText(msg, text);
      setText(sub, subText);
      sub.hidden = !subText;
      if (name !== lastIcon) {
        lastIcon = name;
        clear(ic).appendChild(icon(name));
      }
    },
  };
}

// ───────── 큰 지문자 글자 ─────────
/** 이모지(연습용 손 모양)인지 */
export const isEmojiGlyph = (s) => /\p{Extended_Pictographic}/u.test(String(s || ''));

export function glyph(letter, { size = 96 } = {}) {
  const ch = (letter && (letter.glyph || letter.jamo)) || '?';
  const el = h(
    'div.glyph',
    { 'aria-label': letter ? `${letter.name || ''} ${ch}` : '' },
    h('span.glyph-char', { 'aria-hidden': 'true' }, ch),
  );
  if (isEmojiGlyph(ch) || (letter && letter.kind === 'demo')) el.classList.add('demo');
  el.style.setProperty('--glyph-size', `${size}px`);
  return el;
}

// ───────── 입력 부품 ─────────
/** segmented({ label, options: [[value, text]], value, onchange }) */
export function segmented({ label, options, value, onchange }) {
  const group = h('div.segmented', { role: 'radiogroup', 'aria-label': label });
  const buttons = options.map(([v, text]) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(v === value),
        tabindex: v === value ? '0' : '-1',
        onclick: () => choose(v, true),
      },
      text,
    ),
  );
  function choose(v, fire) {
    buttons.forEach((b, i) => {
      const on = options[i][0] === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && fire) b.focus();
    });
    if (fire && onchange) onchange(v);
  }
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    choose(options[(i + d + options.length) % options.length][0], true);
  });
  group.append(...buttons);
  return group;
}

/** toggle({ label, checked, onchange }) 켜기/끄기 스위치 */
export function toggle({ label, checked, onchange, id }) {
  const state = h('span.switch-state', checked ? '켜짐' : '꺼짐');
  const el = h(
    'button.switch',
    { type: 'button', role: 'switch', id, 'aria-checked': String(!!checked), 'aria-label': label },
    h('span.switch-track'),
    state,
  );
  el.addEventListener('click', () => {
    const v = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(v));
    setText(state, v ? '켜짐' : '꺼짐');
    if (onchange) onchange(v);
  });
  return el;
}

/** stat({ icon, label, value, unit, note }) 통계 타일 */
export function stat({ icon: ic, label, value, unit, note }) {
  return h(
    'div.stat',
    h('div.stat-label', ic ? icon(ic) : null, label),
    h('div.stat-value', String(value), unit ? h('small', unit) : null),
    note ? h('div.stat-note', note) : null,
  );
}

/** 빈 상태 상자 */
export function empty(ic, title, text) {
  return h('div.empty', icon(ic), h('strong', title), text ? h('p', text) : null);
}

/** 안내 상자 */
export function callout(text, { tone = '', ic = 'info' } = {}) {
  return h(`div.callout${tone ? `.${tone}` : ''}`, icon(ic), h('div', text));
}
