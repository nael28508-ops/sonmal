// 한글 낱자 다루기
// - decomposeForSpelling: 낱말 → 지문자로 하나씩 할 자모 순서 (겹받침 · 겹모음을 나눌지 고를 수 있음)
// - createComposer: 자모를 하나씩 넣으면 두벌식 자판처럼 글자로 모아 줌 (도깨비불 포함)
// 자모는 모두 한글 호환 자모(ㄱ, ㅏ …, U+3131~U+3163)로 주고받음

const SBASE = 0xac00;
const SLAST = 0xd7a3;
export const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
export const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 겹받침 → 두 자음 */
export const COMPOUND_FINALS = {
  'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'],
  'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'],
};
/** 겹모음(두벌식에서 두 번 눌러 만드는 모음) → 두 모음 */
export const COMPOUND_VOWELS = {
  'ㅘ': ['ㅗ', 'ㅏ'], 'ㅙ': ['ㅗ', 'ㅐ'], 'ㅚ': ['ㅗ', 'ㅣ'], 'ㅝ': ['ㅜ', 'ㅓ'], 'ㅞ': ['ㅜ', 'ㅔ'], 'ㅟ': ['ㅜ', 'ㅣ'], 'ㅢ': ['ㅡ', 'ㅣ'],
};
/** ㅣ 가 붙은 모음 (두벌식에서는 한 글쇠지만, 나누어 가르치는 방식도 있어서 고를 수 있게) */
export const IOTA_VOWELS = { 'ㅐ': ['ㅏ', 'ㅣ'], 'ㅔ': ['ㅓ', 'ㅣ'], 'ㅒ': ['ㅑ', 'ㅣ'], 'ㅖ': ['ㅕ', 'ㅣ'] };
/** 된소리(쌍자음) → 같은 자음 둘 */
export const DOUBLE_CONSONANTS = { 'ㄲ': ['ㄱ', 'ㄱ'], 'ㄸ': ['ㄷ', 'ㄷ'], 'ㅃ': ['ㅂ', 'ㅂ'], 'ㅆ': ['ㅅ', 'ㅅ'], 'ㅉ': ['ㅈ', 'ㅈ'] };

/** 자모 이름 (화면 · 음성 안내용) */
export const JAMO_NAMES = {
  'ㄱ': '기역', 'ㄴ': '니은', 'ㄷ': '디귿', 'ㄹ': '리을', 'ㅁ': '미음', 'ㅂ': '비읍', 'ㅅ': '시옷', 'ㅇ': '이응',
  'ㅈ': '지읒', 'ㅊ': '치읓', 'ㅋ': '키읔', 'ㅌ': '티읕', 'ㅍ': '피읖', 'ㅎ': '히읗',
  'ㄲ': '쌍기역', 'ㄸ': '쌍디귿', 'ㅃ': '쌍비읍', 'ㅆ': '쌍시옷', 'ㅉ': '쌍지읒',
  'ㄳ': '기역시옷', 'ㄵ': '니은지읒', 'ㄶ': '니은히읗', 'ㄺ': '리을기역', 'ㄻ': '리을미음', 'ㄼ': '리을비읍',
  'ㄽ': '리을시옷', 'ㄾ': '리을티읕', 'ㄿ': '리을피읖', 'ㅀ': '리을히읗', 'ㅄ': '비읍시옷',
  'ㅏ': '아', 'ㅐ': '애', 'ㅑ': '야', 'ㅒ': '얘', 'ㅓ': '어', 'ㅔ': '에', 'ㅕ': '여', 'ㅖ': '예', 'ㅗ': '오', 'ㅘ': '와',
  'ㅙ': '왜', 'ㅚ': '외', 'ㅛ': '요', 'ㅜ': '우', 'ㅝ': '워', 'ㅞ': '웨', 'ㅟ': '위', 'ㅠ': '유', 'ㅡ': '으', 'ㅢ': '의', 'ㅣ': '이',
};

const CONSONANTS = new Set([...CHO, ...JONG.filter(Boolean)]);
const VOWELS = new Set(JUNG);

export const isConsonant = (j) => CONSONANTS.has(j);
export const isVowel = (j) => VOWELS.has(j);
export const isSyllable = (ch) => {
  const c = typeof ch === 'string' ? ch.codePointAt(0) : NaN;
  return c >= SBASE && c <= SLAST;
};

/** 자모 이름: jamoName('ㄱ') → '기역' */
export function jamoName(j) {
  return JAMO_NAMES[j] || j;
}

