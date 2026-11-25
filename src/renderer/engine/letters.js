// 배울 글자(Letter)와 단원(Unit) 목록 — 한국수어 지문자(자음 14 · 된소리 5 · 모음 21)와 지숫자(0~10)
// 자료: 국립국어원 한국수어사전 (https://sldict.korean.go.kr) 의 낱말별 수형 설명 · 사진 · 그림
// - 모든 정의는 "오른손" 기준이고 방향은 수어하는 사람 기준 좌표 S (README.md 참고)
//   사전의 '밖' = 앞(화면/보는 사람 쪽, 'forward'), '안' = 내 쪽('back'), 왼쪽/오른쪽 = 수어하는 사람의 왼쪽/오른쪽
// - 왼손으로 하면 판정 엔진이 손을 거울처럼 뒤집어서 같은 정의로 봄 (문구의 왼쪽 ↔ 오른쪽 도 바뀜)
// - 글자 데이터 모양과 확인 항목(checks) 쓰는 법은 README.md 의 "글자 데이터" 를 보세요
import { PRESETS, normalizePose, withPose } from './handmodel.js';

export const SOURCE = 'https://sldict.korean.go.kr';
export const SOURCE_NAME = '국립국어원 한국수어사전';
const SLDICT_VIEW = 'https://sldict.korean.go.kr/front/sign/signContentsView.do?';

// 국립국어원 한국수어사전의 수형 설명 원문과 낱말 주소 (주소는 SLDICT_VIEW 뒤에 붙임), 자료 확실성
const OFFICIAL = {
  "0": ["오른손의 1·5지 끝을 맞대어 동그라미를 만들어 손바닥이 밖으로 향하게 세운다.", "origin_no=23962&top_category=CTE", "high"],
  "1": ["오른 주먹의 1지를 펴서 바닥이 밖으로 향하게 세운다.", "origin_no=12573&top_category=CTE", "high"],
  "2": ["오른 주먹의 1·2지를 펴서 벌려 바닥이 밖으로 향하게 세운다.", "origin_no=11057&top_category=CTE", "high"],
  "3": ["오른 주먹의 1·2·3지를 펴서 바닥이 밖으로 향하게 세운다.", "origin_no=11311&top_category=CTE", "high"],
  "4": ["5지를 접고 1·2·3·4지를 벌려 바닥이 밖으로 향하게 세운다.", "origin_no=12528&top_category=CTE", "high"],
  "5": ["손등이 안으로 향하게 쥔 오른 주먹의 5지를 펴서 눕힌다.", "origin_no=11055&top_category=CTE", "high"],
  "6": ["오른 주먹의 1·5지를 펴서 등이 밖으로 향하게 모로 세운다.", "origin_no=12841&top_category=CTE", "high"],
  "7": ["오른 주먹의 1·2·5지를 펴서 벌려 등이 밖으로 향하게 모로 세운다.", "origin_no=12674&top_category=CTE", "high"],
  "8": ["오른손을, 4지를 접고 나머지 손가락을 벌려 손등이 밖으로 향하게 비스듬히 세운다.", "origin_no=11419&top_category=CTE", "high"],
  "9": ["오른손을 펴서 손바닥이 안으로 향하게 비스듬히 세운다.", "origin_no=11315&top_category=CTE", "high"],
  "10": ["오른 주먹의 1지를 펴서 약간 구부려 끝이 밖으로 향하게 하여 좌우로 약간 흔든다.", "origin_no=10919&top_category=CTE", "medium"],
  "ㄱ": ["오른 주먹의 1·5지를 펴서 1지 끝이 아래로 손등이 밖으로 향하게 세운다.", "origin_no=19498&top_category=SPE", "high"],
  "ㄴ": ["오른 주먹의 1·5지를 펴서 1지 끝이 왼쪽으로 손등이 밖으로 향하게 한다.", "origin_no=19661&top_category=SPE", "high"],
  "ㄷ": ["오른 주먹의 1·2지를 펴서 벌려 끝이 왼쪽으로 손등이 밖으로 향하게 한다.", "origin_no=19717&top_category=SPE", "high"],
  "ㄹ": ["오른 주먹의 1·2·3지를 펴서 벌려 끝이 왼쪽으로 손등이 밖으로 향하게 한다.", "origin_no=19799&top_category=SPE", "high"],
  "ㅁ": ["손등이 안으로 향하게 세워 쥔 오른 주먹의 1·2지를 구부린다.", "origin_no=19845&top_category=SPE", "medium"],
  "ㅂ": ["오른 주먹의 1·2·3·4지를 펴서 붙여 손바닥이 밖으로 손끝이 위로 향하게 세운다.", "origin_no=19941&top_category=SPE", "high"],
  "ㅅ": ["오른 주먹의 1·2지를 펴서 벌려 등이 밖으로 끝이 아래로 향하게 한다.", "origin_no=20053&top_category=SPE", "high"],
  "ㅇ": ["손바닥이 밖으로 향하게 펴서 세운 오른손의 1·5지 끝을 맞대어 동그라미를 만들어 보인다.", "origin_no=20185&top_category=SPE", "high"],
  "ㅈ": ["오른 주먹의 1·2·5지를 펴서 등이 밖으로 끝이 아래로 향하게 세운다.", "origin_no=20528&top_category=SPE", "high"],
  "ㅊ": ["오른 주먹의 1·2·3·5지를 펴서 등이 밖으로 끝이 아래로 향하게 세운다.", "origin_no=20678&top_category=SPE", "high"],
  "ㅋ": ["오른 주먹의 1지를 반쯤 굽히고 2·5지를 펴서 등이 밖으로, 끝이 아래로 향하게 세운다.", "origin_no=20715&top_category=SPE", "high"],
  "ㅌ": ["손등이 밖으로 향하게 쥔 오른 주먹의 1·2·3지를 펴서 끝이 왼쪽으로 향하게 하여 2·3지는 붙이고 1지는 뗀다.", "origin_no=20726&top_category=SPE", "high"],
  "ㅍ": ["손등이 안으로 향하게 세운 오른손의 1·2·3·4·5지를 반쯤 굽힌다.", "origin_no=20740&top_category=SPE", "medium"],
  "ㅎ": ["오른 주먹의 5지를 펴서 바닥이 밖으로 향하게 세운다.", "origin_no=20794&top_category=SPE", "high"],
  "ㄲ": ["오른 주먹의 1·5지를 펴서 1지 끝이 아래로 손등이 밖으로 향하게 세워 오른쪽으로 한 번 옮긴다.", "origin_no=19655&top_category=SPE", "high"],
  "ㄸ": ["오른 주먹의 1·2지를 펴서 벌려 끝이 왼쪽으로 등이 밖으로 향하게 하여 오른쪽으로 한 번 옮긴다.", "origin_no=19795&top_category=SPE", "high"],
  "ㅃ": ["오른손의 1·2·3·4지를 붙여 손바닥이 밖으로 손끝이 위로 향하게 세워 오른쪽으로 한 번 옮긴다.", "origin_no=20050&top_category=SPE", "high"],
  "ㅆ": ["오른 주먹의 1·2지를 펴서 벌려 등이 밖으로 끝이 아래로 향하게 하여 오른쪽으로 한 번 옮긴다.", "origin_no=20183&top_category=SPE", "high"],
  "ㅉ": ["오른 주먹의 1·2·5지를 펴서 등이 밖으로 끝이 아래로 향하게 세워 오른쪽으로 한 번 옮긴다.", "origin_no=20675&top_category=SPE", "high"],
  "ㅏ": ["오른 주먹의 1지를 펴서 바닥이 밖으로 향하게 세운다.", "origin_no=20186&top_category=SPE", "high"],
  "ㅑ": ["오른 주먹의 1·2지를 펴서 벌려 바닥이 밖으로 향하게 세운다.", "origin_no=20224&top_category=SPE", "high"],
  "ㅓ": ["오른 주먹의 1지를 펴서 바닥이 왼쪽으로 끝이 밖으로 향하게 한다.", "origin_no=20236&top_category=SPE", "high"],
  "ㅕ": ["오른 주먹의 1·2지를 펴서 벌려 바닥이 왼쪽으로 끝이 밖으로 향하게 한다.", "origin_no=20316&top_category=SPE", "high"],
  "ㅗ": ["오른 주먹의 1지를 펴서 끝이 위로 등이 밖으로 향하게 세운다.", "origin_no=20336&top_category=SPE", "high"],
  "ㅛ": ["오른 주먹의 1·2지를 펴서 벌려 끝이 위로 등이 밖으로 향하게 세운다.", "origin_no=20352&top_category=SPE", "high"],
  "ㅜ": ["오른 주먹의 1지를 펴서 끝이 아래로 등이 밖으로 향하게 세운다.", "origin_no=20355&top_category=SPE", "high"],
  "ㅠ": ["오른 주먹의 1·2지를 펴서 약간 벌려 끝이 아래로 등이 밖으로 향하게 세운다.", "origin_no=20364&top_category=SPE", "high"],
  "ㅡ": ["오른 주먹의 1지를 펴서 끝이 왼쪽으로 향하게 모로 세운다.", "origin_no=20375&top_category=SPE", "high"],
  "ㅣ": ["오른 주먹의 4지를 펴서 끝이 위로 바닥이 밖으로 향하게 세운다.", "origin_no=20460&top_category=SPE", "high"],
  "ㅐ": ["오른 주먹의 1·4지를 펴서 바닥이 밖으로 향하게 세운다.", "origin_no=20223&top_category=SPE", "high"],
  "ㅒ": ["오른 주먹의 1·2·4지를 펴서 벌려 바닥이 밖으로 향하게 세운다.", "origin_no=20235&top_category=SPE", "high"],
  "ㅔ": ["오른 주먹의 1·4지를 펴서 바닥이 왼쪽으로 끝이 밖으로 향하게 한다.", "origin_no=20291&top_category=SPE", "high"],
  "ㅖ": ["오른 주먹의 1·2·4지를 펴서 벌려 바닥이 왼쪽으로 끝이 밖으로 향하게 한다.", "origin_no=20333&top_category=SPE", "high"],
  "ㅚ": ["오른 주먹의 1·4지를 펴서 끝이 위로 등이 밖으로 향하게 세운다.", "origin_no=20348&top_category=SPE", "high"],
  "ㅟ": ["오른 주먹의 1·4지를 펴서 끝이 아래로 등이 밖으로 향하게 세운다.", "origin_no=20363&top_category=SPE", "high"],
  "ㅢ": ["오른 주먹의 1·4지를 펴서 끝이 왼쪽으로 향하게 모로 세운다.", "origin_no=20438&top_category=SPE", "high"],
  "ㅘ": ["오른 주먹의 1지를 펴서 끝이 위로 등이 밖으로 향하게 세운 다음, 손목을 돌려 바닥이 밖으로 향하게 세운다.", "origin_no=20342&top_category=SPE", "high"],
  "ㅙ": ["오른 주먹의 1지를 펴서 끝이 위로 등이 밖으로 향하게 세운 다음, 1·4지를 펴서 바닥이 밖으로 향하게 세운다.", "origin_no=20347&top_category=SPE", "high"],
  "ㅝ": ["오른 주먹의 1지를 펴서 끝이 아래로 등이 밖으로 향하게 세운 다음, 1지 바닥이 왼쪽으로 끝이 밖으로 향하게 한다.", "origin_no=20358&top_category=SPE", "high"],
  "ㅞ": ["오른 주먹의 1지를 펴서 끝이 아래로 등이 밖으로 향하게 세운 다음, 1·4지를 펴서 바닥이 왼쪽으로 끝이 밖으로 향하게 한다.", "origin_no=20362&top_category=SPE", "high"],
};

