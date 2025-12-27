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
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 text-white p-4 shadow-lg safe-area-inset-bottom">
      <div className="max-w-lg mx-auto relative">
        <button
          onClick={dismissIOSInstallPrompt}
          className="absolute -top-1 -right-1 p-1 text-slate-400 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="w-5 h-5" />
        </button>

        <p className="font-semibold text-sm mb-2">Install IntexuraOS</p>
        <p className="text-sm text-slate-300 mb-3">
          Add this app to your home screen for the best experience.
        </p>

        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span>Tap</span>
          <Share className="w-5 h-5 text-blue-400" />
          <span>then</span>
          <PlusSquare className="w-5 h-5 text-blue-400" />
          <span className="text-white font-medium">"Add to Home Screen"</span>
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
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-blue-600 text-white p-4 shadow-lg safe-area-inset-bottom">
      <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-sm">Install IntexuraOS</p>
          <p className="text-sm text-blue-100">Add to your home screen for quick access.</p>
        </div>
        <button
          onClick={(): void => {
            void installApp();
          }}
          className="px-4 py-2 bg-white text-blue-600 font-semibold rounded-lg text-sm whitespace-nowrap hover:bg-blue-50 transition-colors"
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
 */
export function UpdateBanner(): React.JSX.Element | null {
  const { updateAvailable, applyUpdate } = usePWA();

  if (!updateAvailable) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 p-3 shadow-lg safe-area-inset-top">
      <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
        <p className="text-sm font-medium">A new version is available</p>
        <button
          onClick={applyUpdate}
          className="px-3 py-1.5 bg-amber-950 text-amber-50 font-semibold rounded-lg text-sm whitespace-nowrap hover:bg-amber-900 transition-colors"
        >
          Update now
        </button>
      </div>
    </div>
  );
}
