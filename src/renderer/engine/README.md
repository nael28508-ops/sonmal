# 판정 엔진 (engine)

손 인식 결과(MediaPipe 손 마디 21개)를 받아 "지금 손 모양이 이 지문자가 맞는지, 틀렸다면 어느 손가락을 어떻게 고치면 되는지"를 알려 주는 부분이에요.
화면(DOM)을 쓰지 않는 순수 ES 모듈이라 Node 에서도 돌아가고, `tests/` 의 단위 테스트로 확인해요.

```
node --test "tests/*.test.mjs"      # Node 24 는 node --test tests/ 처럼 폴더를 주면 안 돼요
```

## 좌표 약속 (모든 모듈 공통)

- **S 좌표**: 수어하는 사람 기준. `x` = 내 오른쪽, `y` = 위, `z` = 앞(카메라 · 보는 사람 쪽).
- 카메라 원본 축에서 S 로: `S.x = -raw.x`, `S.y = -raw.y`, `S.z = -raw.z` (영상 마디는 x, z 에 가로세로 비율을 곱함).
- **왼손**(handedness `Left`)은 `S.x` 를 한 번 더 뒤집어 오른손 정의로 판정해요(거울 판정). 이때 글자 문구의 '왼쪽' ↔ '오른쪽' 도 바꿔서 보여 줘요.
- 방향 이름: `up` `down` `left` `right` `forward`(화면 쪽) `back`(내 쪽). `'up+left'` 처럼 이으면 사이 방향.
- 국립국어원 한국수어사전의 '밖' = `forward`, '안' = `back`, 왼쪽/오른쪽 = 수어하는 사람의 왼쪽/오른쪽.

## 모듈

| 파일 | 하는 일 | 주요 함수 |
|---|---|---|
| `geometry.js` | 3차원 벡터 · 회전 · 방향 이름 | `dirVector`, `nearestDir`, `angleBetween`, `rotate`, `eulerMatrix`, `seededRandom` … |
| `handmodel.js` | 손 모형(관절 각도 → 21점) | `NEUTRAL_POSE`, `PRESETS`, `normalizePose`, `withPose`, `lerpPose`, `buildHand`, `poseToS`, `poseToHand` |
| `features.js` | 손 마디 → 손 특징 | `extractFeatures`, `pickHand`, `qualityMessage`, `spreadBetween`, 한국어 이름표 |
| `rules.js` | 글자 판정 · 분류 | `evaluate`, `classify`, `registerPredicate`, `explainCheck`, `validateLetter`, `TOLERANCE` |
| `letters.js` | 지문자 40개 + 지숫자 0~10, 단원 | `LETTERS`, `UNITS`, `getLetter`, `lettersOfUnit`, `letterForJamo`, `SPELLING_LETTERS`, `NUMBER_LETTERS`, `letterScript`, `DEMO_LETTERS` |
| `motion.js` | 움직임 판정 | `createMotionTracker` → `{ push(features, t), reset(), check(spec, {strictness}) }` |
| `filters.js` | 떨림 줄이기 · 버티기 | `createLandmarkSmoother`, `createOneEuro`, `createHold` |
| `hangul.js` | 낱말 → 지문자 순서, 모아쓰기 | `decomposeForSpelling`, `KSL_SPELLING`, `compose`, `createComposer`, `jamoName` |
| `knn.js` | 선생님 손 본뜨기 | `vectorize`, `createTemplateStore`, 기본 저장소 `addTemplate` / `match` / `exportTemplates` / `importTemplates` |
| `progress.js` | 배운 기록 · 복습 일정 | `createProgress({ storage, now })` |

함께 쓰는 화면 쪽 모듈 (엔진 담당이 만듦):
- `ui/hand-render.js` — `drawReferenceHand(ctx, letter|pose|points, opts)`, `drawLiveHand(ctx, hand, evaluation, opts)`, `makeLandmarkMapper`
- `core/synthetic-tracker.js` — `createSyntheticTracker(opts)` (카메라 없이 HandFrame 을 만드는 가짜 인식기)

### 한 프레임 처리 순서 (배우기 화면 예)

