// 코드로 그리는 그림 배경 6가지 (사진처럼 보이게: 부드러운 빛 · 원근 · 살짝 초점 흐림)
// - 저작권 걱정 없음. 손 · 피부와 잘 구별되게 차갑거나 차분한 색 위주 (가운데 높이에 살구색을 두지 않음)
// - 같은 그림이 매번 같게 (시드 고정 난수)

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tools(ctx, w, h, r) {
  const lin = (stops, x0 = 0, y0 = 0, x1 = 0, y1 = h) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  };
  const glow = (x, y, rad, color, fade = 'rgba(0,0,0,0)') => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, fade);
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const rect = (x, y, ww, hh, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, ww, hh);
  };
  const vignette = (k = 0.35) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  const ridge = (y0, amp, rough, fill, seedStep = 12) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, h);
    let y = y0;
    for (let i = 0; i <= seedStep; i++) {
      y = y0 + (r() - 0.5) * amp + Math.sin(i * rough) * amp * 0.4;
      ctx.lineTo((i / seedStep) * w, y);
    }
    ctx.lineTo(w, h);
    ctx.fill();
  };
  return { lin, glow, rect, vignette, ridge };
}

const PAINTERS = {
  // 맑은 하늘: 높은 하늘 → 지평선 쪽 옅은 색, 뭉게구름, 먼 산 · 초원
  sky(ctx, w, h, r, T) {
    T.rect(0, 0, w, h, T.lin([[0, '#2f6fb5'], [0.55, '#7fb2df'], [0.78, '#cfe3ef']]));
    T.glow(w * 0.82, h * 0.12, w * 0.35, 'rgba(255,255,240,0.35)');
    for (let i = 0; i < 7; i++) {
      const cx = r() * w;
      const cy = h * (0.08 + r() * 0.42);
      const s = w * (0.05 + r() * 0.05);
      for (let k = 0; k < 9; k++) {
        const x = cx + (r() - 0.5) * s * 3.2;
        const y = cy + (r() - 0.6) * s * 0.7;
        T.glow(x, y + s * 0.25, s * 1.1, 'rgba(150,170,195,0.18)', 'rgba(150,170,195,0)');
        T.glow(x, y, s * (0.8 + r() * 0.5), 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)');
      }
    }
    T.ridge(h * 0.74, h * 0.05, 0.9, 'rgba(120,150,180,0.75)');
    T.ridge(h * 0.8, h * 0.04, 1.7, 'rgba(85,125,140,0.9)');
    T.rect(0, h * 0.86, w, h * 0.14, T.lin([[0, '#5e8f6a'], [1, '#3f6e4f']], 0, h * 0.86, 0, h));
    T.rect(0, h * 0.82, w, h * 0.06, T.lin([[0, 'rgba(94,143,106,0)'], [1, 'rgba(94,143,106,1)']], 0, h * 0.82, 0, h * 0.88));
  },
  // 민트 방: 창으로 들어오는 빛, 선반 · 화분, 바닥
  mint(ctx, w, h, r, T) {
    T.rect(0, 0, w, h, T.lin([[0, '#a9d3c8'], [0.75, '#7fb5a8'], [0.76, '#6a8f88'], [1, '#55716d']]));
    // 창 (왼쪽 위) 과 벽에 떨어진 빛
    const wx = w * 0.06;
    const wy = h * 0.12;
    const ww = w * 0.24;
    const wh = h * 0.42;
    T.glow(wx + ww * 0.6, wy + wh * 0.6, w * 0.45, 'rgba(255,255,235,0.45)', 'rgba(255,255,235,0)');
    T.rect(wx - w * 0.008, wy - w * 0.008, ww + w * 0.016, wh + w * 0.016, '#e9f2ee');
    T.rect(wx, wy, ww, wh, T.lin([[0, '#f6fbff'], [1, '#d7ecf3']], 0, wy, 0, wy + wh));
    T.rect(wx + ww / 2 - w * 0.004, wy, w * 0.008, wh, '#e3ece8');
    T.rect(wx, wy + wh / 2 - w * 0.004, ww, w * 0.008, '#e3ece8');
    T.glow(wx + ww * 0.3, wy + wh * 0.7, ww * 0.6, 'rgba(160,200,150,0.35)', 'rgba(160,200,150,0)'); // 창밖 나무
    // 오른쪽 선반 + 책 + 화분
    const sx = w * 0.72;
    const sy = h * 0.3;
    T.rect(sx, sy, w * 0.24, h * 0.02, '#e8eeea');
    T.rect(sx, sy + h * 0.02, w * 0.24, h * 0.012, 'rgba(0,0,0,0.12)');
    const books = ['#3e5c76', '#6d7fa0', '#2f4a4a', '#8aa7a0', '#4b5d7a'];
    let bx = sx + w * 0.01;
    for (let i = 0; i < 6; i++) {
      const bw = w * (0.012 + r() * 0.01);
      const bh = h * (0.08 + r() * 0.05);
      T.rect(bx, sy - bh, bw, bh, books[i % books.length]);
      bx += bw + w * 0.002;
    }
    const px = sx + w * 0.18;
    T.rect(px - w * 0.02, sy - h * 0.07, w * 0.04, h * 0.07, '#dfe7e4');
    for (let i = 0; i < 9; i++) T.glow(px + (r() - 0.5) * w * 0.06, sy - h * (0.1 + r() * 0.1), w * 0.025, 'rgba(46,110,70,0.9)', 'rgba(46,110,70,0)');
    // 큰 화분 (왼쪽 아래)
    for (let i = 0; i < 16; i++) T.glow(w * (0.05 + r() * 0.12), h * (0.5 + r() * 0.22), w * 0.04, 'rgba(38,92,60,0.75)', 'rgba(38,92,60,0)');
    T.rect(w * 0.07, h * 0.66, w * 0.08, h * 0.12, '#cfd8d4');
    // 천장 등 빛 + 걸레받이
    T.glow(w * 0.5, -h * 0.05, w * 0.5, 'rgba(255,255,240,0.25)', 'rgba(255,255,240,0)');
    T.rect(0, h * 0.75, w, h * 0.012, 'rgba(255,255,255,0.35)');
    T.vignette(0.3);
  },
  // 교실 칠판
  board(ctx, w, h, r, T) {
    T.rect(0, 0, w, h, T.lin([[0, '#d9dfd6'], [1, '#b9c4ba']]));
    T.glow(w * 0.5, -h * 0.1, w * 0.6, 'rgba(255,255,245,0.4)', 'rgba(255,255,245,0)');
    const bx = w * 0.08;
    const by = h * 0.12;
    const bw = w * 0.84;
    const bh = h * 0.56;
    T.rect(bx - w * 0.012, by - w * 0.012, bw + w * 0.024, bh + w * 0.024, '#6b5a48');
    T.rect(bx, by, bw, bh, T.lin([[0, '#2f5345'], [1, '#22412f']], bx, by, bx + bw, by + bh));
    T.glow(bx + bw * 0.3, by + bh * 0.3, bw * 0.4, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)'); // 칠판에 비친 빛
    // 지우개 자국
    for (let i = 0; i < 6; i++) T.glow(bx + r() * bw, by + r() * bh, bw * 0.08, 'rgba(220,235,225,0.05)', 'rgba(220,235,225,0)');
    ctx.fillStyle = 'rgba(240,245,240,0.32)';
    ctx.font = `600 ${Math.round(h * 0.075)}px "Malgun Gothic", sans-serif`;
    const jamo = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ';
    for (let i = 0; i < 14; i++) ctx.fillText(jamo[Math.floor(r() * jamo.length)], bx + bw * 0.04 + (i % 7) * bw * 0.135, by + bh * (0.3 + Math.floor(i / 7) * 0.32));
    T.rect(bx, by + bh + w * 0.012, bw, h * 0.018, '#5a4a3a'); // 분필 받침
    // 벽시계
    const cx = w * 0.9;
    const cy = h * 0.06 + w * 0.02;
    ctx.fillStyle = '#f4f6f2';
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.022, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a5552';
    ctx.lineWidth = Math.max(1, w * 0.003);
    ctx.stroke();
    T.rect(0, h * 0.84, w, h * 0.16, T.lin([[0, '#8f9a94'], [1, '#6f7a75']], 0, h * 0.84, 0, h));
    T.vignette(0.3);
  },
  // 숲: 멀수록 옅은 나무, 햇살, 빛망울
  forest(ctx, w, h, r, T) {
    T.rect(0, 0, w, h, T.lin([[0, '#9cc7b4'], [0.5, '#5f8f78'], [1, '#2c4a3a']]));
    T.glow(w * 0.7, h * 0.05, w * 0.5, 'rgba(255,255,220,0.5)', 'rgba(255,255,220,0)');
    const layers = [
      ['rgba(110,150,130,0.55)', 0.012, 14],
      ['rgba(70,110,90,0.7)', 0.022, 10],
      ['rgba(40,70,55,0.85)', 0.04, 7],
      ['rgba(25,45,35,0.95)', 0.07, 4],
    ];
    for (const [c, tw, n] of layers) {
      for (let i = 0; i < n; i++) {
        const x = r() * w;
        const ww = w * tw * (0.7 + r() * 0.6);
        T.rect(x, 0, ww, h, c);
      }
      // 층마다 안개
      T.rect(0, 0, w, h, 'rgba(170,205,185,0.08)');
    }
    // 햇살
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const x = w * (0.45 + r() * 0.45);
      ctx.fillStyle = T.lin([[0, 'rgba(255,250,210,0.12)'], [1, 'rgba(255,250,210,0)']], x, 0, x - w * 0.25, h);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w * 0.05, 0);
      ctx.lineTo(x - w * 0.2, h);
      ctx.lineTo(x - w * 0.32, h);
      ctx.fill();
    }
    for (let i = 0; i < 18; i++) T.glow(r() * w, r() * h * 0.5, w * (0.008 + r() * 0.015), 'rgba(230,255,220,0.35)', 'rgba(230,255,220,0)');
    ctx.restore();
    T.rect(0, h * 0.85, w, h * 0.15, T.lin([[0, 'rgba(40,70,45,0.6)'], [1, '#1f3526']], 0, h * 0.85, 0, h));
    T.vignette(0.35);
  },
  // 저녁 노을: 보랏빛 하늘, 지는 해, 도시 불빛
  dusk(ctx, w, h, r, T) {
    T.rect(0, 0, w, h, T.lin([[0, '#1f2552'], [0.45, '#4a3f7e'], [0.72, '#9a6f9f'], [0.82, '#c99ab0']]));
    T.glow(w * 0.7, h * 0.8, w * 0.45, 'rgba(255,200,215,0.45)', 'rgba(255,200,215,0)');
    for (let i = 0; i < 5; i++) T.glow(r() * w, h * (0.15 + r() * 0.3), w * (0.12 + r() * 0.1), 'rgba(150,120,180,0.22)', 'rgba(150,120,180,0)');
    // 먼 건물 · 가까운 건물
    for (const [y0, c, lit] of [[0.72, '#3a3360', 0.25], [0.8, '#211d3d', 0.45]]) {
      let x = 0;
      while (x < w) {
        const bw = w * (0.03 + r() * 0.05);
        const bh = h * (0.06 + r() * 0.16);
        const top = h * y0 - bh;
        T.rect(x, top, bw, h - top, c);
        for (let yy = top + h * 0.015; yy < h - h * 0.02; yy += h * 0.025) {
          for (let xx = x + bw * 0.15; xx < x + bw * 0.85; xx += bw * 0.22) if (r() < lit * 0.5) T.rect(xx, yy, bw * 0.08, h * 0.008, 'rgba(255,226,170,0.8)');
        }
        x += bw + w * 0.004;
      }
    }
    // 빛망울
    for (let i = 0; i < 14; i++) T.glow(r() * w, h * (0.85 + r() * 0.12), w * (0.012 + r() * 0.02), 'rgba(255,215,170,0.45)', 'rgba(255,215,170,0)');
    T.vignette(0.3);
  },
  // 밤하늘: 별 · 은하수 · 달 · 산 · 호수
  night(ctx, w, h, r, T) {
    T.rect(0, 0, w, h, T.lin([[0, '#070d24'], [0.6, '#142454'], [0.78, '#2a3f73']]));
    ctx.save();
    ctx.translate(w * 0.5, h * 0.35);
    ctx.rotate(-0.5);
    for (let i = 0; i < 40; i++) T.glow((r() - 0.5) * w * 1.2, (r() - 0.5) * h * 0.12, w * (0.04 + r() * 0.05), 'rgba(170,180,255,0.07)', 'rgba(170,180,255,0)');
    ctx.restore();
    const u = Math.max(0.6, w / 1280);
    for (let i = 0; i < 260; i++) {
      const s = (r() < 0.92 ? 1 : 2.2) * u;
      const a = 0.25 + r() * 0.65;
      const x = r() * w;
      const y = r() * h * 0.72;
      if (s > 1.5 * u) T.glow(x, y, s * 3, `rgba(220,230,255,${(a * 0.5).toFixed(2)})`, 'rgba(220,230,255,0)');
      T.rect(x, y, s, s, `rgba(255,255,255,${a.toFixed(2)})`);
    }
    const mx = w * 0.16;
    const my = h * 0.18;
    T.glow(mx, my, w * 0.16, 'rgba(200,215,255,0.28)', 'rgba(200,215,255,0)');
    ctx.fillStyle = '#f2f1e6';
    ctx.beginPath();
    ctx.arc(mx, my, w * 0.028, 0, Math.PI * 2);
    ctx.fill();
    T.ridge(h * 0.7, h * 0.08, 0.8, '#1a2650');
    T.ridge(h * 0.77, h * 0.05, 1.5, '#0e1734');
    T.rect(0, h * 0.86, w, h * 0.14, T.lin([[0, '#1c2a55'], [1, '#0b1330']], 0, h * 0.86, 0, h));
    T.glow(mx, h * 0.92, w * 0.08, 'rgba(220,225,255,0.18)', 'rgba(220,225,255,0)');
  },
};

/** 그림 배경 그리기 (w×h). 마지막에 살짝 초점을 흐려 진짜 카메라 배경처럼 */
export function paintScene(ctx, id, w, h) {
  const paint = PAINTERS[id] || PAINTERS.sky;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const r = rng(id.length * 977 + id.charCodeAt(0) * 31);
  paint(g, w, h, r, tools(g, w, h, r));
  ctx.save();
  ctx.filter = `blur(${Math.max(0.4, w / 320).toFixed(1)}px)`;
  // 가장자리가 흐려지며 어두워지지 않게 조금 크게 그림
  const m = Math.ceil(w / 100);
  ctx.drawImage(c, -m, -m, w + m * 2, h + m * 2);
  ctx.restore();
}
