import { describe, expect, it } from 'vitest';
import type { GenerateChatResult } from '@intexuraos/llm-factory';
import {
  toPublicConversationAssistantAttachmentPreviewDto,
  toPublicConversationAssistantContextAttachmentDto,
  toPublicConversationAssistantContextDto,
  toPublicConversationAssistantExecutionRecoveryDto,
  toPublicConversationAssistantSessionDto,
  toPublicConversationAssistantSseEvent,
  toPublicConversationAssistantTurnDto,
  toPublicConversationAssistantTurnRequestDto,
} from '../../../domain/conversation-assistant/publicDtos.js';
import type {
  ConversationAssistantContextResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
  PublicConversationAssistantContextAttachment,
} from '../../../domain/conversation-assistant/types.js';
import type { ConversationAssistantContextAttachmentPreviewPage } from '../../../domain/conversation-assistant/contextAttachmentPreview.js';
import type {
  ConversationAssistantTurnRequestExecutionResult,
  PublicConversationAssistantTurnRequest,
} from '../../../domain/conversation-assistant/turnRequestUseCases.js';

const omitted = {
  mediaOnly: 0,
  failedTranscriptions: 0,
  pendingTranscriptions: 0,
  nonText: 0,
  overLimit: 0,
};

const usage: GenerateChatResult['usage'] = {
  inputTokens: 10,
  outputTokens: 4,
  totalTokens: 14,
  costUsd: 0.01,
  cachedTokens: 3,
  cacheWriteTokens: 2,
};

function session(): ConversationAssistantSession {
  return {
    id: 'session-public-dto',
    userId: 'private-user',
    chatId: 'private-chat',
    chatDisplayName: 'Alice',
    status: 'failed',
    preparationStage: 'failed',
    preparationAttempt: 2,
    preparationError: { code: 'EMPTY_TRANSCRIPT', message: 'Nothing to analyze' },
    range: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-02T00:00:00.000Z' },
    effectiveRange: {
      from: '2026-07-01T08:00:00.000Z',
      to: '2026-07-01T09:00:00.000Z',
    },
    model: 'minimax/minimax-m3',
    transcriptSha256: 'private-hash',
    transcriptMessageCount: 2,
    transcriptText: 'private transcript',
    assistantRoleLabel: 'Assistant',
    omitted,
    title: 'Alice context',
    createdAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-02T10:01:00.000Z',
    lastTurnAt: '2026-07-02T10:02:00.000Z',
  };
}

function turn(): ConversationAssistantTurn {
  return {
    id: 'turn-public-dto',
    sessionId: 'session-public-dto',
    userId: 'private-user',
    role: 'assistant',
    text: 'The tone became warmer.',
    createdAt: '2026-07-02T10:02:00.000Z',
    sequence: 3,
    conversationRevision: 2,
    requestId: 'request-public-dto',
    kind: 'context_attachment_question',
    contextAttachmentId: 'attachment-public-dto',
    contextAttachment: {
      id: 'attachment-public-dto',
      capturedAt: '2026-07-02T10:00:00.000Z',
      captureRange: {
        from: '2026-07-01T09:00:00.000Z',
        to: '2026-07-02T10:00:00.000Z',
      },
      eventRange: {
        from: '2026-07-01T10:00:00.000Z',
        to: '2026-07-02T09:00:00.000Z',
      },
      counts: {
        included: 2,
        excluded: 1,
        newlyAvailable: 2,
        completedTranscriptions: 1,
        edited: 1,
        redacted: 1,
        deleted: 1,
        reactionsChanged: 1,
        lateIngested: 1,
      },
      omitted,
    },
    acknowledgment: 'Added 2 messages.',
    usage,
  };
}

function request(): PublicConversationAssistantTurnRequest {
  return {
    id: 'request-public-dto',
    sessionId: 'session-public-dto',
    status: 'completed',
    attempt: 1,
    stateVersion: 4,
    conversationRevision: 2,
    contextAttachmentId: 'attachment-public-dto',
    completedAt: '2026-07-02T10:02:00.000Z',
  };
}