// ───────── 확인 항목 만들기 도우미 ─────────
const KO = { thumb: '엄지', index: '검지', middle: '중지', ring: '약지', pinky: '새끼손가락' };
const OBJ = { thumb: '엄지를', index: '검지를', middle: '중지를', ring: '약지를', pinky: '새끼손가락을' };
const TO = { up: '위로', down: '아래로', left: '왼쪽으로', right: '오른쪽으로', forward: '화면 쪽으로', back: '내 쪽으로' };
const TO_OBJ = { up: '위를', down: '아래를', left: '왼쪽을', right: '오른쪽을', forward: '화면 쪽을', back: '내 쪽을' };

/** 엄지를 접은 상태로 보는 위치 (손가락 위 · 손바닥 · 손가락 안 · 검지 옆 · 접힌 손가락 앞) */
export const THUMB_FOLDED = ['across', 'tucked', 'side', 'front'];

const ext = (f) => ({ id: `${f}-ext`, label: `${KO[f]} 펴기`, msg: `${OBJ[f]} 곧게 펴 주세요`, finger: f, state: 'extended' });
const fold = (f) => ({ id: `${f}-fold`, label: `${KO[f]} 접기`, msg: `${OBJ[f]} 접어 주세요`, finger: f, state: 'folded' });
const curl = (f) => ({ id: `${f}-curl`, label: `${KO[f]} 꼭 쥐기`, msg: `${OBJ[f]} 주먹 안으로 꼭 접어 주세요`, finger: f, state: 'curled' });
const hook = (f) => ({
  id: `${f}-hook`, label: `${KO[f]} 갈고리처럼 구부리기`, msg: `${KO[f]}는 세운 채 끝 두 마디만 구부려 주세요`, finger: f, state: 'hooked',
});
const half = (f) => ({ id: `${f}-half`, label: `${KO[f]} 반쯤 굽히기`, msg: `${OBJ[f]} 반쯤만 굽혀 주세요`, finger: f, custom: 'halfBent' });
const point = (f, dir, word) => {
  const d = Array.isArray(dir) ? dir[0] : dir;
  return {
    id: `${f}-dir`, label: `${KO[f]} 끝 ${word || TO[d]}`, msg: `${KO[f]} 끝이 ${word ? word.replace(/로$/, '를') : TO_OBJ[d]} 향하게 해 주세요`,
    finger: f, dir,
  };
};
const PALM = {
  forward: { label: '손바닥이 화면 쪽', msg: '손바닥이 화면 쪽을 보게 해 주세요' },
  back: { label: '손등이 화면 쪽', msg: '손을 돌려 손등이 화면 쪽을 보게 해 주세요' },
  left: { label: '손바닥이 왼쪽', msg: '손을 옆으로 세워 손바닥이 왼쪽을 보게 해 주세요' },
  down: { label: '손바닥이 아래쪽', msg: '손바닥이 아래를 보게 해 주세요' },
};
const palm = (dir) => ({ id: 'palm', ...PALM[dir], palm: dir });
const thumbFold = () => ({ id: 'thumb-fold', label: '엄지 접기', msg: '엄지를 접어 손가락에 붙여 주세요', thumb: THUMB_FOLDED });
const thumbExt = () => ({ id: 'thumb-ext', label: '엄지 펴기', msg: '엄지를 곧게 펴 주세요', finger: 'thumb', state: 'extended' });
const thumbOpen = () => ({ id: 'thumb-open', label: '엄지 벌리기', msg: '엄지를 손바닥에서 떼어 벌려 주세요', thumb: ['out', 'up'] });
const thumbDir = (dir) => ({
  id: 'thumb-dir', label: `엄지 끝 ${TO[dir]}`, msg: `엄지 끝이 ${TO_OBJ[dir]} 향하게 펴 주세요`, finger: 'thumb', dir,
});
const spreadMin = (a, b, min) => ({
  id: `${a}-${b}-spread`, label: `${KO[a]} · ${KO[b]} 벌리기`, msg: `${KO[a]}와 ${OBJ[b]} 벌려 주세요`, spread: { a, b, min },
});
const spreadMax = (a, b, max, word = '붙이기') => ({
  id: `${a}-${b}-close`, label: `${KO[a]} · ${KO[b]} ${word}`, msg: `${KO[a]}와 ${OBJ[b]} 나란히 붙여 주세요`, spread: { a, b, max },
});
const touch = (a, b) => ({
  id: `${a}-${b}-touch`, label: `${KO[a]} 끝 · ${KO[b]} 끝 맞대기`, msg: `${KO[a]} 끝과 ${KO[b]} 끝을 맞대어 동그라미를 만들어 주세요`, touch: [a, b],
});
const apart = (a, b) => ({
  id: `${a}-${b}-apart`, label: `${KO[a]} · ${KO[b]} 떼기`, msg: `${KO[a]} 끝을 ${KO[b]} 끝에서 떼어 주세요`, apart: [a, b],
});
const folds = (...fs) => fs.map(fold);
const exts = (...fs) => fs.map(ext);

