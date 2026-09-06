import type { ConversationAssistantDateRange } from '@intexuraos/llm-contract';
import type {
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextProjection,
  PrivateWhatsAppMessage,
} from '../whatsapp/index.js';

export interface ReconcileConversationContextAtCutoffInput {
  userId: string;
  sourceAccountId: string;
  chatId: string;
  range: ConversationAssistantDateRange;
  startSequence: number;
  cutoffSequence: number;
  scannedMessages: PrivateWhatsAppMessage[];
  changes: PrivateWhatsAppContextChange[];
}

export type ReconcileConversationContextAtCutoffResult =
  | { ok: true; messages: PrivateWhatsAppMessage[] }
  | {
      ok: false;
      reason: 'journal_gap';
      expectedSequence: number;
      actualSequence?: number;
    };

export function reconcileConversationContextAtCutoff(
  input: ReconcileConversationContextAtCutoffInput
): ReconcileConversationContextAtCutoffResult {
  const messagesById = new Map<string, PrivateWhatsAppMessage>();
  for (const message of input.scannedMessages) {
    if (
      message.userId !== input.userId ||
      message.sourceAccountId !== input.sourceAccountId ||
      message.chatId !== input.chatId ||
      message.relation !== undefined ||
      message.messageType === 'reaction' ||
      message.messageType === 'redaction' ||
      !isTimestampInRange(message.eventTimestamp, input.range)
    ) {
      continue;
    }
    messagesById.set(message.id, message);
  }

  const changes = input.changes
    .filter(
      (change) =>
        change.userId === input.userId &&
        change.sourceAccountId === input.sourceAccountId &&
        change.chatId === input.chatId &&
        change.sequence > input.startSequence &&
        change.sequence <= input.cutoffSequence
    )
    .sort((left, right) => left.sequence - right.sequence);
  let expectedSequence = input.startSequence + 1;
  for (const change of changes) {
    if (change.sequence !== expectedSequence) {
      return {
        ok: false,
        reason: 'journal_gap',
        expectedSequence,
        actualSequence: change.sequence,
      };
    }
    expectedSequence += 1;
    if (
      change.after.state === 'missing' ||
      !isProjectionInRange(change.after, input.range)
    ) {
      messagesById.delete(change.messageId);
      continue;
    }
    messagesById.set(
      change.messageId,
      messageFromProjection({
        messageId: change.messageId,
        messageRevision: change.messageRevision,
        contextChangeSequence: change.sequence,
        projection: change.after,
        input,
      })
    );
  }
  if (expectedSequence <= input.cutoffSequence) {
    return {
      ok: false,
      reason: 'journal_gap',
      expectedSequence,
    };
  }

  return {
    ok: true,
    messages: [...messagesById.values()].sort(compareMessages),
  };
}

function messageFromProjection(input: {
  messageId: string;
  messageRevision: number;
  contextChangeSequence: number;
  projection: Exclude<PrivateWhatsAppContextProjection, { state: 'missing' }>;
  input: ReconcileConversationContextAtCutoffInput;
}): PrivateWhatsAppMessage {
  const projection = input.projection;
  const message: PrivateWhatsAppMessage = {
    id: input.messageId,
    chatId: input.input.chatId,
    userId: input.input.userId,
    sourceAccountId: input.input.sourceAccountId,
    matrixRoomId: '',
    matrixEventId: input.messageId,
    matrixSenderId: '',
    direction: projection.direction,
    messageType: projection.messageType,
    eventTimestamp: projection.eventTimestamp,
    receivedAt: projection.importedAt,
    ingestedAt: projection.importedAt,
    deliveryMode: 'live',
    contextRevision: input.messageRevision,
    contextChangeSequence: input.contextChangeSequence,
    contextState:
      projection.state === 'redacted' || projection.state === 'deleted'
        ? projection.state
        : 'visible',
    rawMatrixEvent: {},
  };
  if (projection.direction === 'incoming' && projection.speakerLabel !== 'Participant') {
    message.senderDisplayName = projection.speakerLabel;
  }
  if (projection.state === 'included') {
    if (projection.contentKind === 'text') {
      message.text = projection.content;
    } else {
      message.transcription = {
        status: 'completed',
        text: projection.content,
      };
    }
    message.reactions = projection.reactions;
  } else if (projection.state === 'omitted') {
    if (projection.omissionReason === 'pending_transcription') {
      message.transcription = { status: 'pending' };
    } else if (projection.omissionReason === 'failed_transcription') {
      message.transcription = {
        status: 'failed',
        error: { code: 'TRANSCRIPTION_FAILED', message: 'Transcription failed' },
      };
    }
    message.reactions = projection.reactions;
  }
  return message;
}

function isProjectionInRange(
  projection: Exclude<PrivateWhatsAppContextProjection, { state: 'missing' }>,
  range: ConversationAssistantDateRange
): boolean {
  return isTimestampInRange(projection.eventTimestamp, range);
}

function isTimestampInRange(timestamp: string, range: ConversationAssistantDateRange): boolean {
  return timestamp >= range.from && timestamp < range.to;
}

function compareMessages(left: PrivateWhatsAppMessage, right: PrivateWhatsAppMessage): number {
  const timestampComparison = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestampComparison === 0 ? left.id.localeCompare(right.id) : timestampComparison;
}
