/**
 * Sync Queue Context for managing background sync of shared content.
 * Provides optimistic saving with retry logic and sync status visibility.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext.js';
import { createCommand } from '../services/commandsApi.js';
import {
  addToQueue,
  calculateNextRetryDelay,
  getHistory,
  getQueue,
  isClientError,
  isRetryDue,
  markAsFailed,
  markAsSynced,
  updateHistoryStatus,
  updateQueueItem,
  type ShareHistoryItem,
} from '../services/shareQueue.js';

interface SyncQueueContextValue {
  pendingCount: number;
  history: ShareHistoryItem[];
  addShare: (content: string) => void;
  refreshHistory: () => void;
  isSyncing: boolean;
}

const SyncQueueContext = createContext<SyncQueueContextValue | null>(null);

interface SyncQueueProviderProps {
  children: ReactNode;
}

export function SyncQueueProvider({ children }: SyncQueueProviderProps): React.JSX.Element {
  const { isAuthenticated, getAccessToken } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [history, setHistory] = useState<ShareHistoryItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncingRef = useRef(false);

  const refreshHistory = useCallback((): void => {
    setHistory(getHistory());
    setPendingCount(getQueue().length);
  }, []);

  const processQueue = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || isSyncingRef.current) return;

    const queue = getQueue();
    if (queue.length === 0) return;

    const dueItems = queue.filter(isRetryDue);
    if (dueItems.length === 0) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const token = await getAccessToken();

      for (const item of dueItems) {
        updateHistoryStatus(item.id, 'syncing');
        refreshHistory();

        try {
          const command = await createCommand(token, {
            text: item.content,
            source: item.source,
            externalId: item.externalId,
          });

          markAsSynced(item.id, command.id);
          refreshHistory();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Sync failed';

          if (isClientError(err)) {
            markAsFailed(item.id, errorMessage);
          } else {
            const nextRetryDelay = calculateNextRetryDelay(item.retryCount);
            updateQueueItem(item.id, {
              retryCount: item.retryCount + 1,
              nextRetryAt: new Date(Date.now() + nextRetryDelay).toISOString(),
              lastError: errorMessage,
            });
            updateHistoryStatus(item.id, 'pending');
          }
          refreshHistory();
        }
      }
    } catch {
      // Token error - will retry on next interval
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isAuthenticated, getAccessToken, refreshHistory]);

  const addShare = useCallback(
    (content: string): void => {
      addToQueue(content);
      refreshHistory();
      void processQueue();
    },
    [refreshHistory, processQueue]
  );

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!isAuthenticated) return;

    void processQueue();

    syncIntervalRef.current = setInterval(() => {
      void processQueue();
    }, 5000);

    const handleOnline = (): void => {
      void processQueue();
    };

    window.addEventListener('online', handleOnline);

    return (): void => {
      if (syncIntervalRef.current !== null) {
        clearInterval(syncIntervalRef.current);
      }
      window.removeEventListener('online', handleOnline);
    };
  }, [isAuthenticated, processQueue]);

  const value = useMemo(
    (): SyncQueueContextValue => ({
      pendingCount,
      history,
      addShare,
      refreshHistory,
      isSyncing,
    }),
    [pendingCount, history, addShare, refreshHistory, isSyncing]
  );

  return <SyncQueueContext.Provider value={value}>{children}</SyncQueueContext.Provider>;
}

export function useSyncQueue(): SyncQueueContextValue {
  const context = useContext(SyncQueueContext);
  if (context === null) {
    throw new Error('useSyncQueue must be used within a SyncQueueProvider');
  }
  return context;
}