/** 음절 하나 → { cho, jung, jong } (음절이 아니면 null) */
export function splitSyllable(ch) {
  if (!isSyllable(ch)) return null;
  const s = ch.codePointAt(0) - SBASE;
  return { cho: CHO[Math.floor(s / 588)], jung: JUNG[Math.floor((s % 588) / 28)], jong: JONG[s % 28] };
}

/** 초성 · 중성 · (종성) → 음절 (만들 수 없으면 null) */
export function makeSyllable(cho, jung, jong = '') {
  const a = CHO.indexOf(cho), b = JUNG.indexOf(jung), c = JONG.indexOf(jong || '');
  if (a < 0 || b < 0 || c < 0) return null;
  return String.fromCharCode(SBASE + (a * 21 + b) * 28 + c);
}

const vowelSplitTable = (opt) => {
  if (!opt) return {};
  if (opt === true) return { ...COMPOUND_VOWELS };
  const all = { ...COMPOUND_VOWELS, ...IOTA_VOWELS };
  const out = {};
  for (const v of opt) if (all[v]) out[v] = all[v];
  return out;
};

/**
 * 한국수어 지문자 맞춤법 (기본값): 국립국어원 한국수어사전에는 ㅐㅒㅔㅖㅘㅙㅚㅝㅞㅟㅢ 와 된소리 ㄲㄸㅃㅆㅉ 가
 * 각각 따로 있으므로 그대로 두고, 겹받침(ㄳ ㄺ …)만 두 자음으로 나눔. 받침 없는 첫소리 ㅇ 도 지문자로 함
 */
export const KSL_SPELLING = Object.freeze({ splitFinals: true, splitVowels: false, splitDoubles: false });

/**
 * 낱말 → 지문자 순서 (기본은 KSL_SPELLING)
 * @param {string} text 예: '닭', '의사 선생님'
 * @param {object} [o]
 * @param {boolean} [o.splitFinals=true] 겹받침을 나눔 (ㄳ → ㄱ, ㅅ)
 * @param {boolean|string[]} [o.splitVowels=false] 겹모음을 나눔: true 면 ㅘㅙㅚㅝㅞㅟㅢ 모두,
 *   배열이면 그 모음만 (ㅐㅔㅒㅖ 도 배열에 넣으면 ㅏ+ㅣ 처럼 나눔)
 * @param {boolean} [o.splitDoubles=false] 된소리를 같은 자음 둘로 나눔 (ㄲ → ㄱ, ㄱ)
 * @param {boolean} [o.keepSpaces=false] 띄어쓰기를 { jamo: ' ', role: 'space' } 로 남김
 * @returns {{ jamo: string, syllableIndex: number, role: 'initial'|'medial'|'final'|'space', char: string, from?: string }[]}
 *   syllableIndex 는 글자(코드 포인트) 순번 — 화면에서 지금 글자를 강조할 때 씀
 */
export function decomposeForSpelling(text, { splitFinals = true, splitVowels = false, splitDoubles = false, keepSpaces = false } = {}) {
  const vSplit = vowelSplitTable(splitVowels);
  const out = [];
  const pushJamo = (jamo, role, i, ch) => {
    if (splitDoubles && DOUBLE_CONSONANTS[jamo]) {
      for (const j of DOUBLE_CONSONANTS[jamo]) out.push({ jamo: j, syllableIndex: i, role, char: ch, from: jamo });
    } else out.push({ jamo, syllableIndex: i, role, char: ch });
  };
  const chars = Array.from(String(text ?? '').normalize('NFC'));
  chars.forEach((ch, i) => {
    const s = splitSyllable(ch);
    if (s) {
      pushJamo(s.cho, 'initial', i, ch);
      if (vSplit[s.jung]) for (const v of vSplit[s.jung]) out.push({ jamo: v, syllableIndex: i, role: 'medial', char: ch, from: s.jung });
      else out.push({ jamo: s.jung, syllableIndex: i, role: 'medial', char: ch });
      if (s.jong) {
        if (splitFinals && COMPOUND_FINALS[s.jong]) {
          for (const c of COMPOUND_FINALS[s.jong]) out.push({ jamo: c, syllableIndex: i, role: 'final', char: ch, from: s.jong });
        } else pushJamo(s.jong, 'final', i, ch);
      }
    } else if (isConsonant(ch)) {
      if (splitFinals && COMPOUND_FINALS[ch]) {
        for (const c of COMPOUND_FINALS[ch]) out.push({ jamo: c, syllableIndex: i, role: 'initial', char: ch, from: ch });
      } else pushJamo(ch, 'initial', i, ch);
    } else if (isVowel(ch)) {
      if (vSplit[ch]) for (const v of vSplit[ch]) out.push({ jamo: v, syllableIndex: i, role: 'medial', char: ch, from: ch });
      else out.push({ jamo: ch, syllableIndex: i, role: 'medial', char: ch });
    } else if (keepSpaces && /\s/.test(ch)) {
      if (!out.length || out[out.length - 1].role !== 'space') out.push({ jamo: ' ', syllableIndex: i, role: 'space', char: ch });
    }
  });
  return out;
}