// 움직임
const SHIFT_RIGHT = Object.freeze({
  type: 'move', dir: 'right', minDist: 0.5, within: 1500, desc: '손 모양 그대로 오른쪽으로 한 번 옮겨 주세요',
});
const SHAKE_SIDE = Object.freeze({
  type: 'shake', dir: 'left', minDist: 0.2, count: 3, within: 2000, desc: '손을 좌우로 작게 흔들어 주세요',
});

// ───────── 손 모형 자세 (HandPose) ─────────
const F = (mcp, pip, dip, abd = 0) => ({ mcp, pip, dip, abd });
const EXT = (abd = 0) => F(3, 4, 2, abd);
const CURL = F(88, 100, 62);
const CURLP = F(90, 98, 60);
const HOOK = F(8, 92, 62);
const HALF = (abd = 0) => F(24, 60, 40, abd);
const T_ACROSS = { cmcFlex: 29, cmcAbd: 46, mcp: 46, ip: 39 }; // 접은 손가락 위를 가로지름
const T_PALM = { cmcFlex: 32, cmcAbd: 17, mcp: 70, ip: 24 }; // 편 손가락 아래 손바닥 위로 접음
const T_OUT = { cmcFlex: -38, cmcAbd: 3, mcp: 0, ip: 0 }; // 옆으로 쭉 (L 모양)
const T_UP = { cmcFlex: 29, cmcAbd: 4, mcp: 11, ip: 0 }; // 주먹 위로 세움 (손 축 방향)
const T_HALF = { cmcFlex: -12, cmcAbd: 38, mcp: 14, ip: 26 }; // 반쯤 굽혀 손가락과 마주 봄
const T_RING = { cmcFlex: 19, cmcAbd: 46, mcp: 26, ip: 13 }; // 검지 끝과 맞대 동그라미

// 손 방향 (손목 회전): 기본은 손바닥이 앞, 손가락이 위, 엄지가 왼쪽
const O = {
  palmFwd: { yaw: 6, pitch: -6, roll: 0 }, // 손바닥이 화면 쪽, 손끝 위
  palmBack: { yaw: 174, pitch: -6, roll: 0 }, // 손등이 화면 쪽, 손끝 위
  down: { yaw: 6, pitch: 174, roll: 0 }, // 손끝 아래, 손등이 화면 쪽, 엄지 쪽이 왼쪽
  left: { yaw: 174, pitch: 6, roll: -90 }, // 손끝 왼쪽, 손등이 화면 쪽, 엄지 쪽이 위 (모로 세움)
  forward: { yaw: -90, pitch: 0, roll: -84 }, // 손끝 화면 쪽, 손바닥이 왼쪽, 엄지 쪽이 위
  diag: { yaw: 174, pitch: -6, roll: -40 }, // 손등이 화면 쪽, 손끝 왼쪽 위로 비스듬히
  tenPoint: { yaw: -90, pitch: 72, roll: -86 }, // 손끝 화면 쪽, 손바닥은 왼쪽 아래 (주먹을 조금 엎음)
};
const pose = (rot, thumb, index, middle, ring, pinky) => Object.freeze(normalizePose({ rot, thumb, index, middle, ring, pinky }));

// ───────── 글자 정의 ─────────
// 공통: kind, unit, order 는 아래 UNIT_PLAN 에서 채움
const DEFS = [];
const def = (o) => DEFS.push(o);

const VIEW_BACK = '그림은 거울에 비친 내 손이에요. 화면에는 손등이 보여요.';
const VIEW_PALM = '그림은 거울에 비친 내 손이에요. 화면에는 손바닥이 보여요.';
const VIEW_SIDE = '그림은 거울에 비친 내 손을 왼쪽 앞에서 비스듬히 본 모습이에요. 손가락이 화면을 가리켜요.';
/** 손끝이 화면 쪽을 가리키는 글자는 정면에서 보면 손가락이 짧아 보여서, 왼쪽 앞에서 비스듬히 봄 */
const SIDE_VIEW = Object.freeze({ yaw: 30, pitch: 16, focal: 3.2 });

// ── 자음 1: ㄱ ㄴ ㄷ ㄹ ㅁ ──
def({
  id: 'ㄱ', kind: 'consonant',
  desc: '주먹에서 검지와 엄지를 펴요. 검지는 아래로, 엄지는 왼쪽으로 뻗고, 손등이 화면 쪽을 보게 해요.',
  tips: ['내 쪽에서 보면 ㄱ 모양이에요.', '엄지를 빼면 모음 ㅜ 가 돼요.'],
  view: VIEW_BACK,
  checks: [ext('index'), point('index', 'down'), thumbExt(), thumbDir('left'), ...folds('middle', 'ring', 'pinky'), palm('back')],
  pose: pose(O.down, T_OUT, EXT(2), CURL, CURL, CURLP),
  confusables: ['ㅜ', 'ㅋ', 'ㄴ', 'ㅈ', 'ㄲ'],
});
def({
  id: 'ㄴ', kind: 'consonant',
  desc: '주먹에서 검지와 엄지를 펴요. 검지는 왼쪽으로 눕히고, 엄지는 위로 세워요. 손등이 화면 쪽을 보게 해요.',
  tips: ['보는 사람에게 ㄴ 모양으로 보여요.', '숫자 6 과 손 모양이 같아요.'],
  view: VIEW_BACK,
  checks: [ext('index'), point('index', 'left'), thumbExt(), thumbDir('up'), ...folds('middle', 'ring', 'pinky'), palm('back')],
  pose: pose(O.left, T_OUT, EXT(2), CURL, CURL, CURLP),
  confusables: ['num-6', 'ㅡ', 'ㄱ', 'ㄷ'],
  sameAs: ['num-6'],
});
def({
  id: 'ㄷ', kind: 'consonant',
  desc: '주먹에서 검지와 중지를 펴서 조금 벌리고, 손끝이 왼쪽을 향하게 눕혀요. 손등이 화면 쪽을 보게 해요.',
  tips: ['엄지는 접어서 약지와 새끼손가락을 눌러 주세요.', '엄지까지 위로 펴면 숫자 7 이 돼요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle'), point('index', 'left'), thumbFold(), ...folds('ring', 'pinky'), palm('back')],
  pose: pose(O.left, T_ACROSS, EXT(8), EXT(-6), CURL, CURLP),
  confusables: ['ㄹ', 'ㅌ', 'ㅕ', 'num-7', 'ㄸ'],
});
def({
  id: 'ㄹ', kind: 'consonant',
  desc: '주먹에서 검지 · 중지 · 약지를 펴서 서로 벌리고, 손끝이 왼쪽을 향하게 눕혀요. 손등이 화면 쪽을 보게 해요.',
  tips: ['세 손가락을 모두 벌려야 ㅌ 과 달라요.', '엄지는 접어서 새끼손가락을 눌러 주세요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle', 'ring'), point('index', 'left'), spreadMin('middle', 'ring', 10), thumbFold(), fold('pinky'), palm('back')],
  pose: pose(O.left, T_ACROSS, EXT(14), EXT(0), EXT(20), CURLP),
  confusables: ['ㅌ', 'ㄷ', 'ㅖ', 'num-3'],
});
def({
  id: 'ㅁ', kind: 'consonant',
  desc: '손바닥이 화면 쪽을 보게 주먹을 세우고, 검지와 중지를 올려 끝 두 마디를 갈고리처럼 구부려요.',
  tips: ['검지 · 중지 뿌리는 세우고 끝만 구부려 주세요.', '약지와 새끼손가락은 꼭 쥐어 주세요.'],
  view: VIEW_PALM,
  checks: [hook('index'), hook('middle'), curl('ring'), curl('pinky'), palm('forward')],
  pose: pose(O.palmFwd, T_ACROSS, F(10, 92, 62, 4), F(10, 92, 62, -4), CURL, CURLP),
  confusables: ['ㅍ', 'ㅑ', 'num-2'],
});

