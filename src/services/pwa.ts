import {useSyncExternalStore} from 'react';
import {registerSW} from 'virtual:pwa-register';

declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
      outcome: 'accepted' | 'dismissed';
      platform: string;
    }>;
    prompt(): Promise<void>;
  }
}

interface PwaSnapshot {
  canInstall: boolean;
  hasUpdate: boolean;
  isInstalled: boolean;
  isOfflineReady: boolean;
  isOnline: boolean;
  registrationError: string | null;
  supportsPwa: boolean;
}

const listeners = new Set<() => void>();

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
let snapshot: PwaSnapshot = {
  canInstall: false,
  hasUpdate: false,
  isInstalled: false,
  isOfflineReady: false,
  isOnline: true,
  registrationError: null,
  supportsPwa: false
};

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

const updateSnapshot = (partial: Partial<PwaSnapshot>) => {
  snapshot = {
    ...snapshot,
    ...partial
  };
  emitChange();
};

const detectInstalled = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = Boolean((window.navigator as Navigator & {standalone?: boolean}).standalone);
  return displayModeStandalone || iosStandalone;
};

export const initializePwa = () => {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;

  updateSnapshot({
    isInstalled: detectInstalled(),
    isOnline: navigator.onLine,
    supportsPwa: 'serviceWorker' in navigator
  });

  window.addEventListener('online', () => {
    updateSnapshot({isOnline: true});
  });

  window.addEventListener('offline', () => {
    updateSnapshot({isOnline: false});
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    updateSnapshot({
      canInstall: !detectInstalled(),
      isInstalled: detectInstalled()
    });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateSnapshot({
      canInstall: false,
      isInstalled: true
    });
  });

  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
  if (standaloneMedia) {
    const syncInstalledState = () => {
      updateSnapshot({
        canInstall: deferredPrompt !== null && !detectInstalled(),
        isInstalled: detectInstalled()
      });
    };

    if ('addEventListener' in standaloneMedia) {
      standaloneMedia.addEventListener('change', syncInstalledState);
    } else if ('addListener' in standaloneMedia) {
      standaloneMedia.addListener(syncInstalledState);
    }
  }

  if (!('serviceWorker' in navigator)) {
    return;
  }

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateSnapshot({hasUpdate: true});
    },
    onOfflineReady() {
      updateSnapshot({isOfflineReady: true});
    },
    onRegisterError(error) {
      updateSnapshot({
        registrationError: error instanceof Error ? error.message : String(error ?? 'PWA registration failed.')
      });
    }
  });
};

export const promptForPwaInstall = async () => {
  if (!deferredPrompt) {
    return false;
  }

  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  const accepted = choice.outcome === 'accepted';

  if (!accepted) {
    updateSnapshot({
      canInstall: true
    });
    return false;
  }

  deferredPrompt = null;
  updateSnapshot({
    canInstall: false
  });
  return true;
};

export const applyPwaUpdate = async () => {
  if (!updateServiceWorker) {
    return;
  }

  await updateServiceWorker(true);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => snapshot;

export const usePwaState = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
