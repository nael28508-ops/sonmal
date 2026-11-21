// 선생님 손 등록: 농인 강사 · 선생님이 글자마다 3초씩 손 모양을 보여 주면 본(템플릿)으로 저장
// - 본이 있는 글자는 판정이 그 선생님 손을 따라감 (규칙과 조금 달라도 선생님 손과 같으면 통과)
// - JSON 파일로 내보내기 · 가져오기 → 교실의 다른 컴퓨터에서도 같은 본을 씀
import { h, icon, btn, clear, setText } from '../ui/dom.js';
import { callout, confirmDialog, toast } from '../ui/components.js';
import { createCameraView } from '../ui/camera-view.js';
import { createJudge } from '../core/judge.js';
import { templates } from '../core/templates.js';
import { units, lettersOfUnit, getLetter, nameOf, glyphOf } from '../core/content.js';

const COUNTDOWN_MS = 3000;
const RECORD_MS = 3000;
const MIN_SAMPLES = 8;
const MAX_SAMPLES = 40;

let app, root, cam, judge;
let els = {};
let selected = null;
let rec = null; // { phase: 'count'|'rec', t0, samples: [] }
let tickId = 0;

function tileFor(l) {
  const n = templates.count(l.id);
  return h(
    `button.teacher-tile${selected && selected.id === l.id ? '.selected' : ''}${n ? '.has' : ''}`,
    { type: 'button', 'aria-pressed': String(!!(selected && selected.id === l.id)), onclick: () => select(l), 'aria-label': `${nameOf(l)}${n ? `, 본 ${n}개 있음` : ''}` },
    h('span.teacher-tile-glyph', glyphOf(l)),
    h('span.teacher-tile-name', nameOf(l)),
    n ? h('span.teacher-tile-count', icon('check'), `${n}`) : h('span.teacher-tile-count.none', '없음'),
  );
}

function renderList() {
  clear(els.list).append(
    ...units().map((u) => h('div.teacher-unit', h('div.teacher-unit-name', u.name), h('div.teacher-tiles', lettersOfUnit(u.id).map(tileFor)))),
  );
  setText(els.summary, templates.size ? `본 ${templates.size}개 · 글자 ${templates.letters().length}개` : '아직 등록한 손이 없어요');
}

function select(l) {
  if (rec) return;
  selected = l;
  judge.reset();
  renderList();
  renderSelected();
}

function renderSelected() {
  if (!selected) return;
  setText(els.selName, `${glyphOf(selected)} ${nameOf(selected)}`);
  const n = templates.count(selected.id);
  setText(els.selInfo, n ? `등록한 본 ${n}개 · 다시 녹화하면 바뀌어요` : '아직 등록하지 않았어요');
  els.delBtn.disabled = !n;
}

function startRecording() {
  if (!selected || rec) return;
  rec = { phase: 'count', t0: performance.now(), samples: [] };
  els.recBtn.disabled = true;
  app.sound.play('start');
}

function tick() {
  if (!rec) {
    cam.hint(null);
    return;
  }
  const t = performance.now() - rec.t0;
  if (rec.phase === 'count') {
    const left = Math.ceil((COUNTDOWN_MS - t) / 1000);
    cam.hint(`${left}초 뒤에 녹화해요. 손 모양을 만들어 주세요`, 'clock');
    setText(els.recState, `준비… ${left}`);
    if (t >= COUNTDOWN_MS) {
      rec.phase = 'rec';
      rec.t0 = performance.now();
      app.sound.play('tick');
    }
  } else {
    const left = Math.max(0, (RECORD_MS - t) / 1000);
    cam.hint(`녹화 중… ${left.toFixed(1)}초 · 그대로 있어 주세요`, 'record');
    setText(els.recState, `녹화 중 · ${rec.samples.length}개`);
    els.recBar.style.width = `${Math.min(100, (t / RECORD_MS) * 100)}%`;
    if (t >= RECORD_MS) finishRecording();
  }
}

function finishRecording() {
  const samples = rec.samples;
  rec = null;
  els.recBtn.disabled = false;
  els.recBar.style.width = '0%';
  cam.hint(null);
  if (samples.length < MIN_SAMPLES) {
    setText(els.recState, '손이 잘 안 보였어요. 다시 해 주세요');
    toast('손이 잘 보이지 않아 저장하지 않았어요', { tone: 'bad' });
    app.sound.play('fail');
    return;
  }
  // 고르게 솎아서 저장
  const step = Math.max(1, Math.floor(samples.length / MAX_SAMPLES));
  const kept = samples.filter((_, i) => i % step === 0).slice(0, MAX_SAMPLES);
  templates.replace(selected.id, kept);
  setText(els.recState, `저장했어요 (${kept.length}개)`);
  toast(`“${nameOf(selected)}” 선생님 손을 저장했어요`);
  app.sound.play('success');
  renderList();
  renderSelected();
}

