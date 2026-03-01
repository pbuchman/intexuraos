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
import {
  getCodeTask as getCodeTaskApi,
  cancelCodeTask as cancelCodeTaskApi,
  retryCodeTask as retryCodeTaskApi,
  sendTaskMessage as sendTaskMessageApi,
  startImplementation as startImplementationApi,
  deleteCodeTask as deleteCodeTaskApi,
} from '@/services/codeAgentApi';
import { ApiError } from '@/services/apiClient';
import type { CodeTask, CodeTaskStatus, CodeTaskWorkerType, RetryCodeTaskRequest } from '@/types';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';

export interface LogLine {
  sequence: number;
  text: string;
}

export type MessageStatus = 'idle' | 'queued' | 'delivered';

export interface TaskViewState {
  task: CodeTask | null;
  logs: LogLine[];
  loading: boolean;
  error: string | null;
  listenerHealthy: boolean;
  cancelling: boolean;
  cancelError: string | null;
  retrying: boolean;
  retryError: string | null;
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: MessageStatus;
  implementing: boolean;
  implementError: string | null;
  deleting: boolean;
  deleteError: string | null;
  cancelTask: () => Promise<void>;
  retryTask: (workerType?: string, additionalContext?: string) => Promise<string>;
  sendMessage: (message: string) => Promise<void>;
  startImplementation: (workerType?: string) => Promise<string>;
  deleteTask: () => Promise<void>;
  clearDeleteError: () => void;
}

const ACTIVE_STATUSES: CodeTaskStatus[] = ['dispatched', 'running', 'queued'];

/**
 * Single hook for the Code Task View page.
 * Manages HTTP task fetch + Firestore log streaming.
 *
 * - Active tasks: onSnapshot on task doc (status changes) + log_lines subcollection
 * - Terminal tasks: one-time getDocs for log_lines
 * - Cancellation guards on all async paths
 */
