// 처음 화면: 이어서 하기 · 단원별 진도 · 오늘 복습할 글자 · 카메라 상태
import { h, icon, btn } from '../ui/dom.js';
import { bar, stat, callout } from '../ui/components.js';
import { units, lettersOfUnit, getLetter, getUnit, allLetters, nameOf, glyphOf, isDemo, UNIT_KIND_KO } from '../core/content.js';

let offState = null;

function greeting() {
  const hr = new Date().getHours();
  if (hr < 11) return '좋은 아침이에요';
  if (hr < 17) return '반가워요';
  return '오늘도 수고 많으셨어요';
}

function cameraCard(app) {
  const text = h('div.card-sub');
  const title = h('div.card-title');
  const ic = h('div.card-icon');
  const card = h('div.card.tight.home-cam', h('div.card-head', ic, h('div', title, text)));
  const render = (st) => {
    ic.replaceChildren(icon(st.camera === 'error' ? 'cameraOff' : 'camera'));
    ic.className = `card-icon${st.camera === 'error' ? ' coral' : ''}`;
    if (st.synthetic) {
      title.textContent = '점검용 가짜 손을 쓰고 있어요';
      text.textContent = '자동 점검 중에는 진짜 카메라를 켜지 않아요.';
    } else if (st.camera === 'error' && st.cameraError) {
      title.textContent = st.cameraError.title;
      text.textContent = st.cameraError.text;
    } else if (st.camera === 'on') {
      title.textContent = '카메라가 켜져 있어요';
      text.textContent = st.cameraLabel || '';
    } else {
      title.textContent = '카메라는 배우기를 시작하면 켜져요';
      text.textContent = '50~80cm 떨어져 앉고, 밝은 곳에서 해 주세요.';
    }
  };
  render(app.vision.state());
  offState = app.vision.onState(render);
  return card;
}

export default {
  id: 'home',
  title: '처음 화면',
  nav: '처음',
  icon: 'home',
  mount(root, app) {
    const p = app.progress;
    const all = allLetters();
    const ids = all.map((l) => l.id);
    const last = p.last && p.last.letter ? getLetter(p.last.letter) : null;
    const due = p.due(ids);
    const mastered = p.mastered(ids).length;
    const tot = p.totals();
    const realCount = all.filter((l) => !isDemo(l)).length;

    // 이어서 하기 (가장 큰 카드)
    const contLetter = last || (units()[0] ? lettersOfUnit(units()[0].id)[0] : null);
    const contUnit = contLetter ? getUnit(contLetter.unit) : null;
    const hero = h(
      'div.card.home-hero',
      h(
        'div.home-hero-text',
        h('div.home-hello', greeting()),
        h('h1', last ? '지난번에 하던 곳부터 이어서 해요' : '손말 첫걸음에 오신 것을 환영해요'),
        h(
          'p.lead',
          last
            ? `${contUnit ? contUnit.name : ''} · ${nameOf(contLetter)}`
            : '카메라가 손 모양을 보고, 어느 손가락을 고치면 되는지 하나씩 알려 드려요.',
        ),
        h(
          'div.row',
          contLetter
            ? btn(last ? '이어서 하기' : '첫 글자 배우기', {
                icon: 'play',
                kind: 'primary',
                size: 'lg',
                onclick: () => app.navigate('learn', { letter: contLetter.id }),
              })
            : null,
          btn('처음 쓰는 방법', { icon: 'help', kind: 'ghost', size: 'lg', onclick: () => app.navigate('help') }),
        ),
      ),
      contLetter ? h('div.home-hero-glyph', { 'aria-hidden': 'true' }, h('span', glyphOf(contLetter))) : null,
    );

    const stats = h(
      'div.grid.cols-4.home-stats',
      stat({ icon: 'clock', label: '오늘 복습', value: due.length, unit: '글자', note: due.length ? '연습에서 복습해요' : '복습할 글자가 없어요' }),
      stat({ icon: 'star', label: '다 익힌 글자', value: mastered, unit: `/ ${all.length}` }),
      stat({ icon: 'flame', label: '이어서 연습한 날', value: p.streak(), unit: '일' }),
      stat({ icon: 'calendar', label: '연습한 날', value: tot.days, unit: '일' }),
    );

    const unitCards = units().map((u) => {
      const ls = lettersOfUnit(u.id);
      const done = ls.filter((l) => p.stat(l.id).success > 0).length;
      const m = ls.filter((l) => p.stat(l.id).mastered).length;
      const preview = ls.slice(0, 8).map((l) => h('span.home-unit-chip', { title: nameOf(l) }, glyphOf(l)));
      return h(
        'button.card.interactive.home-unit',
        { type: 'button', onclick: () => app.navigate('learn', { unit: u.id }), 'aria-label': `${u.name} 단원 배우기, ${ls.length}글자 중 ${done}글자 해 봄` },
        h(
          'div.card-head',
          h('div', h('div.card-title', u.name), h('div.card-sub', `${UNIT_KIND_KO[u.kind] || '단원'} · ${ls.length}글자`)),
          h('span.spacer'),
          m === ls.length && ls.length ? h('span.badge.ok', icon('star'), '완료') : done ? h('span.badge.primary', `${done}/${ls.length}`) : h('span.badge', '새 단원'),
        ),
        h('div.home-unit-preview', preview),
        u.desc ? h('p.card-sub.home-unit-desc', u.desc) : null,
        h('div.card-foot', bar(ls.length ? done / ls.length : 0, m === ls.length ? 'ok' : ''), h('span.home-unit-go', icon('arrowRight'))),
      );
    });

    const quick = h(
      'div.grid.cols-3.home-quick',
      quickCard(app, 'practice', 'practice', '연습', due.length ? `복습할 글자 ${due.length}개` : '골고루 · 약한 글자 위주로'),
      quickCard(app, 'words', 'words', '낱말 쓰기', '이름 · 인사 · 가족 낱말을 손으로'),
      quickCard(app, 'translate', 'translate', '번역', '지문자 · 내가 등록한 수어 단어 ↔ 글'),
      quickCard(app, 'quiz', 'quiz', '퀴즈', '그림 보고 맞히기 · 손으로 답하기'),
    );

    root.append(
      h(
        'div.page.home',
        hero,
        realCount === 0
          ? callout('지금은 카메라와 판정을 확인하는 연습용 손 모양만 들어 있어요. 한국수어 지문자 · 지숫자는 곧 추가돼요.', { tone: 'warm', ic: 'info' })
          : null,
        stats,
        h('div.home-cols', h('section.section', h('h2.section-title', icon('learn'), '단원'), h('div.grid.cols-2', unitCards)), h('section.section.home-side', h('h2.section-title', icon('sparkles'), '다른 연습'), quick, cameraCard(app))),
      ),
    );
  },
  unmount() {
    if (offState) offState();
    offState = null;
  },
};

function quickCard(app, id, ic, title, sub) {
  return h(
    'button.card.interactive.tight.home-quick-card',
    { type: 'button', onclick: () => app.navigate(id) },
    h('div.card-icon', icon(ic)),
    h('div', h('div.card-title', title), h('div.card-sub', sub)),
  );
}