describe('Conversation Assistant public DTO projections', () => {
  it('projects every optional session, turn, request, recovery, and usage field', () => {
    const publicSession = toPublicConversationAssistantSessionDto(session(), {
      deletionToken: 'delete-token',
      deletionPending: false,
      modelDisplayName: 'MiniMax M3',
      contextSummary: {
        displayTimeZone: 'Europe/Warsaw',
        availability: { state: 'available', displayTimeZone: 'Europe/Warsaw' },
        contextVersion: 2,
        snapshotCount: 3,
        totalAttachedMessageCount: 2,
        totalAttachedOmittedCount: 1,
        completedConversationRevision: 2,
        activeTurn: { requestId: 'active-request', stateVersion: 5 },
      },
    });
    const publicTurn = toPublicConversationAssistantTurnDto(turn(), {
      canRetryAnswer: false,
    });
    const publicRequest = toPublicConversationAssistantTurnRequestDto(request());
    const recoveryInput: ConversationAssistantTurnRequestExecutionResult = {
      request: request(),
      userTurn: {
        id: 'user-turn',
        sessionId: 'session-public-dto',
        userId: 'private-user',
        role: 'user',
        text: 'How did the tone change?',
        createdAt: '2026-07-02T10:01:00.000Z',
        sequence: 1,
        conversationRevision: 2,
        requestId: 'request-public-dto',
        kind: 'message',
      },
      assistantTurn: {
        id: 'assistant-turn',
        sessionId: 'session-public-dto',
        userId: 'private-user',
        role: 'assistant',
        text: 'It became warmer.',
        createdAt: '2026-07-02T10:02:00.000Z',
        sequence: 2,
        conversationRevision: 2,
        requestId: 'request-public-dto',
        kind: 'message',
      },
      canRetryAnswer: false,
    };

    expect(publicSession).toMatchObject({
      chatDisplayName: 'Alice',
      preparationStage: 'failed',
      preparationAttempt: 2,
      preparationError: { code: 'EMPTY_TRANSCRIPT', message: 'Nothing to analyze' },
      lastTurnAt: '2026-07-02T10:02:00.000Z',
    });
    expect(publicTurn).toMatchObject({
      contextAttachmentId: 'attachment-public-dto',
      contextAttachment: {
        eventRange: {
          from: '2026-07-01T10:00:00.000Z',
          to: '2026-07-02T09:00:00.000Z',
        },
      },
      usage: { cachedTokens: 3, cacheWriteTokens: 2 },
    });
    expect(publicRequest.contextAttachmentId).toBe('attachment-public-dto');
    expect(toPublicConversationAssistantExecutionRecoveryDto(recoveryInput).turns).toHaveLength(2);

    expect(
      toPublicConversationAssistantSseEvent({
        type: 'context_attached',
        requestId: 'request-public-dto',
        streamSequence: 1,
        attachmentId: 'attachment-public-dto',
      })
    ).toEqual({
      type: 'context_attached',
      requestId: 'request-public-dto',
      streamSequence: 1,
      attachmentId: 'attachment-public-dto',
    });
    expect(
      toPublicConversationAssistantSseEvent({
        type: 'usage',
        requestId: 'request-public-dto',
        streamSequence: 2,
        usage,
      })
    ).toMatchObject({
      requestId: 'request-public-dto',
      streamSequence: 2,
      usage: { cachedTokens: 3, cacheWriteTokens: 2 },
    });
  });

  it('projects cursors, initial reactions, and reaction targets without source identifiers', () => {
    const reaction = {
      id: 'private-reaction-id',
      emoji: '👍',
      senderDisplayName: 'Alice',
      direction: 'incoming' as const,
      eventTimestamp: '2026-07-01T08:03:00.000Z',
    };
    const context: ConversationAssistantContextResult = {
      sessionId: 'session-public-dto',
      messages: [
        {
          id: 'private-message-id',
          eventTimestamp: '2026-07-01T08:00:00.000Z',
          importedAt: '2026-07-01T08:01:00.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
          contentKind: 'text',
          content: 'Hello',
          reactions: [reaction],
        },
      ],
      omittedMessages: [
        {
          id: 'private-omitted-id',
          eventTimestamp: '2026-07-01T08:02:00.000Z',
          importedAt: '2026-07-01T08:02:30.000Z',
          direction: 'outgoing',
          speakerLabel: 'Me',
          messageType: 'reaction',
          omissionReason: 'non_text',
          contentKind: 'text',
          content: '👍',
          reactions: [reaction],
          reaction: { emoji: '👍', targetMatrixEventId: 'private-target-id' },
        },
      ],
      messageCount: 1,
      omittedMessageCount: 1,
      snapshotAvailable: true,
      omitted,
      transcriptSha256: 'private-hash',
      nextMessageCursor: 1,
      nextOmittedCursor: 1,
    };

    const projected = toPublicConversationAssistantContextDto(context);

    expect(projected).toMatchObject({ nextMessageCursor: 1, nextOmittedCursor: 1 });
    expect(projected.messages[0]?.reactions?.[0]?.senderDisplayName).toBe('Alice');
    expect(projected.omittedMessages[0]).toMatchObject({
      contentKind: 'text',
      content: '👍',
      reactions: [expect.objectContaining({ senderDisplayName: 'Alice' })],
      reaction: { emoji: '👍', targetReference: expect.stringMatching(/^context-item-/) },
    });
    expect(JSON.stringify(projected)).not.toContain('private-target-id');
    expect(JSON.stringify(projected)).not.toContain('private-reaction-id');
  });

  it('projects attachment metadata and every preview item variant', () => {
    const attachment: PublicConversationAssistantContextAttachment = {
      id: 'attachment-public-dto',
      status: 'ready',
      compatibility: 'current',
      capturedAt: '2026-07-02T10:00:00.000Z',
      expiresAt: '2026-07-02T10:30:00.000Z',
      captureRange: {
        from: '2026-07-01T09:00:00.000Z',
        to: '2026-07-02T10:00:00.000Z',
      },
      eventRange: {
        from: '2026-07-01T10:00:00.000Z',
        to: '2026-07-02T09:00:00.000Z',
      },
      counts: {
        included: 2,
        excluded: 1,
        completedTranscriptions: 1,
        edited: 1,
        redacted: 1,
        reactionsChanged: 1,
        lateIngested: 1,
      },
      omitted,
      newerAvailableCount: 1,
      newerAvailableCorrectionCount: 2,
      requiresConfirmation: true,
      confirmationToken: 'confirmation-token',
    };
    const previewReaction = {
      emoji: '❤️',
      senderDisplayName: 'Alice',
      direction: 'incoming' as const,
      eventTimestamp: '2026-07-02T08:05:00.000Z',
    };
    const preview: ConversationAssistantContextAttachmentPreviewPage = {
      nextCursor: 'opaque-next',
      items: [
        {
          kind: 'included',
          message: {
            id: 'context-item-included',
            eventTimestamp: '2026-07-02T08:00:00.000Z',
            importedAt: '2026-07-02T08:01:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Included',
            reactions: [previewReaction],
          },
        },
        {
          kind: 'excluded',
          message: {
            id: 'context-item-excluded',
            eventTimestamp: '2026-07-02T08:02:00.000Z',
            importedAt: '2026-07-02T08:03:00.000Z',
            direction: 'outgoing',
            speakerLabel: 'Me',
            messageType: 'audio',
            omissionReason: 'pending_transcription',
            contentKind: 'transcription',
            content: 'Pending text',
            reactions: [previewReaction],
          },
        },
        {
          kind: 'correction',
          changeKind: 'edited',
          targetReference: 'context-item-correction-1',
          before: { state: 'missing' },
          after: {
            state: 'included',
            eventTimestamp: '2026-07-02T08:04:00.000Z',
            importedAt: '2026-07-02T08:04:30.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Edited',
            reactions: [previewReaction],
          },
        },
        {
          kind: 'correction',
          changeKind: 'transcription_changed',
          targetReference: 'context-item-correction-2',
          before: {
            state: 'omitted',
            eventTimestamp: '2026-07-02T08:06:00.000Z',
            importedAt: '2026-07-02T08:06:30.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'audio',
            omissionReason: 'pending_transcription',
            reactions: [previewReaction],
          },
          after: {
            state: 'redacted',
            eventTimestamp: '2026-07-02T08:06:00.000Z',
            importedAt: '2026-07-02T08:07:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'audio',
          },
        },
      ],
    };

    expect(toPublicConversationAssistantContextAttachmentDto(attachment)).toEqual(attachment);
    expect(toPublicConversationAssistantAttachmentPreviewDto(preview)).toEqual(preview);
  });

  it('omits absent optional session, recovery, attachment, context, and preview fields', () => {
    const {
      chatDisplayName: _chatDisplayName,
      preparationStage: _preparationStage,
      preparationAttempt: _preparationAttempt,
      preparationError: _preparationError,
      lastTurnAt: _lastTurnAt,
      ...minimalSession
    } = session();
    const projectedSession = toPublicConversationAssistantSessionDto(minimalSession, {
      deletionToken: 'delete-token',
      deletionPending: false,
      modelDisplayName: 'MiniMax M3',
      contextSummary: {
        displayTimeZone: 'UTC',
        availability: { state: 'available', displayTimeZone: 'UTC' },
        contextVersion: 0,
        snapshotCount: 1,
        totalAttachedMessageCount: 0,
        totalAttachedOmittedCount: 0,
        completedConversationRevision: 0,
        activeTurn: null,
      },
    });
    expect(projectedSession).not.toHaveProperty('chatDisplayName');
    expect(projectedSession).not.toHaveProperty('preparationStage');
    expect(projectedSession).not.toHaveProperty('preparationAttempt');

    const recoveryWithoutAssistant: ConversationAssistantTurnRequestExecutionResult = {
      request: request(),
      userTurn: {
        id: 'user-turn-only',
        sessionId: 'session-public-dto',
        userId: 'private-user',
        role: 'user',
        text: 'What changed?',
        createdAt: '2026-07-02T10:01:00.000Z',
        sequence: 1,
        conversationRevision: 2,
        requestId: 'request-public-dto',
        kind: 'message',
      },
      canRetryAnswer: false,
    };
    expect(toPublicConversationAssistantExecutionRecoveryDto(recoveryWithoutAssistant).turns).toHaveLength(1);
    expect(toPublicConversationAssistantSseEvent({ type: 'usage', usage })).toEqual({
      type: 'usage',
      usage,
    });

    const minimalAttachment: PublicConversationAssistantContextAttachment = {
      id: 'attachment-minimal',
      status: 'preparing',
      compatibility: 'current',
      capturedAt: '2026-07-02T10:00:00.000Z',
      requiresConfirmation: false,
      newerAvailableCount: 0,
      newerAvailableCorrectionCount: 0,
    };
    expect(toPublicConversationAssistantContextAttachmentDto(minimalAttachment)).toEqual(
      minimalAttachment
    );

    const contextWithoutReactionIdentity: ConversationAssistantContextResult = {
      sessionId: 'session-public-dto',
      messages: [],
      omittedMessages: [
        {
          id: 'private-omitted-minimal',
          eventTimestamp: '2026-07-02T08:00:00.000Z',
          importedAt: '2026-07-02T08:00:30.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'reaction',
          omissionReason: 'non_text',
          reactions: [
            {
              id: 'private-reaction-minimal',
              emoji: '👍',
              direction: 'incoming',
              eventTimestamp: '2026-07-02T08:00:00.000Z',
            },
          ],
          reaction: { emoji: '👍' },
        },
      ],
      messageCount: 0,
      omittedMessageCount: 1,
      snapshotAvailable: true,
      omitted,
      transcriptSha256: 'private-hash',
    };
    const projectedContext = toPublicConversationAssistantContextDto(
      contextWithoutReactionIdentity
    );
    expect(projectedContext.omittedMessages[0]?.reaction).toEqual({ emoji: '👍' });
    expect(projectedContext.omittedMessages[0]?.reactions?.[0]).not.toHaveProperty(
      'senderDisplayName'
    );

    const turnWithOptionalAttachment = turn();
    const turnAttachment = turnWithOptionalAttachment.contextAttachment;
    expect(turnAttachment).toBeDefined();
    if (turnAttachment === undefined) return;
    const {
      eventRange: _eventRange,
      ...turnAttachmentWithoutEventRange
    } = turnAttachment;
    const projectedTurn = toPublicConversationAssistantTurnDto({
      ...turnWithOptionalAttachment,
      contextAttachment: turnAttachmentWithoutEventRange,
    });
    expect(projectedTurn.contextAttachment).not.toHaveProperty('eventRange');

    const reactionWithoutDisplayName = {
      emoji: '❤️',
      direction: 'incoming' as const,
      eventTimestamp: '2026-07-02T08:05:00.000Z',
    };
    const previewWithoutOptionalFields: ConversationAssistantContextAttachmentPreviewPage = {
      items: [
        {
          kind: 'included',
          message: {
            id: 'context-item-included-minimal',
            eventTimestamp: '2026-07-02T08:00:00.000Z',
            importedAt: '2026-07-02T08:01:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Included',
          },
        },
        {
          kind: 'included',
          message: {
            id: 'context-item-included-reaction',
            eventTimestamp: '2026-07-02T08:02:00.000Z',
            importedAt: '2026-07-02T08:03:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Reacted',
            reactions: [reactionWithoutDisplayName],
          },
        },
        {
          kind: 'excluded',
          message: {
            id: 'context-item-excluded-minimal',
            eventTimestamp: '2026-07-02T08:04:00.000Z',
            importedAt: '2026-07-02T08:05:00.000Z',
            direction: 'outgoing',
            speakerLabel: 'Me',
            messageType: 'audio',
            omissionReason: 'pending_transcription',
          },
        },
      ],
    };
    const projectedPreview = toPublicConversationAssistantAttachmentPreviewDto(
      previewWithoutOptionalFields
    );
    expect(projectedPreview).toEqual(previewWithoutOptionalFields);
    expect(projectedPreview.items[1]).not.toHaveProperty(
      'message.reactions.0.senderDisplayName'
    );
  });
});
