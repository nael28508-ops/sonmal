// 가상 배경 합성기 (WebGL2, 그래픽 카드에서 매 프레임)
// 1) 가면 다듬기: 작은 사람 가면(256×144)을 큰 영상 색을 보며 키움(joint bilateral upsampling) → 머리카락 · 어깨 가장자리가 영상 경계를 따라감
//    + 손 마디 캡슐: 안쪽은 무조건 사람, 바깥 띠는 손 색과 비슷한 곳만 사람 → 손가락이 잘리거나 흐려지지 않음
// 2) 1/4 크기로 줄여 '사람을 뺀 원래 배경'을 흐림(정규화 합성곱) → 흐림 배경에 사람이 번지지 않음(후광 없음),
//    가장자리 색 되살리기(원래 벽 색 빼기)와 빛 번짐(light wrap)에도 씀
// 3) 최종: 사람(거울) + 새 배경(그림 · 사진은 뒤집지 않음), 깃털 가장자리 · 빛 번짐 · 은은한 색 맞추기
// 모든 텍스처는 '0번 줄 = 위쪽'으로 저장하고, 캔버스에 그릴 때만 위아래를 뒤집음

const VS = `#version 300 es
in vec2 p;
uniform bool uFlip;
out vec2 v;
void main() {
  v = vec2(p.x * 0.5 + 0.5, uFlip ? 0.5 - p.y * 0.5 : p.y * 0.5 + 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const MAX_CAPS = 50;

// 1) 가면: R = 사람(0~1), G = 손
const FS_ALPHA = `#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uVideo, uMask, uGuide;
uniform vec2 uOut;
uniform ivec2 uMaskSize;
uniform float uSigR;
uniform vec2 uEdge;
uniform vec4 uCapA[${MAX_CAPS}];
uniform vec2 uCapR[${MAX_CAPS}];
uniform int uCaps;
out vec4 o;
void main() {
  vec3 I = texture(uVideo, v).rgb;
  vec2 ms = vec2(uMaskSize);
  vec2 mp = v * ms - 0.5;
  vec2 b = floor(mp);
  float ws = 0.0, asum = 0.0;
  for (int j = -1; j <= 2; j++) {
    for (int i = -1; i <= 2; i++) {
      vec2 q = b + vec2(float(i), float(j));
      ivec2 qi = clamp(ivec2(q), ivec2(0), uMaskSize - 1);
      float m = texelFetch(uMask, qi, 0).r;
      vec3 g = texelFetch(uGuide, qi, 0).rgb;
      vec2 d = q - mp;
      float sw = exp(-dot(d, d) * 0.3);
      vec3 dc = g - I;
      float w = sw * (exp(-dot(dc, dc) / (2.0 * uSigR * uSigR)) + 0.03);
      ws += w;
      asum += w * m;
    }
  }
  float raw = asum / max(ws, 1e-6);
  float a = smoothstep(uEdge.x, uEdge.y, raw);
  // 손: 캡슐까지 거리
  vec2 px = v * uOut;
  float core = 0.0, band = 0.0, best = 1e9;
  vec2 bq = px;
  for (int k = 0; k < ${MAX_CAPS}; k++) {
    if (k >= uCaps) break;
    vec2 A = uCapA[k].xy, B = uCapA[k].zw;
    vec2 pa = px - A, ba = B - A;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    vec2 q = A + ba * h;
    float d = length(px - q);
    vec2 r = uCapR[k];
    core = max(core, 1.0 - smoothstep(r.x - 1.5, r.x + 0.5, d));
    float bd = 1.0 - smoothstep(r.y * 0.8, r.y, d);
    band = max(band, bd);
    float rel = d / r.y;
    if (rel < best) { best = rel; bq = q; }
  }
  float hand = core;
  if (band > 0.0) {
    // 가장 가까운 뼈 위의 색(손 색)과 비슷하면 손으로 봄
    vec2 t = bq / uOut;
    vec2 e = 1.5 / uOut;
    vec3 ref = (texture(uVideo, t).rgb + texture(uVideo, t + vec2(e.x, 0.0)).rgb + texture(uVideo, t - vec2(e.x, 0.0)).rgb
      + texture(uVideo, t + vec2(0.0, e.y)).rgb + texture(uVideo, t - vec2(0.0, e.y)).rgb) / 5.0;
    vec3 dc = I - ref;
    float lum = dot(dc, vec3(0.299, 0.587, 0.114));
    vec3 ch = dc - lum;
    float dist = length(ch) * 1.6 + abs(lum) * 0.35; // 그늘(밝기 차이)에는 덜 민감하게
    float sim = 1.0 - smoothstep(0.08, 0.2, dist);
    hand = max(core, band * sim);
    // 손 둘레에서는 사람 찾기가 아주 확실할 때만 믿음 → 손가락 사이 벽이 끼지 않음 (손 뒤 몸통은 확실하므로 그대로)
    a = mix(a, smoothstep(0.8, 0.97, raw), band * (1.0 - core));
  }
  o = vec4(max(a, hand), hand, 0.0, 1.0);
}`;

// 2) 1/4 크기로 줄이며 사람 자리를 비움 (RGB = 배경색 × 무게, A = 무게)
const FS_DOWN = `#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uVideo, uAlpha;
uniform vec2 uOut;
out vec4 o;
void main() {
  vec2 e = 1.0 / uOut;
  vec3 c = vec3(0.0);
  float a = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 t = v + (vec2(float(i), float(j)) - 0.5) * 2.0 * e;
    c += texture(uVideo, t).rgb;
  }
  // 사람을 조금 넓혀서 뺌 (가장자리 색이 배경에 섞이지 않게)
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    a = max(a, texture(uAlpha, v + vec2(float(i), float(j)) * 3.0 * e).r);
  }
  float w = 1.0 - smoothstep(0.02, 0.35, a);
  o = vec4(c * 0.25 * w, w);
}`;

// 가우스 흐림 (9탭을 선형 보간 5번으로)
const FS_BLUR = `#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 o;
void main() {
  vec4 s = texture(uSrc, v) * 0.2270270270;
  s += texture(uSrc, v + uDir * 1.3846153846) * 0.3162162162;
  s += texture(uSrc, v - uDir * 1.3846153846) * 0.3162162162;
  s += texture(uSrc, v + uDir * 3.2307692308) * 0.0702702703;
  s += texture(uSrc, v - uDir * 3.2307692308) * 0.0702702703;
  o = s;
}`;

// 3) 최종 합성 (화면 좌표: 사람은 거울, 배경 그림은 그대로)
const FS_FINAL = `#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uVideo, uAlpha, uLight, uStrong, uBg;
uniform int uMode; // 0 = 흐림, 1 = 그림 · 사진 · 단색
uniform float uWrap, uHarm, uDecon;
uniform vec3 uTint;
out vec4 o;
void main() {
  vec2 pv = vec2(1.0 - v.x, v.y);
  vec3 I = texture(uVideo, pv).rgb;
  // 가장자리 계단 없애기: 반 픽셀씩 어긋난 네 곳을 평균 (3×3 텐트 필터)
  vec2 hp = 0.7 / vec2(textureSize(uAlpha, 0));
  vec2 ah = (texture(uAlpha, pv + vec2(hp.x, hp.y)).rg + texture(uAlpha, pv + vec2(-hp.x, hp.y)).rg
    + texture(uAlpha, pv + vec2(hp.x, -hp.y)).rg + texture(uAlpha, pv - hp).rg) * 0.25;
  float a = ah.r, hand = ah.g;
  vec4 L = texture(uLight, pv);
  vec3 B0 = L.a > 0.003 ? L.rgb / L.a : I;
  // 가장자리 색 되살리기: 반투명한 곳에 섞인 원래 벽 색을 뺌 (밝은 · 어두운 테두리 없앰)
  vec3 F = I;
  if (a > 0.02 && a < 0.985 && L.a > 0.003) {
    vec3 Fp = clamp((I - (1.0 - a) * B0) / max(a, 0.3), 0.0, 1.0);
    // 주변 배경을 충분히 알 때만 (L.a 가 작으면 추정이 불안정), 손에는 하지 않음
    F = mix(I, Fp, uDecon * (1.0 - smoothstep(0.85, 0.985, a)) * smoothstep(0.05, 0.3, L.a) * (1.0 - smoothstep(0.0, 0.25, hand)));
  }
  vec3 BG;
  vec3 BW;
  if (uMode == 0) {
    vec4 S = texture(uStrong, pv);
    BG = S.a > 0.002 ? S.rgb / S.a : B0;
    BW = BG;
  } else {
    BG = texture(uBg, v).rgb;
    BW = textureLod(uBg, v, 4.0).rgb;
  }
  // 은은한 색 맞추기 + 빛 번짐 (손은 또렷하게 두려고 손에는 하지 않음)
  F *= mix(vec3(1.0), uTint, uHarm * (1.0 - 0.6 * hand));
  float wrap = uWrap * smoothstep(0.0, 1.0, L.a) * (1.0 - hand);
  F = mix(F, BW, wrap);
  o = vec4(mix(BG, F, a), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`셰이더 오류: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`셰이더 연결 오류: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/**
 * @returns 합성기 또는 null (WebGL2 를 못 쓰면)
 */
export function createGLCompositor() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 9;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });

  const P = {
    alpha: program(gl, FS_ALPHA),
    down: program(gl, FS_DOWN),
    blur: program(gl, FS_BLUR),
    final: program(gl, FS_FINAL),
  };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  function tex(filter = gl.LINEAR) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const T = {
    video: tex(),
    mask: tex(gl.NEAREST),
    guide: tex(gl.NEAREST),
    bg: tex(),
  };
  // 그림 배경은 밉맵으로 (빛 번짐용 흐린 색을 공짜로)
  gl.bindTexture(gl.TEXTURE_2D, T.bg);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.generateMipmap(gl.TEXTURE_2D);

  // 렌더 타깃
  function target() {
    return { t: tex(), fb: gl.createFramebuffer(), w: 0, h: 0 };
  }
  function sizeTarget(rt, w, h) {
    if (rt.w === w && rt.h === h) return;
    rt.w = w;
    rt.h = h;
    gl.bindTexture(gl.TEXTURE_2D, rt.t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt.t, 0);
  }
  const RT = { alpha: target(), s0: target(), s1: target(), light: target(), strong: target() };

  let W = 0;
  let H = 0;
  let maskW = 0;
  let maskH = 0;
  let hasBg = false;

  function resize(w, h) {
    if (w === W && h === H) return;
    W = w;
    H = h;
    canvas.width = w;
    canvas.height = h;
    sizeTarget(RT.alpha, w, h);
    const qw = Math.max(8, Math.round(w / 4));
    const qh = Math.max(8, Math.round(h / 4));
    for (const k of ['s0', 's1', 'light', 'strong']) sizeTarget(RT[k], qw, qh);
  }

  function uploadVideo(el) {
    gl.bindTexture(gl.TEXTURE_2D, T.video);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
  }

  /** mask: Uint8Array(w×h), guide: RGBA Uint8ClampedArray(w×h×4) — 같은 순간의 작은 영상 */
  function uploadMask(mask, guide, w, h) {
    maskW = w;
    maskH = h;
    gl.bindTexture(gl.TEXTURE_2D, T.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, mask);
    gl.bindTexture(gl.TEXTURE_2D, T.guide);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(guide.buffer, guide.byteOffset, guide.byteLength));
  }

  /** 배경 그림(화면 크기, 이미 cover 로 맞춘 캔버스) */
  function setBackground(el) {
    gl.bindTexture(gl.TEXTURE_2D, T.bg);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
    gl.generateMipmap(gl.TEXTURE_2D);
    hasBg = true;
  }

  function bind(unit, t, loc) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc, unit);
  }
  function pass(prog, rt, flip = false) {
    gl.useProgram(prog.p);
    gl.uniform1i(prog.u.uFlip, flip ? 1 : 0);
    if (rt) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
      gl.viewport(0, 0, rt.w, rt.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
    }
  }
  function draw() {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function blur(src, dst, tmp, times) {
    let from = src;
    for (let i = 0; i < times; i++) {
      pass(P.blur, tmp);
      bind(0, from.t, P.blur.u.uSrc);
      gl.uniform2f(P.blur.u.uDir, 1 / tmp.w, 0);
      draw();
      pass(P.blur, dst);
      bind(0, tmp.t, P.blur.u.uSrc);
      gl.uniform2f(P.blur.u.uDir, 0, 1 / dst.h);
      draw();
      from = dst;
    }
  }

  const capA = new Float32Array(MAX_CAPS * 4);
  const capR = new Float32Array(MAX_CAPS * 2);

  /**
   * @param {{ mode: 'blur'|'image', blurPasses: number, caps: Float32Array, capCount: number, capScale: number,
   *           tint: number[], harmonize: number, wrap: number, decon: number }} o
   */
  function render(o) {
    if (!maskW || lost) return false;
    // 1) 가면
    const n = Math.min(MAX_CAPS, o.capCount || 0);
    const s = o.capScale || 1;
    for (let i = 0; i < n; i++) {
      const c = o.caps.subarray(i * 6, i * 6 + 6);
      capA.set([c[0] * s, c[1] * s, c[2] * s, c[3] * s], i * 4);
      capR.set([c[4] * s, c[5] * s], i * 2);
    }
    pass(P.alpha, RT.alpha);
    const u = P.alpha.u;
    bind(0, T.video, u.uVideo);
    bind(1, T.mask, u.uMask);
    bind(2, T.guide, u.uGuide);
    gl.uniform2f(u.uOut, W, H);
    gl.uniform2i(u.uMaskSize, maskW, maskH);
    gl.uniform1f(u.uSigR, 0.11);
    gl.uniform2f(u.uEdge, o.edgeLo ?? 0.34, o.edgeHi ?? 0.78);
    gl.uniform1i(u.uCaps, n);
    if (n) {
      gl.uniform4fv(u.uCapA, capA.subarray(0, n * 4));
      gl.uniform2fv(u.uCapR, capR.subarray(0, n * 2));
    }
    draw();
    // 2) 사람 뺀 원래 배경 (작게) → 살짝 흐림(light), 흐림 배경이면 더 흐림(strong)
    pass(P.down, RT.s0);
    bind(0, T.video, P.down.u.uVideo);
    bind(1, RT.alpha.t, P.down.u.uAlpha);
    gl.uniform2f(P.down.u.uOut, W, H);
    draw();
    blur(RT.s0, RT.light, RT.s1, 2);
    if (o.mode === 'blur') blur(RT.light, RT.strong, RT.s1, Math.max(1, o.blurPasses | 0));
    // 3) 최종
    pass(P.final, null, true);
    const f = P.final.u;
    bind(0, T.video, f.uVideo);
    bind(1, RT.alpha.t, f.uAlpha);
    bind(2, RT.light.t, f.uLight);
    bind(3, RT.strong.t, f.uStrong);
    bind(4, T.bg, f.uBg);
    gl.uniform1i(f.uMode, o.mode === 'blur' ? 0 : 1);
    gl.uniform1f(f.uWrap, o.mode === 'blur' ? 0 : o.wrap ?? 0.3);
    gl.uniform1f(f.uHarm, o.mode === 'blur' ? 0 : o.harmonize ?? 0.5);
    gl.uniform1f(f.uDecon, o.decon ?? 0.8);
    const t = o.tint || [1, 1, 1];
    gl.uniform3f(f.uTint, t[0], t[1], t[2]);
    draw();
    return true;
  }

  return {
    canvas,
    resize,
    uploadVideo,
    uploadMask,
    setBackground,
    render,
    get lost() {
      return lost || gl.isContextLost();
    },
    get hasBg() {
      return hasBg;
    },
    /** 점검용: GPU 가 다 그릴 때까지 기다림 */
    finish: () => gl.finish(),
  };
}