```js
import { pickHand, extractFeatures, qualityMessage } from './engine/features.js';
import { evaluate } from './engine/rules.js';
import { createMotionTracker } from './engine/motion.js';
import { createHold, createLandmarkSmoother } from './engine/filters.js';

const smoother = createLandmarkSmoother(), motion = createMotionTracker(), hold = createHold({ ms: 600 });
tracker.onFrame((frame) => {
  const raw = pickHand(frame.hands, { dominant });                 // 'right' | 'left' (설정)
  const hand = raw && smoother.smooth(raw, frame.t);
  const f = hand && extractFeatures(hand, { aspect: frame.videoW / frame.videoH, dominant });
  motion.push(f, frame.t);
  const ev = evaluate(letter, f, { strictness, motionState: letter.motion ? motion.check(letter.motion, { strictness }) : null });
  // ev.worst?.msg → 큰 안내 문구 하나, ev.checks → ✓/✗ 목록, ev.fingerStatus → 손가락 색
  if (hold.push(ev.pass, frame.t).held) { /* 성공! */ }
  if (f && !f.quality.ok) { /* qualityMessage(f) 로 "손이 너무 작게 보여요" 같은 안내 */ }
});
```
글자가 바뀌면 `motion.reset()`, `hold.reset()` 를 불러 주세요.

## HandFeatures (extractFeatures 결과)

SPEC 의 모양 그대로이고, 덧붙인 것: `isDominant`, `score`, `thumbGeom`(엄지 위치 계산 값), `points`(S 좌표 21점, 손목 원점, 손바닥 길이 단위), `frame`(`{u, r, n}` 손 기준 축), `source`(`'world'|'image'`), `screen.aspect`.
- 관절 각도는 world 마디(없으면 영상 마디)로 계산해요. 0° = 곧게, + = 손바닥 쪽으로 굽힘.
- `state`: `extended` / `hooked`(뿌리는 펴고 끝 두 마디 굽힘) / `bent`(뿌리만 굽힘) / `curled`(모두 굽힘). 판정에서는 `folded`(어느 쪽이든 굽힘)도 쓸 수 있어요.
- `spread` · `together` 판정은 손가락 방향을 **손바닥 평면에 내려서** 잰 각도예요(굽힌 정도가 달라도 옆으로 벌린 만큼만 나오게).
- `thumbPos`: `out`(옆으로 벌림) `up`(손 축 따라 세움) `side`(검지 옆에 붙임) `across`(손가락 위 · 손바닥 쪽으로 접음) `tucked`(손가락 안) `front`(앞으로 내밂).

## 글자 데이터 (Letter)

```js
{
  id: 'ㄱ',               // 자모는 자모 그대로, 숫자는 'num-0' ~ 'num-10'
  name: '기역', glyph: 'ㄱ', jamo: 'ㄱ' | null,
  kind: 'consonant' | 'double' | 'vowel' | 'compound' | 'number' | 'demo',
  unit: 'c1', order: 1,   // 단원과 단원 안 순서
  desc: '…', tips: ['…'], viewNote: '그림은 거울에 비친 내 손이에요. …',
  official: '오른 주먹의 1·5지를 펴서 …',   // 한국수어사전 수형 설명 원문 (1지 = 검지 … 5지 = 엄지)
  confidence: 'high' | 'medium' | 'low', source: 'https://sldict.korean.go.kr', sources: ['낱말 주소'],
  checks: [Check, …],     // 모두 맞아야 통과 (순서 = 화면 목록 순서)
  motion: null | MotionSpec,
  pose: HandPose,         // 참고 그림 · 합성 인식기 · 시험에 쓰는 바른 자세 (자기 checks 를 꼭 통과)
  startPose: HandPose | null,   // 두 동작 글자(ㅘ ㅙ ㅝ ㅞ)의 처음 자세
  refView: { yaw, pitch, focal } | null,   // 참고 그림을 볼 각도 (손끝이 화면 쪽인 글자는 비스듬히)
  base: 'ㄱ' | null,      // 된소리의 기본 자음
  confusables: ['ㅜ', …], // 헷갈리기 쉬운 글자 (연습 · 퀴즈 보기용)
  sameAs: ['num-6'],      // 손 모양이 아예 같은 글자 (ㅏ=1, ㅑ=2, ㅇ=0, ㄴ=6)
}
```

### Check (확인 항목) — 판정 조건은 꼭 하나

공통: `{ id, label, msg, weight? }` — `label` 은 목록에 보일 짧은 이름, `msg` 는 틀렸을 때 보여 줄 존댓말 안내(예: '약지를 접어 주세요').

