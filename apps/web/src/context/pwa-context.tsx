import type React from 'react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PWAContextValue {
  /** Whether the app can be installed (Android) */
  canInstall: boolean;
  /** Whether the app is already installed as PWA */
  isInstalled: boolean;
  /** Whether running on iOS */
  isIOS: boolean;
  /** Whether to show iOS install instructions */
  showIOSInstallPrompt: boolean;
  /** Whether to show Android install prompt */
  showAndroidInstallPrompt: boolean;
  /** Whether a new service worker update is available */
  updateAvailable: boolean;
  /** Dismiss the iOS install prompt */
  dismissIOSInstallPrompt: () => void;
  /** Dismiss the Android install prompt */
  dismissAndroidInstallPrompt: () => void;
  /** Trigger the install prompt (Android) */
  installApp: () => Promise<void>;
  /** Apply the service worker update and reload */
  applyUpdate: () => void;
}

const PWAContext = createContext<PWAContextValue | null>(null);

const INSTALL_DISMISSED_KEY = 'intexuraos_install_dismissed_version';

function getCurrentVersion(): string {
  return import.meta.env.INTEXURAOS_BUILD_VERSION;
}

function isDismissedForCurrentVersion(): boolean {
  const dismissedVersion = localStorage.getItem(INSTALL_DISMISSED_KEY);
  return dismissedVersion === getCurrentVersion();
}

function dismissForCurrentVersion(): void {
  localStorage.setItem(INSTALL_DISMISSED_KEY, getCurrentVersion());
}

export function PWAProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSInstallPrompt, setShowIOSInstallPrompt] = useState(false);
  const [showAndroidInstallPrompt, setShowAndroidInstallPrompt] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  // Detect iOS
  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !('MSStream' in window);

  // Check if app is installed as PWA
  useEffect((): void => {
    const standaloneMediaQuery = window.matchMedia('(display-mode: standalone)').matches;
    const navigatorStandalone =
      'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true;
    const isStandalone = standaloneMediaQuery || navigatorStandalone;
    setIsInstalled(isStandalone);

    // Show iOS install prompt if not installed and not dismissed for current version
    if (isIOS && !isStandalone && !isDismissedForCurrentVersion()) {
      setShowIOSInstallPrompt(true);
    }
  }, [isIOS]);

  // Handle beforeinstallprompt event (Android/Chrome)
  useEffect((): (() => void) => {
    const handleBeforeInstallPrompt = (e: Event): void => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (!isDismissedForCurrentVersion()) {
        setShowAndroidInstallPrompt(true);
      }
    };

    const handleAppInstalled = (): void => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowAndroidInstallPrompt(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return (): void => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Register service worker and listen for updates
  useEffect((): void => {
    if ('serviceWorker' in navigator) {
      // Import the virtual module from vite-plugin-pwa
      import('virtual:pwa-register')
        .then(({ registerSW }) => {
          // Store updateSW for later use
          (window as { __updateSW?: () => Promise<void> }).__updateSW = registerSW({
            onNeedRefresh(): void {
              setUpdateAvailable(true);
            },
            onOfflineReady(): void {
              // App is ready for offline use
            },
            onRegisteredSW(_swUrl: string, r?: ServiceWorkerRegistration): void {
              if (r !== undefined) {
                setRegistration(r);
              }
            },
          });
        })
        .catch((): void => {
          // PWA registration failed, likely in dev mode
        });
    }
  }, []);

  const dismissIOSInstallPrompt = useCallback((): void => {
    dismissForCurrentVersion();
    setShowIOSInstallPrompt(false);
  }, []);

  const dismissAndroidInstallPrompt = useCallback((): void => {
    dismissForCurrentVersion();
    setShowAndroidInstallPrompt(false);
  }, []);

  const installApp = useCallback(async (): Promise<void> => {
    if (deferredPrompt === null) {
      return;
    }
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const applyUpdate = useCallback((): void => {
    const windowUpdateSW = (window as { __updateSW?: () => Promise<void> }).__updateSW;
    if (windowUpdateSW !== undefined) {
      void windowUpdateSW();
    } else if (registration !== null && registration.waiting !== null) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, [registration]);

  const value: PWAContextValue = {
    canInstall: deferredPrompt !== null,
    isInstalled,
    isIOS,
    showIOSInstallPrompt,
    showAndroidInstallPrompt,
    updateAvailable,
    dismissIOSInstallPrompt,
    dismissAndroidInstallPrompt,
    installApp,
    applyUpdate,
  };

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
}

export function usePWA(): PWAContextValue {
  const context = useContext(PWAContext);
  if (context === null) {
    throw new Error('usePWA must be used within a PWAProvider');
  }
  return context;
}
