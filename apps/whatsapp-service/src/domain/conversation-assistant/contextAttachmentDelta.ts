import { createHmac } from 'node:crypto';
import type { ConversationAssistantDateRange } from '@intexuraos/llm-contract';
import type {
  PrivateConversationContextMessage,
  PrivateConversationContextOmittedCounts,
  PrivateConversationContextOmittedMessage,
  PrivateWhatsAppChat,
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextProjection,
  PrivateWhatsAppMessage,
  PrivateWhatsAppReactionSummary,
} from '../whatsapp/index.js';
import { buildPrivateConversationTranscriptText } from './transcriptFormatting.js';
import { calculateConversationAssistantPreparedSnapshotIntegrity } from './preparedSnapshotIntegrity.js';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentPreparedSnapshot,
} from './types.js';

export interface BuildConversationAssistantContextAttachmentDeltaInput {
  attachment: ConversationAssistantContextAttachment;
  chat: PrivateWhatsAppChat;
  scannedMessages: PrivateWhatsAppMessage[];
  journalChanges: PrivateWhatsAppContextChange[];
  observedChangeSeq: number;
  confirmationSecret: string;
  warningMessageThreshold: number;
  warningTokenThreshold: number;
}

export type BuildConversationAssistantContextAttachmentDeltaResult =
  | { ok: true; value: ConversationAssistantContextAttachmentPreparedSnapshot }
  | { ok: false; error: { code: string; message: string } };

