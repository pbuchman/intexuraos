import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { useCronExecutions, useCronServices } from '@/hooks';
import {
  getSchedule,
  updateSchedule as updateScheduleApi,
  deleteSchedule as deleteScheduleApi,
  triggerSchedule as triggerScheduleApi,
} from '@/services/cronAgentApi';
import { formatDateTime, formatDurationMs } from '@/utils/dateFormat';
import { ApiError } from '@/services/apiClient';
import type { CronExecution, CronSchedule, CronScheduleStatus } from '@/types';

function executionStatusColor(status: CronExecution['status']): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'success':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'failure':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'skipped':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
  }
}

// ---------------------------------------------------------------------------
// Inline edit helpers
// ---------------------------------------------------------------------------

function InlineEditText({
  value,
  onSave,
  label,
  multiline,
}: {
  value: string;
  onSave: (newValue: string) => void;
  label: string;
  multiline?: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current !== null) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleSave = useCallback((): void => {
    const trimmed = draft.trim();
    if (trimmed !== '' && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  }, [draft, value, onSave]);

  const handleCancel = useCallback((): void => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && (multiline !== true || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSave, handleCancel, multiline],
  );

  if (editing) {
    return (
      <div className="flex items-start gap-2">
        {multiline === true ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e): void => {
              setDraft(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            rows={3}
            className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            aria-label={label}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e): void => {
              setDraft(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            aria-label={label}
          />
        )}
        <button
          type="button"
          onClick={handleSave}
          className="rounded p-1 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30"
          title="Save"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(): void => {
        setEditing(true);
      }}
      className="group inline-flex max-w-full items-center gap-1.5 text-left"
      title={`Edit ${label}`}
    >
      <span className="truncate">{value}</span>
      <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function CronScheduleViewPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();

  // Schedule state
  const [schedule, setSchedule] = useState<CronSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Action states
  const [updating, setUpdating] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Tools panel
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch schedule
  const fetchSchedule = useCallback(async (): Promise<void> => {
    if (id === undefined) return;
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const token = await getAccessToken();
      const data = await getSchedule(token, id);
      if (isMountedRef.current) {
        setSchedule(data);
      }
    } catch (err) {
      if (isMountedRef.current) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(getErrorMessage(err));
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, id]);

  useEffect(() => {
    void fetchSchedule();
  }, [fetchSchedule]);

  // Executions hook
  const {
    executions,
    loading: executionsLoading,
    error: executionsError,
    refresh: refreshExecutions,
  } = useCronExecutions(id !== undefined ? { scheduleId: id } : undefined);

  const recentExecutions = executions.slice(0, 20);

  // Services hook
  const { services: allServices } = useCronServices();

  // Filter tools to only show those from this schedule's services
  const selectedServiceTools = schedule !== null
    ? allServices.filter((s) => schedule.action.services.includes(s.key))
    : [];

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleUpdate = useCallback(
    async (updates: Partial<{ name: string; status: CronScheduleStatus; action: CronSchedule['action'] }>): Promise<void> => {
      if (id === undefined || schedule === null) return;
      setUpdating(true);
      setActionError(null);

      try {
        const token = await getAccessToken();
        const updated = await updateScheduleApi(token, id, updates);
        if (isMountedRef.current) {
          setSchedule(updated);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setActionError(getErrorMessage(err));
        }
      } finally {
        if (isMountedRef.current) {
          setUpdating(false);
        }
      }
    },
    [getAccessToken, id, schedule],
  );

  const handlePauseResume = useCallback((): void => {
    if (schedule === null) return;
    const newStatus: CronScheduleStatus = schedule.status === 'active' ? 'paused' : 'active';
    void handleUpdate({ status: newStatus });
  }, [schedule, handleUpdate]);

  const handleTrigger = useCallback(async (): Promise<void> => {
    if (id === undefined) return;
    setTriggering(true);
    setActionError(null);

    try {
      const token = await getAccessToken();
      await triggerScheduleApi(token, id);
      if (isMountedRef.current) {
        // Refresh schedule to get updated execution counts and executions list
        void fetchSchedule();
        void refreshExecutions(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setActionError(getErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setTriggering(false);
      }
    }
  }, [getAccessToken, id, fetchSchedule, refreshExecutions]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (id === undefined) return;
    setDeleting(true);
    setActionError(null);

    try {
      const token = await getAccessToken();
      await deleteScheduleApi(token, id);
      if (isMountedRef.current) {
        void navigate('/cron-agent');
      }
    } catch (err) {
      if (isMountedRef.current) {
        setActionError(getErrorMessage(err));
        setDeleting(false);
        setShowDeleteConfirm(false);
      }
    }
  }, [getAccessToken, id, navigate]);

  const handleNameSave = useCallback(
    (newName: string): void => {
      void handleUpdate({ name: newName });
    },
    [handleUpdate],
  );

  const handleInstructionSave = useCallback(
    (newInstruction: string): void => {
      if (schedule === null) return;
      void handleUpdate({
        action: { ...schedule.action, instruction: newInstruction },
      });
    },
    [schedule, handleUpdate],
  );

  // ---------------------------------------------------------------------------
  // Render: loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </Layout>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: not found
  // ---------------------------------------------------------------------------

  if (notFound) {
    return (
      <Layout>
        <div className="py-12 text-center">
          <h2 className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
            Schedule not found
          </h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            The schedule you are looking for does not exist or has been deleted.
          </p>
          <button
            type="button"
            onClick={(): void => {
              void navigate('/cron-agent');
            }}
            className="text-blue-600 underline dark:text-blue-400"
          >
            Back to schedules
          </button>
        </div>
      </Layout>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: error
  // ---------------------------------------------------------------------------

  if (error !== null || schedule === null) {
    return (
      <Layout>
        <Card variant="error" className="mt-4">
          <p>{error ?? 'Failed to load schedule'}</p>
        </Card>
        <button
          type="button"
          onClick={(): void => {
            void navigate('/cron-agent');
          }}
          className="mt-4 text-sm text-blue-600 underline dark:text-blue-400"
        >
          Back to schedules
        </button>
      </Layout>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: schedule details
  // ---------------------------------------------------------------------------

  return (
    <Layout>
      {/* Back button */}
      <button
        type="button"
        onClick={(): void => {
          void navigate('/cron-agent');
        }}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to schedules
      </button>

      {/* Action error banner */}
      {actionError !== null ? (
        <div className="mb-4 break-words rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {actionError}
        </div>
      ) : null}

      {/* Schedule header card */}
      <Card className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {/* Name (editable) */}
            <div className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              <InlineEditText value={schedule.name} onSave={handleNameSave} label="name" />
            </div>

            {/* Description */}
            {schedule.description !== '' ? (
              <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                {schedule.description}
              </p>
            ) : null}

            {/* Cron expression and timezone */}
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-700">
                {schedule.cronExpression}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{schedule.timezone}</span>
            </div>

            {/* Status badge */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                schedule.status === 'active'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  schedule.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'
                }`}
              />
              {schedule.status}
            </span>

            {/* Timestamps */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
              <span>Created: {formatDateTime(schedule.createdAt)}</span>
              <span>Updated: {formatDateTime(schedule.updatedAt)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handlePauseResume}
              disabled={updating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
              title={schedule.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
            >
              {schedule.status === 'active' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {schedule.status === 'active' ? 'Pause' : 'Resume'}
              </span>
            </button>
            <button
              type="button"
              onClick={(): void => {
                void handleTrigger();
              }}
              disabled={triggering}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              title="Trigger execution now"
            >
              {triggering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Trigger Now</span>
            </button>
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
                <button
                  type="button"
                  onClick={(): void => {
                    void handleDelete();
                  }}
                  disabled={deleting}
                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={(): void => {
                    setShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 dark:border-slate-600 dark:text-slate-400"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={(): void => {
                  setShowDeleteConfirm(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 dark:border-slate-600 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-900/30"
                title="Delete schedule"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Action config section */}
      <Card className="mb-6">
        <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Action Configuration
        </h3>

        {/* Services */}
        <div className="mb-4">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Services
          </span>
          <div className="flex flex-wrap gap-1.5">
            {schedule.action.services.map((service) => (
              <span
                key={service}
                className="inline-flex rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              >
                {service}
              </span>
            ))}
            {schedule.action.services.length === 0 ? (
              <span className="text-xs text-slate-400 dark:text-slate-500">No services configured</span>
            ) : null}
          </div>
        </div>

        {/* Instruction (editable) */}
        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Instruction
          </span>
          <div className="text-sm text-slate-700 dark:text-slate-300">
            <InlineEditText
              value={schedule.action.instruction}
              onSave={handleInstructionSave}
              label="instruction"
              multiline
            />
          </div>
        </div>
      </Card>

      {/* Available tools panel (expandable) */}
      {selectedServiceTools.length > 0 ? (
        <Card className="mb-6">
          <button
            type="button"
            onClick={(): void => {
              setToolsPanelOpen(!toolsPanelOpen);
            }}
            className="flex w-full items-center justify-between text-left"
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Available Tools
            </h3>
            {toolsPanelOpen ? (
              <ChevronDown className="h-5 w-5 text-slate-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-slate-400" />
            )}
          </button>

          {toolsPanelOpen ? (
            <div className="mt-4 space-y-4">
              {selectedServiceTools.map((service) => (
                <div key={service.key}>
                  <h4 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {service.name}
                  </h4>
                  <div className="space-y-1.5">
                    {service.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
                      >
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                          {tool.name}
                        </span>
                        {tool.description !== '' ? (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {tool.description}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {service.tools.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-500">No tools</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Recent executions */}
      <Card className="mb-6">
        <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Recent Executions
        </h3>

        {executionsLoading && recentExecutions.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          </div>
        ) : executionsError !== null ? (
          <p className="text-sm text-red-600 dark:text-red-400">{executionsError}</p>
        ) : recentExecutions.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            No executions yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="pb-2 pr-4">Timestamp</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Duration</th>
                  <th className="pb-2 pr-4">Trigger</th>
                  <th className="pb-2">Tool Calls</th>
                </tr>
              </thead>
              <tbody>
                {recentExecutions.map((execution) => (
                  <tr
                    key={execution.id}
                    onClick={(): void => {
                      void navigate('/cron-agent/executions');
                    }}
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50"
                  >
                    <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-600 dark:text-slate-300">
                      {formatDateTime(execution.startedAt)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${executionStatusColor(execution.status)}`}
                      >
                        {execution.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-600 dark:text-slate-300">
                      {formatDurationMs(execution.durationMs)}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500 dark:text-slate-400">
                      {execution.trigger}
                    </td>
                    <td className="py-2 text-xs text-slate-600 dark:text-slate-300">
                      {String(execution.toolCalls.length)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Layout>
  );
}
