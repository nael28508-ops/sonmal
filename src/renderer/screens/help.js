// 도움말: 지문자가 무엇인지 · 손 위치 · 농문화 예절 · 이 프로그램의 한계 · 자료 출처
import { h, icon } from '../ui/dom.js';
import { callout } from '../ui/components.js';

const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

function card(ic, tone, title, ...body) {
  return h('section.card.help-card', h('div.card-head', h(`div.card-icon${tone ? `.${tone}` : ''}`, icon(ic)), h('h2.card-title', title)), h('div.help-body', ...body));
}

export default {
  id: 'help',
  title: '도움말',
  nav: '도움말',
  icon: 'help',
  mount(root, app) {
    const v = app.host && app.host.version ? `판 ${app.host.version}` : '';
    root.append(
      h(
        'div.page.help',
        h('div.page-head', h('div', h('h1', '도움말'), h('p.lead', '처음 쓰시는 분을 위한 짧은 안내예요.'))),
        h(
          'div.grid.cols-2.help-grid',
          card(
            'hand',
            '',
            '지문자가 무엇인가요?',
            h('p', '지문자는 한글 자음과 모음을 손 모양으로 하나씩 나타내는 방법이에요. 사람 이름, 땅 이름, 새로 생긴 낱말처럼 알맞은 수어 낱말이 없을 때 주로 써요. 숫자는 지숫자로 나타내요.'),
            h('p', '한국수어는 지문자를 늘어놓은 것이 아니라, 자기만의 낱말과 문법을 가진 하나의 언어예요. 2016년 「한국수화언어법」으로 농인의 공용어가 되었어요. 지문자는 한국수어로 가는 첫걸음이에요.'),
          ),
          card(
            'camera',
            '',
            '손은 이렇게 보여 주세요',
            h(
              'ul.help-list',
              h('li', '카메라에서 ', h('strong', '50~80cm'), ' 떨어져 앉아 주세요.'),
              h('li', '얼굴 앞이 아니라 ', h('strong', '어깨 앞, 가슴 높이'), '에서 손 모양을 만들어요.'),
              h('li', '손목까지 화면 안에 들어오게, 손바닥 전체가 보이게 해 주세요.'),
              h('li', '밝은 곳에서, 뒤가 단순한 벽이면 더 잘 알아봐요. 창문을 등지면 손이 어둡게 보여요.'),
              h('li', '긴 소매나 반지 · 팔찌는 가끔 인식을 방해해요.'),
              h('li', '화면은 거울처럼 보여요. 참고 그림도 거울에 비친 내 손처럼 그렸어요.'),
            ),
          ),
          card(
            'heart',
            'coral',
            '농문화 예절',
            h(
              'ul.help-list',
              h('li', '대화할 때는 ', h('strong', '눈을 맞춰 주세요.'), ' 눈길을 돌리면 이야기를 그만 듣는다는 뜻이 될 수 있어요.'),
              h('li', '부를 때는 어깨를 가볍게 톡톡 치거나, 상대가 볼 수 있는 곳에서 손을 흔들어 주세요.'),
              h('li', '입 모양을 과장하거나 소리를 크게 낼 필요는 없어요. 자연스럽게 말해 주세요.'),
              h('li', '지문자는 느려도 괜찮아요. 또박또박 정확하게 하는 것이 더 중요해요.'),
              h('li', '수어 이름(사인 네임)은 보통 농인 공동체에서 지어 줘요. 스스로 지어 쓰지 않아요.'),
              h('li', '가능하면 ', h('strong', '농인 강사'), '에게 직접 배워 보세요. 이 프로그램은 연습을 돕는 도구예요.'),
            ),
          ),
          card(
            'alert',
            'warm',
            '이 프로그램이 못 하는 것',
            h(
              'ul.help-list',
              h('li', h('strong', '수어 번역기가 아니에요.'), ' 지문자와 지숫자 손 모양만 연습해요.'),
              h('li', '카메라 판정은 틀릴 수 있어요. 손 크기, 빛, 각도에 따라 맞게 해도 틀렸다고 할 때가 있어요. 그럴 때는 설정에서 “너그럽게”로 바꿔 보세요.'),
              h('li', '움직임이 있는 글자는 손 모양보다 판정이 어려워요.'),
              h('li', '지역이나 사람마다 손 모양이 조금씩 다를 수 있어요. “선생님 손 등록”으로 우리 선생님 손에 맞출 수 있어요.'),
            ),
          ),
        ),
        h(
          'section.card.help-card.section',
          h('div.card-head', h('div.card-icon', icon('book')), h('h2.card-title', '자료와 만든 이')),
          h(
            'div.help-body',
            h(
              'ul.help-list',
              h('li', '지문자 · 지숫자 손 모양: ', ext('https://sldict.korean.go.kr', '국립국어원 한국수어사전 (sldict.korean.go.kr)'), ' 을 바탕으로 정리했어요.'),
              h('li', '손 인식: Google MediaPipe Hand Landmarker (Apache-2.0 라이선스). 컴퓨터 안에서만 돌아가요.'),
              h('li', '손말 첫걸음은 MIT 라이선스로 누구나 무료로 쓰고 고칠 수 있어요.', v ? ` (${v})` : ''),
            ),
            callout('카메라 영상은 저장하지도, 인터넷으로 보내지도 않아요. 배운 기록과 설정은 이 컴퓨터에만 남아요.', { tone: '', ic: 'eye' }),
          ),
        ),
      ),
    );
  },
};
