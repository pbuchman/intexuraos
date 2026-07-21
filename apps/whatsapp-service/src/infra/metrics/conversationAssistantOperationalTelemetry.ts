import type { CustomMetric, MetricsClient } from '@intexuraos/common-metrics';
import type { Logger } from 'pino';
import type {
  ConversationAssistantOperationalTelemetry,
  ConversationAssistantTelemetryInput,
  ConversationAssistantTelemetryOperation,
  ConversationAssistantTelemetryOutcome,
} from '../../domain/conversation-assistant/operationalTelemetry.js';

interface OperationLabels extends Record<string, string> {
  operation: ConversationAssistantTelemetryOperation;
  outcome: ConversationAssistantTelemetryOutcome;
}

const OPERATIONS = new Set<ConversationAssistantTelemetryOperation>([
  'attachment_preparation',
  'turn_request',
  'model_first_delta',
  'answer_retry',
  'sse_disconnect',
  'pdf_revision',
  'session_cleanup',
  'privacy_erasure',
  'chain_verification',
]);

const OUTCOMES = new Set<ConversationAssistantTelemetryOutcome>([
  'created',
  'ready',
  'zero',
  'failed',
  'expired',
  'replay',
  'conflict',
  'lease_recovered',
  'disconnected',
  'completed',
  'stale',
  'mismatch',
  'rejected',
  'partial',
]);