export function buildConversationAssistantContextAttachmentDelta(
  input: BuildConversationAssistantContextAttachmentDeltaInput
): BuildConversationAssistantContextAttachmentDeltaResult {
  const boundaryError = validateBoundaries(input);
  if (boundaryError !== undefined) return boundaryError;
  const previousContextChainSha256 = input.attachment.previousContextChainSha256 as string;
  if (!matchesAttachmentSource(input.chat, input.attachment)) {
    return sourceMismatch();
  }
  if (
    input.scannedMessages.some(
      (message) => !matchesAttachmentSource(message, input.attachment)
    ) ||
    input.journalChanges.some(
      (entry) => !matchesAttachmentSource(entry, input.attachment)
    )
  ) {
    return sourceMismatch();
  }

  const journal = [...input.journalChanges].sort(compareJournalEntries);
  const journalError = validateContiguousJournal(input, journal);
  if (journalError !== undefined) return journalError;

  const capturedChanges = journal.filter(
    (entry) => entry.sequence <= input.attachment.cutoffChangeSeq
  );
  const postCutoffChanges = journal.filter(
    (entry) => entry.sequence > input.attachment.cutoffChangeSeq
  );
  const firstPostCutoffByMessageId = new Map<string, PrivateWhatsAppContextChange>();
  for (const entry of postCutoffChanges) {
    if (!firstPostCutoffByMessageId.has(entry.messageId)) {
      firstPostCutoffByMessageId.set(entry.messageId, entry);
    }
  }

  const candidateMessages = new Map<string, PrivateWhatsAppMessage>();
  const newMessageIds = new Set<string>();
  for (const scanned of input.scannedMessages) {
    if (!isLogicalContextMessage(scanned) || !isInChronologicalExtension(scanned, input)) {
      continue;
    }
    const firstPostCutoff = firstPostCutoffByMessageId.get(scanned.id);
    if (firstPostCutoff?.before.state === 'missing') {
      continue;
    }
    const atCutoff =
      firstPostCutoff === undefined
        ? scanned
        : messageFromProjection({
            attachment: input.attachment,
            messageId: scanned.id,
            messageRevision: Math.max(1, firstPostCutoff.messageRevision - 1),
            contextChangeSequence: input.attachment.cutoffChangeSeq,
            projection: firstPostCutoff.before,
          });
    if (isProjectionRangeTimestamp(atCutoff.eventTimestamp, input)) {
      candidateMessages.set(scanned.id, atCutoff);
      newMessageIds.add(scanned.id);
    }
  }

  const corrections: PrivateWhatsAppContextChange[] = [];
  let completedTranscriptions = 0;
  let edited = 0;
  let redacted = 0;
  let deleted = 0;
  let reactionsChanged = 0;
  let lateIngested = 0;
  for (const entry of capturedChanges) {
    const timestamp =
      entry.after.state === 'missing' ? entry.eventTimestamp : entry.after.eventTimestamp;
    if (!isProjectionRangeTimestamp(timestamp, input)) {
      candidateMessages.delete(entry.messageId);
      newMessageIds.delete(entry.messageId);
      continue;
    }

    if (entry.changeType === 'created') {
      newMessageIds.add(entry.messageId);
      if (timestamp < input.attachment.baseEventThrough) lateIngested += 1;
    } else if (!newMessageIds.has(entry.messageId)) {
      corrections.push(sanitizeContextChange(entry));
      switch (entry.changeType) {
        case 'transcription_changed':
          break;
        case 'edited':
          edited += 1;
          break;
        case 'redacted':
          redacted += 1;
          break;
        case 'deleted':
          deleted += 1;
          break;
        case 'reaction_changed':
          reactionsChanged += 1;
          break;
      }
    }

    if (isCompletedTranscription(entry)) {
      completedTranscriptions += 1;
    }
    if (entry.after.state === 'missing') {
      candidateMessages.delete(entry.messageId);
      continue;
    }
    const becameIncluded =
      entry.before.state === 'omitted' && entry.after.state === 'included';
    if (newMessageIds.has(entry.messageId) || isCompletedTranscription(entry) || becameIncluded) {
      const projected = messageFromProjection({
        attachment: input.attachment,
        messageId: entry.messageId,
        messageRevision: entry.messageRevision,
        contextChangeSequence: entry.sequence,
        projection: entry.after,
      });
      candidateMessages.set(entry.messageId, projected);
    }
  }

  const projected = projectDeltaMessages(
    [...candidateMessages.values()].sort(compareMessages)
  );
  const transcriptText = buildPrivateConversationTranscriptText(projected.messages, {
    sessionId: input.attachment.sessionId,
    sessionGenerationId: input.attachment.sessionGenerationId,
  });
  const {
    deltaTranscriptSha256,
    resultingContextChainSha256,
    canonicalSnapshotUtf8ByteLength,
  } =
    calculateConversationAssistantPreparedSnapshotIntegrity({
      transcriptText,
      messages: projected.messages,
      omittedMessages: projected.omittedMessages,
      corrections,
      previousContextChainSha256,
    });
  // A byte is the smallest provider-independent tokenization unit we can bound
  // without coupling this domain flow to one model tokenizer. Treating every
  // UTF-8 byte as a possible token is deliberately conservative and remains
  // safe for punctuation/base64-heavy evidence where chars/3 undercounts.
  const estimatedInputTokens = canonicalSnapshotUtf8ByteLength;
  const newlyAvailable = projected.messages.length;
  const attachedItemCount = projected.messages.length + projected.omittedMessages.length;
  const requiresConfirmation =
    attachedItemCount > input.warningMessageThreshold ||
    estimatedInputTokens > input.warningTokenThreshold;
  const confirmationToken = requiresConfirmation
    ? createConfirmationToken({
        secret: input.confirmationSecret,
        attachmentId: input.attachment.id,
        deltaTranscriptSha256,
        resultingContextChainSha256,
        estimatedInputTokens,
      })
    : undefined;
  const eventRange = eventRangeFor(projected.messages);

  return {
    ok: true,
    value: {
      transcriptText,
      messages: projected.messages,
      omittedMessages: projected.omittedMessages,
      corrections,
      ...(eventRange === undefined ? {} : { eventRange }),
      counts: {
        included: projected.messages.length,
        omitted: projected.omittedMessages.length,
        newlyAvailable,
        edited,
        redacted,
        deleted,
        reactionsChanged,
        lateIngested,
        completedTranscriptions,
      },
      omitted: projected.omitted,
      deltaTranscriptSha256,
      previousContextChainSha256,
      resultingContextChainSha256,
      estimatedInputTokens,
      requiresConfirmation,
      ...(confirmationToken === undefined ? {} : { confirmationToken }),
    },
  };
}

function validateBoundaries(
  input: BuildConversationAssistantContextAttachmentDeltaInput
): Extract<BuildConversationAssistantContextAttachmentDeltaResult, { ok: false }> | undefined {
  const attachment = input.attachment;
  if (
    typeof attachment.sourceAccountGeneration !== 'string' ||
    attachment.sourceAccountGeneration.length === 0 ||
    !Number.isInteger(attachment.baseChangeSeq) ||
    !Number.isInteger(attachment.cutoffChangeSeq) ||
    !Number.isInteger(input.observedChangeSeq) ||
    attachment.baseChangeSeq < 0 ||
    attachment.cutoffChangeSeq < attachment.baseChangeSeq ||
    input.observedChangeSeq < attachment.cutoffChangeSeq ||
    attachment.initialContextFrom >= attachment.baseEventThrough ||
    attachment.baseEventThrough > attachment.capturedAt ||
    attachment.previousContextChainSha256 === undefined ||
    attachment.previousContextChainSha256.length === 0 ||
    input.confirmationSecret.length === 0 ||
    !Number.isFinite(input.warningMessageThreshold) ||
    input.warningMessageThreshold < 0 ||
    !Number.isFinite(input.warningTokenThreshold) ||
    input.warningTokenThreshold < 0 ||
    input.journalChanges.some((entry) => entry.sequence > input.observedChangeSeq)
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CONTEXT_BOUNDARY',
        message: 'The frozen context boundary is invalid',
      },
    };
  }
  return undefined;
}

