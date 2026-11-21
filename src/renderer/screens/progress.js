// 내 기록: 글자별 정확도 · 다 익힌 글자 · 연습한 날 · 약한 글자
import { h, icon, btn, pct } from '../ui/dom.js';
import { stat, bar, confirmDialog, empty } from '../ui/components.js';
import { units, lettersOfUnit, allLetters, nameOf, glyphOf } from '../core/content.js';

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calendar(days) {
  const set = new Set(days);
  const cells = [];
  const now = new Date();
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const on = set.has(dayKey(d));
    cells.push(
      h(`span.cal-day${on ? '.on' : ''}${i === 0 ? '.today' : ''}`, { title: `${d.getMonth() + 1}월 ${d.getDate()}일${on ? ' · 연습함' : ''}` }, on ? icon('check') : String(d.getDate())),
    );
  }
  return h('div.cal', { role: 'img', 'aria-label': `최근 4주 동안 ${cells.filter((c) => c.classList.contains('on')).length}일 연습했어요` }, cells);
}

export default {
  id: 'progress',
  title: '내 기록',
  nav: '내 기록',
  icon: 'progress',
  mount(root, app) {
    const p = app.progress;
    const ids = allLetters().map((l) => l.id);
    const tot = p.totals();
    const weak = p.weakest(ids, 6);
    const mastered = p.mastered(ids).length;

    const head = h(
      'div.page-head',
      h('div', h('h1', '내 기록'), h('p.lead', '꾸준히 하면 손이 먼저 기억해요. 기록은 이 컴퓨터에만 저장돼요.')),
      h(
        'div.page-head-actions',
        btn('기록 지우기', {
          icon: 'trash',
          kind: 'danger',
          size: 'sm',
          onclick: async () => {
            const ok = await confirmDialog({ title: '기록을 모두 지울까요?', body: '글자별 정확도, 연습한 날, 복습 일정이 모두 지워져요. 되돌릴 수 없어요.', ok: '지우기', danger: true });
            if (ok) {
              p.reset();
              app.toast('기록을 지웠어요');
              app.navigate('progress');
            }
          },
        }),
      ),
    );

    const stats = h(
      'div.grid.cols-4',
      stat({ icon: 'star', label: '다 익힌 글자', value: mastered, unit: `/ ${ids.length}` }),
      stat({ icon: 'check', label: '정확도', value: Number.isFinite(tot.accuracy) ? Math.round(tot.accuracy * 100) : '–', unit: '%', note: `모두 ${tot.attempts}번 해 봤어요` }),
      stat({ icon: 'flame', label: '이어서 연습한 날', value: p.streak(), unit: '일' }),
      stat({ icon: 'calendar', label: '연습한 날', value: tot.days, unit: '일' }),
    );

    const weakBox = h(
      'div.card',
      h('div.card-head', h('div.card-icon.coral', icon('practice')), h('div', h('div.card-title', '약한 글자'), h('div.card-sub', '자주 틀린 글자부터 다시 해 봐요'))),
      weak.length
        ? h(
            'ul.weak-list',
            weak.map((s) => {
              const l = allLetters().find((x) => x.id === s.id);
              return h('li', h('span.weak-glyph', glyphOf(l)), h('span.weak-name', nameOf(l)), bar(s.accuracy, 'bad'), h('span.num.weak-pct', pct(s.accuracy)));
            }),
          )
        : h('p.muted', '아직 약한 글자가 없어요. 잘하고 있어요!'),
      weak.length ? h('div.card-foot', h('span'), btn('약한 글자 연습', { icon: 'arrowRight', kind: 'primary', onclick: () => app.navigate('practice', { mode: 'weak' }) })) : null,
    );

    const calBox = h(
      'div.card',
      h('div.card-head', h('div.card-icon.warm', icon('calendar')), h('div', h('div.card-title', '최근 4주'), h('div.card-sub', '연습한 날에 ✓ 표시가 있어요'))),
      calendar(p.days),
    );

    const unitBlocks = units().map((u) =>
      h(
        'section.section',
        h('h2.section-title', icon('learn'), u.name),
        h(
          'div.letter-grid',
          lettersOfUnit(u.id).map((l) => {
            const s = p.stat(l.id);
            const state = s.mastered ? 'mastered' : s.attempts ? 'learning' : 'new';
            const label = s.mastered ? '다 익힘' : s.attempts ? '연습 중' : '아직';
            return h(
              `button.letter-tile.${state}`,
              { type: 'button', onclick: () => app.navigate('learn', { letter: l.id }), 'aria-label': `${nameOf(l)}: ${label}, 정확도 ${pct(s.accuracy)}` },
              h('span.letter-tile-glyph', glyphOf(l)),
              h('span.letter-tile-name', nameOf(l)),
              h('span.letter-tile-state', s.mastered ? icon('star') : null, label),
              s.attempts ? bar(s.accuracy, s.accuracy >= 0.8 ? 'ok' : 'hint') : h('div.bar'),
              h('span.letter-tile-meta.num', s.attempts ? `${pct(s.accuracy)} · ${s.attempts}번` : '–'),
            );
          }),
        ),
      ),
    );

    root.append(
      h(
        'div.page',
        head,
        stats,
        h('div.grid.cols-2.section', weakBox, calBox),
        tot.attempts ? null : h('div.section', empty('progress', '아직 기록이 없어요', '배우기나 연습을 하면 여기에 기록이 쌓여요.')),
        unitBlocks,
      ),
    );
  },
};
