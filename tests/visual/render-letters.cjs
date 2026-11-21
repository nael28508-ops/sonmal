// 눈으로 보는 시험: 모든 글자의 참고 손 그림을 한 장(PNG)에 그려 저장
// 실행 (창 안 보임, 소리 없음, 카메라 안 씀):
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe tests/visual/render-letters.cjs --out=<폴더>
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (name, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : d;
};
const OUT = path.resolve(arg('out', path.join(ROOT, 'selftest-out')));
const PAGE = arg('page', 'letters');

app.commandLine.appendSwitch('mute-audio');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({
    show: false, width: 800, height: 600,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (e) => {
    const level = e.level ?? e.params?.level;
    const message = e.message ?? e.params?.message;
    if (level === 'error' || level === 3) errors.push(message);
  });
  const timer = setTimeout(() => { console.log('VISUAL_RESULT', JSON.stringify({ ok: false, error: 'timeout' })); app.exit(1); }, 60000);
  try {
    await win.loadURL(`app://local/tests/visual/${PAGE}.html`);
    let data = null;
    for (let i = 0; i < 100 && !data; i++) {
      data = await win.webContents.executeJavaScript('window.__result || null');
      if (!data) await new Promise((r) => setTimeout(r, 100));
    }
    if (!data) throw new Error('그림이 만들어지지 않았어요');
    fs.mkdirSync(OUT, { recursive: true });
    const files = [];
    for (const [name, url] of Object.entries(data.images)) {
      const f = path.join(OUT, `${name}.png`);
      fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
      files.push(f);
    }
    clearTimeout(timer);
    console.log('VISUAL_RESULT', JSON.stringify({ ok: errors.length === 0 && !data.error, files, errors, error: data.error || null }));
    app.exit(errors.length || data.error ? 1 : 0);
  } catch (e) {
    console.log('VISUAL_RESULT', JSON.stringify({ ok: false, error: String(e), errors }));
    app.exit(1);
  }
});
