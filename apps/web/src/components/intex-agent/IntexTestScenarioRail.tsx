import { useMemo, useState } from 'react';
import type {
  IntexAgentToolName,
  PublicTestRunScenarioSummaryV1,
  TestScenarioLifecycle,
  TestVerdict,
} from '@/types';
import {
  formatTestDuration,
  formatTestStatus,
  formatTestToolName,
  scenarioMatchesTestRunFilters,
} from './testRunPresentation.js';

const TOOL_NAMES = [
  'create_note',
  'create_calendar_event',
  'update_calendar_event',
  'query_calendar_events',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'get_user_preferences',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
] as const satisfies readonly IntexAgentToolName[];

interface IntexTestScenarioRailProps {
  scenarios: PublicTestRunScenarioSummaryV1[];
  selectedScenarioId: string | undefined;
  loading: boolean;
  onSelect: (scenarioId: string) => void;
}

export function IntexTestScenarioRail({
  scenarios,
  selectedScenarioId,
  loading,
  onSelect,
}: IntexTestScenarioRailProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [lifecycle, setLifecycle] = useState<TestScenarioLifecycle | 'all'>('all');
  const [verdict, setVerdict] = useState<TestVerdict | 'all'>('all');
  const [tool, setTool] = useState<IntexAgentToolName | 'all'>('all');
  const visible = useMemo(
    () => scenarios.filter((scenario) => scenarioMatchesTestRunFilters(scenario, { search, lifecycle, verdict, tool })),
    [lifecycle, scenarios, search, tool, verdict]
  );

  return (
    <aside className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="grid gap-2 border-b border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-2 xl:grid-cols-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Search test scenarios
          <input
            type="search"
            value={search}
            onChange={(event): void => { setSearch(event.target.value); }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="text-xs">Lifecycle<select aria-label="Scenario lifecycle" value={lifecycle} onChange={(event): void => { setLifecycle(event.target.value as TestScenarioLifecycle | 'all'); }}><option value="all">All</option><option value="pending">Pending</option><option value="running">Running</option><option value="completed">Completed</option><option value="stopped">Stopped</option><option value="not_run">Not run</option></select></label>
        <label className="text-xs">Verdict<select aria-label="Scenario verdict" value={verdict} onChange={(event): void => { setVerdict(event.target.value as TestVerdict | 'all'); }}><option value="all">All</option><option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="not_evaluated">Not evaluated</option></select></label>
        <label className="text-xs">Tool<select aria-label="Selected tool" value={tool} onChange={(event): void => { setTool(event.target.value as IntexAgentToolName | 'all'); }}><option value="all">All</option>{TOOL_NAMES.map((name) => <option key={name} value={name}>{formatTestToolName(name)}</option>)}</select></label>
      </div>
      {loading ? <div aria-label="Loading test scenarios" className="m-3 h-48 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /> : null}
      {!loading && visible.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No scenarios match the active filters.</p> : null}
      <div className="max-h-[32rem] min-h-0 space-y-2 overflow-y-auto p-2">
        {visible.map((scenario) => {
          const selected = scenario.scenarioId === selectedScenarioId;
          const number = String(scenario.scenarioNumber).padStart(3, '0');
          return (
            <button
              key={scenario.scenarioId}
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={(): void => { onSelect(scenario.scenarioId); }}
              className={`w-full min-w-0 rounded-lg border p-3 text-left ${selected ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <span className="block break-words text-sm font-semibold">Scenario {number} — {scenario.scenarioLabel}</span>
              <span className="mt-1 block text-xs">{formatTestStatus(scenario.lifecycle)} · {formatTestStatus(scenario.verdict)} · {String(scenario.completedTurns)}/{String(scenario.plannedTurns)} turns · {formatTestDuration(scenario.durationMs)}</span>
              <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">Deterministic: {formatTestStatus(scenario.deterministicVerdict)} · MiniMax: {formatTestStatus(scenario.semanticVerdict)}</span>
              <span className="mt-2 flex flex-wrap gap-1 text-[10px] font-semibold"><span>TEST</span><span>MATRIX</span><span>MOCKED</span></span>
              {scenario.selectedTools.length > 0 ? <span className="mt-1 block text-xs text-slate-500">{scenario.selectedTools.map(formatTestToolName).join(', ')}</span> : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