// ───────── 두벌식 모아쓰기 ─────────
const FINAL_SET = new Set(JONG.filter(Boolean));
const combineTable = (table) => {
  const out = {};
  for (const [whole, [a, b]] of Object.entries(table)) out[a + b] = whole;
  return out;
};
const FINAL_COMBINE = combineTable(COMPOUND_FINALS);
const VOWEL_COMBINE = combineTable(COMPOUND_VOWELS);
const IOTA_COMBINE = combineTable(IOTA_VOWELS);

/**
 * 자모 목록 → 글자 (두벌식 자판으로 차례로 친 것과 같음)
 * @param {string[]} jamoList 예: ['ㄷ','ㅏ','ㄹ','ㄱ','ㅇ','ㅣ'] → '닭이'
 * @param {{iotaVowels?: boolean}} [o] iotaVowels: ㅏ+ㅣ → ㅐ 처럼 ㅣ 붙은 모음도 합침
 */
export function compose(jamoList, { iotaVowels = false } = {}) {
  let out = '';
  let cur = null; // { cho, jung, jong }
  const vCombine = iotaVowels ? { ...VOWEL_COMBINE, ...IOTA_COMBINE } : VOWEL_COMBINE;

  const render = (c) => {
    if (!c) return '';
    if (c.cho && c.jung) return makeSyllable(c.cho, c.jung, c.jong || '') || `${c.cho}${c.jung}${c.jong || ''}`;
    return (c.cho || '') + (c.jung || '');
  };
  const flush = () => {
    out += render(cur);
    cur = null;
  };

  for (const j of jamoList) {
    if (isConsonant(j)) {
      if (!cur) cur = { cho: j };
      else if (!cur.jung) {
        flush();
        cur = { cho: j };
      } else if (!cur.jong) {
        if (cur.cho && FINAL_SET.has(j)) cur.jong = j;
        else {
          flush();
          cur = { cho: j };
        }
      } else if (FINAL_COMBINE[cur.jong + j]) cur.jong = FINAL_COMBINE[cur.jong + j];
      else {
        flush();
        cur = { cho: j };
      }
    } else if (isVowel(j)) {
      if (!cur) cur = { jung: j };
      else if (!cur.jung) cur.jung = j;
      else if (!cur.jong) {
        if (vCombine[cur.jung + j]) cur.jung = vCombine[cur.jung + j];
        else {
          flush();
          cur = { jung: j };
        }
      } else {
        // 도깨비불: 받침이 다음 글자의 첫소리로 넘어감 (겹받침이면 뒤쪽 자음만)
        const parts = COMPOUND_FINALS[cur.jong];
        let moved;
        if (parts) {
          cur.jong = parts[0];
          moved = parts[1];
        } else {
          moved = cur.jong;
          cur.jong = '';
        }
        flush();
        cur = { cho: moved, jung: j };
      }
    } else {
      // 자모가 아닌 것(띄어쓰기 등)은 글자를 마치고 그대로 붙임
      flush();
      out += j;
    }
  }
  return out + render(cur);
}

/**
 * 자모를 하나씩 받아 글자로 모으는 입력기
 * @param {{iotaVowels?: boolean}} [o] compose 와 같은 선택
 * @returns {{ push(jamo: string): string, backspace(): string, reset(): void, readonly text: string,
 *            readonly composing: string, readonly jamo: string[], readonly length: number }}
 *   backspace 는 "마지막으로 넣은 자모 하나"를 지움 (넣은 적이 없던 것처럼 다시 모음)
 */
export function createComposer(o = {}) {
  let log = [];
  let text = '';
  const update = () => {
    text = compose(log, o);
    return text;
  };
  return {
    push(jamo) {
      if (typeof jamo !== 'string' || !jamo) return text;
      for (const ch of Array.from(jamo)) log.push(ch);
      return update();
    },
    backspace() {
      log.pop();
      return update();
    },
    reset() {
      log = [];
      text = '';
    },
    get text() {
      return text;
    },
    /** 아직 모으는 중인 마지막 글자 (다음 자모에 따라 바뀔 수 있음) */
    get composing() {
      const last = log[log.length - 1];
      if (!last || !(isConsonant(last) || isVowel(last))) return '';
      return Array.from(text).pop() || '';
    },
    get jamo() {
      return log.slice();
    },
    get length() {
      return log.length;
    },
  };
}
