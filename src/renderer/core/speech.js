// 목소리: 윈도우에 들어 있는 한국어 목소리(Microsoft Heami)로 글자 이름 · 안내를 읽어 줌
// - 설정에서 끄거나 "소리 없이" 모드면 아무 소리도 내지 않음
// - 자동 점검(selftest)에서는 진짜로 읽지 않고, 읽으려던 말만 기록함 (speechSynthesis.speak 를 부르지 않음)
// - Chromium 은 긴 문장을 말없이 버릴 때가 있어서 문장마다 나눠 읽음

/**
 * @param {{ getSettings: () => object, stub?: boolean }} o
 */
export function createSpeech({ getSettings, stub = false }) {
  const log = []; // stub 모드에서 읽으려던 말
  let voices = [];
  const synth = !stub && typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const voiceCbs = new Set();

  function loadVoices() {
    if (!synth) return;
    try {
      voices = synth.getVoices() || [];
    } catch {
      voices = [];
    }
    for (const fn of voiceCbs) fn(koreanVoices());
  }
  if (synth) {
    loadVoices();
    try {
      synth.addEventListener('voiceschanged', loadVoices);
    } catch {
      /* 오래된 엔진 */
    }
  }

  function koreanVoices() {
    return voices.filter((v) => /^ko/i.test(v.lang));
  }

  function pickVoice() {
    const want = getSettings().voiceName;
    const ko = koreanVoices();
    return (want && voices.find((v) => v.name === want)) || ko.find((v) => /heami/i.test(v.name)) || ko[0] || null;
  }

  function enabled() {
    const s = getSettings();
    return !!s.voice && !s.silent;
  }

  /** 읽기. interrupt 가 true 면 읽던 말을 멈추고 바로 */
  function speak(text, { interrupt = true, force = false } = {}) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (!force && !enabled()) return false;
    if (getSettings().silent) return false;
    if (stub || !synth) {
      log.push({ text: t, at: Date.now() });
      if (log.length > 200) log.shift();
      return true;
    }
    try {
      if (interrupt) synth.cancel();
      const voice = pickVoice();
      const parts = t.split(/(?<=[.!?。…])\s+/).filter(Boolean);
      for (const p of parts) {
        const u = new SpeechSynthesisUtterance(p);
        u.lang = 'ko-KR';
        if (voice) u.voice = voice;
        u.rate = Number(getSettings().voiceRate) || 1;
        synth.speak(u);
      }
      return true;
    } catch (err) {
      console.warn('speech', err);
      return false;
    }
  }

  function stop() {
    if (synth) {
      try {
        synth.cancel();
      } catch {
        /* 무시 */
      }
    }
  }

  return {
    speak,
    stop,
    enabled,
    get voices() {
      return koreanVoices();
    },
    get currentVoice() {
      const v = pickVoice();
      return v ? v.name : '';
    },
    onVoices(fn) {
      voiceCbs.add(fn);
      return () => voiceCbs.delete(fn);
    },
    /** stub 모드에서 기록된 말 (점검용) */
    get log() {
      return log.slice();
    },
    get stub() {
      return stub;
    },
  };
}