// ── 자음 2: ㅂ ㅅ ㅇ ㅈ ㅊ ──
def({
  id: 'ㅂ', kind: 'consonant',
  desc: '엄지를 접고 나머지 네 손가락을 붙여 위로 곧게 세워요. 손바닥이 화면 쪽을 보게 해요.',
  tips: ['네 손가락을 벌리면 숫자 4 가 돼요. 꼭 붙여 주세요.'],
  view: VIEW_PALM,
  checks: [...exts('index', 'middle', 'ring', 'pinky'), point('index', 'up'), spreadMax('index', 'middle', 10), spreadMax('middle', 'ring', 10), thumbFold(), palm('forward')],
  pose: pose(O.palmFwd, T_PALM, EXT(1), EXT(0), EXT(1), EXT(2)),
  confusables: ['num-4', 'ㅃ', 'num-9'],
});
def({
  id: 'ㅅ', kind: 'consonant',
  desc: '주먹에서 검지와 중지를 펴서 V 자로 크게 벌리고, 손끝이 아래를 향하게 해요. 손등이 화면 쪽을 보게 해요.',
  tips: ['두 손가락을 크게 벌려야 ㅠ 와 달라요.', '엄지는 접어 주세요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle'), point('index', 'down'), spreadMin('index', 'middle', 18), thumbFold(), ...folds('ring', 'pinky'), palm('back')],
  pose: pose(O.down, T_ACROSS, EXT(14), EXT(-14), CURL, CURLP),
  confusables: ['ㅠ', 'ㅈ', 'ㅆ', 'ㅜ'],
});
def({
  id: 'ㅇ', kind: 'consonant',
  desc: '손바닥이 화면 쪽을 보게 손을 세우고, 엄지 끝과 검지 끝을 맞대어 동그라미를 만들어요. 나머지 세 손가락은 위로 펴요.',
  tips: ['숫자 0 과 손 모양이 같아요.', '동그라미가 화면에서 잘 보이게 해 주세요.'],
  view: VIEW_PALM,
  checks: [touch('thumb', 'index'), ...exts('middle', 'ring', 'pinky'), point('middle', 'up'), palm('forward')],
  pose: pose(O.palmFwd, T_RING, F(45, 60, 40), EXT(-4), EXT(6), EXT(14)),
  confusables: ['num-0', 'ㅍ'],
  sameAs: ['num-0'],
});
def({
  id: 'ㅈ', kind: 'consonant',
  desc: '주먹에서 검지 · 중지 · 엄지를 펴요. 검지와 중지는 아래로, 엄지는 왼쪽으로 뻗고, 손등이 화면 쪽을 보게 해요.',
  tips: ['엄지를 접으면 ㅠ 가 돼요. 엄지를 옆으로 펴 주세요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle'), point('index', 'down'), thumbExt(), thumbDir('left'), ...folds('ring', 'pinky'), palm('back')],
  pose: pose(O.down, T_OUT, EXT(5), EXT(-4), CURL, CURLP),
  confusables: ['ㅅ', 'ㅊ', 'ㅋ', 'ㅠ', 'ㅉ'],
});
def({
  id: 'ㅊ', kind: 'consonant',
  desc: '주먹에서 검지 · 중지 · 약지와 엄지를 펴요. 세 손가락은 아래로, 엄지는 왼쪽으로 뻗고, 손등이 화면 쪽을 보게 해요.',
  tips: ['ㅈ 에 약지를 하나 더 편 모양이에요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle', 'ring'), point('index', 'down'), thumbExt(), thumbDir('left'), fold('pinky'), palm('back')],
  pose: pose(O.down, T_OUT, EXT(6), EXT(0), EXT(6), CURLP),
  confusables: ['ㅈ', 'num-8'],
});

// ── 자음 3: ㅋ ㅌ ㅍ ㅎ ──
def({
  id: 'ㅋ', kind: 'consonant',
  desc: '주먹에서 중지와 엄지를 펴고 검지는 반쯤 굽혀요. 손끝이 아래를 향하고, 엄지는 왼쪽으로, 손등이 화면 쪽을 보게 해요.',
  tips: ['검지는 접지도 펴지도 말고 반쯤만 굽혀 주세요.', '중지가 가장 길게 아래로 내려와요.'],
  view: VIEW_BACK,
  checks: [half('index'), ext('middle'), point('middle', 'down'), thumbExt(), thumbDir('left'), ...folds('ring', 'pinky'), palm('back')],
  pose: pose(O.down, T_OUT, HALF(4), EXT(-2), CURL, CURLP),
  confusables: ['ㄱ', 'ㅈ'],
});
def({
  id: 'ㅌ', kind: 'consonant',
  desc: '주먹에서 검지 · 중지 · 약지를 펴서 손끝이 왼쪽을 향하게 눕혀요. 중지와 약지는 붙이고 검지만 떼어요.',
  tips: ['세 손가락을 모두 벌리면 ㄹ 이 돼요.', '손등이 화면 쪽을 보게 해 주세요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle', 'ring'), point('index', 'left'), spreadMin('index', 'middle', 12), spreadMax('middle', 'ring', 8), thumbFold(), fold('pinky'), palm('back')],
  pose: pose(O.left, T_ACROSS, EXT(18), EXT(-1), EXT(-1), CURLP),
  confusables: ['ㄹ', 'ㄷ'],
});
def({
  id: 'ㅍ', kind: 'consonant',
  desc: '손바닥이 화면 쪽을 보게 손을 세우고, 다섯 손가락을 모두 반쯤 굽혀요. 공을 잡는 듯한 모양이에요.',
  tips: ['주먹을 쥐지 말고 손가락 사이를 조금 띄워 주세요.', '엄지 끝도 검지 끝에 닿지 않게 해 주세요.'],
  view: VIEW_PALM,
  checks: [...['index', 'middle', 'ring', 'pinky'].map(half), apart('thumb', 'index'), palm('forward')],
  pose: pose(O.palmFwd, T_HALF, HALF(8), HALF(0), HALF(6), HALF(12)),
  confusables: ['ㅁ', 'ㅇ'],
});
def({
  id: 'ㅎ', kind: 'consonant',
  desc: '주먹을 쥐고 엄지만 위로 세워요. 주먹 앞(손바닥 쪽)이 화면 쪽을 보게 해요.',
  tips: ['엄지를 옆으로 눕히면 숫자 5 가 돼요.'],
  view: VIEW_PALM,
  checks: [thumbExt(), thumbDir('up'), ...['index', 'middle', 'ring', 'pinky'].map(curl), palm('forward')],
  pose: pose(O.palmFwd, T_UP, CURL, CURL, CURL, CURLP),
  confusables: ['num-5'],
});

// ── 된소리: ㄲ ㄸ ㅃ ㅆ ㅉ — 기본 자음 모양으로 오른쪽으로 한 번 옮기기 ──
for (const [id, base] of [['ㄲ', 'ㄱ'], ['ㄸ', 'ㄷ'], ['ㅃ', 'ㅂ'], ['ㅆ', 'ㅅ'], ['ㅉ', 'ㅈ']]) {
  const b = DEFS.find((d) => d.id === base);
  def({
    id, kind: 'double', base,
    desc: `${base} 모양을 만든 다음, 그대로 오른쪽으로 한 번 옮겨요.`,
    tips: [`${base} 를 두 번 하는 게 아니라 한 번 옮기는 거예요.`, '보는 사람에게는 손이 왼쪽으로 움직여 보여요.'],
    view: b.view,
    checks: b.checks,
    motion: SHIFT_RIGHT,
    pose: b.pose,
    confusables: [base],
  });
}

