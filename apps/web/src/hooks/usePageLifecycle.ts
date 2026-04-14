import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
} from '@/services/stateCheckpoint.js';

/**
 * Page lifecycle hook for PWA resilience on Android HyperOS.
 *
 * - Saves route + scroll position to IndexedDB on visibilitychange (hidden) and freeze
 * - Restores saved state on initial page load
 * - Handles BFCache events (pagehide/pageshow)
 * - Requests persistent storage
 *
 * Call once in App.tsx inside the HashRouter.
 */
export function usePageLifecycle(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  const restoredRef = useRef(false);

  // Keep locationRef current to avoid stale closures in event handlers
  locationRef.current = location;

  // Restore checkpoint on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    void (async (): Promise<void> => {
      try {
        const checkpoint = await loadCheckpoint();
        if (checkpoint !== null) {
          void navigate(checkpoint.routeHash);
          const scrollY = checkpoint.scrollY;
          window.setTimeout(() => {
            window.scrollTo(0, scrollY);
          }, 50);
          await clearCheckpoint();
        }
      } catch {
        // Best-effort restore
      }
    })();

    // Request persistent storage (fire-and-forget)
    try {
      if (typeof navigator.storage.persist === 'function') {
        void navigator.storage.persist();
      }
    } catch {
      // Best-effort
    }
  }, [navigate]);

  // Register event listeners
  useEffect(() => {
    const handleSave = (): void => {
      const loc = locationRef.current;
      void saveCheckpoint({
        routeHash: loc.pathname + loc.search,
        scrollY: window.scrollY,
        timestamp: Date.now(),
      });
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        handleSave();
      }
    };

    const handleFreeze = (): void => {
      handleSave();
    };

    const handlePageHide = (): void => {
      // BFCache cleanup — save state before potential eviction
      handleSave();
    };

    const handlePageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        // Restored from BFCache — could refresh data here if needed
        void loadCheckpoint();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('freeze', handleFreeze);
    document.addEventListener('pagehide', handlePageHide);
    document.addEventListener('pageshow', handlePageShow as EventListener);

    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('freeze', handleFreeze);
      document.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener(
        'pageshow',
        handlePageShow as EventListener
      );
    };
  }, []);
}