function validateContiguousJournal(
  input: BuildConversationAssistantContextAttachmentDeltaInput,
  journal: PrivateWhatsAppContextChange[]
): Extract<BuildConversationAssistantContextAttachmentDeltaResult, { ok: false }> | undefined {
  let expected = input.attachment.baseChangeSeq + 1;
  for (const entry of journal) {
    if (entry.sequence !== expected) return journalGap(expected);
    expected += 1;
  }
  return expected <= input.observedChangeSeq ? journalGap(expected) : undefined;
}

function journalGap(
  sequence: number
): Extract<BuildConversationAssistantContextAttachmentDeltaResult, { ok: false }> {
  return {
    ok: false,
    error: {
      code: 'CONTEXT_JOURNAL_GAP',
      message: `The context change journal is incomplete at sequence ${String(sequence)}`,
    },
  };
}

function sourceMismatch(): Extract<
  BuildConversationAssistantContextAttachmentDeltaResult,
  { ok: false }
> {
  return {
    ok: false,
    error: {
      code: 'CONTEXT_SOURCE_MISMATCH',
      message: 'The context source does not match the frozen attachment',
    },
  };
}

function matchesAttachmentSource(
  source: { userId: string; sourceAccountId: string; id?: string; chatId?: string },
  attachment: ConversationAssistantContextAttachment
): boolean {
  const chatId = source.chatId ?? source.id;
  return (
    source.userId === attachment.userId &&
    source.sourceAccountId === attachment.sourceAccountId &&
    chatId === attachment.chatId
  );
}

function compareJournalEntries(
  left: PrivateWhatsAppContextChange,
  right: PrivateWhatsAppContextChange
): number {
  return left.sequence - right.sequence;
}

function compareMessages(left: PrivateWhatsAppMessage, right: PrivateWhatsAppMessage): number {
  const timestamp = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestamp === 0 ? left.id.localeCompare(right.id) : timestamp;
}

function isLogicalContextMessage(message: PrivateWhatsAppMessage): boolean {
  return (
    message.relation === undefined &&
    message.messageType !== 'reaction' &&
    message.messageType !== 'redaction'
  );
}

function isInChronologicalExtension(
  message: PrivateWhatsAppMessage,
  input: BuildConversationAssistantContextAttachmentDeltaInput
): boolean {
  return (
    message.eventTimestamp >= input.attachment.baseEventThrough &&
    message.eventTimestamp < input.attachment.capturedAt
  );
}

function isProjectionRangeTimestamp(
  timestamp: string,
  input: BuildConversationAssistantContextAttachmentDeltaInput
): boolean {
  return (
    timestamp >= input.attachment.initialContextFrom &&
    timestamp < input.attachment.capturedAt
  );
}

function isCompletedTranscription(change: PrivateWhatsAppContextChange): boolean {
  return (
    change.changeType === 'transcription_changed' &&
    change.after.state === 'included' &&
    change.after.contentKind === 'transcription' &&
    (change.before.state === 'omitted' || change.before.state === 'missing')
  );
}