| 종류 | 모양 | 뜻 |
|---|---|---|
| state | `{ finger, state: 'extended'|'hooked'|'bent'|'curled'|'folded' | [...] }` | 손가락 상태 |
| dir | `{ finger, dir: 'down' | ['up+left','up'] }` | 손가락(뿌리→끝)이 가리키는 방향 (허용 각도 안) |
| angle | `{ finger, angle: { joint, min?, max? } }` | 관절 각도 범위 |
| palm | `{ palm: 'forward' }` | 손바닥이 보는 방향 |
| hand | `{ hand: 'up' }` | 손목→중지 뿌리 방향 |
| thumb | `{ thumb: ['across','tucked','side','front'] }` | 엄지 위치 |
| touch / apart | `{ touch: ['thumb', 'index'] }` (`'index.pip'`, `'palm'` 도 됨) | 끝끼리 닿음 / 떨어짐 |
| together | `{ together: ['index','middle'] }` | 나란히 붙임 |
| spread | `{ spread: { a, b, min?, max? } }` | 두 손가락 벌림 각도 |
| custom | `{ custom: 'halfBent', finger }` | `registerPredicate` 로 등록한 판정. 기본 등록: `halfBent`(반쯤 굽힘, curl 0.18~0.8) |

엄격함(`lenient` / `normal` / `strict`)은 `rules.js` 의 `TOLERANCE` 표 하나로 모든 기준을 넓히거나 좁혀요.

### MotionSpec (움직임)

| type | 모양 | 뜻 |
|---|---|---|
| move | `{ type:'move', dir:'right', minDist: 0.8, within: 1500 }` | 손을 그 방향으로 옮김 (손바닥 길이 단위). 된소리 = 오른쪽으로 한 번 |
| shake | `{ type:'shake', dir:'left', minDist, count, within }` | 그 축으로 흔들기 (지숫자 10) |
| twist | `{ type:'twist', dir:'in'|'out', minAngle }` | 손목 돌리기 |
| sequence | `{ type:'sequence', from: [Check…], to?: [Check…], within: 3000, hintFirst, hintThen }` | 처음 모양(from)을 만든 뒤 끝 모양으로 바꾸기. 끝 모양은 글자 checks 가 봄 (ㅘ = ㅗ → ㅏ, ㅙ = ㅗ → ㅐ, ㅝ = ㅜ → ㅓ, ㅞ = ㅜ → ㅔ) |

`evaluate` 는 움직임 결과를 `kind: 'motion'` 확인 항목으로 덧붙이고(모양이 다 맞은 뒤 안내), 움직임 안내 문구(`hint`)를 `msg` 로 보여 줘요.

## 글자 내용과 근거

