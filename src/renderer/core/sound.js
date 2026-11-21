// 효과음: WebAudio 로 만든 짧고 부드러운 소리 (파일 없음)
// - success: 올라가는 세 음, fail: 낮은 두 음, tick: 아주 짧은 톡
// - 설정에서 끄거나 "소리 없이" 모드, 자동 점검(selftest)에서는 소리를 만들지 않음

const NOTES = {
  success: [
    [659.25, 0, 0.16],
    [830.61, 0.09, 0.18],
    [987.77, 0.18, 0.32],
  ],
  fail: [
    [392, 0, 0.14],
    [329.63, 0.12, 0.22],
  ],
  tick: [[1046.5, 0, 0.06]],
  start: [
    [523.25, 0, 0.12],
    [783.99, 0.08, 0.2],
  ],
};

/**
 * @param {{ getSettings: () => object, disabled?: boolean }} o
 */
export function createSound({ getSettings, disabled = false }) {
  let ctx = null;
  const log = [];

  function audio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function play(name = 'tick') {
    const s = getSettings();
    if (disabled) {
      log.push(name);
      return false;
    }
    if (s.silent || !s.sound) return false;
    const notes = NOTES[name];
    const ac = notes && audio();
    if (!ac) return false;
    try {
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + 0.01;
      const master = ac.createGain();
      master.gain.value = 0.18;
      master.connect(ac.destination);
      for (const [freq, at, dur] of notes) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t0 + at);
        g.gain.linearRampToValueAtTime(1, t0 + at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + at + dur);
        o.connect(g);
        g.connect(master);
        o.start(t0 + at);
        o.stop(t0 + at + dur + 0.05);
      }
      return true;
    } catch (err) {
      console.warn('sound', err);
      return false;
    }
  }

  return {
    play,
    get log() {
      return log.slice();
    },
  };
}