function messageFromProjection(input: {
  attachment: ConversationAssistantContextAttachment;
  messageId: string;
  messageRevision: number;
  contextChangeSequence: number;
  projection: Exclude<PrivateWhatsAppContextProjection, { state: 'missing' }>;
}): PrivateWhatsAppMessage {
  const projection = input.projection;
  const message: PrivateWhatsAppMessage = {
    id: input.messageId,
    chatId: input.attachment.chatId,
    userId: input.attachment.userId,
    sourceAccountId: input.attachment.sourceAccountId,
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
      message.transcription = { status: 'completed', text: projection.content };
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

function projectDeltaMessages(messages: PrivateWhatsAppMessage[]): {
  messages: PrivateConversationContextMessage[];
  omittedMessages: PrivateConversationContextOmittedMessage[];
  omitted: PrivateConversationContextOmittedCounts;
} {
  const projected: PrivateConversationContextMessage[] = [];
  const omittedMessages: PrivateConversationContextOmittedMessage[] = [];
  const omitted: PrivateConversationContextOmittedCounts = {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  };
  for (const message of messages) {
    if (message.contextState === 'redacted' || message.contextState === 'deleted') continue;
    const base = contextProjectionBase(message);
    const text = message.text?.trim();
    if (text !== undefined && text.length > 0) {
      projected.push({ ...base, contentKind: 'text', content: text });
      continue;
    }
    const transcription = message.transcription;
    const transcriptionText = transcription?.text?.trim();
    if (
      transcription?.status === 'completed' &&
      transcriptionText !== undefined &&
      transcriptionText.length > 0
    ) {
      projected.push({
        ...base,
        contentKind: 'transcription',
        content: transcriptionText,
      });
      continue;
    }
    if (transcription?.status === 'pending' || transcription?.status === 'processing') {
      omitted.pendingTranscriptions += 1;
      omittedMessages.push({ ...base, omissionReason: 'pending_transcription' });
      continue;
    }
    if (transcription?.status === 'failed') {
      omitted.failedTranscriptions += 1;
      omittedMessages.push({ ...base, omissionReason: 'failed_transcription' });
      continue;
    }
    if (isMediaMessage(message)) {
      omitted.mediaOnly += 1;
      omittedMessages.push({ ...base, omissionReason: 'media_only' });
      continue;
    }
    omitted.nonText += 1;
    omittedMessages.push({ ...base, omissionReason: 'non_text' });
  }
  return { messages: projected, omittedMessages, omitted };
}

function contextProjectionBase(message: PrivateWhatsAppMessage): {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: PrivateWhatsAppMessage['direction'];
  speakerLabel: string;
  messageType: PrivateWhatsAppMessage['messageType'];
  reactions?: PrivateWhatsAppReactionSummary[];
} {
  const reactions = message.reactions?.map(sanitizeReaction).sort(compareReactions);
  return {
    id: message.id,
    eventTimestamp: message.eventTimestamp,
    importedAt: message.ingestedAt,
    direction: message.direction,
    speakerLabel:
      message.direction === 'outgoing'
        ? 'You'
        : nonEmpty(message.senderDisplayName) ?? 'Unknown',
    messageType: message.messageType,
    ...(reactions === undefined || reactions.length === 0 ? {} : { reactions }),
  };
}

function sanitizeReaction(reaction: PrivateWhatsAppReactionSummary): PrivateWhatsAppReactionSummary {
  return {
    id: reaction.id,
    emoji: reaction.emoji,
    direction: reaction.direction,
    eventTimestamp: reaction.eventTimestamp,
    ...(reaction.senderDisplayName === undefined
      ? {}
      : { senderDisplayName: reaction.senderDisplayName }),
  };
}

function sanitizeContextChange(
  change: PrivateWhatsAppContextChange
): PrivateWhatsAppContextChange {
  return {
    ...change,
    before: sanitizeContextProjection(change.before),
    after: sanitizeContextProjection(change.after),
  };
}

function sanitizeContextProjection(
  projection: PrivateWhatsAppContextProjection
): PrivateWhatsAppContextProjection {
  if (projection.state !== 'included' && projection.state !== 'omitted') {
    return projection;
  }
  return {
    ...projection,
    reactions: projection.reactions.map(sanitizeReaction).sort(compareReactions),
  };
}

function compareReactions(
  left: PrivateWhatsAppReactionSummary,
  right: PrivateWhatsAppReactionSummary
): number {
  const timestamp = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestamp === 0 ? left.id.localeCompare(right.id) : timestamp;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function isMediaMessage(message: PrivateWhatsAppMessage): boolean {
  return (
    message.messageType === 'image' ||
    message.messageType === 'audio' ||
    message.messageType === 'video' ||
    message.messageType === 'file' ||
    message.messageType === 'sticker'
  );
}

function eventRangeFor(
  messages: PrivateConversationContextMessage[]
): ConversationAssistantDateRange | undefined {
  if (messages.length === 0) return undefined;
  const first = messages[0] as PrivateConversationContextMessage;
  const last = messages[messages.length - 1] as PrivateConversationContextMessage;
  return { from: first.eventTimestamp, to: last.eventTimestamp };
}

function createConfirmationToken(input: {
  secret: string;
  attachmentId: string;
  deltaTranscriptSha256: string;
  resultingContextChainSha256: string;
  estimatedInputTokens: number;
}): string {
  return createHmac('sha256', input.secret)
    .update(
      JSON.stringify({
        version: 1,
        attachmentId: input.attachmentId,
        deltaTranscriptSha256: input.deltaTranscriptSha256,
        resultingContextChainSha256: input.resultingContextChainSha256,
        estimatedInputTokens: input.estimatedInputTokens,
      })
    )
    .digest('base64url');
}
