// 웹캠: 카메라 목록 · 고르기 · 켜기/끄기 (motion-cam 에서 검증한 방법을 그대로 씀)
// - Iriun 같은 가상 카메라(휴대폰 · 방송 프로그램)보다 이 컴퓨터에 달린 카메라를 먼저 고름
// - 고른 카메라 이름을 설정에 기억, 카메라를 꽂거나 빼면 목록을 새로 고침
// - 다른 프로그램이 카메라를 쓰고 있으면(NotReadableError) 알기 쉬운 안내
// ⚠ 자동 점검(selftest)에서는 이 모듈을 쓰지 않음 (가짜 손 synthetic-tracker 를 씀)

export const VIRTUAL_CAM = /iriun|droidcam|epoccam|ivcam|obs|manycam|xsplit|snap camera|nvidia broadcast|ndi|camo|virtual/i;

/**
 * @param {{ video: HTMLVideoElement, getSavedLabel?: () => string, saveLabel?: (label: string) => void }} o
 */
export function createCamera({ video, getSavedLabel = () => '', saveLabel = () => {} }) {
  let stream = null;
  let cameras = [];
  let current = null;
  let status = 'off'; // 'off' | 'starting' | 'on' | 'error'
  let error = null; // { kind, title, text }
  let starting = null;
  const listeners = new Set();

  const emit = () => {
    for (const fn of listeners) {
      try {
        fn(api);
      } catch (err) {
        console.error(err);
      }
    }
  };

  async function enumerate() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  }

  async function listCameras() {
    let cams = await enumerate();
    // 이름이 비어 있으면 아직 권한이 없는 것 → 잠깐 켰다 꺼서 이름을 받아 옴
    if (cams.length && cams.every((c) => !c.label)) {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach((t) => t.stop());
      cams = await enumerate();
    }
    return cams;
  }

  // 전에 고른 카메라 → 이 컴퓨터에 달린 카메라 → 아무 카메라
  function preferred(cams) {
    const saved = getSavedLabel();
    return (saved && cams.find((c) => c.label === saved)) || cams.find((c) => !VIRTUAL_CAM.test(c.label)) || cams[0];
  }

  function describeError(err) {
    const name = (err && err.name) || '';
    const which = current && current.label ? `고른 카메라: ${current.label}. ` : '';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { kind: 'none', title: '카메라를 찾지 못했어요', text: '웹캠이 연결되어 있는지 확인하고 다시 시도해 주세요.' };
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
      return {
        kind: 'busy',
        title: '카메라가 다른 곳에서 쓰이고 있어요',
        text: `${which}화상 회의 같은 다른 프로그램이 카메라를 쓰고 있어요. 그 프로그램을 끄거나 다른 카메라를 골라 주세요.`,
      };
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return {
        kind: 'denied',
        title: '카메라 사용이 막혀 있어요',
        text: '윈도우 설정 › 개인 정보 › 카메라에서 "데스크톱 앱이 카메라에 액세스하도록 허용"을 켜 주세요.',
      };
    }
    return { kind: 'other', title: '카메라를 켤 수 없어요', text: `${which}잠시 뒤 다시 시도하거나 다른 카메라를 골라 주세요.` };
  }

  function stopStream() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  }

  async function doStart(cam) {
    status = 'starting';
    error = null;
    emit();
    stopStream();
    try {
      cameras = await listCameras();
      if (!cameras.length) {
        const e = new Error('no camera');
        e.name = 'NotFoundError';
        throw e;
      }
      current = (cam && cameras.find((c) => c.deviceId === cam.deviceId)) || preferred(cameras);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: current.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      status = 'on';
      emit();
      return true;
    } catch (err) {
      console.warn('camera:', err && err.name, err && err.message);
      stopStream();
      status = 'error';
      error = describeError(err);
      emit();
      return false;
    }
  }

  function start(cam) {
    if (status === 'on' && !cam) return Promise.resolve(true);
    if (starting) return starting;
    starting = doStart(cam).finally(() => {
      starting = null;
    });
    return starting;
  }

  function stop() {
    stopStream();
    status = 'off';
    emit();
  }

  /** deviceId 로 고르기 (이름을 기억해서 다음에도 그 카메라로) */
  function select(deviceId) {
    const cam = cameras.find((c) => c.deviceId === deviceId);
    if (!cam) return Promise.resolve(false);
    saveLabel(cam.label);
    return start(cam);
  }

  /** C 키: 다음 카메라 */
  function next() {
    if (cameras.length < 2) return Promise.resolve(false);
    const i = cameras.findIndex((c) => current && c.deviceId === current.deviceId);
    const cam = cameras[(i + 1) % cameras.length];
    saveLabel(cam.label);
    return start(cam);
  }

  /** 목록만 새로 받아 오기 (설정 화면용) */
  async function refresh() {
    try {
      cameras = await (status === 'on' ? enumerate() : listCameras());
    } catch {
      /* 권한이 없으면 그대로 */
    }
    emit();
    return cameras;
  }

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      try {
        cameras = await enumerate();
      } catch {
        return;
      }
      if (status === 'on' && current && !cameras.some((c) => c.deviceId === current.deviceId) && cameras.length) {
        start(preferred(cameras));
      } else emit();
    });
  }

  const api = {
    start,
    stop,
    select,
    next,
    refresh,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get video() {
      return video;
    },
    get cameras() {
      return cameras.slice();
    },
    get current() {
      return current;
    },
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    get isVirtual() {
      return !!(current && VIRTUAL_CAM.test(current.label));
    },
  };
  return api;
}
