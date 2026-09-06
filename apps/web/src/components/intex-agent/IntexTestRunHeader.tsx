import type { PublicTestRunHeaderV1 } from '@/types';
import { formatDateTimeCompact } from '@/utils/dateFormat';
import {
  formatTestArtifactDelivery,
  formatTestArtifactFailure,
  formatTestDuration,
  formatTestModel,
  formatTestNanoUsd,
  formatTestStatus,
} from './testRunPresentation.js';

interface IntexTestRunHeaderProps {
  run: PublicTestRunHeaderV1;
  stale: boolean;
}

export function IntexTestRunHeader({ run, stale }: IntexTestRunHeaderProps): React.JSX.Element {
  const reportFailed = run.artifactDelivery.status === 'failed';
  const outcomeLabel = reportFailed
    ? `Run ${run.verdict === 'passed' ? 'passed' : run.verdict === 'failed' ? 'failed' : 'not evaluated'} · Report failed`
    : `${formatTestStatus(run.lifecycle)} · ${formatTestStatus(run.verdict)}`;
  const completed = run.totals.scenarios.completed;
  const planned = run.totals.scenarios.planned;
  const durationMs = Math.max(
    0,
    Date.parse(run.finishedAt ?? run.updatedAt) - Date.parse(run.startedAt)
  );

  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Selected test run
          </p>
          <h3 className="mt-1 break-words text-lg font-semibold text-slate-950 dark:text-slate-50">
            {outcomeLabel}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            REAL MATRIX
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            WHATSAPP
          </span>
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
            MOCKED TOOLS
          </span>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>{String(completed)} / {String(planned)} scenarios completed</span>
          <span><span>{String(run.totals.scenarios.running)} running</span> · <span>{String(run.totals.scenarios.passed)} passed</span> · <span>{String(run.totals.scenarios.failed)} failed</span></span>
        </div>
        <progress
          aria-label="Test scenarios completed"
          className="h-2 w-full overflow-hidden rounded-full"
          value={completed}
          max={planned}
        />
      </div>

      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-slate-500">Agent</dt><dd>{formatTestModel(run.agentModel)}</dd></div>
        <div><dt className="text-slate-500">Evaluator</dt><dd>{formatTestModel(run.evaluatorModel)}</dd></div>
        <div><dt className="text-slate-500">Report</dt><dd>{formatTestArtifactDelivery(run.artifactDelivery)}</dd></div>
        <div><dt className="text-slate-500">Updated</dt><dd>{formatDateTimeCompact(run.updatedAt)}</dd></div>
        <div><dt className="text-slate-500">Started</dt><dd>{formatDateTimeCompact(run.startedAt)}</dd></div>
        <div><dt className="text-slate-500">Finished</dt><dd>{run.finishedAt === null ? 'In progress' : formatDateTimeCompact(run.finishedAt)}</dd></div>
        <div><dt className="text-slate-500">Duration</dt><dd>{formatTestDuration(durationMs)}</dd></div>
        <div><dt className="text-slate-500">Agent cost</dt><dd>{formatTestNanoUsd(run.cost.agentNanoUsd)}</dd></div>
        <div><dt className="text-slate-500">Evaluator cost</dt><dd>{formatTestNanoUsd(run.cost.evaluatorNanoUsd)}</dd></div>
        <div><dt className="text-slate-500">Cost</dt><dd>Total {formatTestNanoUsd(run.cost.totalNanoUsd)}</dd></div>
        <div><dt className="text-slate-500">Not run</dt><dd>{String(run.totals.scenarios.notRun)}</dd></div>
      </dl>

      {run.artifactDelivery.failureCode !== null ? (
        <p className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          {formatTestArtifactFailure(run.artifactDelivery.failureCode)}
        </p>
      ) : null}
      {stale ? (
        <p role="status" className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          Live updates paused
        </p>
      ) : null}
    </section>
  );
}
