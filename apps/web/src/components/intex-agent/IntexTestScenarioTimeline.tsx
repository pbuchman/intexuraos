import type {
  PublicTestTimelineEventV1,
  SafeDeterministicCheckV1,
  SafeToolFactV1,
  TestScenarioDtoV1,
} from '@/types';
import {
  formatTestModel,
  formatTestNanoUsd,
  formatTestStatus,
  formatTestToolName,
} from './testRunPresentation.js';

interface IntexTestScenarioTimelineProps {
  detail: TestScenarioDtoV1 | undefined;
  loading: boolean;
}

function formatClosedLabel(value: string): string {
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Facts({ facts }: { facts: SafeToolFactV1[] }): React.JSX.Element | null {
  if (facts.length === 0) return null;
  return <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">{facts.map((fact) => <li key={fact.name}>{formatClosedLabel(fact.name)}: {String(fact.value)}</li>)}</ul>;
}

function DeterministicEvidence({
  check,
}: {
  check: SafeDeterministicCheckV1;
}): React.JSX.Element {
  const { evidence } = check;
  const location = [
    check.turnIndex === null ? null : `Turn ${String(check.turnIndex + 1)}`,
    check.replyIndex === null ? null : `Reply ${String(check.replyIndex)}`,
  ]
    .filter((value): value is string => value !== null)
    .join(' · ');
  return (
    <div className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
      {location.length > 0 ? <p>{location}</p> : null}
      {evidence.expectedToolName === null ? null : (
        <p>Expected tool: {formatTestToolName(evidence.expectedToolName)}</p>
      )}
      {evidence.actualToolName === null ? null : (
        <p>Actual tool: {formatTestToolName(evidence.actualToolName)}</p>
      )}
      {evidence.expectedTurnIndex === null ? null : (
        <p>Expected turn: {String(evidence.expectedTurnIndex + 1)}</p>
      )}
      {evidence.actualTurnIndex === null ? null : (
        <p>Actual turn: {String(evidence.actualTurnIndex + 1)}</p>
      )}
      {evidence.expectedCount === null ? null : (
        <p>Expected count: {String(evidence.expectedCount)}</p>
      )}
      {evidence.actualCount === null ? null : (
        <p>Actual count: {String(evidence.actualCount)}</p>
      )}
      {evidence.expectedTransition === null ? null : (
        <p>Expected transition: {formatClosedLabel(evidence.expectedTransition)}</p>
      )}
      {evidence.actualTransition === null ? null : (
        <p>Actual transition: {formatClosedLabel(evidence.actualTransition)}</p>
      )}
      {evidence.expectedFacts.map((fact) => (
        <p key={`expected-${fact.name}`}>
          Expected {formatClosedLabel(fact.name)}: {fact.operator === 'equals' ? String(fact.value) : fact.operator}
        </p>
      ))}
      {evidence.actualFacts.map((fact) => (
        <p key={`actual-${fact.name}`}>
          Actual {formatClosedLabel(fact.name)}: {String(fact.value)}
        </p>
      ))}
    </div>
  );
}

function TimelineCard({ event }: { event: PublicTestTimelineEventV1 }): React.JSX.Element {
  switch (event.type) {
    case 'session_started':
      return <article className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20"><h4 className="font-semibold">Session started</h4><p className="mt-1 text-sm">{formatClosedLabel(event.startReason)} · {event.explicit ? 'Explicit start' : 'Automatic start'} · Turn {String(event.turnIndex + 1)}</p></article>;
    case 'session_closed':
      return <article className="rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40"><h4 className="font-semibold">Previous session closed</h4><p className="mt-1 text-sm">{formatClosedLabel(event.endReason)} · {formatClosedLabel(event.status)} · Turn {String(event.turnIndex + 1)}</p></article>;
    case 'user_message':
      return <article className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><h4 className="font-semibold">User · Turn {String(event.turnIndex + 1)}</h4><p className="mt-2 whitespace-pre-wrap break-words">{event.text}</p></article>;
    case 'assistant_message':
      return <article className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20"><h4 className="font-semibold">Assistant · Turn {String(event.turnIndex + 1)} · Reply {String(event.replyIndex)}</h4><p className="mt-2 whitespace-pre-wrap break-words">{event.text}</p></article>;
    case 'tool_selected':
    case 'mock_completed':
    case 'mock_failed':
    case 'unexpected_known_no_execution': {
      const title = event.type === 'tool_selected' ? 'Tool selected' : event.type === 'mock_completed' ? 'Mock completed' : event.type === 'mock_failed' ? 'Mock failed' : 'Unexpected known tool — not executed';
      return <article className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20"><h4 className="font-semibold">{title}</h4><p className="mt-1 text-sm">{formatTestToolName(event.toolName)} · Turn {String(event.turnIndex + 1)}</p><Facts facts={event.facts} /></article>;
    }
    case 'confirmation_requested':
      return <article className="rounded-lg border border-amber-200 p-3 dark:border-amber-900"><h4 className="font-semibold">Confirmation requested</h4><p className="mt-1 text-sm">{formatTestToolName(event.toolName)} · Turn {String(event.turnIndex + 1)}</p></article>;
    case 'confirmation_resolved':
      return <article className="rounded-lg border border-amber-200 p-3 dark:border-amber-900"><h4 className="font-semibold">Confirmation resolved</h4><p className="mt-1 text-sm">{event.resolution === 'confirmed' ? 'Confirmed' : 'Rejected'}</p></article>;
    case 'deterministic_evaluation':
      return <article role="article" aria-label="Deterministic evaluation" className="rounded-lg border border-violet-200 p-3 dark:border-violet-900"><h4 className="font-semibold">Deterministic evaluation · {formatTestStatus(event.verdict)}</h4><ul className="mt-2 space-y-2">{event.checks.map((check, index) => <li key={`${check.code}-${String(index)}`} className="rounded border border-violet-100 p-2 text-sm dark:border-violet-950"><div className="flex justify-between gap-3"><span>{formatClosedLabel(check.code)}</span><span>{formatTestStatus(check.status)}</span></div><DeterministicEvidence check={check} /></li>)}</ul></article>;
    case 'minimax_evaluation': {
      const evaluation = event.evaluation;
      return <article role="article" aria-label={`Turn ${String(evaluation.turnIndex + 1)} · Reply ${String(evaluation.replyIndex)} MiniMax evaluation`} className="rounded-lg border border-fuchsia-200 p-3 dark:border-fuchsia-900"><h4 className="font-semibold">Turn {String(evaluation.turnIndex + 1)} · Reply {String(evaluation.replyIndex)} · MiniMax</h4><div className="mt-1 flex flex-wrap gap-3 text-sm"><span>{formatTestModel(event.evaluatorModel)}</span><span>{formatTestStatus(evaluation.verdict)}</span><span>Score {String(evaluation.score)}/5</span><span>{String(evaluation.latencyMs)} ms</span><span>{formatTestNanoUsd(evaluation.usage.costNanoUsd)}</span></div><ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{Object.entries(evaluation.criteria).map(([criterion, passed]) => <li key={criterion}>{formatClosedLabel(criterion)}: {passed ? 'Passed' : 'Failed'}</li>)}</ul>{evaluation.failureCodes.length > 0 ? <p className="mt-2 text-sm">Failed criteria: {evaluation.failureCodes.map(formatClosedLabel).join(', ')}</p> : null}<p className="mt-2 text-xs text-slate-500">{String(evaluation.usage.totalTokens)} tokens · {evaluation.usage.repairCount === 0 ? 'No repair' : 'One repair'}</p></article>;
    }
  }
}

export function IntexTestScenarioTimeline({ detail, loading }: IntexTestScenarioTimelineProps): React.JSX.Element {
  return (
    <section data-testid="intex-test-scenario-timeline" aria-busy={loading} className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {loading ? <div aria-label="Loading scenario timeline" className="m-4 h-64 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /> : null}
      {!loading && detail === undefined ? <p className="p-12 text-center text-sm text-slate-500">Select a scenario to inspect its timeline.</p> : null}
      {!loading && detail !== undefined ? <><header className="border-b border-slate-200 p-4 dark:border-slate-800"><h3 className="break-words text-lg font-semibold">Scenario {String(detail.scenario.scenarioNumber).padStart(3, '0')} — {detail.scenario.scenarioLabel}</h3><p className="mt-1 text-sm text-slate-500">{formatTestStatus(detail.scenario.lifecycle)} · {formatTestStatus(detail.scenario.verdict)} · {String(detail.scenario.completedTurns)}/{String(detail.scenario.plannedTurns)} turns · {String(detail.scenario.completedReplies)}/{String(detail.scenario.expectedReplies)} replies</p><p className="mt-1 text-sm">Deterministic: {formatTestStatus(detail.scenario.deterministicVerdict)}</p><p className="mt-1 text-sm">MiniMax: {formatTestStatus(detail.scenario.semanticVerdict)}</p><p className="mt-1 text-sm">Agent {formatTestModel(detail.agentModel)} · Evaluator {formatTestModel(detail.evaluatorModel)}</p></header><div className="min-w-0 space-y-3 p-4">{detail.timeline.map((event) => <TimelineCard key={event.timelineIndex} event={event} />)}<article aria-label="Evaluation coverage" className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><h4 className="font-semibold">Evaluation coverage</h4><p className="mt-1 text-sm">Expected {String(detail.scenario.expectedReplies)} · Observed {String(detail.scenario.completedReplies)} · Judged {String(detail.timeline.filter((event) => event.type === 'minimax_evaluation').length)}</p></article></div></> : null}
    </section>
  );
}
