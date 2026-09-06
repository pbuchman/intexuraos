import { describe, expect, it } from 'vitest';
import { buildConversationAssistantContextAttachmentAcknowledgment } from '../../../domain/conversation-assistant/contextAttachmentAcknowledgment.js';
import type { ConversationAssistantContextAttachmentCounts } from '../../../domain/conversation-assistant/types.js';

describe('buildConversationAssistantContextAttachmentAcknowledgment', () => {
  it('counts only included bodies and formats their persisted event range in the session timezone', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({ included: 2, omitted: 1, newlyAvailable: 99 }),
      eventRange: {
        from: '2026-07-17T16:49:00.000Z',
        to: '2026-07-19T08:09:00.000Z',
      },
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 2 new messages sent between 17 July 2026, 18:49 and 19 July 2026, 10:09. ' +
        'The snapshot was captured at 10:14. ' +
        '1 item was excluded because it had no analyzable content.'
    );
  });

  it('uses singular message grammar', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({ included: 1 }),
      eventRange: {
        from: '2026-07-19T08:09:00.000Z',
        to: '2026-07-19T08:09:00.000Z',
      },
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 1 new message sent at 19 July 2026, 10:09. ' +
        'The snapshot was captured at 10:14.'
    );
  });

  it('falls back to the capture range and appends a completed-transcription-only update', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({ included: 1, completedTranscriptions: 1 }),
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 1 new message sent at 17 July 2026, 18:42. ' +
        'The snapshot was captured at 10:14. ' +
        'Also applied 1 completed transcription.'
    );
  });

  it('appends a source-correction-only update', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({ included: 2, edited: 1 }),
      eventRange: {
        from: '2026-07-18T06:00:00.000Z',
        to: '2026-07-19T08:09:00.000Z',
      },
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toContain('Also applied 1 source correction (1 edit).');
  });

  it('describes a truly empty delta without implying an update', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts(),
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 0 messages. I checked from 17 July 2026, 18:42 through ' +
        '19 July 2026, 10:14 and found no new analyzable messages.'
    );
  });

  it('uses capturedAt as the fixed checked cutoff', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts(),
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-20T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toContain('through 19 July 2026, 10:14');
    expect(result).not.toContain('20 July 2026');
  });

  it('reports omitted-only context separately from Added 0', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({ omitted: 3 }),
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 0 messages. I checked from 17 July 2026, 18:42 through ' +
        '19 July 2026, 10:14 and found no new analyzable messages. ' +
        '3 items were excluded because they had no analyzable content.'
    );
  });

  it('does not describe corrections-only context as empty', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({ completedTranscriptions: 1, edited: 2 }),
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 0 new messages. Applied 3 updates to earlier context. ' +
        'I checked from 17 July 2026, 18:42 through 19 July 2026, 10:14. ' +
        'The updates were 1 completed transcription and 2 edits.'
    );
    expect(result).not.toContain('found no new analyzable messages');
  });

  it('appends completed transcriptions and every typed source correction', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({
        included: 4,
        completedTranscriptions: 2,
        edited: 2,
        redacted: 1,
        deleted: 2,
        reactionsChanged: 1,
      }),
      eventRange: {
        from: '2026-07-18T06:00:00.000Z',
        to: '2026-07-19T08:09:00.000Z',
      },
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 4 new messages sent between 18 July 2026, 08:00 and 19 July 2026, 10:09. ' +
        'The snapshot was captured at 10:14. ' +
        'Also applied 2 completed transcriptions and 6 source corrections ' +
        '(2 edits, 3 redactions, and 1 reaction change).'
    );
  });

  it('uses singular update grammar for one reaction correction', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts({ reactionsChanged: 1 }),
      captureRange: {
        from: '2026-07-19T08:00:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Europe/Warsaw',
    });

    expect(result).toBe(
      'Added 0 new messages. Applied 1 update to earlier context. ' +
        'I checked from 19 July 2026, 10:00 through 19 July 2026, 10:14. ' +
        'The update was 1 reaction change.'
    );
  });

  it('falls back to UTC when the persisted IANA timezone is invalid', () => {
    const result = buildConversationAssistantContextAttachmentAcknowledgment({
      counts: counts(),
      captureRange: {
        from: '2026-07-17T16:42:00.000Z',
        to: '2026-07-19T08:14:00.000Z',
      },
      capturedAt: '2026-07-19T08:14:00.000Z',
      displayTimeZone: 'Invalid/Timezone',
    });

    expect(result).toBe(
      'Added 0 messages. I checked from 17 July 2026, 16:42 through ' +
        '19 July 2026, 08:14 and found no new analyzable messages.'
    );
  });
});

function counts(
  overrides: Partial<ConversationAssistantContextAttachmentCounts> = {}
): ConversationAssistantContextAttachmentCounts {
  return {
    included: 0,
    omitted: 0,
    newlyAvailable: 0,
    edited: 0,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 0,
    ...overrides,
  };
}
