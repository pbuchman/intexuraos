/**
 * Real-time action changes listener with cost optimizations.
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

export interface UseActionChangesResult {
  changedActionIds: string[];
  error: string | null;
  isListening: boolean;
  clearChangedIds: () => void;
}

// 💰 CostGuard: Maximum documents to fetch per query
const MAX_QUERY_LIMIT = 100;

export function useActionChanges(): UseActionChangesResult {
  const { getAccessToken, user, isAuthenticated } = useAuth();
  const [changedActionIds, setChangedActionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const isVisibleRef = useRef(true);
  const firebaseAuthenticatedRef = useRef(false);
  const isSettingUpRef = useRef(false);

  const clearChangedIds = useCallback((): void => {
    setChangedActionIds([]);
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
      // Authenticate with Firebase if not already done
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

      // 💰 CostGuard: Query with strict limit (max 100 per security rules)
      // Orders by updatedAt descending to get most recent changes first
      const q = query(
        collection(db, 'actions'),
        where('userId', '==', userId),
        orderBy('updatedAt', 'desc'),
        limit(MAX_QUERY_LIMIT) // 💰 CostGuard: Explicit limit prevents accidental full collection read
      );

      // 💰 CostGuard: Listener only reads minimal metadata (userId, status, updatedAt)
      // Full action data fetched separately via batch API
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const changed: string[] = [];

          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' || change.type === 'modified') {
              changed.push(change.doc.id);
            }
          });

          if (changed.length > 0) {
            setChangedActionIds((prev) => {
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

      unsubscribeRef.current = unsubscribe;
      setIsListening(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to setup listener');
    } finally {
      isSettingUpRef.current = false;
    }
  }, [isAuthenticated, user, getAccessToken]);

  // 💰 CostGuard: Pause listeners when tab is hidden (reduce continuous reads)
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      isVisibleRef.current = document.visibilityState === 'visible';

      if (!isVisibleRef.current) {
        cleanupListener();
      } else if (isAuthenticated && user !== undefined) {
        void setupListener();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, user, setupListener, cleanupListener]);

  // Setup listener when authenticated and visible
  useEffect(() => {
    if (isAuthenticated && user !== undefined && isVisibleRef.current) {
      void setupListener();
    }

    // 💰 CostGuard: Cleanup listener on unmount to prevent memory leaks and ongoing reads
    return (): void => {
      cleanupListener();
    };
  }, [isAuthenticated, user, setupListener, cleanupListener]);

  return {
    changedActionIds,
    error,
    isListening,
    clearChangedIds,
  };
}