- 모든 정의는 국립국어원 한국수어사전(https://sldict.korean.go.kr)의 수형 설명 · 사진 · 그림을 따랐어요(`official`, `sources`). 오른손 기준이고, 왼손잡이는 거울처럼 판정해요(사전에 왼손 규정은 없음 — 일반적인 수어 관례).
- 모음은 "방향 약속": 검지 위 + 손바닥 앞 = ㅏ, 위 + 손등 앞 = ㅗ, 아래 = ㅜ, 화면 쪽 + 손바닥 왼쪽 = ㅓ, 왼쪽(모로) = ㅡ, 새끼손가락 = ㅣ, 새끼손가락을 더하면 ㅣ 가 붙음(ㅐ ㅔ ㅚ ㅟ ㅢ ㅒ ㅖ).
- 된소리는 기본 자음 모양 + 오른쪽으로 한 번 옮기기(두 번 하는 게 아님).
- 지숫자: 1~4 손바닥 앞, 5 = 엄지 하나를 눕힘, 6~9 = 엄지 + 손가락(손등 앞), 10 = 살짝 구부린 검지로 화면을 가리키고 좌우로 흔들기(사전에는 0 처럼 동그라미로 하는 10 도 있음).
- 신뢰도: ㅁ, ㅍ(굽힘 정도 · 엄지 위치가 사전에 자세히 없음), 10 은 `medium`, 나머지는 `high`.

### 손 모양만으로는 구별되지 않는 짝 (일부러 그렇게 둠)

| 짝 | 이유 | 앱에서 할 일 |
|---|---|---|
| ㅏ = 1, ㅑ = 2, ㅇ = 0, ㄴ = 6 | 사전에서 손 모양이 같음 (`sameAs`) | 자유 쓰기 · 분류는 `SPELLING_LETTERS` 또는 `NUMBER_LETTERS` 한쪽만 넘기기 |
| ㄱ/ㄲ, ㄷ/ㄸ, ㅂ/ㅃ, ㅅ/ㅆ, ㅈ/ㅉ | 움직임(오른쪽으로 옮기기)만 다름 | `motionFor` 를 넘기면 `classify` 가 움직임까지 맞은 글자를 먼저 고름 |
| ㅏ/ㅘ, ㅐ/ㅙ, ㅓ/ㅝ, ㅔ/ㅞ | 끝 모양이 같고 앞 동작(ㅗ, ㅜ)만 다름 | 위와 같음 |
| ㅓ → 10 | ㅓ 모양은 10 의 모양 확인을 통과함(10 은 흔들기가 있어야 성공). 10 자세는 손바닥이 아래라 ㅓ 를 통과하지 않음 | 숫자/글자 모드를 나누면 겹치지 않음 |

나머지 모든 글자 짝은 `tests/letters.test.mjs` 의 혼동 행렬(너그럽게 · 보통 · 엄격하게)에서 서로의 확인 항목을 통과하지 않아요. ㅅ/ㅠ 는 사전에서도 벌림 정도로만 구별해요(ㅅ 18° 이상, ㅠ 14° 이하).

## SPEC 과 다른 점 · 덧붙인 것

- `LETTERS` 에는 실제 지문자 · 지숫자만 있어요. 연습용 손 모양은 `DEMO_LETTERS`(단원 없음)로 옮겼고 `getLetter('demo-open')` 으로는 여전히 찾을 수 있어요.
- 글자 id: 자모는 자모 그대로(`'ㄱ'`, `'ㅘ'`), 숫자는 `'num-3'`. `letterForJamo('ㄱ' | '3')` 도 있어요.
- `motion.js` 의 `check(spec, { strictness })` 에 엄격함을 줄 수 있고, 움직임 종류 `sequence` 가 늘었어요.
- `classify(features, letters, { motionFor })`: 움직임까지 맞은 글자를 정적인 글자보다 먼저 고르고, 결과에 `ambiguous` 가 있어요.
- `evaluate` 결과에 `shapePass`(움직임 빼고 모양만), `palmStatus`, `noHand` 가 더 있어요.
- `hangul.js`: 기본값 `KSL_SPELLING` = 겹받침만 나누고 ㅐㅒㅔㅖㅘㅙㅚㅝㅞㅟㅢ · 된소리는 그대로.
- `knn.js`: `createTemplateStore()` 로 저장소를 따로 만들 수 있고, 모듈 함수(`addTemplate`, `match`, `exportTemplates`, `importTemplates`, `clearTemplates`, `removeTemplates`)는 기본 저장소 하나를 써요. `match` 결과: `{ letterId, distance, votes, confidence, neighbors }`.
- `progress.js`: `createProgress({ storage: core/storage.js 의 adapter })` → `recordAttempt(id, {ok, ms})`, `stats(id)`, `dueForReview(ids)`, `reviewCount(ids)`, `weakest(n, ids)`, `unitProgress(ids)`, `pickPractice(ids, n)`, `practiceDays()`, `streakDays()`, `setLast/getLast`, `reset`, `exportJSON/importJSON`, `subscribe`.
- `drawReferenceHand` 는 글자(Letter)를 바로 받아도 돼요(`pose` 와 `refView` 를 씀). 반환값 `{ palmVisible, bounds }`. 손바닥이 보이면 밝은 살색 + 손금, 손등이면 진한 살색 + 손톱 · 손마디로 그려요.
- `drawLiveHand(ctx, hand, evaluation, { videoW, videoH, fit: 'cover', mirror: true })`: 맞은 손가락 초록 실선 + 채운 원, 틀린 손가락 빨강 점선 + ✕ 고리, 판정 안 함 회색. 캔버스는 CSS 로 뒤집지 말고 좌표만 거울처럼 그려요.
- `createSyntheticTracker` 는 tracker 모양에 더해 `tick(t)`, `frameAt(t)`, `setScript(list, {loop})`, `setPose(pose)`, `clear()`, `playLetter(letter, {loop})`, `onEnd(cb)`, `duration` 이 있어요. 왼손(`side: 'left'`)이면 대본의 움직임도 거울처럼 해요.