// ── 모음: 방향 약속 — 검지가 위+손바닥 앞 = ㅏ, 위+손등 앞 = ㅗ, 아래 = ㅜ, 화면 쪽 = ㅓ, 왼쪽 = ㅡ, 새끼손가락 = ㅣ ──
const V = {
  a: [ext('index'), point('index', 'up'), thumbFold(), ...folds('middle', 'ring', 'pinky')],
  ya: [...exts('index', 'middle'), point('index', 'up'), thumbFold(), ...folds('ring', 'pinky')],
  eo: [ext('index'), point('index', 'forward'), thumbFold(), ...folds('middle', 'ring', 'pinky')],
  yeo: [...exts('index', 'middle'), point('index', 'forward'), thumbFold(), ...folds('ring', 'pinky')],
  u: [ext('index'), point('index', 'down'), thumbFold(), ...folds('middle', 'ring', 'pinky')],
  eu: [ext('index'), point('index', 'left'), thumbFold(), ...folds('middle', 'ring', 'pinky')],
  // ㅣ 를 더한 모음: 검지 + 새끼손가락
  ae: [...exts('index', 'pinky'), point('index', 'up'), thumbFold(), ...folds('middle', 'ring')],
  yae: [...exts('index', 'middle', 'pinky'), point('index', 'up'), thumbFold(), fold('ring')],
  e: [...exts('index', 'pinky'), point('index', 'forward'), thumbFold(), ...folds('middle', 'ring')],
  ye: [...exts('index', 'middle', 'pinky'), point('index', 'forward'), thumbFold(), fold('ring')],
  wi: [...exts('index', 'pinky'), point('index', 'down'), thumbFold(), ...folds('middle', 'ring')],
  ui: [...exts('index', 'pinky'), point('index', 'left'), thumbFold(), ...folds('middle', 'ring')],
};
const P1 = (o) => pose(o, T_ACROSS, EXT(2), CURL, CURL, CURLP);
const P2 = (o) => pose(o, T_ACROSS, EXT(9), EXT(-9), CURL, CURLP);
const P1i = (o) => pose(o, T_ACROSS, EXT(3), CURL, CURL, EXT(8));
const P2i = (o) => pose(o, T_ACROSS, EXT(9), EXT(-8), CURL, EXT(10));
const POSE_O = P1(O.palmBack);
const POSE_U = P1(O.down);

def({
  id: 'ㅏ', kind: 'vowel',
  desc: '주먹에서 검지만 위로 곧게 세우고, 손바닥이 화면 쪽을 보게 해요.',
  tips: ['손등이 화면 쪽을 보면 ㅗ 가 돼요.', '숫자 1 과 손 모양이 같아요.'],
  view: VIEW_PALM,
  checks: [...V.a, palm('forward')], pose: P1(O.palmFwd),
  confusables: ['num-1', 'ㅗ', 'ㅐ', 'ㅘ'], sameAs: ['num-1'],
});
def({
  id: 'ㅑ', kind: 'vowel',
  desc: '주먹에서 검지와 중지를 펴서 벌려 위로 세우고, 손바닥이 화면 쪽을 보게 해요.',
  tips: ['손등이 화면 쪽을 보면 ㅛ 가 돼요.', '숫자 2 와 손 모양이 같아요.'],
  view: VIEW_PALM,
  checks: [...V.ya, palm('forward')], pose: P2(O.palmFwd),
  confusables: ['num-2', 'ㅛ', 'ㅒ'], sameAs: ['num-2'],
});
def({
  id: 'ㅓ', kind: 'vowel',
  desc: '주먹에서 검지를 펴서 손끝이 화면(보는 사람)을 가리키게 해요. 손을 옆으로 세워 손바닥이 왼쪽을 보게 해요.',
  tips: ['검지가 카메라를 똑바로 가리켜요.', '엄지는 접힌 중지 위에 얹어 주세요.'],
  view: VIEW_SIDE,
  checks: [...V.eo, palm('left')], pose: P1(O.forward),
  confusables: ['ㅡ', 'ㅕ', 'ㅔ', 'num-10'],
});
def({
  id: 'ㅕ', kind: 'vowel',
  desc: '주먹에서 검지와 중지를 펴서 벌려 손끝이 화면 쪽을 가리키게 해요. 손바닥이 왼쪽을 보게 해요.',
  tips: ['ㅓ 에 중지를 더한 모양이에요.'],
  view: VIEW_SIDE,
  checks: [...V.yeo, palm('left')], pose: P2(O.forward),
  confusables: ['ㅓ', 'ㄷ', 'ㅖ'],
});
def({
  id: 'ㅗ', kind: 'vowel',
  desc: '주먹에서 검지만 위로 곧게 세우고, 손등이 화면 쪽을 보게 해요.',
  tips: ['손바닥이 화면 쪽을 보면 ㅏ 가 돼요.', '엄지는 손바닥 쪽에 숨겨 주세요.'],
  view: VIEW_BACK,
  checks: [...V.a, palm('back')], pose: POSE_O,
  confusables: ['ㅏ', 'num-1', 'ㅚ', 'ㅘ'],
});
def({
  id: 'ㅛ', kind: 'vowel',
  desc: '주먹에서 검지와 중지를 펴서 벌려 위로 세우고, 손등이 화면 쪽을 보게 해요.',
  tips: ['손바닥이 화면 쪽을 보면 ㅑ 가 돼요.'],
  view: VIEW_BACK,
  checks: [...V.ya, palm('back')], pose: P2(O.palmBack),
  confusables: ['ㅑ', 'num-2', 'ㅗ'],
});
def({
  id: 'ㅜ', kind: 'vowel',
  desc: '주먹에서 검지만 펴서 손끝이 아래를 향하게 하고, 손등이 화면 쪽을 보게 해요.',
  tips: ['엄지는 숨겨 주세요. 엄지를 옆으로 펴면 ㄱ 이 돼요.'],
  view: VIEW_BACK,
  checks: [...V.u, palm('back')], pose: POSE_U,
  confusables: ['ㄱ', 'ㅟ', 'ㅠ', 'ㅗ'],
});
def({
  id: 'ㅠ', kind: 'vowel',
  desc: '주먹에서 검지와 중지를 펴서 아주 조금만 벌리고, 손끝이 아래를 향하게 해요. 손등이 화면 쪽을 보게 해요.',
  tips: ['두 손가락을 크게 벌리면 ㅅ 이 돼요. 거의 붙여 주세요.', '엄지를 옆으로 펴면 ㅈ 이 돼요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle'), point('index', 'down'), spreadMax('index', 'middle', 14, '거의 붙이기'), thumbFold(), ...folds('ring', 'pinky'), palm('back')],
  pose: pose(O.down, T_ACROSS, EXT(3), EXT(-3), CURL, CURLP),
  confusables: ['ㅅ', 'ㅜ', 'ㅈ', 'ㅆ'],
});
def({
  id: 'ㅡ', kind: 'vowel',
  desc: '주먹에서 검지만 펴서 손끝이 왼쪽을 향하게 눕혀요. 손을 모로 세워 손등이 화면 쪽을 보게 해요.',
  tips: ['엄지는 접어 주세요. 엄지를 위로 세우면 ㄴ 이 돼요.'],
  view: VIEW_BACK,
  checks: [...V.eu, palm('back')], pose: P1(O.left),
  confusables: ['ㄴ', 'ㅓ', 'ㅢ', 'num-6'],
});
def({
  id: 'ㅣ', kind: 'vowel',
  desc: '주먹에서 새끼손가락만 위로 곧게 세우고, 손바닥이 화면 쪽을 보게 해요.',
  tips: ['새끼손가락을 더하면 모음에 ㅣ 가 붙어요 (ㅐ, ㅔ, ㅚ …).'],
  view: VIEW_PALM,
  checks: [ext('pinky'), point('pinky', 'up'), thumbFold(), ...folds('index', 'middle', 'ring'), palm('forward')],
  pose: pose(O.palmFwd, T_ACROSS, CURL, CURL, CURL, EXT(6)),
  confusables: ['ㅐ', 'ㅚ'],
});