export const CONVERSATION_ASSISTANT_OPERATION_METRIC = {
  name: 'conversation_assistant_operations',
  type: 'counter',
  unit: '1',
  description: 'Content-free Conversation Assistant operation outcomes',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_DURATION_METRIC = {
  name: 'conversation_assistant_operation_duration',
  type: 'distribution',
  unit: 'ms',
  description: 'Conversation Assistant operation duration',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_ESTIMATED_BYTES_METRIC = {
  name: 'conversation_assistant_estimated_input_bytes',
  type: 'distribution',
  unit: 'By',
  description: 'Estimated serialized input size before provider execution',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_COUNT_METRIC = {
  name: 'conversation_assistant_operation_count',
  type: 'distribution',
  unit: '1',
  description: 'Content-free aggregate count for one Conversation Assistant operation',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_INCLUDED_COUNT_METRIC = aggregateCountMetric(
  'conversation_assistant_included_messages',
  'Messages included in a prepared Conversation Assistant context update'
);

export const CONVERSATION_ASSISTANT_OMITTED_COUNT_METRIC = aggregateCountMetric(
  'conversation_assistant_omitted_messages',
  'Messages omitted from a prepared Conversation Assistant context update'
);

export const CONVERSATION_ASSISTANT_CORRECTED_COUNT_METRIC = aggregateCountMetric(
  'conversation_assistant_corrected_messages',
  'Non-removal corrections in a prepared Conversation Assistant context update'
);

export const CONVERSATION_ASSISTANT_REDACTED_COUNT_METRIC = aggregateCountMetric(
  'conversation_assistant_redacted_messages',
  'Redactions in a prepared Conversation Assistant context update'
);

export const CONVERSATION_ASSISTANT_NEWLY_AVAILABLE_COUNT_METRIC = aggregateCountMetric(
  'conversation_assistant_newly_available_messages',
  'Messages newly available to a Conversation Assistant context update'
);

export const CONVERSATION_ASSISTANT_LATE_INGESTED_COUNT_METRIC = aggregateCountMetric(
  'conversation_assistant_late_ingested_messages',
  'Late-ingested messages in a prepared Conversation Assistant context update'
);

export const CONVERSATION_ASSISTANT_ESTIMATED_TOKENS_METRIC = {
  name: 'conversation_assistant_estimated_input_tokens',
  type: 'distribution',
  unit: '1',
  description: 'Conservative input-token estimate before Conversation Assistant execution',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_PROMPT_BUDGET_REJECTION_METRIC = {
  name: 'conversation_assistant_prompt_budget_rejections',
  type: 'counter',
  unit: '1',
  description: 'Conversation Assistant turns rejected before commit for prompt budget safety',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_TIME_TO_FIRST_DELTA_METRIC = {
  name: 'conversation_assistant_time_to_first_delta',
  type: 'distribution',
  unit: 'ms',
  description: 'Time from durable turn execution to the first model delta',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_TWO_TAB_CONFLICT_METRIC = {
  name: 'conversation_assistant_two_tab_conflicts',
  type: 'counter',
  unit: '1',
  description: 'Conversation Assistant stale-state conflicts caused by concurrent browser state',
} as const satisfies CustomMetric<OperationLabels>;

export const CONVERSATION_ASSISTANT_ORPHAN_CLEANUP_COUNT_METRIC = aggregateCountMetric(
  'conversation_assistant_orphan_chunks_cleaned',
  'Orphaned Conversation Assistant snapshot chunks removed after a lost fence'
);

export function createConversationAssistantOperationalTelemetry(input: {
  metrics: MetricsClient;
  logger: Pick<Logger, 'warn'>;
}): ConversationAssistantOperationalTelemetry {
  return {
    async record(raw): Promise<void> {
      if (!isSafeInput(raw)) {
        input.logger.warn(
          { operation: 'invalid', outcome: 'rejected' },
          'Rejected invalid Conversation Assistant telemetry input'
        );
        return;
      }
      const labels: OperationLabels = {
        operation: raw.operation,
        outcome: raw.outcome,
      };
      input.metrics.increment(CONVERSATION_ASSISTANT_OPERATION_METRIC, labels);
      recordOptional(input.metrics, CONVERSATION_ASSISTANT_DURATION_METRIC, labels, raw.durationMs);
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_ESTIMATED_BYTES_METRIC,
        labels,
        raw.estimatedBytes
      );
      recordOptional(input.metrics, CONVERSATION_ASSISTANT_COUNT_METRIC, labels, raw.count);
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_INCLUDED_COUNT_METRIC,
        labels,
        raw.includedCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_OMITTED_COUNT_METRIC,
        labels,
        raw.omittedCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_CORRECTED_COUNT_METRIC,
        labels,
        raw.correctedCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_REDACTED_COUNT_METRIC,
        labels,
        raw.redactedCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_NEWLY_AVAILABLE_COUNT_METRIC,
        labels,
        raw.newlyAvailableCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_LATE_INGESTED_COUNT_METRIC,
        labels,
        raw.lateIngestedCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_ESTIMATED_TOKENS_METRIC,
        labels,
        raw.estimatedTokens
      );
      incrementOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_PROMPT_BUDGET_REJECTION_METRIC,
        labels,
        raw.promptBudgetRejectionCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_TIME_TO_FIRST_DELTA_METRIC,
        labels,
        raw.timeToFirstDeltaMs
      );
      incrementOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_TWO_TAB_CONFLICT_METRIC,
        labels,
        raw.twoTabConflictCount
      );
      recordOptional(
        input.metrics,
        CONVERSATION_ASSISTANT_ORPHAN_CLEANUP_COUNT_METRIC,
        labels,
        raw.orphanCleanupCount
      );
      try {
        await input.metrics.flush();
      } catch {
        input.logger.warn(
          { operation: raw.operation, outcome: raw.outcome },
          'Conversation Assistant metrics flush failed'
        );
      }
    },
  };
}

export function createNoOpConversationAssistantOperationalTelemetry(): ConversationAssistantOperationalTelemetry {
  return { record: () => Promise.resolve() };
}

function recordOptional(
  metrics: MetricsClient,
  descriptor: CustomMetric<OperationLabels>,
  labels: OperationLabels,
  value: number | undefined
): void {
  if (value !== undefined) metrics.record(descriptor, labels, value);
}

function incrementOptional(
  metrics: MetricsClient,
  descriptor: CustomMetric<OperationLabels>,
  labels: OperationLabels,
  value: number | undefined
): void {
  if (value !== undefined) metrics.increment(descriptor, labels, value);
}

function isSafeInput(input: ConversationAssistantTelemetryInput): boolean {
  if (!OPERATIONS.has(input.operation) || !OUTCOMES.has(input.outcome)) return false;
  return (
    isSafeNumber(input.durationMs, false) &&
    isSafeNumber(input.estimatedBytes, true) &&
    isSafeNumber(input.count, true) &&
    isSafeNumber(input.includedCount, true) &&
    isSafeNumber(input.omittedCount, true) &&
    isSafeNumber(input.correctedCount, true) &&
    isSafeNumber(input.redactedCount, true) &&
    isSafeNumber(input.newlyAvailableCount, true) &&
    isSafeNumber(input.lateIngestedCount, true) &&
    isSafeNumber(input.estimatedTokens, true) &&
    isSafeNumber(input.promptBudgetRejectionCount, true) &&
    isSafeNumber(input.timeToFirstDeltaMs, false) &&
    isSafeNumber(input.twoTabConflictCount, true) &&
    isSafeNumber(input.orphanCleanupCount, true)
  );
}

function isSafeNumber(value: number | undefined, integer: boolean): boolean {
  return (
    value === undefined ||
    (Number.isFinite(value) && value >= 0 && (!integer || Number.isInteger(value)))
  );
}

function aggregateCountMetric(
  name: string,
  description: string
): CustomMetric<OperationLabels> {
  return { name, type: 'distribution', unit: '1', description };
}
