import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from 'firebase/firestore';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getDispatchQueue } from '@/services/codeAgentApi';
import type { QueuedTask, QueueResponse } from '@/services/codeAgentApi';
import {
  authenticateFirebase,
  getFirestoreClient,
  initializeFirebase,
  isFirebaseAuthenticated,
} from '@/services/firebase';

export interface DispatchQueueState {
  tasks: QueuedTask[];
  totalQueued: number;
  maxQueueSize: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDispatchQueue(): DispatchQueueState {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [tasks, setTasks] = useState<QueuedTask[]>([]);
  const [totalQueued, setTotalQueued] = useState(0);
  const [maxQueueSize, setMaxQueueSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const fetchQueue = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessTokenRef.current();
      const data: QueueResponse = await getDispatchQueue(token);
      setTasks(data.tasks);
      setTotalQueued(data.totalQueued);
      setMaxQueueSize(data.maxQueueSize);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load dispatch queue'));
    }
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      await fetchQueue();
      if (!cancelled) {
        setLoading(false);
      }
    };
    void load();
    return (): void => { cancelled = true; };
  }, [fetchQueue]);

  // Firestore real-time listener for queue changes
  useEffect(() => {
    if (!isAuthenticated || user === undefined) return;

    const cancelState = { cancelled: false };
    let unsub: Unsubscribe | null = null;

    const setup = async (): Promise<void> => {
      try {
        if (!isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessTokenRef.current();
          if (cancelState.cancelled) return;
          await authenticateFirebase(token);
        }

        const db = getFirestoreClient();
        const queueQuery = query(
          collection(db, 'code_tasks'),
          where('status', '==', 'queued'),
          orderBy('queuedAt', 'asc'),
        );

        unsub = onSnapshot(
          queueQuery,
          () => {
            // On any change to queued tasks, refetch via API for full data
            if (!cancelState.cancelled) {
              void fetchQueue();
            }
          },
          () => {
            // Firestore listener error — silent, API polling still works
          },
        );
      } catch {
        // Firebase init error — page still works via initial API load
      }
    };

    void setup();

    return (): void => {
      cancelState.cancelled = true;
      if (unsub !== null) {
        unsub();
      }
    };
  }, [isAuthenticated, user, fetchQueue]);

  return {
    tasks,
    totalQueued,
    maxQueueSize,
    loading,
    error,
    refresh: fetchQueue,
  };
}