// ── 모음 3: ㅐ ㅒ ㅔ ㅖ ㅚ ㅟ ㅢ — 기본 모음 모양에 새끼손가락을 더 펴기 ──
def({
  id: 'ㅐ', kind: 'compound',
  desc: '주먹에서 검지와 새끼손가락을 위로 펴고, 손바닥이 화면 쪽을 보게 해요. (ㅏ + 새끼손가락)',
  tips: ['손등이 화면 쪽을 보면 ㅚ 가 돼요.'],
  view: VIEW_PALM,
  checks: [...V.ae, palm('forward')], pose: P1i(O.palmFwd),
  confusables: ['ㅚ', 'ㅏ', 'ㅣ', 'ㅒ', 'ㅙ'],
});
def({
  id: 'ㅒ', kind: 'compound',
  desc: '주먹에서 검지 · 중지 · 새끼손가락을 펴서 벌려 위로 세우고, 손바닥이 화면 쪽을 보게 해요. (ㅑ + 새끼손가락)',
  tips: ['약지는 접어 주세요. 약지를 펴고 새끼손가락을 접으면 숫자 3 이에요.'],
  view: VIEW_PALM,
  checks: [...V.yae, palm('forward')], pose: P2i(O.palmFwd),
  confusables: ['ㅐ', 'ㅑ', 'num-3'],
});
def({
  id: 'ㅔ', kind: 'compound',
  desc: '주먹에서 검지와 새끼손가락을 펴서 손끝이 화면 쪽을 가리키게 하고, 손바닥이 왼쪽을 보게 해요. (ㅓ + 새끼손가락)',
  tips: ['위에 검지, 아래에 새끼손가락이 나란히 화면을 가리켜요.'],
  view: VIEW_SIDE,
  checks: [...V.e, palm('left')], pose: P1i(O.forward),
  confusables: ['ㅓ', 'ㅖ', 'ㅢ', 'ㅞ'],
});
def({
  id: 'ㅖ', kind: 'compound',
  desc: '주먹에서 검지 · 중지 · 새끼손가락을 펴서 벌려 손끝이 화면 쪽을 가리키게 하고, 손바닥이 왼쪽을 보게 해요. (ㅕ + 새끼손가락)',
  tips: ['약지는 접어 주세요.'],
  view: VIEW_SIDE,
  checks: [...V.ye, palm('left')], pose: P2i(O.forward),
  confusables: ['ㅕ', 'ㅔ', 'ㄹ'],
});
def({
  id: 'ㅚ', kind: 'compound',
  desc: '주먹에서 검지와 새끼손가락을 위로 펴고, 손등이 화면 쪽을 보게 해요. (ㅗ + 새끼손가락)',
  tips: ['손바닥이 화면 쪽을 보면 ㅐ 가 돼요.'],
  view: VIEW_BACK,
  checks: [...V.ae, palm('back')], pose: P1i(O.palmBack),
  confusables: ['ㅐ', 'ㅗ', 'ㅟ', 'ㅙ'],
});
def({
  id: 'ㅟ', kind: 'compound',
  desc: '주먹에서 검지와 새끼손가락을 펴서 손끝이 아래를 향하게 하고, 손등이 화면 쪽을 보게 해요. (ㅜ + 새끼손가락)',
  tips: ['엄지는 숨겨 주세요.'],
  view: VIEW_BACK,
  checks: [...V.wi, palm('back')], pose: P1i(O.down),
  confusables: ['ㅜ', 'ㅚ', 'ㅞ'],
});
def({
  id: 'ㅢ', kind: 'compound',
  desc: '주먹에서 검지와 새끼손가락을 펴서 손끝이 왼쪽을 향하게 눕히고, 손등이 화면 쪽을 보게 해요. (ㅡ + 새끼손가락)',
  tips: ['검지가 위, 새끼손가락이 아래에 와요.'],
  view: VIEW_BACK,
  checks: [...V.ui, palm('back')], pose: P1i(O.left),
  confusables: ['ㅡ', 'ㄷ', 'ㅔ'],
});

// ── 모음 4: ㅘ ㅙ ㅝ ㅞ — 두 동작 (처음 모양 → 손목을 돌려 끝 모양) ──
const seq = (fromChecks, hintFirst, hintThen, desc) => Object.freeze({
  type: 'sequence', from: fromChecks, within: 3000, hintFirst, hintThen, desc,
});
def({
  id: 'ㅘ', kind: 'compound',
  desc: 'ㅗ 모양(검지 위, 손등이 화면 쪽)을 만든 다음, 손목을 돌려 손바닥이 화면 쪽을 보게 해요. (ㅗ → ㅏ)',
  tips: ['검지는 계속 위를 가리켜요.', '두 모양을 이어서, 3초 안에 해 주세요.'],
  view: VIEW_PALM,
  checks: [...V.a, palm('forward')],
  motion: seq([...V.a, palm('back')], '먼저 ㅗ 모양을 만들어 주세요 (손등이 화면 쪽)', '이제 손목을 돌려 손바닥이 화면 쪽을 보게 해 주세요', 'ㅗ 모양에서 손목을 돌려 ㅏ 모양으로'),
  pose: P1(O.palmFwd), startPose: POSE_O,
  confusables: ['ㅏ', 'ㅗ', 'ㅙ'],
});
def({
  id: 'ㅙ', kind: 'compound',
  desc: 'ㅗ 모양(검지 위, 손등이 화면 쪽)을 만든 다음, 새끼손가락을 펴면서 손목을 돌려 손바닥이 화면 쪽을 보게 해요. (ㅗ → ㅐ)',
  tips: ['끝 모양은 ㅐ 예요.', '두 모양을 이어서, 3초 안에 해 주세요.'],
  view: VIEW_PALM,
  checks: [...V.ae, palm('forward')],
  motion: seq([...V.a, palm('back')], '먼저 ㅗ 모양을 만들어 주세요 (손등이 화면 쪽)', '이제 새끼손가락을 펴며 손목을 돌려 손바닥이 화면 쪽을 보게 해 주세요', 'ㅗ 모양에서 새끼손가락을 펴며 ㅐ 모양으로'),
  pose: P1i(O.palmFwd), startPose: POSE_O,
  confusables: ['ㅚ', 'ㅐ', 'ㅘ'],
});
def({
  id: 'ㅝ', kind: 'compound',
  desc: 'ㅜ 모양(검지 아래, 손등이 화면 쪽)을 만든 다음, 손을 들어 돌려서 검지가 화면 쪽을 가리키고 손바닥이 왼쪽을 보게 해요. (ㅜ → ㅓ)',
  tips: ['끝 모양은 ㅓ 예요.', '두 모양을 이어서, 3초 안에 해 주세요.'],
  view: VIEW_SIDE,
  checks: [...V.eo, palm('left')],
  motion: seq([...V.u, palm('back')], '먼저 ㅜ 모양을 만들어 주세요 (검지가 아래)', '이제 손을 들어 검지가 화면 쪽을 가리키게 해 주세요', 'ㅜ 모양에서 손을 돌려 ㅓ 모양으로'),
  pose: P1(O.forward), startPose: POSE_U,
  confusables: ['ㅜ', 'ㅓ', 'ㅞ'],
});
def({
  id: 'ㅞ', kind: 'compound',
  desc: 'ㅜ 모양(검지 아래, 손등이 화면 쪽)을 만든 다음, 새끼손가락을 펴면서 손을 돌려 두 손가락이 화면 쪽을 가리키게 해요. (ㅜ → ㅔ)',
  tips: ['끝 모양은 ㅔ 예요.', '두 모양을 이어서, 3초 안에 해 주세요.'],
  view: VIEW_SIDE,
  checks: [...V.e, palm('left')],
  motion: seq([...V.u, palm('back')], '먼저 ㅜ 모양을 만들어 주세요 (검지가 아래)', '이제 새끼손가락을 펴며 손을 돌려 화면 쪽을 가리켜 주세요', 'ㅜ 모양에서 새끼손가락을 펴며 ㅔ 모양으로'),
  pose: P1i(O.forward), startPose: POSE_U,
  confusables: ['ㅟ', 'ㅔ', 'ㅝ'],
});

