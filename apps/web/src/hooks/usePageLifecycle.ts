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
          void navigate(checkpoint.routePath);
          const scrollY = checkpoint.scrollY;
          // Use double-rAF to wait for route render before restoring scroll
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo(0, scrollY);
            });
          });
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
        routePath: loc.pathname + loc.search,
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
        // Restored from BFCache — existing hooks already refresh data on
        // visibilitychange (visible). This handler is a future extension
        // point for re-establishing connections (WebSocket, etc.) if needed.
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('freeze', handleFreeze);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('freeze', handleFreeze);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);
}
