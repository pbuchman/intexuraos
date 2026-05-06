/**
 * Backfill progress page: shows run metadata and a color-coded day grid.
 * Polls via useBackfillRun until status is terminal.
 */

import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Card, Layout } from '@/components';
import { BackfillProgressGrid } from '@/components/notification-digests';
import { useBackfillRun } from '@/hooks/useBackfillRun';

function statusBadge(status: string): { label: string; className: string } {
  if (status === 'completed') {
    return {
      label: 'Completed',
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    };
  }
  if (status === 'failed') {
    return {
      label: 'Failed',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    };
  }
  if (status === 'running') {
    return {
      label: 'Running',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    };
  }
  return {
    label: 'Queued',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  };
}

export function NotificationDigestBackfillPage(): React.JSX.Element {
  const { runId } = useParams<{ runId: string }>();
  const { run, loading, error } = useBackfillRun(runId);

  if (loading && run === null) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </Layout>
    );
  }

  if (error !== null && run === null) {
    return (
      <Layout>
        <Card variant="error" className="mt-4">
          <p>{error}</p>
        </Card>
      </Layout>
    );
  }

  if (run === null) {
    return (
      <Layout>
        <Card className="mt-4">
          <p className="text-slate-600 dark:text-slate-300">
            Backfill {runId ?? ''} was not found.
          </p>
        </Card>
      </Layout>
    );
  }

  const badge = statusBadge(run.status);

  return (
    <Layout>
      <div className="mb-4">
        <Link
          to="/notifications/digests"
          className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to list
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Backfilling digests
        </h2>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {run.fromDate} → {run.toDate} · {String(run.totalDates)} days
        </span>
      </div>

      {error !== null ? (
        <Card variant="error" className="mb-4">
          <p className="text-sm">{error}</p>
        </Card>
      ) : null}

      <BackfillProgressGrid run={run} />

      <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Started: {new Date(run.startedAt).toLocaleString('en-US')} ·{' '}
        Last updated: {new Date(run.updatedAt).toLocaleString('en-US')}
        {run.completedAt !== undefined ? (
          <> · Completed: {new Date(run.completedAt).toLocaleString('en-US')}</>
        ) : null}
      </div>

      {run.failedDates.length > 0 ? (
        <Card variant="error" className="mt-6">
          <h3 className="mb-2 font-semibold text-red-800 dark:text-red-300">
            Days with errors ({String(run.failedDates.length)})
          </h3>
          <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
            {run.failedDates.map((f) => (
              <li key={f.date}>
                <span className="font-mono">{f.date}</span>: {f.error}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Layout>
  );
}
