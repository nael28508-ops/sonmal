// Learn 수어 — preload
// 화면(렌더러)에는 Node 기능을 주지 않고, 꼭 필요한 몇 가지만 window.sonmalHost 로 열어 줌
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let config = { selftest: false, args: {}, version: '', platform: '' };
try {
  config = ipcRenderer.sendSync('sonmal:config') || config;
} catch {
  /* 설정을 못 받아도 일반 모드로 계속 */
}

// structured clone 으로 넘길 수 있는 값만 남김 (함수 · DOM 같은 건 빠짐)
function plain(value) {
  try {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  } catch {
    return { error: 'result could not be serialized' };
  }
}

contextBridge.exposeInMainWorld('sonmalHost', {
  isSelftest: Boolean(config.selftest),
  args: plain(config.args || {}),
  version: String(config.version || ''),
  platform: String(config.platform || ''),
  /** 자동 점검 중에만: 지금 화면을 PNG 로 저장하고 파일 경로를 돌려줌 */
  screenshot: (name) => ipcRenderer.invoke('sonmal:screenshot', String(name)),
  /** 자동 점검 결과 보내기 (메인이 SELFTEST_RESULT 를 출력하고 종료) */
  done: (result) => ipcRenderer.send('sonmal:done', plain(result)),
  /** 한국수어사전 낱말 쪽을 기본 브라우저로 (https://sldict.korean.go.kr/ 만) */
  openDict: (url) => ipcRenderer.invoke('sonmal:openDict', String(url)),
  log: (msg) => ipcRenderer.send('sonmal:log', String(msg)),
  toggleFullscreen: () => ipcRenderer.send('sonmal:fullscreen'),
  /** 진단 기록 JSON 을 프로젝트의 logs 폴더에 저장하고 경로를 돌려줌 */
  saveDiag: (json) => ipcRenderer.invoke('sonmal:diag', String(json)),
});
