// 설정: 카메라 · 주로 쓰는 손 · 판정 · 목소리와 소리 · 보기(글자 크기 · 고대비 · 테마)
import { h, icon, btn, clear, setText } from '../ui/dom.js';
import { segmented, toggle, confirmDialog, callout } from '../ui/components.js';
import { STRICTNESS_KO } from '../engine/rules.js';
import { BG_MODES, BG_COLORS, BG_SCENES, paintScene } from '../core/background.js';

let offs = [];

function row(label, help, control, id) {
  return h('div.setting-row', h('div.setting-text', h('div.field-label', { id }, label), help ? h('div.field-help', help) : null), h('div.setting-control', control));
}

function group(ic, title, ...rows) {
  return h('section.card.setting-group', h('h2.section-title', icon(ic), title), ...rows);
}

export default {
  id: 'settings',
  title: '설정',
  nav: '설정',
  icon: 'settings',
  mount(root, app, params = {}) {
    const s = app.settings;
    const set = (k) => (v) => s.set(k, v);

    // 카메라
    const camSelect = h('select.select.setting-camera', { 'aria-label': '카메라 고르기', onchange: (e) => app.vision.selectCamera(e.target.value) });
    const camInfo = h('div.field-help');
    const renderCams = (st) => {
      clear(camSelect);
      if (st.synthetic) {
        camSelect.append(h('option', '가짜 손 (점검용)'));
        camSelect.disabled = true;
        setText(camInfo, '자동 점검 중에는 진짜 카메라를 쓰지 않아요.');
        return;
      }
      const cams = st.cameras;
      if (!cams.length) camSelect.append(h('option', { value: '' }, s.get('cameraLabel') || '배우기 화면에 들어가면 카메라 목록이 나와요'));
      for (const [i, c] of cams.entries()) camSelect.append(h('option', { value: c.deviceId, selected: c.label === st.cameraLabel }, c.label || `카메라 ${i + 1}`));
      camSelect.disabled = cams.length < 2;
      setText(camInfo, st.camera === 'error' && st.cameraError ? st.cameraError.text : 'Iriun 같은 가상 카메라보다 컴퓨터에 달린 카메라를 먼저 골라요. 배우는 중에 C 키로도 바꿀 수 있어요.');
    };
    renderCams(app.vision.state());
    offs.push(app.vision.onState(renderCams));
    if (!app.vision.synthetic && app.vision.camera) app.vision.camera.refresh().catch(() => {});

    // 목소리
    const voiceSelect = h('select.select', { 'aria-label': '목소리 고르기', onchange: (e) => s.set('voiceName', e.target.value) });
    const renderVoices = () => {
      const vs = app.speech.voices;
      clear(voiceSelect).append(h('option', { value: '' }, '자동 (한국어 목소리)'));
      for (const v of vs) voiceSelect.append(h('option', { value: v.name, selected: v.name === s.get('voiceName') }, v.name.replace(/^Microsoft\s+/, '').replace(/\s*-\s*Korean.*$/, '')));
    };
    renderVoices();
    offs.push(app.speech.onVoices(renderVoices));
    const rateOut = h('output.num.setting-rate-out', `${s.get('voiceRate').toFixed(1)}배`);
    const rate = h('input.slider', {
      type: 'range',
      min: '0.6',
      max: '1.4',
      step: '0.1',
      value: String(s.get('voiceRate')),
      'aria-label': '말하는 빠르기',
      oninput: (e) => {
        s.set('voiceRate', Number(e.target.value));
        setText(rateOut, `${Number(e.target.value).toFixed(1)}배`);
      },
    });

    const bgGroup = backgroundGroup(app);

    root.append(
      h(
        'div.page.settings',
        h('div.page-head', h('div', h('h1', '설정'), h('p.lead', '바꾼 내용은 바로 저장돼요.'))),
        h(
          'div.settings-cols',
          h(
            'div.stack',
            group('camera', '카메라', row('쓸 카메라', null, h('div.stack', camSelect, camInfo))),
            bgGroup,
            group(
              'hand',
              '손과 판정',
              row('주로 쓰는 손', '왼손잡이면 “왼손”을 고르세요. 거울처럼 뒤집어서 판정해요.', segmented({ label: '주로 쓰는 손', options: [['right', '오른손'], ['left', '왼손']], value: s.get('dominant'), onchange: set('dominant') })),
              row('판정 엄격함', '처음에는 “너그럽게”로 시작해도 좋아요.', segmented({ label: '판정 엄격함', options: Object.entries(STRICTNESS_KO), value: s.get('strictness'), onchange: set('strictness') })),
              row('맞히면 다음 글자로', '배우기에서 맞힌 뒤 잠시 후 저절로 넘어가요.', toggle({ label: '맞히면 다음 글자로', checked: s.get('autoAdvance'), onchange: set('autoAdvance') })),
            ),
            group(
              'volume',
              '목소리와 소리',
              row('소리 없이 (화면으로만)', '소리를 모두 끄고 화면으로만 알려 드려요. 청각장애 학생에게 알맞아요.', toggle({ label: '소리 없이', checked: s.get('silent'), onchange: set('silent') })),
              row('글자 이름 읽어 주기', '맞히면 글자 이름을 소리로 읽어 줘요. M 키로 끄고 켤 수 있어요.', toggle({ label: '글자 이름 읽어 주기', checked: s.get('voice'), onchange: set('voice') })),
              row('고칠 점도 읽어 주기', '같은 고칠 점이 오래 이어지면 소리로도 알려 드려요.', toggle({ label: '고칠 점도 읽어 주기', checked: s.get('speakHints'), onchange: set('speakHints') })),
              row('효과음', '맞힘 · 틀림을 짧은 소리로 알려 드려요.', toggle({ label: '효과음', checked: s.get('sound'), onchange: set('sound') })),
              row('목소리', null, h('div.row.setting-voice', voiceSelect, btn('들어 보기', { icon: 'play', kind: 'soft', size: 'sm', onclick: () => { if (!app.speech.speak('안녕하세요. Learn 수어예요.')) app.toast('목소리가 꺼져 있거나 소리 없이 모드예요', { tone: 'hint' }); } }))),
              row('말하는 빠르기', null, h('div.row.setting-rate', rate, rateOut)),
            ),
          ),
          h(
            'div.stack',
            group(
              'eye',
              '보기',
              row('글자 크기', null, segmented({ label: '글자 크기', options: [['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게']], value: s.get('textSize'), onchange: set('textSize') })),
              row('고대비', '글자와 테두리를 더 진하게 보여 드려요.', toggle({ label: '고대비', checked: s.get('contrast') === 'high', onchange: (v) => s.set('contrast', v ? 'high' : 'normal') })),
              row('테마', null, segmented({ label: '테마', options: [['system', '시스템'], ['light', '밝게'], ['dark', '어둡게']], value: s.get('theme'), onchange: set('theme') })),
              row('처리 속도 보기', '위쪽에 초당 인식 횟수(fps)를 보여 드려요.', toggle({ label: '처리 속도 보기', checked: s.get('showFps'), onchange: set('showFps') })),
            ),
            group(
              'keyboard',
              '키보드',
              h(
                'dl.keys',
                [
                  ['← →', '이전 · 다음 글자'],
                  ['Space', '다음 · 건너뛰기'],
                  ['H', '이름 듣기'],
                  ['R', '다시 하기'],
                  ['M', '소리 끄기 · 켜기'],
                  ['C', '카메라 바꾸기'],
                  ['Esc', '처음 화면으로'],
                  ['F11', '전체 화면'],
                ].map(([k, d]) => h('div.keys-row', h('dt', h('kbd', k)), h('dd', d))),
              ),
            ),
            group(
              'refresh',
              '처음 설정으로',
              callout('배운 기록과 선생님 손은 그대로 두고 설정만 처음으로 돌려요.', { tone: 'plain' }),
              h(
                'div.row.end',
                btn('설정 처음으로', {
                  icon: 'refresh',
                  kind: 'danger',
                  onclick: async () => {
                    if (await confirmDialog({ title: '설정을 처음으로 돌릴까요?', body: '카메라, 손, 소리, 보기 설정이 처음 값으로 바뀌어요.', ok: '처음으로', danger: true })) {
                      s.reset();
                      app.toast('설정을 처음으로 돌렸어요');
                      app.navigate('settings', { t: Date.now() });
                    }
                  },
                }),
              ),
            ),
          ),
        ),
      ),
    );
    if (params.focus === 'background') requestAnimationFrame(() => bgGroup.scrollIntoView({ block: 'start' }));
  },
  unmount() {
    for (const off of offs) off();
    offs = [];
  },
};

