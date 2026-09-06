import { describe, expect, it } from 'vitest';
import {
  createConversationAssistantAttachmentState,
  reduceConversationAssistantAttachmentState,
  type ConversationAssistantAttachmentDto,
} from '../conversationAssistantAttachmentState.js';

function createAttachment(
  overrides: Partial<ConversationAssistantAttachmentDto> = {}
): ConversationAssistantAttachmentDto {
  const base: ConversationAssistantAttachmentDto = {
    id: 'attachment-a',
    status: 'ready',
    compatibility: 'current',
    capturedAt: '2026-07-21T10:00:00.000Z',
    captureRange: {
      from: '2026-07-20T10:00:00.000Z',
      to: '2026-07-21T10:00:00.000Z',
    },
    counts: {
      included: 2,
      excluded: 0,
      edited: 0,
      redacted: 0,
      deleted: 0,
      reactionsChanged: 0,
      lateIngested: 0,
      completedTranscriptions: 0,
    },
    omitted: {
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    },
    requiresConfirmation: false,
    newerAvailableCount: 0,
    newerAvailableCorrectionCount: 0,
  };

  return {
    ...base,
    ...overrides,
    counts: { ...base.counts, ...overrides.counts },
    omitted: { ...base.omitted, ...overrides.omitted },
  };
}

describe('Conversation Assistant attachment state lifecycle', () => {
  it('starts idle for the active session and enters restoring for a stored attachment', () => {
    const initial = createConversationAssistantAttachmentState('session-a');

    expect(initial).toEqual({ phase: 'idle', sessionId: 'session-a' });
    expect(
      reduceConversationAssistantAttachmentState(initial, {
        type: 'begin_restoring',
        sessionId: 'session-a',
        attachmentId: 'attachment-a',
      })
    ).toEqual({
      phase: 'restoring',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });

    expect(
      reduceConversationAssistantAttachmentState(initial, {
        type: 'begin_restoring',
        sessionId: 'session-a',
      })
    ).toEqual({
      phase: 'restoring',
      sessionId: 'session-a',
    });
  });

  it('maps preparing responses to preparing', () => {
    const initial = createConversationAssistantAttachmentState('session-a');
    const preparingState = reduceConversationAssistantAttachmentState(initial, {
      type: 'track_attachment',
      attachment: createAttachment({ status: 'preparing' }),
    });

    expect(preparingState).toMatchObject({
      phase: 'preparing',
      attachment: { id: 'attachment-a', status: 'preparing' },
    });
    expect(
      reduceConversationAssistantAttachmentState(preparingState, {
        type: 'attachment_status_received',
        attachment: createAttachment({ status: 'preparing' }),
      })
    ).toMatchObject({ phase: 'preparing', attachment: { status: 'preparing' } });
  });

  it.each([
    {
      label: 'zero delta',
      counts: {
        included: 0,
        excluded: 0,
      },
    },
    {
      label: 'omitted-only delta',
      counts: {
        included: 0,
        excluded: 4,
      },
    },
    {
      label: 'corrections-only delta',
      counts: {
        included: 0,
        excluded: 0,
        edited: 2,
        completedTranscriptions: 1,
      },
    },
  ])('keeps a $label ready with its persisted counts', ({ counts }) => {
    const attachment = createAttachment({ counts: { ...createAttachment().counts, ...counts } });

    const state = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment }
    );

    expect(state).toMatchObject({ phase: 'ready', attachment: { counts } });
  });
});

describe('terminal attachment statuses', () => {
  it('maps public failure, expiry, stale compatibility, and an external commit', () => {
    const initial = createConversationAssistantAttachmentState('session-a');
    const failed = reduceConversationAssistantAttachmentState(initial, {
      type: 'track_attachment',
      attachment: createAttachment({
        status: 'failed',
        error: {
          code: 'PREPARATION_FAILED',
          message: 'The context attachment could not be prepared',
        },
      }),
    });
    const expired = reduceConversationAssistantAttachmentState(initial, {
      type: 'track_attachment',
      attachment: createAttachment({ status: 'expired' }),
    });
    const stale = reduceConversationAssistantAttachmentState(initial, {
      type: 'track_attachment',
      attachment: createAttachment({ compatibility: 'stale' }),
    });
    const committed = reduceConversationAssistantAttachmentState(initial, {
      type: 'track_attachment',
      attachment: createAttachment({ status: 'committed' }),
    });

    expect(failed).toMatchObject({
      phase: 'failed',
      failure: { code: 'PREPARATION_FAILED' },
    });
    expect(expired).toMatchObject({ phase: 'expired', attachment: { status: 'expired' } });
    expect(stale).toMatchObject({ phase: 'stale', attachment: { compatibility: 'stale' } });
    expect(committed).toMatchObject({
      phase: 'consumed_elsewhere',
      attachment: { id: 'attachment-a', status: 'committed' },
    });
  });

  it('marks a metadata-ready rejected attachment as requiring recapture', () => {
    const ready = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment: createAttachment() }
    );

    expect(
      reduceConversationAssistantAttachmentState(ready, {
        type: 'recapture_required',
        sessionId: 'session-a',
        attachmentId: 'attachment-a',
      })
    ).toMatchObject({
      phase: 'recapture_required',
      attachment: { id: 'attachment-a', status: 'ready' },
    });
  });
});

