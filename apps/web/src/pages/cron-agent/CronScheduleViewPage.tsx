import { useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pause, Play, Trash2, Zap } from 'lucide-react';
import { Card, Layout } from '@/components';
import { useCronExecutions, useCronSchedule, useCronServices, useScheduleActions } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';
import { AvailableToolsPanel } from './AvailableToolsPanel.js';
import { InlineEditText } from './InlineEditText.js';
import { RecentExecutionsTable } from './RecentExecutionsTable.js';
import { ScheduleStatusBadge } from './ScheduleStatusBadge.js';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function CronScheduleViewPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Schedule hook
  const {
    schedule,
    loading,
    error,
    notFound,
    refresh: refreshSchedule,
    update,
    remove,
    trigger,
  } = useCronSchedule(id);

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

  // Action state management
  const actionHooks = useMemo(() => ({
    update,
    trigger,
    remove,
    refreshSchedule,
    refreshExecutions,
  }), [update, trigger, remove, refreshSchedule, refreshExecutions]);

  const {
    updating,
    triggering,
    deleting,
    showDeleteConfirm,
    actionError,
    handlePauseResume,
    handleTrigger,
    handleDelete,
    handleNameSave,
    handleInstructionSave,
    setShowDeleteConfirm,
  } = useScheduleActions(schedule, actionHooks);

  // Handle delete with navigation
  const handleDeleteAndNavigate = useCallback(async (): Promise<void> => {
    await handleDelete();
    void navigate('/cron-agent');
  }, [handleDelete, navigate]);

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
            <ScheduleStatusBadge status={schedule.status} />

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
                    void handleDeleteAndNavigate();
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
      <AvailableToolsPanel services={selectedServiceTools} />

      {/* Recent executions */}
      <RecentExecutionsTable
        executions={recentExecutions}
        loading={executionsLoading}
        error={executionsError}
        onRowClick={(): void => {
          void navigate('/cron-agent/executions');
        }}
      />
    </Layout>
  );
}
