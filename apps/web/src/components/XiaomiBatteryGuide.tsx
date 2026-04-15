import { useState, useEffect } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import { usePWA } from '@/context/pwa-context';
import { isXiaomiDevice } from '@/utils/deviceDetection';

const DISMISS_KEY = 'intexuraos_xiaomi_guide_dismissed';

/**
 * Dismissible banner for Xiaomi/HyperOS/MIUI devices.
 * Guides users through battery optimization settings to prevent
 * the OS from killing the PWA in the background.
 */
export function XiaomiBatteryGuide(): React.JSX.Element | null {
  const { isInstalled } = usePWA();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!isXiaomiDevice() || !isInstalled) return;
    const stored = localStorage.getItem(DISMISS_KEY);
    if (stored !== 'true') {
      setDismissed(false);
    }
  }, [isInstalled]);

  if (dismissed) {
    return null;
  }

  const handleDismiss = (): void => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  return (
    <div className="fixed right-4 top-20 z-50 max-w-sm rounded-xl bg-amber-600 p-4 text-white shadow-xl lg:hidden">
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-2 p-1 text-amber-200 hover:text-white"
        aria-label="Dismiss"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="pr-6">
        <p className="mb-1 text-sm font-semibold">Optimize for Best Experience</p>
        <p className="mb-3 text-sm text-amber-100">
          Your device may close this app in the background. Follow these steps:
        </p>

        <ol className="mb-3 list-inside list-decimal space-y-1 text-sm text-amber-50">
          <li>Open Settings &rarr; Apps &rarr; find this app (or Chrome)</li>
          <li>Tap Battery Saver &rarr; select &ldquo;No restrictions&rdquo;</li>
          <li>Enable Autostart for the app</li>
          <li>Lock the app in recent apps (hold &amp; tap padlock)</li>
        </ol>

        <a
          href="https://dontkillmyapp.com/xiaomi"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-amber-100 underline hover:text-white"
        >
          Learn more
        </a>
      </div>
    </div>
  );
}