// ── 지숫자 0~10 ──
const num = (n, o) => def({ id: `num-${n}`, kind: 'number', glyph: String(n), name: NUM_NAMES[n], ...o });
const NUM_NAMES = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'];
const sameShape = (id) => DEFS.find((d) => d.id === id);
num(0, {
  desc: '엄지 끝과 검지 끝을 맞대어 동그라미를 만들고, 손바닥이 화면 쪽을 보게 세워요.',
  tips: ['자음 ㅇ 과 손 모양이 같아요.'],
  view: VIEW_PALM, checks: sameShape('ㅇ').checks, pose: sameShape('ㅇ').pose,
  confusables: ['ㅇ', 'num-10'], sameAs: ['ㅇ'],
});
num(1, {
  desc: '주먹에서 검지만 위로 세우고, 손바닥이 화면 쪽을 보게 해요.',
  tips: ['모음 ㅏ 와 손 모양이 같아요.'],
  view: VIEW_PALM, checks: sameShape('ㅏ').checks, pose: sameShape('ㅏ').pose,
  confusables: ['ㅏ', 'ㅗ'], sameAs: ['ㅏ'],
});
num(2, {
  desc: '주먹에서 검지와 중지를 펴서 벌려 위로 세우고, 손바닥이 화면 쪽을 보게 해요.',
  tips: ['모음 ㅑ 와 손 모양이 같아요.'],
  view: VIEW_PALM, checks: sameShape('ㅑ').checks, pose: sameShape('ㅑ').pose,
  confusables: ['ㅑ', 'ㅛ'], sameAs: ['ㅑ'],
});
num(3, {
  desc: '주먹에서 검지 · 중지 · 약지를 위로 펴고, 엄지로 새끼손가락을 눌러요. 손바닥이 화면 쪽을 보게 해요.',
  tips: ['새끼손가락은 접어 주세요.'],
  view: VIEW_PALM,
  checks: [...exts('index', 'middle', 'ring'), point('index', 'up'), thumbFold(), fold('pinky'), palm('forward')],
  pose: pose(O.palmFwd, T_ACROSS, EXT(8), EXT(0), EXT(7), CURLP),
  confusables: ['ㅒ', 'ㄹ', 'num-4'],
});
num(4, {
  desc: '엄지를 손바닥 쪽으로 접고, 나머지 네 손가락을 펴서 벌려 위로 세워요. 손바닥이 화면 쪽을 보게 해요.',
  tips: ['네 손가락을 붙이면 자음 ㅂ 이 돼요. 벌려 주세요.'],
  view: VIEW_PALM,
  checks: [...exts('index', 'middle', 'ring', 'pinky'), point('index', 'up'), spreadMin('index', 'middle', 12), thumbFold(), palm('forward')],
  pose: pose(O.palmFwd, T_PALM, EXT(14), EXT(-10), EXT(10), EXT(18)),
  confusables: ['ㅂ', 'ㅃ', 'num-3'],
});
num(5, {
  desc: '주먹을 쥐고 엄지만 펴서 왼쪽으로 눕혀요. 주먹 앞(손바닥 쪽)이 화면 쪽을 보게 해요.',
  tips: ['한국수어의 5 는 엄지 하나예요.', '엄지를 위로 세우면 자음 ㅎ 이 돼요.'],
  view: VIEW_PALM,
  checks: [thumbExt(), thumbDir('left'), ...['index', 'middle', 'ring', 'pinky'].map(curl), palm('forward')],
  pose: pose(O.palmFwd, T_OUT, CURL, CURL, CURL, CURLP),
  confusables: ['ㅎ'],
});
num(6, {
  desc: '주먹에서 엄지와 검지를 펴요. 엄지는 위로, 검지는 왼쪽으로 하고, 손을 모로 세워 손등이 화면 쪽을 보게 해요.',
  tips: ['자음 ㄴ 과 손 모양이 같아요.', '6 부터는 엄지(5)에 손가락을 하나씩 더해요.'],
  view: VIEW_BACK, checks: sameShape('ㄴ').checks, pose: sameShape('ㄴ').pose,
  confusables: ['ㄴ', 'ㄱ', 'num-7'], sameAs: ['ㄴ'],
});
num(7, {
  desc: '주먹에서 엄지 · 검지 · 중지를 펴요. 엄지는 위로, 검지와 중지는 벌려 왼쪽으로 하고, 손등이 화면 쪽을 보게 해요.',
  tips: ['엄지를 접으면 자음 ㄷ 이 돼요.'],
  view: VIEW_BACK,
  checks: [...exts('index', 'middle'), point('index', 'left'), thumbExt(), thumbDir('up'), ...folds('ring', 'pinky'), palm('back')],
  pose: pose(O.left, T_OUT, EXT(8), EXT(-6), CURL, CURLP),
  confusables: ['ㄷ', 'num-6', 'ㅈ'],
});
num(8, {
  desc: '새끼손가락만 접고 나머지 네 손가락을 펴서 벌려요. 손등이 화면 쪽을 보게 비스듬히(손끝이 왼쪽 위) 세워요.',
  tips: ['새끼손가락까지 펴면 9 가 돼요.'],
  view: VIEW_BACK,
  checks: [thumbExt(), thumbOpen(), ...exts('index', 'middle', 'ring'), point('index', ['up+left', 'up', 'left'], '왼쪽 위로'), fold('pinky'), palm('back')],
  pose: pose(O.diag, T_OUT, EXT(12), EXT(0), EXT(10), CURLP),
  confusables: ['ㅊ', 'num-9', 'ㄹ'],
});
num(9, {
  desc: '다섯 손가락을 모두 펴서 벌려요. 손등이 화면 쪽을 보게(손바닥은 내 쪽) 비스듬히 세워요.',
  tips: ['손바닥이 화면 쪽을 보지 않게 해 주세요.'],
  view: VIEW_BACK,
  checks: [thumbExt(), thumbOpen(), ...exts('index', 'middle', 'ring', 'pinky'), point('index', ['up+left', 'up', 'left'], '왼쪽 위로'), palm('back')],
  pose: pose(O.diag, T_OUT, EXT(12), EXT(0), EXT(10), EXT(18)),
  confusables: ['num-8', 'ㅂ'],
});
num(10, {
  desc: '주먹에서 검지를 펴서 살짝 구부리고, 손끝이 화면 쪽을 가리키게 한 채 좌우로 작게 흔들어요.',
  tips: ['동그라미(0 과 같은 모양)로 10 을 나타내기도 해요.', '흔들지 않으면 모음 ㅓ 와 비슷해요.'],
  view: VIEW_SIDE,
  refView: Object.freeze({ yaw: 62, pitch: 20, focal: 3.5 }),
  checks: [{ ...ext('index'), state: ['extended', 'hooked'], label: '검지 펴서 살짝 구부리기', msg: '검지를 펴서 살짝만 구부려 주세요' },
    point('index', 'forward'), thumbFold(), ...['middle', 'ring', 'pinky'].map(curl)],
  motion: SHAKE_SIDE,
  pose: pose(O.tenPoint, T_ACROSS, F(4, 22, 14, 2), CURL, CURL, CURLP),
  confusables: ['ㅓ', 'num-0'],
});

