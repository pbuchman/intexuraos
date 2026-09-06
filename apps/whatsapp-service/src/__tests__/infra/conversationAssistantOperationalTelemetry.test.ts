import { describe, expect, it, vi } from 'vitest';
import type { MetricsClient } from '@intexuraos/common-metrics';
import type { Logger } from 'pino';
import {
  CONVERSATION_ASSISTANT_CORRECTED_COUNT_METRIC,
  CONVERSATION_ASSISTANT_COUNT_METRIC,
  CONVERSATION_ASSISTANT_DURATION_METRIC,
  CONVERSATION_ASSISTANT_ESTIMATED_BYTES_METRIC,
  CONVERSATION_ASSISTANT_ESTIMATED_TOKENS_METRIC,
  CONVERSATION_ASSISTANT_INCLUDED_COUNT_METRIC,
  CONVERSATION_ASSISTANT_LATE_INGESTED_COUNT_METRIC,
  CONVERSATION_ASSISTANT_NEWLY_AVAILABLE_COUNT_METRIC,
  CONVERSATION_ASSISTANT_OMITTED_COUNT_METRIC,
  CONVERSATION_ASSISTANT_OPERATION_METRIC,
  CONVERSATION_ASSISTANT_ORPHAN_CLEANUP_COUNT_METRIC,
  CONVERSATION_ASSISTANT_PROMPT_BUDGET_REJECTION_METRIC,
  CONVERSATION_ASSISTANT_REDACTED_COUNT_METRIC,
  CONVERSATION_ASSISTANT_TIME_TO_FIRST_DELTA_METRIC,
  CONVERSATION_ASSISTANT_TWO_TAB_CONFLICT_METRIC,
  createConversationAssistantOperationalTelemetry,
  createNoOpConversationAssistantOperationalTelemetry,
} from '../../infra/metrics/conversationAssistantOperationalTelemetry.js';

function harness(): {
  metrics: MetricsClient;
  logger: { warn: ReturnType<typeof vi.fn> & Logger['warn'] };
} {
  const warn = vi.fn() as ReturnType<typeof vi.fn> & Logger['warn'];
  return {
    metrics: {
      increment: vi.fn(),
      record: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    },
    logger: { warn },
  };
}

