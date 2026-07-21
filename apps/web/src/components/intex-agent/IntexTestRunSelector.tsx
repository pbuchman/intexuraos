import type { PublicTestRunHeaderV1 } from '@/types';
import { formatDateTimeCompact } from '@/utils/dateFormat';
import {
  formatTestArtifactDelivery,
  formatTestStatus,
} from './testRunPresentation.js';

interface IntexTestRunSelectorProps {
  runs: PublicTestRunHeaderV1[];
  selectedRunId: string | undefined;
  loading: boolean;
  loadFailed: boolean;
  onSelect: (runId: string) => void;
}

export function IntexTestRunSelector({
  runs,
  selectedRunId,
  loading,
  loadFailed,
  onSelect,
}: IntexTestRunSelectorProps): React.JSX.Element {
  return (
    <section aria-label="Retained test runs" className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Retained runs</h3>
      {loading ? <div aria-label="Loading test runs" className="mt-3 h-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /> : null}
      {!loading && !loadFailed && runs.length === 0 ? (
        <div className="py-6 text-center">
          <p className="font-medium text-slate-800 dark:text-slate-100">No test runs yet</p>
          <p className="mt-1 text-sm text-slate-500">Runs are started by the protected Home Dev evaluator.</p>
        </div>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {runs.map((run) => {
          const selected = run.runId === selectedRunId;
          return (
            <button
              key={run.runId}
              type="button"
              aria-pressed={selected}
              onClick={(): void => { onSelect(run.runId); }}
              className={`min-w-0 rounded-lg border px-3 py-2 text-left ${selected ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <span className="block text-sm font-semibold">
                {formatTestStatus(run.lifecycle)} · {formatTestStatus(run.verdict)}
              </span>
              <span className="block text-xs text-slate-500">
                {formatTestArtifactDelivery(run.artifactDelivery)} · {formatDateTimeCompact(run.startedAt)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