describe('newer context observations', () => {
  it('shows both required newer counts and keeps only the observed version dismissed', () => {
    const newer = createAttachment({
      newerAvailableCount: 3,
      newerAvailableCorrectionCount: 2,
    });
    const initial = createConversationAssistantAttachmentState('session-a');
    const visible = reduceConversationAssistantAttachmentState(initial, {
      type: 'track_attachment',
      attachment: newer,
    });

    expect(visible).toMatchObject({
      phase: 'newer_available',
      attachment: {
        newerAvailableCount: 3,
        newerAvailableCorrectionCount: 2,
      },
    });

    const kept = reduceConversationAssistantAttachmentState(visible, {
      type: 'keep_current_snapshot',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });
    expect(kept).toMatchObject({
      phase: 'ready',
      dismissedNewerObservation: {
        attachmentId: 'attachment-a',
        capturedAt: '2026-07-21T10:00:00.000Z',
        newerAvailableCount: 3,
        newerAvailableCorrectionCount: 2,
      },
    });

    const unchanged = reduceConversationAssistantAttachmentState(kept, {
      type: 'attachment_status_received',
      attachment: newer,
    });
    expect(unchanged.phase).toBe('ready');

    const changedMessageCount = reduceConversationAssistantAttachmentState(unchanged, {
      type: 'attachment_status_received',
      attachment: createAttachment({
        newerAvailableCount: 4,
        newerAvailableCorrectionCount: 2,
      }),
    });
    expect(changedMessageCount.phase).toBe('newer_available');

    const keptAgain = reduceConversationAssistantAttachmentState(changedMessageCount, {
      type: 'keep_current_snapshot',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });
    const changedCorrectionCount = reduceConversationAssistantAttachmentState(keptAgain, {
      type: 'attachment_status_received',
      attachment: createAttachment({
        newerAvailableCount: 4,
        newerAvailableCorrectionCount: 3,
      }),
    });
    expect(changedCorrectionCount.phase).toBe('newer_available');

    const keptCorrections = reduceConversationAssistantAttachmentState(changedCorrectionCount, {
      type: 'keep_current_snapshot',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });
    const changedVersion = reduceConversationAssistantAttachmentState(keptCorrections, {
      type: 'attachment_status_received',
      attachment: createAttachment({
        capturedAt: '2026-07-21T10:01:00.000Z',
        newerAvailableCount: 4,
        newerAvailableCorrectionCount: 3,
      }),
    });
    expect(changedVersion.phase).toBe('newer_available');
  });

  it('does not enter newer_available when both newer counts are zero', () => {
    const state = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      {
        type: 'track_attachment',
        attachment: createAttachment({
          newerAvailableCount: 0,
          newerAvailableCorrectionCount: 0,
        }),
      }
    );

    expect(state.phase).toBe('ready');
  });

  it('forgets a Keep dismissal after counts change to zero', () => {
    const visible = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      {
        type: 'track_attachment',
        attachment: createAttachment({ newerAvailableCount: 2 }),
      }
    );
    const kept = reduceConversationAssistantAttachmentState(visible, {
      type: 'keep_current_snapshot',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });
    const zero = reduceConversationAssistantAttachmentState(kept, {
      type: 'attachment_status_received',
      attachment: createAttachment({ newerAvailableCount: 0 }),
    });

    expect(zero).toEqual({
      phase: 'ready',
      sessionId: 'session-a',
      attachment: createAttachment({ newerAvailableCount: 0 }),
    });

    const visibleAgain = reduceConversationAssistantAttachmentState(zero, {
      type: 'attachment_status_received',
      attachment: createAttachment({ newerAvailableCount: 2 }),
    });
    expect(visibleAgain.phase).toBe('newer_available');
  });
});

