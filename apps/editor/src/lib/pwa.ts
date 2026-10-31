/**
 * 설치형 앱(PWA)으로 동작하기 위한 것들.
 *
 * 세 가지를 한다:
 *  1. 서비스 워커 등록 — 한 번 열어 두면 인터넷 없이도 열린다.
 *  2. 설치 안내 — 브라우저가 "설치 가능" 신호를 보내면 버튼을 띄운다.
 *  3. OS 에서 연 파일 받기 — 탐색기에서 .hwpx 를 더블클릭하면 이 앱이
 *     그 파일을 받아 연다.
 *
 * 전부 없어도 앱은 그대로 돌아간다. 브라우저마다 지원이 다르고,
 * `file://` 로 연 단일 HTML 파일에서는 애초에 쓸 수 없기 때문에
 * 하나하나 있는지 확인하고 쓴다.
 */
import { useEffect, useState } from 'react';

/** 서비스 워커를 쓸 수 있는 자리인지. file:// 과 http:// 에서는 안 된다. */
function securePlace(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname } = window.location;
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return; // 개발 서버에는 sw.js 가 없다.
  if (!securePlace()) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // 등록에 실패해도 앱은 돌아간다. 오프라인만 안 될 뿐이다.
    });
  });
}

// ------------------------------------------------------------ 새 판 알림

/** 새 판이 있는지 다시 물어보는 간격. */
const UPDATE_CHECK_MS = 15 * 60 * 1000;

/**
 * 새 판이 받아진 것을 알려 준다.
 *
 * 왜 필요한가: 웹에 올려 두면 고친 내용이 바로 반영돼야 하는데, 서비스
 * 워커가 옛 판을 캐시에서 내주는 동안에는 새로고침해도 그대로다. 새 판이
 * 다 받아진 시점을 잡아 "새로 고치세요" 라고 알려야 한다.
 *
 * 스스로 새로고침하지는 않는다. 고치던 문서가 열려 있을 수 있고, 저장하지
 * 않은 내용이 날아가면 알림보다 훨씬 나쁘다. 누를지는 사용자가 정한다.
 */
export function useAppUpdate(): { ready: boolean; reload: () => void } {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    let stopped = false;

    const watch = (worker: ServiceWorker | null): void => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        // controller 가 있다는 건 이미 한 번 띄운 적이 있다는 뜻이다.
        // 처음 설치할 때까지 "새 판" 이라고 하면 안 된다.
        if (worker.state === 'installed' && navigator.serviceWorker.controller && !stopped) {
          setReady(true);
        }
      });
    };

    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg || stopped) return;
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) setReady(true);
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
      })
      .catch(() => undefined);

    const timer = setInterval(() => {
      void registration?.update().catch(() => undefined);
    }, UPDATE_CHECK_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return { ready, reload: () => window.location.reload() };
}

// -------------------------------------------------------------- 설치 안내

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * 설치 버튼 상태.
 *
 * 크롬·엣지는 설치 가능해지면 `beforeinstallprompt` 를 던지는데, 그 이벤트를
 * 붙잡아 두지 않으면 나중에 설치를 띄울 방법이 없다. 사파리는 이 이벤트를
 * 주지 않으므로(공유 → 홈 화면에 추가) 버튼이 아예 안 나온다.
 */
export function useInstallPrompt(): { canInstall: boolean; install: () => void } {
  const [deferred, setDeferred] = useState<InstallPromptEvent | undefined>(undefined);

  useEffect(() => {
    const onPrompt = (event: Event): void => {
      // 브라우저 기본 안내 막대를 막고 우리 버튼으로 돌린다.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = (): void => setDeferred(undefined);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    canInstall: deferred !== undefined,
    install: () => {
      if (!deferred) return;
      void deferred.prompt().then(() => setDeferred(undefined));
    },
  };
}

/** 이미 설치해서 전용 창으로 띄운 상태인지. */
export function runningInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches === true
  );
}

// ------------------------------------------------------ OS 에서 연 파일

interface LaunchParams {
  files: FileSystemFileHandle[];
}

declare global {
  interface Window {
    launchQueue?: {
      setConsumer: (consumer: (params: LaunchParams) => void) => void;
    };
  }
}

export interface LaunchedFile {
  name: string;
  data: Uint8Array;
  /** 핸들이 있으면 Ctrl+S 로 그 파일에 그대로 덮어쓸 수 있다. */
  handle?: FileSystemFileHandle;
}

/**
 * 탐색기에서 더블클릭해 넘어온 파일을 받는다.
 *
 * 소비자를 늦게 걸면 브라우저가 이미 넘긴 실행 정보를 놓칠 수 있으므로
 * 앱이 뜨자마자 건다. 파일을 하나만 다루므로 첫 번째만 쓴다.
 */
export function consumeLaunchFiles(open: (file: LaunchedFile) => void): void {
  if (typeof window === 'undefined' || !window.launchQueue) return;
  window.launchQueue.setConsumer((params) => {
    const handle = params.files?.[0];
    if (!handle) return;
    void handle
      .getFile()
      .then(async (file) => {
        open({
          name: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
          handle,
        });
      })
      .catch(() => {
        // 권한이 없거나 파일이 사라진 경우. 빈 화면으로 두면 된다.
      });
  });
}

/** 바로가기(`?new=hwpx`)로 띄웠을 때 만들 문서 종류. */
export function startupNewDocument(): 'hwpx' | 'docx' | 'pptx' | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get('new');
  return value === 'hwpx' || value === 'docx' || value === 'pptx' ? value : undefined;
}
