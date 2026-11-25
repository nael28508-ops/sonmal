// 진단 기록: D 키로 켜고 끄면, 그동안의 손 판정 과정을 logs/ 폴더에 JSON 으로 남김
// 카메라 영상은 남기지 않고, 손가락 상태 · 판정 결과 · 움직임 같은 숫자만 남김
const r1 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

let on = false;
let frames = [];
let startedAt = 0;

export const diag = {
  get on() { return on; },
  start() { on = true; frames = []; startedAt = performance.now(); },
  /** judge.update 결과 한 프레임 */
  push(letter, frame, r) {
    if (!on || !r) return;
    if (frames.length > 20000) return;
    const f = r.features;
    frames.push({
      t: Math.round(frame.t - startedAt),
      letter: letter && letter.id,
      hands: (frame.hands || []).map((h) => h.handedness),
      f: f && {
        side: f.side, mirrored: f.mirrored,
        fingers: Object.fromEntries(Object.entries(f.fingers).map(([k, v]) => [k, { state: v.state, dir: v.dir, mcp: r1(v.mcp), pip: r1(v.pip), dip: r1(v.dip), cmc: r1(v.cmc), ip: r1(v.ip) }])),
        palm: f.palm && f.palm.facing, hand: f.hand && f.hand.dir, thumbPos: f.thumbPos,
        screen: f.screen && { cx: r1(f.screen.cx), cy: r1(f.screen.cy), size: r1(f.screen.size) },
        quality: f.quality,
      },
      checks: r.evaluation && (r.evaluation.checks || []).map((c) => ({ id: c.id, ok: c.ok, value: typeof c.value === 'object' ? JSON.stringify(c.value) : r1(c.value), target: typeof c.target === 'object' ? JSON.stringify(c.target) : c.target })),
      shapePass: r.evaluation && r.evaluation.shapePass,
      pass: r.evaluation && r.evaluation.pass,
      motion: r.motion && { done: r.motion.done, progress: r1(r.motion.progress) },
      hold: r.hold && r1(r.hold.progress),
      success: r.success,
    });
  },
  /** 기록을 멈추고 파일로 저장. 저장한 경로(또는 null)를 돌려줌 */
  async stop(meta = {}) {
    on = false;
    const data = { savedAt: new Date().toISOString(), meta, frames };
    frames = [];
    const host = globalThis.sonmalHost;
    if (!host || !host.saveDiag) return null;
    return host.saveDiag(JSON.stringify(data));
  },
};
