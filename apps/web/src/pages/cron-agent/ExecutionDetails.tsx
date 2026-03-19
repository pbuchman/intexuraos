import { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  SkipForward,
  Loader2,
} from 'lucide-react';
import { formatDurationMs } from '@/utils/dateFormat';
import type { CronExecution, CronExecutionStatus } from '@/types';

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

export function StatusBadge({ status }: { status: CronExecutionStatus }): React.JSX.Element {
  switch (status) {
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle className="h-3 w-3" />
          Success
        </span>
      );
    case 'failure':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          Failure
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 animate-pulse dark:bg-blue-900/30 dark:text-blue-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
          <SkipForward className="h-3 w-3" />
          Skipped
        </span>
      );
  }
}

export function TriggerBadge({ trigger }: { trigger: 'scheduled' | 'manual' }): React.JSX.Element {
  if (trigger === 'manual') {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        Manual
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
      Scheduled
    </span>
  );
}

export function ExecutionDetails({ execution }: { execution: CronExecution }): React.JSX.Element {
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleTool = useCallback((index: number): void => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="space-y-4">
        {/* Agent Response */}
        {execution.agentResponse !== null ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Agent Response
            </h4>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {execution.agentResponse}
            </pre>
          </div>
        ) : null}

        {/* Tool Calls */}
        {execution.toolCalls.length > 0 ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Tool Calls ({String(execution.toolCalls.length)})
            </h4>
            <div className="space-y-1">
              {execution.toolCalls.map((call, index) => {
                const isExpanded = expandedTools.has(index);
                return (
                  <div
                    key={index}
                    className="rounded-lg border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
                  >
                    <button
                      type="button"
                      onClick={(): void => { toggleTool(index); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-slate-800 dark:text-slate-200">
                          {call.toolName}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {formatDurationMs(call.durationMs)}
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      )}
                    </button>
                    {isExpanded ? (
                      <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-600">
                        <div className="space-y-2">
                          <div>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              Args:
                            </span>
                            <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {JSON.stringify(call.args, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              Result:
                            </span>
                            <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {truncateString(call.result, 2000)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Token Usage */}
        {execution.tokenUsage !== null ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Token Usage
            </h4>
            <div className="flex gap-4 text-sm">
              <div className="text-slate-600 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">Input: </span>
                {String(execution.tokenUsage.inputTokens)}
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">Output: </span>
                {String(execution.tokenUsage.outputTokens)}
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">Cost: </span>
                {formatCost(execution.tokenUsage.totalCost)}
              </div>
            </div>
          </div>
        ) : null}

        {/* Error */}
        {execution.error !== null ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-500 dark:text-red-400">
              Error
            </h4>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {execution.error}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
