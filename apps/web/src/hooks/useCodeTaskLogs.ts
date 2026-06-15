import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getCodeTask as getCodeTaskApi } from '@/services/codeAgentApi';
import type { CodeTask, CodeTaskStatus } from '@/types';
import {
  authenticateFirebase,
  getFirestoreClient,
  initializeFirebase,
  isFirebaseAuthenticated,
} from '@/services/firebase';

export interface LogLine {
  sequence: number;
  text: string;
}

export interface CodeTaskLogsState {
  task: CodeTask | null;
  logs: LogLine[];
  loading: boolean;
  error: string | null;
  listenerHealthy: boolean;
  refreshTask: () => Promise<CodeTask | null>;
  setTaskState: React.Dispatch<React.SetStateAction<CodeTask | null>>;
}

const ACTIVE_STATUSES: CodeTaskStatus[] = ['dispatched', 'running', 'queued'];

export function useCodeTaskLogs(taskId: string): CodeTaskLogsState {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [task, setTask] = useState<CodeTask | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listenerHealthy, setListenerHealthy] = useState(false);

  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const lastTaskRefreshKeyRef = useRef<string | null>(null);

  const refreshTask = useCallback(async (): Promise<CodeTask | null> => {
    if (taskId === '') return null;
    const token = await getAccessTokenRef.current();
    return await getCodeTaskApi(token, taskId);
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      setLogs([]);
      try {
        const data = await refreshTask();
        if (cancelled) return;
        setTask(data);
        lastTaskRefreshKeyRef.current = data !== null ? taskRefreshKeyFromTask(data) : null;
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Failed to load code task'));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return (): void => {
      cancelled = true;
    };
  }, [refreshTask]);

  useEffect(() => {
    if (!isAuthenticated || user === undefined || taskId === '' || task === null) {
      setListenerHealthy(false);
      return;
    }

    const cancelState = { cancelled: false };
    const unsubs: Unsubscribe[] = [];
    const isActive = ACTIVE_STATUSES.includes(task.status);

    const setup = async (): Promise<void> => {
      try {
        if (!isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessTokenRef.current();
          if (cancelState.cancelled) return;
          await authenticateFirebase(token);
        }

        const db = getFirestoreClient();

        if (isActive) {
          const taskRef = doc(db, 'code_tasks', taskId);
          const taskUnsub = onSnapshot(
            taskRef,
            (snapshot) => {
              if (cancelState.cancelled || !snapshot.exists()) return;
              const nextKey = taskRefreshKeyFromSnapshotData(snapshot.data());
              if (nextKey !== null && nextKey !== lastTaskRefreshKeyRef.current) {
                lastTaskRefreshKeyRef.current = nextKey;
                void refreshTask().then((data) => {
                  if (!cancelState.cancelled) {
                    setTask(data);
                    lastTaskRefreshKeyRef.current = data !== null ? taskRefreshKeyFromTask(data) : null;
                  }
                }).catch((err: unknown) => {
                  if (!cancelState.cancelled) {
                    setError(getErrorMessage(err, 'Failed to refresh task'));
                  }
                });
              }
            },
            () => {
              if (!cancelState.cancelled) {
                setListenerHealthy(false);
              }
            },
          );
          if (cancelState.cancelled) {
            taskUnsub();
            return;
          }
          unsubs.push(taskUnsub);

          const linesRef = collection(db, 'code_tasks', taskId, 'log_lines');
          const linesQuery = query(linesRef, orderBy('sequence', 'asc'));
          let isFirstSnapshot = true;
          const logsUnsub = onSnapshot(
            linesQuery,
            (snapshot) => {
              if (cancelState.cancelled) return;

              if (isFirstSnapshot) {
                isFirstSnapshot = false;
                const initialLogs: LogLine[] = [];
                for (const docSnap of snapshot.docs) {
                  const data = docSnap.data() as LogLine;
                  initialLogs.push({ sequence: data.sequence, text: data.text });
                }
                setLogs(initialLogs);
                return;
              }

              const added: LogLine[] = [];
              const modified: LogLine[] = [];
              for (const change of snapshot.docChanges()) {
                if (change.type === 'added') {
                  const data = change.doc.data() as LogLine;
                  added.push({ sequence: data.sequence, text: data.text });
                } else if (change.type === 'modified') {
                  const data = change.doc.data() as LogLine;
                  modified.push({ sequence: data.sequence, text: data.text });
                }
              }

              if (added.length === 0 && modified.length === 0) {
                return;
              }

              added.sort((a, b) => a.sequence - b.sequence);
              setLogs((prev) => {
                let updated = prev;

                if (modified.length > 0) {
                  const modifiedMap = new Map(modified.map((line) => [line.sequence, line]));
                  updated = updated.map((line) => modifiedMap.get(line.sequence) ?? line);
                }

                if (added.length > 0) {
                  const maxSequence = updated.length > 0 ? (updated[updated.length - 1]?.sequence ?? -1) : -1;
                  const newLines = added.filter((line) => line.sequence > maxSequence);
                  if (newLines.length > 0) {
                    updated = [...updated, ...newLines];
                  }
                }

                return updated === prev ? prev : updated;
              });
            },
            () => {
              if (!cancelState.cancelled) {
                setListenerHealthy(false);
              }
            },
          );
          unsubs.push(logsUnsub);
          setListenerHealthy(true);
          return;
        }

        const linesRef = collection(db, 'code_tasks', taskId, 'log_lines');
        const linesQuery = query(linesRef, orderBy('sequence', 'asc'));
        const snapshot = await getDocs(linesQuery);
        if (cancelState.cancelled) return;
        const nextLogs: LogLine[] = [];
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data() as LogLine;
          nextLogs.push({ sequence: data.sequence, text: data.text });
        }
        setLogs(nextLogs);
        setListenerHealthy(false);
      } catch {
        if (!cancelState.cancelled) {
          setListenerHealthy(false);
        }
      }
    };

    void setup();

    return (): void => {
      cancelState.cancelled = true;
      setListenerHealthy(false);
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [isAuthenticated, refreshTask, task, taskId, user]);

  return {
    task,
    logs,
    loading,
    error,
    listenerHealthy,
    refreshTask,
    setTaskState: setTask,
  };
}

