import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useCronSchedules } from '@/hooks';
import { useTimeTick } from '@/hooks';
import { Plus, RefreshCw } from 'lucide-react';
import type { CronScheduleStatus } from '@/types';
import { ScheduleListItem } from './ScheduleListItem.js';

const FILTER_STORAGE_KEY = 'cron-schedules-filter';

type FilterOption = 'active' | 'paused' | 'all';

const FILTER_OPTIONS: { key: FilterOption; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'all', label: 'All' },
];

function loadFilterFromStorage(): FilterOption {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    if (stored === 'active' || stored === 'paused' || stored === 'all') {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'active';
}

function getStatusFilterValues(filter: FilterOption): CronScheduleStatus[] | undefined {
  if (filter === 'active') return ['active'];
  if (filter === 'paused') return ['paused'];
  return undefined;
}

const INACTIVE_PILL_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

const FILTER_ACTIVE_CLASSES: Record<FilterOption, string> = {
  active:
    'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  paused:
    'border-yellow-500 bg-yellow-50 text-yellow-700 dark:border-yellow-400 dark:bg-yellow-900/30 dark:text-yellow-400',
  all:
    'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
};

export function CronSchedulesPage(): React.JSX.Element {
  const navigate = useNavigate();
  // Keep relative timestamps fresh
  useTimeTick(30000);
  const [activeFilter, setActiveFilter] = useState<FilterOption>(loadFilterFromStorage);

  const statusFilter = useMemo(() => getStatusFilterValues(activeFilter), [activeFilter]);

  const {
    schedules,
    loading,
    error,
    refresh,
    updateSchedule,
    deleteSchedule,
    triggerSchedule,
  } = useCronSchedules(statusFilter !== undefined ? { status: statusFilter } : undefined);

  const filteredSchedules = useMemo(() => {
    // The hook already filters by status via the API, but for 'all' we exclude 'deleted'
    if (activeFilter === 'all') {
      return schedules.filter((s) => s.status !== 'deleted');
    }
    return schedules;
  }, [schedules, activeFilter]);

  const handleFilterChange = useCallback((filter: FilterOption): void => {
    setActiveFilter(filter);
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, filter);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const handlePauseResume = useCallback(
    (id: string, currentStatus: CronScheduleStatus): void => {
      const newStatus: CronScheduleStatus = currentStatus === 'active' ? 'paused' : 'active';
      void updateSchedule(id, { status: newStatus });
    },
    [updateSchedule],
  );

  const handleTrigger = useCallback(
    (id: string): void => {
      void triggerSchedule(id);
    },
    [triggerSchedule],
  );

  const handleDelete = useCallback(
    (id: string, name: string): void => {
      const confirmed = window.confirm(
        `Are you sure you want to delete the schedule "${name}"? This action cannot be undone.`,
      );
      if (confirmed) {
        void deleteSchedule(id);
      }
    },
    [deleteSchedule],
  );

  const handleRowClick = useCallback(
    (id: string): void => {
      void navigate(`/cron-agent/${id}`);
    },
    [navigate],
  );

  const handleRefresh = useCallback((): void => {
    void refresh();
  }, [refresh]);

  // Loading state
  if (loading && schedules.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Schedules</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {String(filteredSchedules.length)} schedule{filteredSchedules.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={(): void => {
              void navigate('/cron-agent/new');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Schedule</span>
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(({ key, label }) => {
          const isActive = activeFilter === key;
          return (
            <button
              type="button"
              key={key}
              onClick={(): void => {
                handleFilterChange(key);
              }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive ? FILTER_ACTIVE_CLASSES[key] : INACTIVE_PILL_CLASS
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Error state */}
      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {/* Empty state */}
      {filteredSchedules.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="py-12 text-center">
            <p className="mb-4 text-slate-600 dark:text-slate-300">
              {schedules.length > 0 && activeFilter !== 'all'
                ? 'No schedules match the selected filter'
                : 'No schedules yet. Create your first schedule.'}
            </p>
            {schedules.length === 0 ? (
              <button
                type="button"
                onClick={(): void => {
                  void navigate('/cron-agent/new');
                }}
                className="text-blue-600 underline dark:text-blue-400"
              >
                Create your first schedule
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSchedules.map((schedule) => (
            <ScheduleListItem
              key={schedule.id}
              schedule={schedule}
              onRowClick={handleRowClick}
              onPauseResume={handlePauseResume}
              onTrigger={handleTrigger}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}
