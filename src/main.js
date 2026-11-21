// 손말 첫걸음 — Electron 메인 프로세스
// - 프로젝트 폴더를 app://local/ 주소로 보여 줌 (MediaPipe 가 WASM · 모델을 fetch 로 읽어야 해서 file:// 대신)
// - 카메라 권한은 이 앱 화면(app://local)에만, 다른 권한은 모두 거절
// - --selftest: 보이지 않는 창(offscreen)에서 자동 점검을 돌리고 결과를 SELFTEST_RESULT 한 줄로 출력
//   (진짜 카메라 · 소리 · 창은 절대 쓰지 않음)
'use strict';

const { app, BrowserWindow, Menu, protocol, net, session, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..'); // 프로젝트 폴더 (node_modules · models 까지)
const ORIGIN = 'app://local';
const START_PAGE = `${ORIGIN}/src/renderer/index.html`;
const APP_TITLE = '손말 첫걸음';
const SELFTEST_TIMEOUT_MS = 180000;
const SELFTEST_PARTITION = 'sonmal-selftest'; // 'persist:' 가 없으면 메모리에만 저장 → 점검이 진짜 기록을 건드리지 않음

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

// ───────── 명령줄 옵션 ─────────
// --selftest            자동 점검 (숨은 창, 소리 끔, 가짜 손)
// --out=<폴더>          점검 화면 사진 저장 폴더 (기본: <프로젝트>/selftest-out)
// --screens=a,b,c       점검할 화면만 골라서
// --size=1920x1080      점검 창 크기 (기본 1280x800)
// --show                점검 창을 화면에 보이기 (사용자가 원할 때만)
function parseArgs(argv) {
  const out = { selftest: false, show: false, out: null, screens: null, size: null };
  for (const a of argv) {
    if (a === '--selftest') out.selftest = true;
    else if (a === '--show') out.show = true;
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a.startsWith('--screens=')) {
      out.screens = a.slice('--screens='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--size=')) {
      const m = /^(\d{3,4})x(\d{3,4})$/i.exec(a.slice('--size='.length));
      if (m) out.size = [Number(m[1]), Number(m[2])];
    }
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(1));
const SELFTEST = ARGS.selftest;
const HIDDEN = SELFTEST && !ARGS.show;
const OUT_DIR = path.resolve(process.cwd(), ARGS.out || path.join(ROOT, 'selftest-out'));

// MediaPipe 가 fetch 로 파일을 읽을 수 있게 app:// 를 표준 · 보안 주소로 등록 (ready 전에 해야 함)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (SELFTEST) {
  app.commandLine.appendSwitch('mute-audio'); // 혹시 소리가 나도 들리지 않게
  app.commandLine.appendSwitch('use-fake-device-for-media-stream'); // 진짜 웹캠 대신 가짜 장치 (권한도 거절함)
  app.commandLine.appendSwitch('force-device-scale-factor', '1'); // 화면 사진 크기를 창 크기와 똑같이
  // 점검용 프로필은 결과 폴더 안에 (사용자의 진짜 앱 데이터는 건드리지 않음)
  const profile = path.join(OUT_DIR, '.profile');
  fs.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
}

// 이미 켜져 있으면 새로 띄우지 않고 그 창을 앞으로 (카메라는 한 프로그램만 쓸 수 있음)
const GOT_LOCK = SELFTEST || app.requestSingleInstanceLock();
if (!GOT_LOCK) app.quit();

// 프로젝트 폴더 안의 파일만 내보냄
function resolveAppFile(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.host !== 'local') return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const file = path.resolve(ROOT, `.${pathname}`);
  const rel = path.relative(ROOT, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

function setupSession(ses) {
  ses.protocol.handle('app', async (request) => {
    const file = resolveAppFile(request.url);
    if (!file) return new Response('Not found', { status: 404 });
    let res;
    try {
      res = await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!/\.html?$/i.test(file)) return res;
    // HTML 에는 보안 정책(CSP)을 응답 머리글로도 붙임 (index.html 의 meta 와 같은 값)
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(res.body, { status: res.status, headers });
  });

  const fromApp = (url) => typeof url === 'string' && (url === ORIGIN || url.startsWith(`${ORIGIN}/`));

  // 웹캠(영상만) 권한은 이 앱 화면에서만. 자동 점검 중에는 카메라를 아예 막음
  ses.setPermissionRequestHandler((wc, permission, callback, details = {}) => {
    const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const videoOnly = types.length > 0 && types.every((t) => t === 'video');
    callback(!SELFTEST && permission === 'media' && videoOnly && fromApp(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => (
    !SELFTEST && permission === 'media' && fromApp(requestingOrigin)
  ));
  ses.setDevicePermissionHandler(() => false);
}

// ───────── 자동 점검(selftest) ─────────
const pageErrors = []; // 화면 쪽 console.error 와 로드 실패
let finished = false;
let lastFrame = null; // offscreen 창이 마지막으로 그린 화면 (capturePage 가 비었을 때 대신)
let appStarted = false; // 화면 쪽 앱(app.js)이 시작했다고 알려 왔는지

function finishSelftest(result) {
  if (finished) return;
  finished = true;
  const r = result && typeof result === 'object' ? { ...result } : { ok: false, error: 'no result' };
  r.pageErrors = pageErrors.slice(0, 50);
  r.ok = Boolean(r.ok) && pageErrors.length === 0;
  r.outDir = OUT_DIR;
  const line = `SELFTEST_RESULT ${JSON.stringify(r)}\n`;
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'selftest-result.json'), JSON.stringify(r, null, 2));
  } catch {
    /* 파일로 못 남겨도 출력은 함 */
  }
  const code = r.ok ? 0 : 1;
  const quit = () => app.exit(code);
  const fallback = setTimeout(quit, 2000);
  process.stdout.write(line, () => {
    clearTimeout(fallback);
    quit();
  });
}

function safeShotName(name) {
  const s = String(name || 'shot').replace(/[^a-z0-9._-]+/gi, '_').replace(/^\.+/, '').slice(0, 80);
  return s || 'shot';
}

function fromAppSender(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  return url.startsWith(`${ORIGIN}/`);
}

ipcMain.on('sonmal:config', (event) => {
  event.returnValue = {
    selftest: SELFTEST,
    args: {
      out: SELFTEST ? OUT_DIR : null,
      screens: ARGS.screens,
      show: ARGS.show,
      size: ARGS.size,
    },
    version: app.getVersion(),
    platform: process.platform,
  };
});

ipcMain.handle('sonmal:screenshot', async (event, name) => {
  if (!SELFTEST || !fromAppSender(event)) throw new Error('screenshot is only available in selftest');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('no window');
  let img = await win.webContents.capturePage();
  if ((!img || img.isEmpty()) && lastFrame && !lastFrame.isEmpty()) img = lastFrame;
  if (!img || img.isEmpty()) throw new Error('empty capture');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${safeShotName(name)}.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
});

ipcMain.on('sonmal:done', (event, result) => {
  if (!SELFTEST || !fromAppSender(event)) return;
  finishSelftest(result);
});

ipcMain.on('sonmal:log', (event, msg) => {
  appStarted = true;
  if (SELFTEST) process.stdout.write(`[selftest] ${String(msg).slice(0, 2000)}\n`);
});

ipcMain.on('sonmal:fullscreen', (event) => {
  if (!fromAppSender(event)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !HIDDEN) win.setFullScreen(!win.isFullScreen());
});

// ───────── 창 ─────────
function createWindow() {
  const [width, height] = ARGS.size || [1280, 800];
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: APP_TITLE,
    backgroundColor: '#f8f5ef',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // 창이 뒤에 있어도 손 인식이 멈추지 않게
      spellcheck: false,
      offscreen: HIDDEN,
      partition: SELFTEST ? SELFTEST_PARTITION : undefined,
    },
  });
  Menu.setApplicationMenu(null);
  const wc = win.webContents;

  // 앱 밖으로 이동하지 않음. 바깥 링크(도움말의 사전 주소 등)는 기본 브라우저로
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (!SELFTEST && /^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // F11 전체 화면, Ctrl+Shift+I 개발자 도구 (점검 중이 아닐 때)
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' && !HIDDEN) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (!SELFTEST && input.control && input.shift && (input.key === 'I' || input.key === 'i')) {
      wc.toggleDevTools();
      e.preventDefault();
    }
  });

  if (SELFTEST) {
    wc.on('console-message', (event, legacyLevel, legacyMessage) => {
      // Electron 35+ 는 event.level / event.message, 예전 버전은 위치 인자
      const level = typeof event.level === 'string'
        ? event.level
        : ['debug', 'info', 'warning', 'error'][legacyLevel] || 'info';
      const message = String(event.message ?? legacyMessage ?? '');
      if (level === 'error') pageErrors.push(message.slice(0, 500));
      if (level === 'error' || level === 'warning') process.stdout.write(`[page:${level}] ${message.slice(0, 500)}\n`);
    });
    wc.on('did-fail-load', (e, code, desc, url) => {
      pageErrors.push(`load failed ${code} ${desc} ${url}`);
      finishSelftest({ ok: false, error: `page failed to load: ${desc}` });
    });
    wc.on('preload-error', (e, file, err) => {
      pageErrors.push(`preload error: ${err && err.message}`);
    });
    wc.on('render-process-gone', (e, details) => {
      finishSelftest({ ok: false, error: `renderer gone: ${details && details.reason}` });
    });
    if (HIDDEN) {
      wc.setFrameRate(30);
      wc.on('paint', (e, dirty, image) => {
        lastFrame = image;
      });
    } else {
      win.once('ready-to-show', () => win.show());
    }
    // 화면 쪽이 아예 시작하지 못하면 3분까지 기다리지 않고 일찍 실패
    wc.once('did-finish-load', () => {
      setTimeout(() => {
        if (!appStarted) finishSelftest({ ok: false, error: 'app did not start (no message from the page in 30 s)' });
      }, 30000);
    });
  } else {
    win.once('ready-to-show', () => win.show());
  }

  win.loadURL(SELFTEST ? `${START_PAGE}?selftest=1` : START_PAGE);
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (!GOT_LOCK) return;
  const ses = SELFTEST ? session.fromPartition(SELFTEST_PARTITION) : session.defaultSession;
  setupSession(ses);
  createWindow();
  if (SELFTEST) {
    setTimeout(() => finishSelftest({ ok: false, error: `timeout after ${SELFTEST_TIMEOUT_MS / 1000} s` }), SELFTEST_TIMEOUT_MS);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (SELFTEST) finishSelftest({ ok: false, error: 'window closed' });
  else if (process.platform !== 'darwin') app.quit();
});
