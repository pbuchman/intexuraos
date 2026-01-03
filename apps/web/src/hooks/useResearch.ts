import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  createResearch as createResearchApi,
  deleteResearch as deleteResearchApi,
  getResearch as getResearchApi,
  listResearches as listResearchesApi,
  saveDraft as saveDraftApi,
} from '@/services/llmOrchestratorApi';
import type {
  CreateResearchRequest,
  Research,
  SaveDraftRequest,
} from '@/services/llmOrchestratorApi.types';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';

/**
 * Hook for fetching a single research by ID with real-time Firestore updates.
 *
 * 💰 CostGuard: Replaces polling with conditional Firestore listener.
 * Only listens when research status is 'pending' or 'processing'.
 */
export function useResearch(id: string): {
  research: Research | null;
  loading: boolean;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
} {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [research, setResearch] = useState<Research | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const firebaseAuthenticatedRef = useRef(false);
  const lastStatusRef = useRef<string | null>(null);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const shouldShowLoading = showLoading !== false;

      if (id === '') {
        setLoading(false);
        return;
      }

      if (shouldShowLoading) {
        setLoading(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await getResearchApi(token, id);
        setResearch(data);
        lastStatusRef.current = data.status;
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load research'));
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        }
      }
    },
    [id, getAccessToken]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 💰 CostGuard: Conditional Firestore listener - only for active statuses
  // Completed/failed research doesn't need real-time updates
  useEffect(() => {
    if (!isAuthenticated || user === undefined || id === '' || research === null) {
      return;
    }

    // 💰 CostGuard: Only listen for in-progress statuses, not terminal ones
    const inProgressStatuses = [
      'pending',
      'processing',
      'retrying',
      'synthesizing',
      'awaiting_confirmation',
    ];
    if (!inProgressStatuses.includes(research.status)) {
      // Cleanup any existing listener when status changes to terminal
      if (unsubscribeRef.current !== null) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      return;
    }

    let listenerFailed = false;

    const setupListener = async (): Promise<void> => {
      try {
        // Authenticate with Firebase if not already done
        if (!firebaseAuthenticatedRef.current || !isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessToken();
          await authenticateFirebase(token);
          firebaseAuthenticatedRef.current = true;
        }

        const db = getFirestoreClient();
        const researchRef = doc(db, 'researches', id);

        // 💰 CostGuard: Document listener (cheaper than collection listener)
        // Only monitors single research document
        unsubscribeRef.current = onSnapshot(
          researchRef,
          (snapshot) => {
            if (snapshot.exists()) {
              const data = snapshot.data();
              const newStatus = data['status'] as string | undefined;

              // Only fetch full data if status changed
              if (newStatus !== undefined && newStatus !== lastStatusRef.current) {
                lastStatusRef.current = newStatus;
                void refresh(false);
              }
            }
          },
          () => {
            listenerFailed = true;
          }
        );
      } catch {
        listenerFailed = true;
      }
    };

    void setupListener();

    // Polling fallback: if Firestore listener fails, poll every 5 seconds
    const pollInterval = setInterval(() => {
      if (listenerFailed) {
        void refresh(false);
      }
    }, 5000);

    // 💰 CostGuard: Cleanup listener and polling on unmount or when conditions change
    return (): void => {
      clearInterval(pollInterval);
      if (unsubscribeRef.current !== null) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [isAuthenticated, user, id, research?.status, getAccessToken, refresh]);

  return { research, loading, error, refresh };
}

/**
 * Hook for managing a list of researches with pagination.
 *
 * 💰 CostGuard: Refreshes on visibility change to catch status updates
 * without expensive Firestore listeners.
 */
export function useResearches(): {
  researches: Research[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  deleteResearch: (id: string) => Promise<void>;
  createResearch: (request: CreateResearchRequest) => Promise<Research>;
  saveDraft: (request: SaveDraftRequest) => Promise<{ id: string }>;
} {
  const { getAccessToken } = useAuth();
  const [researches, setResearches] = useState<Research[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const isInitialLoadRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listResearchesApi(token);
      setResearches(data.items);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== undefined);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load researches'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 💰 CostGuard: Refresh when page becomes visible to catch status updates
  // Cheaper than Firestore listeners for the whole collection
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && !isInitialLoadRef.current) {
        void refresh();
      }
      isInitialLoadRef.current = false;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading) return;

    try {
      const token = await getAccessToken();
      const data = await listResearchesApi(token, cursor);
      setResearches((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== undefined);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load more'));
    }
  }, [cursor, hasMore, loading, getAccessToken]);

  const deleteResearch = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteResearchApi(token, id);
      setResearches((prev) => prev.filter((r) => r.id !== id));
    },
    [getAccessToken]
  );

  const createResearch = useCallback(
    async (request: CreateResearchRequest): Promise<Research> => {
      const token = await getAccessToken();
      const newResearch = await createResearchApi(token, request);
      setResearches((prev) => [newResearch, ...prev]);
      return newResearch;
    },
    [getAccessToken]
  );

  const saveDraft = useCallback(
    async (request: SaveDraftRequest): Promise<{ id: string }> => {
      const token = await getAccessToken();
      const result = await saveDraftApi(token, request);
      await refresh();
      return result;
    },
    [getAccessToken, refresh]
  );

  return {
    researches,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    deleteResearch,
    createResearch,
    saveDraft,
  };
}