// ───────── 단원 ─────────
export const UNITS = Object.freeze([
  { id: 'c1', name: '자음 1', kind: 'consonant', letters: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ'], desc: '기역부터 미음까지 자음 다섯 개를 배워요.' },
  { id: 'c2', name: '자음 2', kind: 'consonant', letters: ['ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ'], desc: '비읍부터 치읓까지 자음 다섯 개를 배워요.' },
  { id: 'c3', name: '자음 3', kind: 'consonant', letters: ['ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'], desc: '키읔부터 히읗까지 자음 네 개를 배워요.' },
  { id: 'd1', name: '된소리', kind: 'double', letters: ['ㄲ', 'ㄸ', 'ㅃ', 'ㅆ', 'ㅉ'], desc: '기본 자음 모양을 오른쪽으로 한 번 옮겨요.' },
  { id: 'v1', name: '모음 1', kind: 'vowel', letters: ['ㅏ', 'ㅑ', 'ㅓ', 'ㅕ', 'ㅗ'], desc: '검지의 방향과 손바닥 방향으로 모음을 나타내요.' },
  { id: 'v2', name: '모음 2', kind: 'vowel', letters: ['ㅛ', 'ㅜ', 'ㅠ', 'ㅡ', 'ㅣ'], desc: '아래 · 왼쪽을 가리키는 모음과 ㅣ 를 배워요.' },
  { id: 'v3', name: '모음 3', kind: 'compound', letters: ['ㅐ', 'ㅒ', 'ㅔ', 'ㅖ', 'ㅚ', 'ㅟ', 'ㅢ'], desc: '새끼손가락을 더 펴서 ㅣ 가 붙은 모음을 만들어요.' },
  { id: 'v4', name: '모음 4', kind: 'compound', letters: ['ㅘ', 'ㅙ', 'ㅝ', 'ㅞ'], desc: '두 모양을 이어서 하는 모음이에요. 손목을 돌려요.' },
  { id: 'n1', name: '숫자 0~5', kind: 'number', letters: ['num-0', 'num-1', 'num-2', 'num-3', 'num-4', 'num-5'], desc: '지숫자 0부터 5까지 배워요. 5 는 엄지 하나예요.' },
  { id: 'n2', name: '숫자 6~10', kind: 'number', letters: ['num-6', 'num-7', 'num-8', 'num-9', 'num-10'], desc: '엄지에 손가락을 더해 6~9, 그리고 10 을 배워요.' },
].map((u, i) => Object.freeze({ ...u, order: i + 1, letters: Object.freeze(u.letters) })));

const UNIT_OF = new Map();
for (const u of UNITS) u.letters.forEach((id, i) => UNIT_OF.set(id, { unit: u.id, order: i + 1 }));

const JAMO_NAMES = {
  'ㄱ': '기역', 'ㄴ': '니은', 'ㄷ': '디귿', 'ㄹ': '리을', 'ㅁ': '미음', 'ㅂ': '비읍', 'ㅅ': '시옷', 'ㅇ': '이응',
  'ㅈ': '지읒', 'ㅊ': '치읓', 'ㅋ': '키읔', 'ㅌ': '티읕', 'ㅍ': '피읖', 'ㅎ': '히읗',
  'ㄲ': '쌍기역', 'ㄸ': '쌍디귿', 'ㅃ': '쌍비읍', 'ㅆ': '쌍시옷', 'ㅉ': '쌍지읒',
  'ㅏ': '아', 'ㅐ': '애', 'ㅑ': '야', 'ㅒ': '얘', 'ㅓ': '어', 'ㅔ': '에', 'ㅕ': '여', 'ㅖ': '예', 'ㅗ': '오', 'ㅘ': '와',
  'ㅙ': '왜', 'ㅚ': '외', 'ㅛ': '요', 'ㅜ': '우', 'ㅝ': '워', 'ㅞ': '웨', 'ㅟ': '위', 'ㅠ': '유', 'ㅡ': '으', 'ㅢ': '의', 'ㅣ': '이',
};

function finish(d) {
  const key = d.kind === 'number' ? d.id.slice(4) : d.id;
  const [official = '', query = '', confidence = 'medium'] = OFFICIAL[key] || [];
  const place = UNIT_OF.get(d.id) || { unit: null, order: 0 };
  const out = {
    id: d.id,
    name: d.name || JAMO_NAMES[d.id] || d.id,
    glyph: d.glyph || d.id,
    jamo: d.kind === 'number' ? null : d.id,
    kind: d.kind,
    unit: place.unit,
    order: place.order,
    desc: d.desc,
    tips: Object.freeze(d.tips || []),
    viewNote: d.view || '그림은 거울에 비친 내 손처럼 보여요.',
    official,
    confidence,
    source: SOURCE,
    sources: Object.freeze([query ? SLDICT_VIEW + query : SOURCE]),
    checks: Object.freeze(d.checks.map((c) => Object.freeze({ ...c }))),
    motion: d.motion || null,
    pose: d.pose,
    startPose: d.startPose || null,
    refView: d.refView || (d.view === VIEW_SIDE ? SIDE_VIEW : null),
    base: d.base || null,
    confusables: Object.freeze(d.confusables || []),
    sameAs: Object.freeze(d.sameAs || []),
  };
  return Object.freeze(out);
}

/** 한국수어 지문자 · 지숫자 전체 (단원 순서) */
export const LETTERS = Object.freeze(
  UNITS.flatMap((u) => u.letters).map((id) => finish(DEFS.find((d) => d.id === id))),
);

// ───────── 연습용 손 모양 (지문자가 아님, 단원에 넣지 않음) ─────────
// 카메라 · 판정이 되는지 확인하거나 시험할 때만 씀. getLetter('demo-open') 처럼 찾을 수 있음
export const DEMO_NOTICE = '연습용 손 모양이에요. 한국수어 지문자는 아니에요.';
const demo = (id, name, glyph, checks, p) => Object.freeze({
  id, name, glyph, jamo: null, kind: 'demo', unit: null, order: 0, desc: DEMO_NOTICE, tips: [], viewNote: '', official: '',
  confidence: 'high', source: '', sources: [], checks, motion: null, pose: p, startPose: null, base: null, confusables: [], sameAs: [],
});
export const DEMO_LETTERS = Object.freeze([
  demo('demo-open', '손바닥 펴기', '🖐', [...exts('thumb', 'index', 'middle', 'ring', 'pinky'), palm('forward')], PRESETS.open),
  demo('demo-fist', '주먹', '✊', [...['index', 'middle', 'ring', 'pinky'].map(curl), thumbFold()], PRESETS.fist),
]);

const byId = new Map([...LETTERS, ...DEMO_LETTERS].map((l) => [l.id, l]));

/** id 로 글자 찾기 (없으면 null). 자모 글자는 id 가 자모 그대로 ('ㄱ'), 숫자는 'num-3' */
export function getLetter(id) {
  return byId.get(id) || null;
}

/** 자모(ㄱ, ㅘ …) 또는 숫자('3') → 글자 (없으면 null) */
export function letterForJamo(jamo) {
  const s = String(jamo);
  return byId.get(s) || byId.get(`num-${s}`) || null;
}

/** id 로 단원 찾기 (없으면 null) */
export function getUnit(id) {
  return UNITS.find((u) => u.id === id) || null;
}

/** 단원에 속한 글자들 (단원 안 순서) */
export function lettersOfUnit(unitId) {
  const u = getUnit(unitId);
  return u ? u.letters.map((id) => byId.get(id)) : [];
}

/** 글자 종류별 (예: lettersOfKind('number')) */
export function lettersOfKind(...kinds) {
  return LETTERS.filter((l) => kinds.includes(l.kind));
}

/** 지문자만 (숫자 빼고) — 자유 쓰기 · 낱말 쓰기에서 ㅏ 와 1 처럼 같은 모양이 겹치지 않게 */
export const SPELLING_LETTERS = Object.freeze(LETTERS.filter((l) => l.kind !== 'number'));
/** 숫자만 */
export const NUMBER_LETTERS = Object.freeze(LETTERS.filter((l) => l.kind === 'number'));

/**
 * 글자를 "해 보이는" 손 움직임 대본 (합성 손 인식기 · 시연 · 시험용)
 * @returns {{pose: object, ms: number, blend?: number, dx?: number, dy?: number}[]}
 *   dx, dy: 수어하는 사람 기준 손 위치 이동 (손바닥 길이 단위, + 오른쪽 / + 위)
 */
export function letterScript(letter, { holdMs = 1200 } = {}) {
  if (!letter) return [];
  const m = letter.motion;
  if (!m) return [{ pose: letter.pose, ms: holdMs }];
  if (m.type === 'move') {
    const v = { right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1] }[m.dir] || [1, 0];
    const d = (m.minDist || 1) * 1.4;
    return [
      { pose: letter.pose, ms: 400 },
      { pose: letter.pose, ms: 0, blend: 350, dx: v[0] * d, dy: v[1] * d },
      { pose: letter.pose, ms: holdMs, dx: v[0] * d, dy: v[1] * d },
    ];
  }
  if (m.type === 'shake') {
    const a = (m.minDist || 0.3) * 1.5;
    const frames = [{ pose: letter.pose, ms: 200 }];
    for (let i = 0; i < (m.count || 3) + 2; i++) frames.push({ pose: letter.pose, ms: 0, blend: 140, dx: i % 2 ? -a : a });
    frames.push({ pose: letter.pose, ms: holdMs, blend: 140 });
    return frames;
  }
  if (m.type === 'sequence') {
    return [
      { pose: letter.startPose || letter.pose, ms: 700 },
      { pose: letter.pose, ms: holdMs, blend: 450 },
    ];
  }
  return [{ pose: letter.pose, ms: holdMs }];
}

export { withPose };
