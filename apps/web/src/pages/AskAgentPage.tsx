import { useCallback, useState } from 'react';
import { Loader2, Play, Square, Trash2, XCircle } from 'lucide-react';
import { Layout, Card } from '@/components';
import { CodeTaskLogViewer } from '@/components/code-tasks/CodeTaskLogViewer.js';
import { useAskAgent } from '@/hooks';

export function AskAgentPage(): React.JSX.Element {
  const {
    task,
    logs,
    error,
    starting,
    startError,
    cancelling,
    cancelError,
    isAgentRunning,
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
    taskId,
  } = useAskAgent();

  const [inputValue, setInputValue] = useState('');

  const handleStart = useCallback((): void => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) return;
    setInputValue('');
    void start(trimmed);
  }, [inputValue, start]);

  const handleCancel = useCallback((): void => {
    void cancel();
  }, [cancel]);

  const handleClear = useCallback((): void => {
    clear();
    setInputValue('');
  }, [clear]);

  const hasInput = inputValue.trim().length > 0;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Ask Agent</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Interactive conversation with Claude Code. Type a message and click Start.
        </p>
      </div>

      {error !== null ? (
        <Card variant="error" className="mb-4">
          <p>{error}</p>
        </Card>
      ) : null}

      {startError !== null ? (
        <Card variant="error" className="mb-4">
          <p>{startError}</p>
        </Card>
      ) : null}

      {cancelError !== null ? (
        <Card variant="error" className="mb-4">
          <p>{cancelError}</p>
        </Card>
      ) : null}

      {/* Log viewer — reuses the same component as code task view */}
      <CodeTaskLogViewer
        logs={logs}
        isActive={isAgentRunning}
        listenerHealthy={listenerHealthy}
        taskStatus={task?.status ?? 'queued'}
        agentType="ask_agent"
        {...(taskId !== null ? { onSendMessage: sendMessage } : {})}
        sending={sending}
        sendError={sendError}
        messageStatus={messageStatus}
        workerOnline={workerOnline}
        workerName={workerName}
        readOnly={taskId === null}
      />

      {/* Input + Start button — shown when no task exists yet */}
      {taskId === null ? (
        <div className="mt-4 space-y-3">
          <textarea
            value={inputValue}
            onChange={(e): void => {
              setInputValue(e.target.value);
            }}
            onKeyDown={(e): void => {
              if (e.key === 'Enter' && !e.shiftKey && canStart && hasInput) {
                e.preventDefault();
                handleStart();
              }
            }}
            placeholder="What would you like to ask Claude?"
            rows={3}
            className="w-full resize-none rounded-lg border border-slate-300 bg-white px-4 py-3 font-mono text-sm leading-relaxed text-slate-900 placeholder-slate-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-500"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleStart}
              disabled={!canStart || !hasInput || starting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start
            </button>
          </div>
        </div>
      ) : null}

      {/* Action buttons — shown when a task exists */}
      {taskId !== null ? (
        <div className="mt-4 space-y-4">
          {/* Primary action buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!canCancel || cancelling}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {cancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Cancel
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={!canClear}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </button>
          </div>

          {/* Stop button — separate section */}
          {isAgentRunning ? (
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <button
                type="button"
                onClick={handleCancel}
                disabled={!canCancel || cancelling}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Stop &amp; Free Worker
              </button>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Kills the task and frees the worker slot.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Layout>
  );
}