function exportFile() {
  if (!templates.size) {
    toast('내보낼 본이 없어요', { tone: 'hint' });
    return;
  }
  const json = JSON.stringify(templates.exportJSON(), null, 1);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const name = `sonmal-teacher-${(templates.teacher || 'hand').replace(/[^\p{L}\p{N}_-]+/gu, '_')}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  const a = h('a', { href: url, download: name });
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
      const n = templates.importJSON(String(reader.result), { merge: true });
      toast(`본 ${n}개를 가져왔어요`);
      els.name.value = templates.teacher;
      renderList();
      renderSelected();
    } catch (err) {
      toast(err && err.message ? err.message : '파일을 읽지 못했어요', { tone: 'bad', ms: 4000 });
    }
  };
  reader.readAsText(file);
}

export default {
  id: 'teacher',
  title: '선생님 손 등록',
  nav: '선생님 손',
  icon: 'teacher',
  camera: true,
  fit: true,
  mount(r, a, params) {
    app = a;
    root = r;
    els = {};
    rec = null;
    judge = createJudge({ getSettings: () => app.settings.get() });
    selected = (params.letter && getLetter(params.letter)) || (units()[0] ? lettersOfUnit(units()[0].id)[0] : null);
    cam = createCameraView(app, { showRing: false });
    els.list = h('div.teacher-list');
    els.summary = h('span.muted');
    els.name = h('input.input', {
      type: 'text',
      value: templates.teacher,
      placeholder: '예: 김지민 선생님',
      maxLength: 40,
      'aria-label': '선생님 이름',
      onchange: (e) => templates.setTeacher(e.target.value),
    });
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { importFile(e.target.files[0]); e.target.value = ''; } });
    els.selName = h('div.teacher-sel-name');
    els.selInfo = h('div.muted');
    els.recState = h('div.teacher-rec-state', { role: 'status' }, '“3초 녹화”를 누르면 3초 뒤에 녹화해요');
    els.recBar = h('span');
    els.recBtn = btn('3초 녹화', { icon: 'record', kind: 'primary', size: 'lg', onclick: startRecording });
    els.delBtn = btn('이 글자 본 지우기', {
      icon: 'trash',
      kind: 'ghost',
      size: 'sm',
      onclick: () => {
        templates.remove(selected.id);
        renderList();
        renderSelected();
      },
    });
    const left = h(
      'aside.teacher-left',
      h('div', h('h1.teacher-title', '선생님 손 등록'), h('p.muted', '농인 강사님이나 선생님의 손을 글자마다 3초씩 등록하면, 판정이 그 손을 따라가요.')),
      h('div.card.tight.teacher-who', h('label.field', h('span.field-label', '선생님 이름'), els.name)),
      h('div.card.tight.teacher-pick', h('div.row.between', h('strong', '글자 고르기'), els.summary), els.list),
      h(
        'div.row.teacher-files',
        btn('파일로 내보내기', { icon: 'download', kind: 'soft', onclick: exportFile }),
        btn('파일 가져오기', { icon: 'upload', kind: 'soft', onclick: () => fileInput.click() }),
        btn('모두 지우기', {
          icon: 'trash',
          kind: 'danger',
          onclick: async () => {
            if (!templates.size) return;
            if (await confirmDialog({ title: '선생님 손을 모두 지울까요?', body: '이 컴퓨터에 등록한 본이 모두 지워져요. 내보낸 파일은 그대로 있어요.', ok: '모두 지우기', danger: true })) {
              templates.clear();
              renderList();
              renderSelected();
            }
          },
        }),
        fileInput,
      ),
    );
    const right = h(
      'div.teacher-right',
      cam.el,
      h(
        'div.card.teacher-rec',
        h('div.teacher-rec-head', h('div', els.selName, els.selInfo), h('span.spacer'), els.delBtn),
        h('div.bar', els.recBar),
        h('div.row.between', els.recState, els.recBtn),
      ),
      callout('손이 화면 가운데에 크게 보이게 하고, 손목까지 나오게 해 주세요. 판정에 쓰는 숫자만 저장하고 영상은 저장하지 않아요.', { tone: 'plain', ic: 'info' }),
    );
    root.append(h('div.work.teacher', left, right));
    renderList();
    renderSelected();
    tickId = setInterval(tick, 100);
  },
  unmount() {
    clearInterval(tickId);
    rec = null;
    if (cam) cam.destroy();
    cam = null;
  },
  onFrame(frame) {
    if (!cam || !selected) return;
    const r = judge.update(frame, selected);
    cam.render(r, frame);
    if (rec && rec.phase === 'rec' && r && r.features && (!r.features.quality || r.features.quality.ok)) {
      try {
        rec.samples.push(templates.vectorize(r.features));
      } catch (err) {
        console.warn(err);
      }
    }
  },
  onKey(e) {
    if (e.key === ' ' && selected && !rec) {
      startRecording();
      return true;
    }
    return false;
  },
  // 점검용
  startRecording: () => startRecording(),
  get recording() {
    return !!rec;
  },
  get selected() {
    return selected;
  },
};
