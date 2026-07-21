import type {
  PublicTestRunScenarioSummaryV1,
  IntexAgentToolName,
  TestArtifactDeliveryV1,
  TestScenarioDtoV1,
  TestRunLifecycle,
  TestScenarioLifecycle,
  TestVerdict,
} from '@/types';

type TestRunModel = TestScenarioDtoV1['agentModel'] | TestScenarioDtoV1['evaluatorModel'];

export interface TestRunScenarioFilters {
  search: string;
  lifecycle: TestScenarioLifecycle | 'all';
  verdict: TestVerdict | 'all';
  tool: IntexAgentToolName | 'all';
}

export function formatTestStatus(
  value: TestRunLifecycle | TestScenarioLifecycle | TestVerdict
): string {
  switch (value) {
    case 'preflight':
      return 'Preflight';
    case 'running':
      return 'Running';
    case 'finalizing':
      return 'Finalizing safely';
    case 'completed':
      return 'Completed';
    case 'stopped':
      return 'Stopped';
    case 'pending':
      return 'Pending';
    case 'not_run':
      return 'Not run';
    case 'passed':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'not_evaluated':
      return 'Not evaluated';
  }
}

export function formatTestModel(model: TestRunModel): string {
  switch (model) {
    case 'or:deepseek/deepseek-v4-flash':
      return 'DeepSeek V4 Flash';
    case 'or:minimax/minimax-m3':
      return 'MiniMax M3';
    case 'or:google/gemini-3-flash-preview':
      return 'Gemini 3 Flash Preview';
  }
}

export function formatTestNanoUsd(value: number | null): string {
  return value === null ? 'Unavailable' : `$${(value / 1_000_000_000).toFixed(9)}`;
}

export function formatTestArtifactDelivery(delivery: TestArtifactDeliveryV1): string {
  switch (delivery.status) {
    case 'pending':
      return 'Report pending';
    case 'staged':
      return 'Report staged';
    case 'ready':
      return 'Report ready';
    case 'failed':
      return 'Report failed';
    case 'unknown':
      return 'Report status unknown';
  }
}

export function formatTestArtifactFailure(
  failureCode: Exclude<TestArtifactDeliveryV1['failureCode'], null>
): string {
  switch (failureCode) {
    case 'REPORT_STAGING_INTERRUPTED':
      return 'Report staging interrupted';
    case 'REPORT_STAGING_FAILED':
      return 'Report staging failed';
    case 'REPORT_VALIDATION_FAILED':
      return 'Report validation failed';
    case 'REPORT_PUBLICATION_FAILED':
      return 'Report publication failed';
    case 'REPORT_DELIVERY_STATUS_TIMEOUT':
      return 'Report delivery status timed out';
  }
}

export function formatTestToolName(toolName: IntexAgentToolName): string {
  return toolName
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatTestDuration(durationMs: number | null): string {
  if (durationMs === null) return 'In progress';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${String(seconds)}s` : `${String(minutes)}m ${String(seconds)}s`;
}

export function scenarioMatchesTestRunFilters(
  scenario: PublicTestRunScenarioSummaryV1,
  filters: TestRunScenarioFilters
): boolean {
  if (filters.lifecycle !== 'all' && scenario.lifecycle !== filters.lifecycle) return false;
  if (filters.verdict !== 'all' && scenario.verdict !== filters.verdict) return false;
  if (filters.tool !== 'all' && !scenario.selectedTools.includes(filters.tool)) return false;
  const query = filters.search.trim().toLowerCase();
  if (query === '') return true;
  const searchable = [
    `scenario ${String(scenario.scenarioNumber).padStart(3, '0')}`,
    scenario.scenarioLabel,
    ...scenario.selectedTools.map(formatTestToolName),
  ];
  return searchable.some((value) => value.toLowerCase().includes(query));
}