describe('hard prompt limit', () => {
  it('keeps the ready attachment in a blocking CONTEXT_WINDOW_EXCEEDED failure', () => {
    const ready = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment: createAttachment() }
    );
    const blocked = reduceConversationAssistantAttachmentState(ready, {
      type: 'hard_limit_rejected',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });

    expect(blocked).toMatchObject({
      phase: 'failed',
      attachment: { id: 'attachment-a', status: 'ready' },
      failure: {
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'This update is too large to include in one question.',
        blocking: true,
      },
    });

    const afterPoll = reduceConversationAssistantAttachmentState(blocked, {
      type: 'attachment_status_received',
      attachment: createAttachment(),
    });
    expect(afterPoll).toMatchObject({
      phase: 'failed',
      failure: { code: 'CONTEXT_WINDOW_EXCEEDED' },
      attachment: { status: 'ready' },
    });
  });

  it('clears the hard-limit block when an intentional refresh tracks a new attachment', () => {
    const ready = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment: createAttachment() }
    );
    const blocked = reduceConversationAssistantAttachmentState(ready, {
      type: 'hard_limit_rejected',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });

    const refreshed = reduceConversationAssistantAttachmentState(blocked, {
      type: 'track_attachment',
      attachment: createAttachment({ id: 'attachment-b', status: 'preparing' }),
    });

    expect(refreshed).toMatchObject({
      phase: 'preparing',
      attachment: { id: 'attachment-b' },
    });
  });

  it('treats ATTACHMENT_TOO_LARGE preparation failure as blocking recovery', () => {
    const tooLarge = createAttachment({
      status: 'failed',
      error: {
        code: 'ATTACHMENT_TOO_LARGE',
        message: 'This update is too large to include in one question.',
      },
    });

    const blocked = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment: tooLarge }
    );

    expect(blocked).toMatchObject({
      phase: 'failed',
      attachment: { id: 'attachment-a', status: 'failed' },
      failure: {
        code: 'ATTACHMENT_TOO_LARGE',
        message: 'This update is too large to include in one question.',
        blocking: true,
      },
    });
  });
});

describe('response isolation and removal', () => {
  it('ignores status responses for another session or attachment', () => {
    const ready = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment: createAttachment() }
    );

    expect(
      reduceConversationAssistantAttachmentState(ready, {
        type: 'attachment_status_received',
        sessionId: 'session-b',
        attachment: createAttachment(),
      })
    ).toBe(ready);
    expect(
      reduceConversationAssistantAttachmentState(ready, {
        type: 'attachment_status_received',
        attachment: createAttachment({ id: 'attachment-b' }),
      })
    ).toBe(ready);
  });

  it('accepts only the requested attachment while restoring', () => {
    const restoring = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      {
        type: 'begin_restoring',
        sessionId: 'session-a',
        attachmentId: 'attachment-a',
      }
    );

    expect(
      reduceConversationAssistantAttachmentState(restoring, {
        type: 'attachment_status_received',
        attachment: createAttachment({ id: 'attachment-b' }),
      })
    ).toBe(restoring);
    expect(
      reduceConversationAssistantAttachmentState(restoring, {
        type: 'attachment_status_received',
        attachment: createAttachment(),
      })
    ).toMatchObject({ phase: 'ready', attachment: { id: 'attachment-a' } });
  });

  it('removes the matching attachment and ignores its later response', () => {
    const ready = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment: createAttachment() }
    );
    const wrongRemove = reduceConversationAssistantAttachmentState(ready, {
      type: 'remove',
      sessionId: 'session-a',
      attachmentId: 'attachment-b',
    });
    expect(wrongRemove).toBe(ready);

    const removed = reduceConversationAssistantAttachmentState(ready, {
      type: 'remove',
      sessionId: 'session-a',
      attachmentId: 'attachment-a',
    });
    expect(removed).toEqual({ phase: 'idle', sessionId: 'session-a' });
    expect(
      reduceConversationAssistantAttachmentState(removed, {
        type: 'attachment_status_received',
        attachment: createAttachment(),
      })
    ).toBe(removed);
  });

  it('resets to a new active session and ignores late responses from the previous one', () => {
    const ready = reduceConversationAssistantAttachmentState(
      createConversationAssistantAttachmentState('session-a'),
      { type: 'track_attachment', attachment: createAttachment() }
    );
    const reset = reduceConversationAssistantAttachmentState(ready, {
      type: 'reset',
      sessionId: 'session-b',
    });

    expect(reset).toEqual({ phase: 'idle', sessionId: 'session-b' });
    expect(
      reduceConversationAssistantAttachmentState(reset, {
        type: 'track_attachment',
        sessionId: 'session-a',
        attachment: createAttachment(),
      })
    ).toBe(reset);
  });
});
