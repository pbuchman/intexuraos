import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  limit,
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

/** 💰 CostGuard: Firestore security rules enforce query.limit <= 100 */
const MAX_QUERY_LIMIT = 100;

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
  const isMountedRef = useRef(false);

  const fetchQueue = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessTokenRef.current();
      const data: QueueResponse = await getDispatchQueue(token);
      if (isMountedRef.current) {
        setTasks(data.tasks);
        setTotalQueued(data.totalQueued);
        setMaxQueueSize(data.maxQueueSize);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to load dispatch queue'));
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    isMountedRef.current = true;
    const load = async (): Promise<void> => {
      setLoading(true);
      await fetchQueue();
      if (isMountedRef.current) {
        setLoading(false);
      }
    };
    void load();
    return (): void => { isMountedRef.current = false; };
  }, [fetchQueue]);

  // Firestore real-time listener for queue changes
  useEffect(() => {
    if (!isAuthenticated || user?.sub === undefined) return;

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
          where('userId', '==', user.sub),
          orderBy('queuedAt', 'asc'),
          limit(MAX_QUERY_LIMIT),
        );

        let isFirstSnapshot = true;
        unsub = onSnapshot(
          queueQuery,
          () => {
            // Skip the initial snapshot — the initial load effect already fetches
            if (isFirstSnapshot) {
              isFirstSnapshot = false;
              return;
            }
            // On subsequent changes to queued tasks, refetch via API for full data
            if (!cancelState.cancelled) {
              void fetchQueue();
            }
          },
          (err) => {
            if (!cancelState.cancelled) {
              setError(getErrorMessage(err, 'Queue listener disconnected — showing last known state'));
            }
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
  }, [isAuthenticated, user?.sub, fetchQueue]);

  return {
    tasks,
    totalQueued,
    maxQueueSize,
    loading,
    error,
    refresh: fetchQueue,
  };
}