function taskRefreshKeyFromTask(task: CodeTask): string {
  return [
    task.status,
    task.updatedAt,
    task.dispatchStatus?.reason ?? '',
    task.dispatchStatus?.lastSeenAt ?? '',
    task.callbackState?.configuredAt ?? '',
    task.callbackState?.lastSuccessAt ?? '',
    task.callbackState?.lastFailure?.occurredAt ?? '',
  ].join('|');
}

function taskRefreshKeyFromSnapshotData(data: Record<string, unknown>): string | null {
  const status = data['status'];
  if (typeof status !== 'string') return null;
  const updatedAt = snapshotTimestampToKey(data['updatedAt']);
  const dispatchStatus = data['dispatchStatus'];
  const dispatchReason = typeof dispatchStatus === 'object' && dispatchStatus !== null
    && 'reason' in dispatchStatus && typeof dispatchStatus.reason === 'string'
    ? dispatchStatus.reason
    : '';
  const dispatchLastSeenAt = typeof dispatchStatus === 'object' && dispatchStatus !== null
    && 'lastSeenAt' in dispatchStatus
    ? snapshotTimestampToKey(dispatchStatus.lastSeenAt)
    : '';
  const callbackState = data['callbackState'];
  const callbackConfiguredAt = typeof callbackState === 'object' && callbackState !== null
    && 'configuredAt' in callbackState
    ? snapshotTimestampToKey(callbackState.configuredAt)
    : '';
  const callbackLastSuccessAt = typeof callbackState === 'object' && callbackState !== null
    && 'lastSuccessAt' in callbackState
    ? snapshotTimestampToKey(callbackState.lastSuccessAt)
    : '';
  const callbackLastFailure = typeof callbackState === 'object' && callbackState !== null
    && 'lastFailure' in callbackState
    ? callbackState.lastFailure
    : undefined;
  const callbackLastFailureAt = typeof callbackLastFailure === 'object' && callbackLastFailure !== null
    && 'occurredAt' in callbackLastFailure
    ? snapshotTimestampToKey(callbackLastFailure.occurredAt)
    : '';
  return [
    status,
    updatedAt,
    dispatchReason,
    dispatchLastSeenAt,
    callbackConfiguredAt,
    callbackLastSuccessAt,
    callbackLastFailureAt,
  ].join('|');
}

function snapshotTimestampToKey(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object'
    && value !== null
    && 'toDate' in value
    && typeof value.toDate === 'function'
  ) {
    return (value.toDate() as Date).toISOString();
  }
  return '';
}
