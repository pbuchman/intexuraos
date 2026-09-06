export type ConversationAssistantTelemetryOperation =
  | 'attachment_preparation'
  | 'turn_request'
  | 'model_first_delta'
  | 'answer_retry'
  | 'sse_disconnect'
  | 'pdf_revision'
  | 'session_cleanup'
  | 'privacy_erasure'
  | 'chain_verification';

export type ConversationAssistantTelemetryOutcome =
  | 'created'
  | 'ready'
  | 'zero'
  | 'failed'
  | 'expired'
  | 'replay'
  | 'conflict'
  | 'lease_recovered'
  | 'disconnected'
  | 'completed'
  | 'stale'
  | 'mismatch'
  | 'rejected'
  | 'partial';

export interface ConversationAssistantTelemetryInput {
  operation: ConversationAssistantTelemetryOperation;
  outcome: ConversationAssistantTelemetryOutcome;
  durationMs?: number;
  estimatedBytes?: number;
  count?: number;
  includedCount?: number;
  omittedCount?: number;
  /** Non-removal corrections: transcription completions, edits, and reaction changes. */
  correctedCount?: number;
  redactedCount?: number;
  newlyAvailableCount?: number;
  lateIngestedCount?: number;
  estimatedTokens?: number;
  promptBudgetRejectionCount?: number;
  timeToFirstDeltaMs?: number;
  twoTabConflictCount?: number;
  orphanCleanupCount?: number;
}

export interface ConversationAssistantOperationalTelemetry {
  record(input: ConversationAssistantTelemetryInput): Promise<void>;
}

export async function recordConversationAssistantTelemetry(
  telemetry: ConversationAssistantOperationalTelemetry | undefined,
  input: ConversationAssistantTelemetryInput
): Promise<void> {
  if (telemetry === undefined) return;
  try {
    await telemetry.record(input);
  } catch {
    // Operational metrics must never change the Conversation Assistant result.
  }
}
