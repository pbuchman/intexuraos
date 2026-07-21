import type { PrivateWhatsAppContextChange } from '../whatsapp/index.js';

export type ConversationAssistantContextAttachmentNewerAvailabilityResult =
  | { ok: true; value: { messageCount: number; correctionCount: number } }
  | {
      ok: false;
      error: {
        code: 'INVALID_CONTEXT_BOUNDARY' | 'CONTEXT_JOURNAL_GAP';
        message: string;
      };
    };

export function countConversationAssistantContextAttachmentNewerAvailability(input: {
  afterSequence: number;
  throughSequence: number;
  initialContextFrom: string;
  changes: PrivateWhatsAppContextChange[];
}): ConversationAssistantContextAttachmentNewerAvailabilityResult {
  if (
    !Number.isInteger(input.afterSequence) ||
    !Number.isInteger(input.throughSequence) ||
    input.afterSequence < 0 ||
    input.throughSequence < input.afterSequence ||
    input.initialContextFrom === '' ||
    input.changes.some(
      (change) =>
        change.sequence <= input.afterSequence || change.sequence > input.throughSequence
    )
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CONTEXT_BOUNDARY',
        message: 'The context availability boundary is invalid',
      },
    };
  }

  const changes = [...input.changes].sort((left, right) => left.sequence - right.sequence);
  let expectedSequence = input.afterSequence + 1;
  for (const change of changes) {
    if (change.sequence !== expectedSequence) return journalGap(expectedSequence);
    expectedSequence += 1;
  }
  if (expectedSequence <= input.throughSequence) return journalGap(expectedSequence);

  const newMessageIds = new Set<string>();
  const excludedNewMessageIds = new Set<string>();
  const correctionMessageIds = new Set<string>();
  for (const change of changes) {
    const eventTimestamp =
      change.after.state === 'missing' ? change.eventTimestamp : change.after.eventTimestamp;
    if (change.changeType === 'created') {
      correctionMessageIds.delete(change.messageId);
      if (eventTimestamp >= input.initialContextFrom) {
        newMessageIds.add(change.messageId);
      } else {
        excludedNewMessageIds.add(change.messageId);
      }
      continue;
    }
    if (
      !newMessageIds.has(change.messageId) &&
      !excludedNewMessageIds.has(change.messageId) &&
      eventTimestamp >= input.initialContextFrom
    ) {
      correctionMessageIds.add(change.messageId);
    }
  }
  return {
    ok: true,
    value: {
      messageCount: newMessageIds.size,
      correctionCount: correctionMessageIds.size,
    },
  };
}

function journalGap(
  sequence: number
): Extract<ConversationAssistantContextAttachmentNewerAvailabilityResult, { ok: false }> {
  return {
    ok: false,
    error: {
      code: 'CONTEXT_JOURNAL_GAP',
      message: `The context change journal is incomplete at sequence ${String(sequence)}`,
    },
  };
}