// ───────── 카메라 배경 ─────────
function backgroundGroup(app) {
  const s = app.settings;
  const bg = app.background;
  const body = h('div.bg-options');
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });

  const swatchBtn = (on, label, onclick, ...kids) =>
    h('button.bg-swatch', { type: 'button', 'aria-pressed': String(on), title: label, 'aria-label': label, onclick }, ...kids, h('span.bg-swatch-check', { 'aria-hidden': 'true' }, on ? '✓' : ''));

  function render() {
    const cur = s.get('bg');
    clear(body);
    const harmonize = () => row('색 자연스럽게 맞추기', '내 모습의 색과 가장자리 빛을 새 배경에 은은하게 맞춰요. 손 색은 거의 그대로 둬요.', toggle({ label: '색 자연스럽게 맞추기', checked: s.get('bgHarmonize'), onchange: (v) => s.set('bgHarmonize', v) }));
    if (cur === 'blur') {
      const out = h('output.num.setting-rate-out', String(s.get('bgBlur')));
      body.append(
        row('흐림 세기', '세게 할수록 뒤쪽이 더 뿌옇게 보여요.', h('div.row.setting-rate', h('input.slider', {
          type: 'range', min: '4', max: '24', step: '1', value: String(s.get('bgBlur')), 'aria-label': '흐림 세기',
          oninput: (e) => { s.set('bgBlur', Number(e.target.value)); setText(out, e.target.value); },
        }), out)),
      );
    } else if (cur === 'color') {
      const custom = h('input.bg-color-input', { type: 'color', value: s.get('bgColor'), 'aria-label': '색 직접 고르기', oninput: (e) => s.set('bgColor', e.target.value) });
      body.append(
        h('div.field-label', '색 고르기'),
        h('div.bg-swatches',
          BG_COLORS.map(([c, name]) => swatchBtn(s.get('bgColor').toLowerCase() === c, name, () => { s.set('bgColor', c); render(); }, h('span.bg-swatch-fill', { style: { background: c } }), h('span.bg-swatch-name', name))),
          h('label.bg-swatch.custom', { title: '직접 고르기' }, custom, h('span.bg-swatch-name', '직접 고르기')),
        ),
        harmonize(),
      );
    } else if (cur === 'scene') {
      body.append(
        h('div.field-label', '그림 고르기'),
        h('div.bg-swatches.scenes', BG_SCENES.map(([id, name]) => {
          const c = h('canvas.bg-scene-thumb', { width: 160, height: 90 });
          paintScene(c.getContext('2d'), id, 160, 90);
          return swatchBtn(s.get('bgScene') === id, name, () => { s.set('bgScene', id); render(); }, c, h('span.bg-swatch-name', name));
        })),
        harmonize(),
      );
    } else if (cur === 'photo' || cur === 'none') {
      const has = bg.hasPhoto();
      if (cur === 'photo' || has) {
        body.append(
          h('div.bg-photo-row',
            has ? h('img.bg-photo-thumb', { src: bg.photoUrl(), alt: '배경으로 고른 사진' }) : h('div.bg-photo-thumb.empty', icon('image'), h('span', '사진 없음')),
            h('div.stack',
              h('div.row', btn(has ? '다른 사진 고르기' : '사진 고르기', { icon: 'upload', kind: 'soft', size: 'sm', onclick: () => fileInput.click() }),
                has ? btn('사진 지우기', { icon: 'trash', kind: 'ghost', size: 'sm', onclick: () => { bg.clearPhoto(); app.toast('사진을 지웠어요'); render(); } }) : null),
              h('div.field-help', '사진은 이 컴퓨터에만 저장돼요. 크면 1280×720 크기로 줄여서 저장해요. 화면을 꽉 채우게 놓고, 뒤집지 않아요.'),
            ),
          ),
        );
        if (cur === 'photo') body.append(harmonize());
      }
    }
  }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      await bg.savePhoto(f);
      s.set('bg', 'photo');
      app.toast('내 사진을 배경으로 했어요');
    } catch (err) {
      app.toast(`사진을 쓰지 못했어요: ${err.message}`, { tone: 'bad' });
    }
    render();
  });

  const seg = segmented({ label: '카메라 배경', options: BG_MODES, value: s.get('bg'), onchange: (v) => s.set('bg', v) });
  const off = s.subscribe((_st, changed) => {
    if (changed.includes('bg')) render();
  });
  offs.push(off);
  render();
  return h(
    'section.card.setting-group.bg-group',
    { id: 'setting-background' },
    h('h2.section-title', icon('image'), '카메라 배경'),
    callout('화상 통화처럼 내 뒤쪽만 흐리게 하거나 다른 배경으로 바꿔 보여 드려요. 화면에 보이는 모습만 바뀌고, 손 인식은 원래 영상으로 해요. 실제로 뒤쪽 벽이 단순하고 밝으면 손을 더 잘 알아봐요.', { tone: 'plain' }),
    row('배경', '카메라 화면 오른쪽 아래 “배경” 단추로도 바꿀 수 있어요.', seg),
    body,
    fileInput,
  );
}
