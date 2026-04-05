import { useCallback, useState } from 'react';
import { useAuth } from '@/context';
import { startAskAgent } from '@/services/codeAgentApi';
import { useTaskView } from './useTaskView.js';
import type { CodeTask } from '@/types';

export interface AskAgentState {
  /** Current task ID (null if no session) */
  taskId: string | null;
  /** Current task data (from useTaskView) */
  task: CodeTask | null;
  /** Logs from useTaskView */
  logs: import('./useCodeTaskLogs.js').LogLine[];
  /** Whether a task is loading */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Whether the initial start request is in-flight */
  starting: boolean;
  /** Start error */
  startError: string | null;
  /** Whether cancel is in-flight */
  cancelling: boolean;
  /** Cancel error */
  cancelError: string | null;
  /** Whether agent is currently running (task is running/dispatched/queued) */
  isAgentRunning: boolean;
  /** Whether the session is idle (agent finished its turn) */
  isSessionIdle: boolean;
  /** Whether we can start (no task running) */
  canStart: boolean;
  /** Whether we can cancel (agent is mid-turn) */
  canCancel: boolean;
  /** Whether we can clear (session idle) */
  canClear: boolean;

  // --- Message input state (from useTaskView) ---
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: import('./index.js').MessageStatus;

  // --- Actions ---
  /** Start a new ask agent task with the given prompt */
  start: (prompt: string) => Promise<void>;
  /** Send a follow-up message (--continue) */
  sendMessage: (message: string) => Promise<void>;
  /** Cancel the running task */
  cancel: () => Promise<void>;
  /** Clear the session (reset to fresh state) */
  clear: () => void;

  // --- Log viewer props ---
  listenerHealthy: boolean;
  workerOnline: boolean;
  workerName: string;
}

const ACTIVE_STATUSES = new Set(['queued', 'dispatched', 'running']);
const TERMINAL_STATUSES = new Set([
  'planned', 'implemented', 'reviewed', 'failed', 'cancelled', 'interrupted',
]);

export function useAskAgent(): AskAgentState {
  const { getAccessToken } = useAuth();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // useTaskView handles real-time log streaming, task polling, messaging, and cancellation
  const {
    task,
    logs,
    loading,
    error,
    listenerHealthy,
    cancelling,
    cancelError,
    sending,
    sendError,
    messageStatus,
    cancelTask: cancelTaskFromView,
    sendMessage: sendMessageFromView,
  } = useTaskView(taskId ?? '');

  const isAgentRunning = task !== null && ACTIVE_STATUSES.has(task.status);
  const isSessionIdle = task !== null && TERMINAL_STATUSES.has(task.status);
  const canStart = !isAgentRunning && !starting;
  const canCancel = isAgentRunning;
  const canClear = isSessionIdle && !starting;

  const start = useCallback(async (prompt: string): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      const token = await getAccessToken();
      const response = await startAskAgent(token, { prompt });
      setTaskId(response.codeTaskId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start ask agent';
      setStartError(message);
    } finally {
      setStarting(false);
    }
  }, [getAccessToken]);

  const sendMessage = useCallback(async (message: string): Promise<void> => {
    if (taskId === null) {
      await start(message);
      return;
    }
    await sendMessageFromView(message);
  }, [taskId, start, sendMessageFromView]);

  const cancel = useCallback(async (): Promise<void> => {
    await cancelTaskFromView();
  }, [cancelTaskFromView]);

  const clear = useCallback((): void => {
    setTaskId(null);
    setStartError(null);
  }, []);

  const workerOnline = true; // Simplified for MVP — worker status handled by useTaskView
  const workerName = task?.workerLocation ?? '';

  return {
    taskId,
    task,
    logs,
    loading: taskId !== null && loading,
    error: taskId !== null ? error : null,
    starting,
    startError,
    cancelling,
    cancelError,
    isAgentRunning,
    isSessionIdle,
    canStart,
    canCancel,
    canClear,
    sending,
    sendError,
    messageStatus,
    start,
    sendMessage,
    cancel,
    clear,
    listenerHealthy,
    workerOnline,
    workerName,
  };
}
