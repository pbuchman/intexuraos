/**
 * Real-time command changes listener with cost optimizations.
 *
 * Cost optimization features:
 * - 💰 CostGuard: Pauses listener when tab is hidden (Page Visibility API)
 * - 💰 CostGuard: Strict query limit prevents full collection reads
 * - 💰 CostGuard: Only tracks changed IDs, full data fetched via API
 * - 💰 CostGuard: Proper cleanup prevents memory leaks and ongoing reads
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { useAuth } from '@/context';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';

export interface UseCommandChangesResult {
  changedCommandIds: string[];
  error: string | null;
  isListening: boolean;
  clearChangedIds: () => void;
}

const MAX_QUERY_LIMIT = 100;

export function useCommandChanges(enabled = true): UseCommandChangesResult {
  const { getAccessToken, user, isAuthenticated } = useAuth();
  const [changedCommandIds, setChangedCommandIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const isVisibleRef = useRef(true);
  const firebaseAuthenticatedRef = useRef(false);
  const isSettingUpRef = useRef(false);
  const isInitialSnapshotRef = useRef(true);

  const clearChangedIds = useCallback((): void => {
    setChangedCommandIds([]);
  }, []);

  const cleanupListener = useCallback((): void => {
    if (unsubscribeRef.current !== null) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsListening(false);
    }
  }, []);

  const setupListener = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || user === undefined) return;
    if (isSettingUpRef.current) return;

    isSettingUpRef.current = true;

    try {
      if (!firebaseAuthenticatedRef.current || !isFirebaseAuthenticated()) {
        initializeFirebase();
        const token = await getAccessToken();
        await authenticateFirebase(token);
        firebaseAuthenticatedRef.current = true;
      }

      const db = getFirestoreClient();
      const userId = user.sub;

      if (typeof userId !== 'string') {
        setError('Invalid user ID');
        return;
      }

      const q = query(
        collection(db, 'commands'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(MAX_QUERY_LIMIT)
      );

      // Reset initial snapshot flag when starting new listener
      isInitialSnapshotRef.current = true;

      unsubscribeRef.current = onSnapshot(
        q,
        (snapshot) => {
          // Skip the initial snapshot - it reports all documents as 'added'
          // which would override the data from fetchData()
          if (isInitialSnapshotRef.current) {
            isInitialSnapshotRef.current = false;
            return;
          }

          const changed: string[] = [];

          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' || change.type === 'modified') {
              changed.push(change.doc.id);
            }
          });

          if (changed.length > 0) {
            setChangedCommandIds((prev) => {
              const newIds = changed.filter((id) => !prev.includes(id));
              return [...prev, ...newIds];
            });
          }
        },
        (err) => {
          setError(err.message);
          setIsListening(false);
        }
      );
      setIsListening(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to setup listener');
    } finally {
      isSettingUpRef.current = false;
    }
  }, [isAuthenticated, user, getAccessToken]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      isVisibleRef.current = document.visibilityState === 'visible';

      if (!isVisibleRef.current) {
        cleanupListener();
      } else if (enabled && isAuthenticated && user !== undefined) {
        void setupListener();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, isAuthenticated, user, setupListener, cleanupListener]);

  useEffect(() => {
    if (enabled && isAuthenticated && user !== undefined && isVisibleRef.current) {
      void setupListener();
    } else {
      cleanupListener();
    }

    return (): void => {
      cleanupListener();
    };
  }, [enabled, isAuthenticated, user, setupListener, cleanupListener]);

  return {
    changedCommandIds,
    error,
    isListening,
    clearChangedIds,
  };
}
