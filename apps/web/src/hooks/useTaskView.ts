import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  cancelCodeTask as cancelCodeTaskApi,
  retryCodeTask as retryCodeTaskApi,
  sendTaskMessage as sendTaskMessageApi,
  startImplementation as startImplementationApi,
  deleteCodeTask as deleteCodeTaskApi,
} from '@/services/codeAgentApi';
import { ApiError } from '@/services/apiClient';
import type { CodeTask, CodeTaskWorkerType, RetryCodeTaskRequest } from '@/types';
import { useCodeTaskLogs, type LogLine } from './useCodeTaskLogs.js';

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

export function useTaskView(taskId: string): TaskViewState {
  const { getAccessToken } = useAuth();
  const {
    task,
    logs,
    loading,
    error,
    listenerHealthy,
    refreshTask,
    setTaskState,
  } = useCodeTaskLogs(taskId);
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

  const isMountedRef = useRef(true);
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  // --- Actions ---
  const cancelTask = useCallback(async (): Promise<void> => {
    if (task === null) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const token = await getAccessTokenRef.current();
      await cancelCodeTaskApi(token, task.id);
      const data = await refreshTask();
      if (isMountedRef.current && data !== null) {
        setTaskState(data);
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
  }, [refreshTask, setTaskState, task]);

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
          setTaskState({ ...task, status: 'running' });
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
  }, [task, setTaskState]);

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