export function useTaskView(taskId: string): TaskViewState {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [task, setTask] = useState<CodeTask | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{ code: string; message: string } | null>(null);
  const [messageStatus, setMessageStatus] = useState<MessageStatus>('idle');
  const [implementing, setImplementing] = useState(false);
  const [implementError, setImplementError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [listenerHealthy, setListenerHealthy] = useState(false);

  const isMountedRef = useRef(true);
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  // Track latest task status to avoid redundant fetches
  const lastStatusRef = useRef<string | null>(null);

  // --- Fetch task via HTTP ---
  const fetchTask = useCallback(async (): Promise<CodeTask | null> => {
    if (taskId === '') return null;
    const token = await getAccessTokenRef.current();
    return await getCodeTaskApi(token, taskId);
  }, [taskId]);

  // --- Initial load ---
  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTask();
        if (cancelled) return;
        setTask(data);
        if (data !== null) {
          lastStatusRef.current = data.status;
        }
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
      isMountedRef.current = false;
    };
  }, [fetchTask]);

  // --- Firestore: task status listener + log streaming ---
  useEffect(() => {
    if (!isAuthenticated || user === undefined || taskId === '' || task === null) {
      return;
    }

    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const isActive = ACTIVE_STATUSES.includes(task.status);

    const setup = async (): Promise<void> => {
      try {
        // Authenticate Firebase if needed
        if (!isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessTokenRef.current();
          if (cancelled) return;
          await authenticateFirebase(token);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure after await yields
          if (cancelled) return;
        }

        const db = getFirestoreClient();

        if (isActive) {
          // Live: listen for status changes on task doc
          const taskRef = doc(db, 'code_tasks', taskId);
          const taskUnsub = onSnapshot(
            taskRef,
            (snapshot) => {
              if (cancelled) return;
              if (snapshot.exists()) {
                const newStatus = snapshot.data()['status'] as string | undefined;
                if (newStatus !== undefined && newStatus !== lastStatusRef.current) {
                  lastStatusRef.current = newStatus;
                  // Re-fetch task via HTTP for full data
                  void fetchTask().then((data) => {
                    if (!cancelled && data !== null) {
                      setTask(data);
                    }
                  }).catch((err: unknown) => {
                    if (!cancelled) {
                      setError(getErrorMessage(err, 'Failed to refresh task'));
                    }
                  });
                }
              }
            },
            () => {
              if (!cancelled) {
                setListenerHealthy(false);
              }
            }
          );
          if (cancelled) {
            taskUnsub();
            return;
          }
          unsubs.push(taskUnsub);

          // Live: stream log lines
          const linesRef = collection(db, 'code_tasks', taskId, 'log_lines');
          const linesQuery = query(linesRef, orderBy('sequence', 'asc'));
          let isFirstSnapshot = true;
          const logsUnsub = onSnapshot(
            linesQuery,
            (snapshot) => {
              if (cancelled) return;

              // First snapshot after (re-)attaching: replace all logs so resumed
              // tasks don't miss lines when the orchestrator restarts sequencing.
              if (isFirstSnapshot) {
                isFirstSnapshot = false;
                const all: LogLine[] = [];
                for (const docSnap of snapshot.docs) {
                  const data = docSnap.data() as LogLine;
                  all.push({ sequence: data.sequence, text: data.text });
                }
                setLogs(all);
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
              if (added.length > 0 || modified.length > 0) {
                added.sort((a, b) => a.sequence - b.sequence);
                setLogs((prev) => {
                  let updated = prev;
                  // Apply modifications (replace existing lines by sequence)
                  if (modified.length > 0) {
                    const modMap = new Map(modified.map((l) => [l.sequence, l]));
                    updated = updated.map((l) => modMap.get(l.sequence) ?? l);
                  }
                  // Append new lines
                  if (added.length > 0) {
                    const maxSeq = updated.length > 0 ? (updated[updated.length - 1]?.sequence ?? -1) : -1;
                    const newLines = added.filter((l) => l.sequence > maxSeq);
                    if (newLines.length > 0) {
                      updated = [...updated, ...newLines];
                    }
                  }
                  return updated !== prev ? updated : prev;
                });
              }
            },
            () => {
              if (!cancelled) {
                setListenerHealthy(false);
              }
            }
          );
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- guard for cleanup during synchronous listener setup
          if (cancelled) {
            logsUnsub();
            return;
          }
          unsubs.push(logsUnsub);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure after await yields
          if (!cancelled) setListenerHealthy(true);
        } else {
          // Terminal: one-time fetch of log lines
          const linesRef = collection(db, 'code_tasks', taskId, 'log_lines');
          const linesQuery = query(linesRef, orderBy('sequence', 'asc'));
          const snapshot = await getDocs(linesQuery);
          if (cancelled) return;
          const lines: LogLine[] = [];
          for (const docSnap of snapshot.docs) {
            const data = docSnap.data() as LogLine;
            lines.push({ sequence: data.sequence, text: data.text });
          }
          setLogs(lines);
        }
      } catch {
        if (!cancelled) {
          setListenerHealthy(false);
        }
      }
    };

    void setup();

    return (): void => {
      cancelled = true;
      setListenerHealthy(false);
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [isAuthenticated, user, taskId, task?.status, fetchTask]);

  // --- Actions ---
  const cancelTask = useCallback(async (): Promise<void> => {
    if (task === null) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const token = await getAccessTokenRef.current();
      await cancelCodeTaskApi(token, task.id);
      const data = await fetchTask();
      if (isMountedRef.current && data !== null) {
        setTask(data);
        lastStatusRef.current = data.status;
      }
    } catch (err) {
      if (isMountedRef.current) {
        setCancelError(getErrorMessage(err, 'Failed to cancel task'));
      }
    } finally {
      if (isMountedRef.current) {
        setCancelling(false);
      }
    }
  }, [task, fetchTask]);

  const retryTask = useCallback(async (workerType?: string, additionalContext?: string): Promise<string> => {
    if (task === null) throw new Error('No task to retry');
    setRetrying(true);
    setRetryError(null);
    try {
      const token = await getAccessTokenRef.current();
      const request: RetryCodeTaskRequest = { taskId: task.id };
      const trimmedContext = additionalContext?.trim();
      if (trimmedContext !== undefined && trimmedContext.length > 0) {
        request.additionalContext = trimmedContext;
      }
      if (workerType !== undefined) {
        request.workerType = workerType as CodeTaskWorkerType;
      }
      const result = await retryCodeTaskApi(token, request);
      return result.codeTaskId;
    } catch (err) {
      if (isMountedRef.current) {
        setRetryError(getErrorMessage(err, 'Failed to retry task'));
      }
      throw err;
    } finally {
      if (isMountedRef.current) {
        setRetrying(false);
      }
    }
  }, [task]);

  const sendMessage = useCallback(async (message: string): Promise<void> => {
    if (task === null) return;
    setSending(true);
    setSendError(null);
    setMessageStatus('idle');
    try {
      const token = await getAccessTokenRef.current();
      const result = await sendTaskMessageApi(token, task.id, { message });
      if (isMountedRef.current) {
        setMessageStatus(result.action === 'queued' ? 'queued' : 'delivered');

        // When a terminal task is resumed, update local status so the
        // Firestore effect re-runs and attaches live onSnapshot listeners.
        if (result.action === 'resumed') {
          setTask({ ...task, status: 'running' });
          lastStatusRef.current = 'running';
        }

        // Reset status after 3 seconds so user can send another message
        setTimeout(() => {
          if (isMountedRef.current) {
            setMessageStatus('idle');
          }
        }, 3000);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const code = err instanceof ApiError ? err.code : 'UNKNOWN';
        setSendError({ code, message: getErrorMessage(err, 'Failed to send message') });
      }
    } finally {
      if (isMountedRef.current) {
        setSending(false);
      }
    }
  }, [task]);

  const startImplementation = useCallback(async (workerType?: string): Promise<string> => {
    if (task === null) throw new Error('No task to implement');
    setImplementing(true);
    setImplementError(null);
    try {
      const token = await getAccessTokenRef.current();
      const result = await startImplementationApi(token, task.id, workerType);
      return result.codeTaskId;
    } catch (err) {
      if (isMountedRef.current) {
        // For already_implemented, extract existingTaskId from details and navigate
        if (err instanceof ApiError && err.code === 'already_implemented') {
          const existingTaskId = err.details?.['existingTaskId'];
          if (typeof existingTaskId === 'string') {
            return existingTaskId;
          }
        }
        setImplementError(getErrorMessage(err, 'Failed to start implementation'));
      }
      throw err;
    } finally {
      if (isMountedRef.current) {
        setImplementing(false);
      }
    }
  }, [task]);

  const deleteTask = useCallback(async (): Promise<void> => {
    if (task === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const token = await getAccessTokenRef.current();
      await deleteCodeTaskApi(token, task.id);
    } catch (err) {
      if (isMountedRef.current) {
        setDeleteError(getErrorMessage(err, 'Failed to delete task'));
      }
      throw err;
    } finally {
      if (isMountedRef.current) {
        setDeleting(false);
      }
    }
  }, [task]);

  const clearDeleteError = useCallback((): void => {
    setDeleteError(null);
  }, []);

  return {
    task,
    logs,
    loading,
    error,
    listenerHealthy,
    cancelling,
    cancelError,
    retrying,
    retryError,
    sending,
    sendError,
    messageStatus,
    implementing,
    implementError,
    deleting,
    deleteError,
    cancelTask,
    retryTask,
    sendMessage,
    startImplementation,
    deleteTask,
    clearDeleteError,
  };
}
