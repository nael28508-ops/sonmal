// 손 모형 → 특징 왕복 시험: 여러 방향 · 왼손 · 영상 마디만 있을 때
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, poseToHand, withPose, poseToS, normalizePose } from '../src/renderer/engine/handmodel.js';
import { extractFeatures, pickHand, qualityMessage } from '../src/renderer/engine/features.js';
import { angleBetween, dirVector, rotate, eulerMatrix, applyMat, dot, nearestDir } from '../src/renderer/engine/geometry.js';

const feat = (pose, o = {}) => {
  const h = poseToHand(pose, o);
  if (o.imageOnly) delete h.world;
  return extractFeatures(h, { aspect: o.aspect || 16 / 9 });
};

test('geometry: 방향 이름과 회전', () => {
  assert.deepEqual(dirVector('up'), [0, 1, 0]);
  assert.ok(Math.abs(angleBetween(dirVector('up+left'), [0, 1, 0]) - 45) < 1e-9);
  assert.equal(dirVector('sideways'), null);
  const r = rotate([0, 1, 0], [0, 0, 1], 90);
  assert.ok(Math.abs(r[0] + 1) < 1e-9, 'z 축 +90° 회전이면 위 → 왼쪽');
  const M = eulerMatrix(180, 0, 0);
  assert.equal(nearestDir(applyMat(M, [0, 0, 1])), 'back');
});

test('기본 자세: 손바닥 앞, 손가락 위, 다섯 손가락 펴짐', () => {
  const f = feat(PRESETS.open);
  assert.equal(f.palm.facing, 'forward');
  assert.equal(f.hand.dir, 'up');
  for (const k of ['thumb', 'index', 'middle', 'ring', 'pinky']) assert.equal(f.fingers[k].state, 'extended', k);
  assert.equal(f.side, 'right');
  assert.equal(f.mirrored, false);
  assert.ok(f.quality.ok, f.quality.reasons.join());
});

test('관절 각도 왕복: 자세의 굽힘 값이 특징에 그대로 나옴', () => {
  const p = normalizePose({ index: { mcp: 30, pip: 50, dip: 20, abd: 8 }, middle: { mcp: 70, pip: 10, dip: 5 }, ring: { mcp: 5, pip: 90, dip: 60 }, pinky: { mcp: 88, pip: 100, dip: 62 } });
  for (const rot of [{}, { yaw: 180 }, { pitch: 174 }, { roll: -90, yaw: 174 }, { yaw: -90, roll: -84 }, { yaw: 35, pitch: 20, roll: 15 }]) {
    for (const side of ['right', 'left']) {
      const f = feat(withPose(p, { rot }), { side });
      const msg = `${JSON.stringify(rot)} ${side}`;
      assert.ok(Math.abs(f.fingers.index.mcp - 30) < 3, `index mcp ${f.fingers.index.mcp} ${msg}`);
      assert.ok(Math.abs(f.fingers.index.pip - 50) < 3, `index pip ${msg}`);
      assert.ok(Math.abs(f.fingers.index.abd - 8) < 3, `index abd ${f.fingers.index.abd} ${msg}`);
      assert.equal(f.fingers.middle.state, 'bent', msg);
      assert.equal(f.fingers.ring.state, 'hooked', msg);
      assert.equal(f.fingers.pinky.state, 'curled', msg);
      assert.equal(f.fingers.index.state, 'hooked', msg);
    }
  }
});

test('손바닥 방향 여섯 가지 (오른손 · 왼손 · 영상 마디만)', () => {
  const cases = {
    forward: {}, back: { yaw: 180 }, left: { yaw: -90 }, right: { yaw: 90 }, down: { pitch: 90 }, up: { pitch: -90 },
  };
  for (const [want, rot] of Object.entries(cases)) {
    for (const o of [{}, { side: 'left' }, { imageOnly: true }, { side: 'left', imageOnly: true, aspect: 4 / 3 }]) {
      const f = feat(withPose(PRESETS.flat, { rot }), o);
      assert.equal(f.palm.facing, want, `${want} ${JSON.stringify(o)}`);
    }
  }
});

test('손가락 방향: 검지가 가리키는 쪽', () => {
  const cases = { up: {}, down: { pitch: 174 }, left: { roll: -90, yaw: 174 }, forward: { yaw: -90, roll: -84 }, right: { roll: -90 } };
  for (const [want, rot] of Object.entries(cases)) {
    for (const side of ['right', 'left']) {
      const f = feat(withPose(PRESETS.point, { rot }), { side });
      assert.equal(f.fingers.index.dir, want, `${want} ${side}`);
    }
  }
});

test('왼손 거울 판정: 왼손 자세는 같은 오른손 자세와 같은 특징', () => {
  const p = withPose(PRESETS.ell, { rot: { yaw: 30, pitch: -20, roll: 10 } });
  const r = feat(p, { side: 'right' });
  const l = feat(p, { side: 'left' });
  assert.equal(l.mirrored, true);
  assert.equal(l.side, 'left');
  for (const k of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    assert.equal(l.fingers[k].state, r.fingers[k].state, k);
    assert.ok(angleBetween(l.fingers[k].dirVec, r.fingers[k].dirVec) < 2, `${k} 방향`);
  }
  assert.ok(angleBetween(l.palm.normal, r.palm.normal) < 2);
  assert.equal(l.thumbPos, r.thumbPos);
});

test('엄지 위치 분류', () => {
  assert.equal(feat(PRESETS.fist).thumbPos, 'across');
  assert.equal(feat(PRESETS.ell).thumbPos, 'out');
  assert.equal(feat(PRESETS.fistThumbAlong).thumbPos, 'up');
  assert.equal(feat(PRESETS.fistThumbIn).thumbPos, 'tucked');
  assert.equal(feat(PRESETS.thumbFront).thumbPos, 'front');
  assert.ok(feat(PRESETS.ok).tipDist['thumb-index'] < 0.2);
});

test('손 품질: 너무 작음 · 화면 밖 · 손 없음', () => {
  assert.ok(feat(PRESETS.open, { size: 0.05 }).quality.reasons.includes('too-far'));
  assert.ok(feat(PRESETS.open, { center: [0.02, 0.5] }).quality.reasons.includes('out-of-frame'));
  assert.equal(extractFeatures(null), null);
  assert.match(qualityMessage(null), /손이 보이지/);
});

test('pickHand: 주로 쓰는 손 → 없으면 큰 손', () => {
  const small = poseToHand(PRESETS.open, { size: 0.12, side: 'left' });
  const big = poseToHand(PRESETS.open, { size: 0.3, side: 'left' });
  const right = poseToHand(PRESETS.open, { size: 0.15, side: 'right' });
  assert.equal(pickHand([small, right], { dominant: 'right' }), right);
  assert.equal(pickHand([small, big], { dominant: 'right' }), big);
  assert.equal(pickHand([], {}), null);
});

test('poseToS: 21점, 손목 원점, 중지 뿌리까지 길이 1', () => {
  const S = poseToS(PRESETS.neutral);
  assert.equal(S.length, 21);
  assert.deepEqual([S[0].x, S[0].y, S[0].z], [0, 0, 0]);
  assert.ok(Math.abs(Math.hypot(S[9].x, S[9].y, S[9].z) - 1) < 1e-9);
  assert.ok(dot([S[5].x, 0, 0], [1, 0, 0]) < 0, '오른손 검지 뿌리는 왼쪽(-x)');
});
