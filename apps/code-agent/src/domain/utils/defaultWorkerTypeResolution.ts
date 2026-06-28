import type { AgentType, WorkerType } from '../models/codeTask.js';
import type { UserWorkerSettings } from '../models/workerSettings.js';
import type { DefaultWorkerTypeField } from '../ports/workerSettingsRepository.js';

type DefaultWorkerTypeSettings = Partial<Pick<UserWorkerSettings, DefaultWorkerTypeField>>;

const DEFAULT_WORKER_TYPE_FIELD_BY_AGENT_TYPE: Partial<Record<AgentType, DefaultWorkerTypeField>> = {
  planning: 'defaultPlanningWorkerType',
  execution: 'defaultExecutionWorkerType',
  pull_request: 'defaultPullRequestWorkerType',
  review: 'defaultReviewWorkerType',
  remediation: 'defaultRemediationWorkerType',
  sentry: 'defaultSentryWorkerType',
};

interface ResolveDefaultWorkerTypeInput {
  agentType: AgentType;
  requestWorkerType?: WorkerType | undefined;
  labelWorkerType?: WorkerType | undefined;
  settings?: DefaultWorkerTypeSettings | null;
}

interface ResolveDefaultWorkerTypeResult {
  workerType: WorkerType;
  source: 'label' | 'request' | 'default' | 'fallback';
  defaultField?: DefaultWorkerTypeField;
}

export function resolveDefaultWorkerType(
  input: ResolveDefaultWorkerTypeInput
): ResolveDefaultWorkerTypeResult {
  if (input.labelWorkerType !== undefined) {
    return {
      workerType: input.labelWorkerType,
      source: 'label',
    };
  }

  if (input.requestWorkerType !== undefined && input.requestWorkerType !== 'auto') {
    return {
      workerType: input.requestWorkerType,
      source: 'request',
    };
  }

  const defaultField = DEFAULT_WORKER_TYPE_FIELD_BY_AGENT_TYPE[input.agentType];
  if (defaultField !== undefined && input.settings?.[defaultField] !== undefined) {
    return {
      workerType: input.settings[defaultField],
      source: 'default',
      defaultField,
    };
  }

  return {
    workerType: 'auto',
    source: 'fallback',
  };
}
