import type React from 'react';
import { X, Share, PlusSquare } from 'lucide-react';
import { usePWA } from '@/context/pwa-context';

/**
 * iOS-specific install instructions banner.
 * Shows how to add the app to home screen using Safari's Share menu.
 */
export function IOSInstallBanner(): React.JSX.Element | null {
  const { showIOSInstallPrompt, dismissIOSInstallPrompt } = usePWA();

  if (!showIOSInstallPrompt) {
    return null;
  }

  return (
    <div className="safe-area-inset-bottom fixed bottom-0 left-0 right-0 z-50 bg-slate-900 p-4 text-white shadow-lg">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <button
          onClick={dismissIOSInstallPrompt}
          className="absolute -right-1 -top-1 p-1 text-slate-400 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="mb-2 text-sm font-semibold">Install IntexuraOS</p>
        <p className="mb-3 text-sm text-slate-300">
          Add this app to your home screen for the best experience.
        </p>

        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span>Tap</span>
          <Share className="h-5 w-5 text-blue-400" />
          <span>then</span>
          <PlusSquare className="h-5 w-5 text-blue-400" />
          <span className="font-medium text-white">"Add to Home Screen"</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Android/Chrome install prompt banner.
 * Shows when beforeinstallprompt event is captured.
 */
export function AndroidInstallBanner(): React.JSX.Element | null {
  const { canInstall, installApp } = usePWA();

  if (!canInstall) {
    return null;
  }

  return (
    <div className="safe-area-inset-bottom fixed bottom-0 left-0 right-0 z-50 bg-blue-600 p-4 text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-semibold">Install IntexuraOS</p>
          <p className="text-sm text-blue-100">Add to your home screen for quick access.</p>
        </div>
        <button
          onClick={(): void => {
            void installApp();
          }}
          className="whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
        >
          Install
        </button>
      </div>
    </div>
  );
}

/**
 * Update available notification banner.
 * Shows when a new service worker is waiting to activate.
 * Only displays when app is installed as PWA.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const { updateAvailable, applyUpdate, isInstalled } = usePWA();

  // Only show update banner when app is installed as PWA
  if (!updateAvailable || !isInstalled) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 shadow-lg safe-area-inset-top">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <p className="text-sm font-medium">A new version is available</p>
        <button
          onClick={applyUpdate}
          className="whitespace-nowrap rounded-lg bg-amber-950 px-4 py-2 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-900"
        >
          Update now
        </button>
      </div>
    </div>
  );
}