describe('Conversation Assistant operational telemetry', () => {
  it('records only fixed low-cardinality labels plus finite aggregate numbers', async () => {
    const test = harness();
    const telemetry = createConversationAssistantOperationalTelemetry(test);
    await telemetry.record({
      operation: 'attachment_preparation',
      outcome: 'ready',
      durationMs: 123.5,
      estimatedBytes: 4096,
      count: 12,
      includedCount: 10,
      omittedCount: 2,
      correctedCount: 3,
      redactedCount: 1,
      newlyAvailableCount: 10,
      lateIngestedCount: 4,
      estimatedTokens: 2048,
      promptBudgetRejectionCount: 1,
      timeToFirstDeltaMs: 87.5,
      twoTabConflictCount: 1,
      orphanCleanupCount: 6,
      userId: 'private-user',
      question: 'private question',
      transcriptSha256: 'private-hash',
    } as never);

    const labels = { operation: 'attachment_preparation', outcome: 'ready' };
    expect(test.metrics.increment).toHaveBeenCalledWith(
      CONVERSATION_ASSISTANT_OPERATION_METRIC,
      labels
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      1,
      CONVERSATION_ASSISTANT_DURATION_METRIC,
      labels,
      123.5
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      2,
      CONVERSATION_ASSISTANT_ESTIMATED_BYTES_METRIC,
      labels,
      4096
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      3,
      CONVERSATION_ASSISTANT_COUNT_METRIC,
      labels,
      12
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      4,
      CONVERSATION_ASSISTANT_INCLUDED_COUNT_METRIC,
      labels,
      10
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      5,
      CONVERSATION_ASSISTANT_OMITTED_COUNT_METRIC,
      labels,
      2
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      6,
      CONVERSATION_ASSISTANT_CORRECTED_COUNT_METRIC,
      labels,
      3
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      7,
      CONVERSATION_ASSISTANT_REDACTED_COUNT_METRIC,
      labels,
      1
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      8,
      CONVERSATION_ASSISTANT_NEWLY_AVAILABLE_COUNT_METRIC,
      labels,
      10
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      9,
      CONVERSATION_ASSISTANT_LATE_INGESTED_COUNT_METRIC,
      labels,
      4
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      10,
      CONVERSATION_ASSISTANT_ESTIMATED_TOKENS_METRIC,
      labels,
      2048
    );
    expect(test.metrics.increment).toHaveBeenNthCalledWith(
      2,
      CONVERSATION_ASSISTANT_PROMPT_BUDGET_REJECTION_METRIC,
      labels,
      1
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      11,
      CONVERSATION_ASSISTANT_TIME_TO_FIRST_DELTA_METRIC,
      labels,
      87.5
    );
    expect(test.metrics.increment).toHaveBeenNthCalledWith(
      3,
      CONVERSATION_ASSISTANT_TWO_TAB_CONFLICT_METRIC,
      labels,
      1
    );
    expect(test.metrics.record).toHaveBeenNthCalledWith(
      12,
      CONVERSATION_ASSISTANT_ORPHAN_CLEANUP_COUNT_METRIC,
      labels,
      6
    );
    expect(JSON.stringify(vi.mocked(test.metrics.increment).mock.calls)).not.toMatch(
      /private-user|private question|private-hash/
    );
    expect(test.metrics.flush).toHaveBeenCalledOnce();
  });

  it('omits absent numeric samples', async () => {
    const test = harness();
    await createConversationAssistantOperationalTelemetry(test).record({
      operation: 'sse_disconnect',
      outcome: 'disconnected',
    });
    expect(test.metrics.increment).toHaveBeenCalledOnce();
    expect(test.metrics.record).not.toHaveBeenCalled();
  });

  it('records time to first model delta as a dedicated content-free operation', async () => {
    const test = harness();
    await createConversationAssistantOperationalTelemetry(test).record({
      operation: 'model_first_delta',
      outcome: 'completed',
      timeToFirstDeltaMs: 42.25,
    });
    const labels = { operation: 'model_first_delta' as const, outcome: 'completed' as const };
    expect(test.metrics.increment).toHaveBeenCalledWith(
      CONVERSATION_ASSISTANT_OPERATION_METRIC,
      labels
    );
    expect(test.metrics.record).toHaveBeenCalledWith(
      CONVERSATION_ASSISTANT_TIME_TO_FIRST_DELTA_METRIC,
      labels,
      42.25
    );
  });

  it.each([
    { operation: 'session-id', outcome: 'ready' },
    { operation: 'turn_request', outcome: 'attachment-id' },
    { operation: 'turn_request', outcome: 'ready', durationMs: Number.NaN },
    { operation: 'turn_request', outcome: 'ready', estimatedBytes: -1 },
    { operation: 'turn_request', outcome: 'ready', count: 1.5 },
    { operation: 'turn_request', outcome: 'ready', includedCount: -1 },
    { operation: 'turn_request', outcome: 'ready', omittedCount: 0.5 },
    { operation: 'turn_request', outcome: 'ready', correctedCount: Number.NaN },
    { operation: 'turn_request', outcome: 'ready', redactedCount: -1 },
    { operation: 'turn_request', outcome: 'ready', newlyAvailableCount: 0.5 },
    { operation: 'turn_request', outcome: 'ready', lateIngestedCount: Number.POSITIVE_INFINITY },
    { operation: 'turn_request', outcome: 'ready', estimatedTokens: 1.5 },
    { operation: 'turn_request', outcome: 'ready', promptBudgetRejectionCount: -1 },
    { operation: 'turn_request', outcome: 'ready', timeToFirstDeltaMs: -0.1 },
    { operation: 'turn_request', outcome: 'ready', twoTabConflictCount: 0.5 },
    { operation: 'turn_request', outcome: 'ready', orphanCleanupCount: -1 },
  ])('rejects unsafe runtime values without emitting metrics', async (unsafe) => {
    const test = harness();
    await createConversationAssistantOperationalTelemetry(test).record(unsafe as never);
    expect(test.metrics.increment).not.toHaveBeenCalled();
    expect(test.metrics.record).not.toHaveBeenCalled();
    expect(test.metrics.flush).not.toHaveBeenCalled();
    expect(test.logger.warn).toHaveBeenCalledWith(
      { operation: 'invalid', outcome: 'rejected' },
      'Rejected invalid Conversation Assistant telemetry input'
    );
  });

  it('isolates metrics flush failure with safe labels only', async () => {
    const test = harness();
    vi.mocked(test.metrics.flush).mockRejectedValue(new Error('secret backend detail'));
    await createConversationAssistantOperationalTelemetry(test).record({
      operation: 'privacy_erasure',
      outcome: 'partial',
      count: 20,
    });
    expect(test.logger.warn).toHaveBeenCalledWith(
      { operation: 'privacy_erasure', outcome: 'partial' },
      'Conversation Assistant metrics flush failed'
    );
    expect(JSON.stringify(test.logger.warn.mock.calls)).not.toContain('secret backend detail');
  });

  it('provides a no-op implementation for disabled/test metrics', async () => {
    await expect(
      createNoOpConversationAssistantOperationalTelemetry().record({
        operation: 'turn_request',
        outcome: 'completed',
      })
    ).resolves.toBeUndefined();
  });
});
