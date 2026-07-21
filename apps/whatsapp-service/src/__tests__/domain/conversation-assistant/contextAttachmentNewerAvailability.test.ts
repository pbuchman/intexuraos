import { describe, expect, it } from 'vitest';
import type {
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextProjection,
} from '../../../domain/whatsapp/index.js';
import { countConversationAssistantContextAttachmentNewerAvailability } from '../../../domain/conversation-assistant/contextAttachmentNewerAvailability.js';

function projection(
  eventTimestamp = '2026-07-20T10:00:00.000Z'
): Extract<PrivateWhatsAppContextProjection, { state: 'included' }> {
  return {
    state: 'included',
    eventTimestamp,
    importedAt: '2026-07-21T10:00:00.000Z',
    direction: 'incoming',
    speakerLabel: 'Alice',
    messageType: 'text',
    contentKind: 'text',
    content: 'safe',
    reactions: [],
  };
}

function change(
  sequence: number,
  messageId: string,
  changeType: PrivateWhatsAppContextChange['changeType'],
  before: PrivateWhatsAppContextProjection,
  after: PrivateWhatsAppContextProjection
): PrivateWhatsAppContextChange {
  return {
    userId: 'user-1',
    sourceAccountId: 'source-1',
    chatId: 'chat-1',
    sequence,
    messageId,
    messageRevision: sequence,
    changeType,
    changedAt: '2026-07-21T10:00:00.000Z',
    eventTimestamp:
      after.state === 'missing' ? '2026-07-20T10:00:00.000Z' : after.eventTimestamp,
    before,
    after,
    schemaVersion: 1,
  };
}

describe('countConversationAssistantContextAttachmentNewerAvailability', () => {
  it('counts distinct new messages separately from updates to earlier context', () => {
    const created = change(11, 'new-1', 'created', { state: 'missing' }, projection());
    const editedNew = change(12, 'new-1', 'edited', projection(), projection());
    const editedOld = change(13, 'old-1', 'edited', projection(), projection());
    const reactedOld = change(14, 'old-1', 'reaction_changed', projection(), projection());
    const transcribedOld = change(
      15,
      'old-2',
      'transcription_changed',
      {
        state: 'omitted',
        eventTimestamp: '2026-07-16T10:00:00.000Z',
        importedAt: '2026-07-16T10:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'audio',
        omissionReason: 'pending_transcription',
        reactions: [],
      },
      projection('2026-07-16T10:00:00.000Z')
    );

    expect(
      countConversationAssistantContextAttachmentNewerAvailability({
        afterSequence: 10,
        throughSequence: 15,
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        changes: [reactedOld, created, transcribedOld, editedNew, editedOld],
      })
    ).toEqual({ ok: true, value: { messageCount: 1, correctionCount: 2 } });
  });

  it('excludes late backfill before the initial lower bound', () => {
    const tooOld = change(
      11,
      'too-old',
      'created',
      { state: 'missing' },
      projection('2026-07-13T23:59:59.999Z')
    );

    expect(
      countConversationAssistantContextAttachmentNewerAvailability({
        afterSequence: 10,
        throughSequence: 11,
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        changes: [tooOld],
      })
    ).toEqual({ ok: true, value: { messageCount: 0, correctionCount: 0 } });
  });

  it('uses the journal event timestamp when a correction removes the projection', () => {
    const removed = change(
      11,
      'removed-old',
      'deleted',
      projection('2026-07-20T10:00:00.000Z'),
      { state: 'missing' }
    );

    expect(
      countConversationAssistantContextAttachmentNewerAvailability({
        afterSequence: 10,
        throughSequence: 11,
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        changes: [removed],
      })
    ).toEqual({ ok: true, value: { messageCount: 0, correctionCount: 1 } });
  });

  it('fails closed for a gap, duplicate, or invalid boundary', () => {
    const one = change(11, 'one', 'created', { state: 'missing' }, projection());

    expect(
      countConversationAssistantContextAttachmentNewerAvailability({
        afterSequence: 10,
        throughSequence: 12,
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        changes: [one],
      })
    ).toMatchObject({ ok: false, error: { code: 'CONTEXT_JOURNAL_GAP' } });
    expect(
      countConversationAssistantContextAttachmentNewerAvailability({
        afterSequence: 10,
        throughSequence: 11,
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        changes: [one, one],
      })
    ).toMatchObject({ ok: false, error: { code: 'CONTEXT_JOURNAL_GAP' } });
    expect(
      countConversationAssistantContextAttachmentNewerAvailability({
        afterSequence: 12,
        throughSequence: 11,
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        changes: [],
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_CONTEXT_BOUNDARY' } });
  });
});
