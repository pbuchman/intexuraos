import { describe, expect, it } from 'vitest';
import {
  assessCalendarEventReadiness,
  isCalendarDraftAcceptance,
  parseAcceptedCalendarEventDraft,
} from '../../domain/agent/calendarEventReadiness.js';

const VALID_SAFE_DEFAULT_DRAFT = {
  version: 1,
  toolArgs: {
    summary: 'Dentist',
    start: '2026-08-18T09:00:00+02:00',
    end: '2026-08-18T10:00:00+02:00',
    timeZone: 'Europe/Warsaw',
  },
  fields: {
    summary: { value: 'Dentist', status: 'user_confirmed', source: 'user_message' },
    start: {
      value: '2026-08-18T09:00:00+02:00',
      status: 'user_confirmed',
      source: 'user_message',
    },
    end: {
      value: '2026-08-18T10:00:00+02:00',
      status: 'proposed_default',
      source: 'safe_default',
    },
    timeZone: {
      value: 'Europe/Warsaw',
      status: 'runtime_default',
      source: 'runtime',
    },
  },
  omittedFields: ['location'],
} as const;

describe('calendarEventReadiness', () => {
  it('keeps explicit grounded fields and the explicit IANA time zone ready', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: 'Dentist',
          start: '2026-08-18T14:30:00-04:00',
          end: '2026-08-18T15:15:00-04:00',
          timeZone: 'America/New_York',
          location: 'Smile Clinic',
          description: 'Annual checkup',
          attendees: ['pat@example.com'],
        },
        evidenceTexts: [
          'Schedule Dentist on 2026-08-18 from 14:30 to 15:15 America/New_York at Smile Clinic with pat@example.com for Annual checkup.',
        ],
        hasExplicitStart: true,
        hasExplicitEnd: true,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'en',
      })
    ).toEqual({
      status: 'ready',
      toolArgs: {
        summary: 'Dentist',
        start: '2026-08-18T14:30:00-04:00',
        end: '2026-08-18T15:15:00-04:00',
        timeZone: 'America/New_York',
        location: 'Smile Clinic',
        description: 'Annual checkup',
        attendees: ['pat@example.com'],
      },
    });
  });

  it('drops invented optional fields and proposes one hour for a missing end', () => {
    const result = assessCalendarEventReadiness({
      toolArgs: {
        summary: 'Turniej OPEN B++',
        start: '2026-08-14T18:00:00+02:00',
        end: '2026-08-14T21:00:00+02:00',
        location: 'Invented venue',
        attendees: ['invented@example.com'],
      },
      evidenceTexts: ['Dodaj Turniej OPEN B++ 14 sierpnia 2026 o 18:00.'],
      hasExplicitStart: true,
      hasExplicitEnd: false,
      runtimeTimeZone: 'Europe/Warsaw',
      replyLanguage: 'pl',
    });

    expect(result).toMatchObject({
      status: 'needs_clarification',
      missingFields: ['end'],
      draft: {
        toolArgs: {
          summary: 'Turniej OPEN B++',
          start: '2026-08-14T18:00:00+02:00',
          end: '2026-08-14T19:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        omittedFields: ['location', 'description', 'attendees'],
      },
    });
  });

  it('records an explicit time zone as user-confirmed in a proposed draft', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: 'Dentist',
          start: '2026-08-18T14:30:00-04:00',
          end: '2026-08-18T15:30:00-04:00',
          timeZone: 'America/New_York',
        },
        evidenceTexts: ['Schedule Dentist on 2026-08-18 at 14:30 America/New_York.'],
        hasExplicitStart: true,
        hasExplicitEnd: false,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'en',
      })
    ).toMatchObject({
      status: 'needs_clarification',
      draft: {
        fields: {
          timeZone: {
            value: 'America/New_York',
            status: 'user_confirmed',
            source: 'user_message',
          },
        },
      },
    });
  });

  it('asks for a grounded title when summary is generic', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: 'Event',
          start: '2026-08-14T18:00:00+02:00',
          end: '2026-08-14T19:00:00+02:00',
        },
        evidenceTexts: ['Dodaj wydarzenie 14 sierpnia 2026 o 18:00 na godzinę.'],
        hasExplicitStart: true,
        hasExplicitEnd: true,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'pl',
      })
    ).toMatchObject({ status: 'needs_clarification', missingFields: ['summary'] });
  });

  it('builds an English missing-title draft without inventing start, end, or time zone', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: { summary: 'Event' },
        evidenceTexts: ['Add an event.'],
        hasExplicitStart: false,
        hasExplicitEnd: false,
        runtimeTimeZone: '',
        replyLanguage: 'en',
      })
    ).toMatchObject({
      status: 'needs_clarification',
      reply: 'What short title should I use for this event?',
      draft: {
        fields: {
          start: { status: 'missing', source: 'none' },
          end: { status: 'missing', source: 'none' },
          timeZone: { status: 'missing', source: 'none' },
        },
      },
    });
  });

  it('replaces a partially invented summary with the title extracted from user evidence', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: 'Important Dentist',
          start: '2026-08-18T14:30:00+02:00',
          end: '2026-08-18T15:15:00+02:00',
        },
        evidenceTexts: ['Schedule Dentist on 2026-08-18 from 14:30 to 15:15.'],
        hasExplicitStart: true,
        hasExplicitEnd: true,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'en',
      })
    ).toMatchObject({ status: 'ready', toolArgs: { summary: 'Dentist' } });
  });

  it('asks for start before proposing a duration', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: 'Dentist',
          start: '2026-08-18T09:00:00+02:00',
          end: '2026-08-18T10:00:00+02:00',
        },
        evidenceTexts: ['Schedule Dentist on 2026-08-18.'],
        hasExplicitStart: false,
        hasExplicitEnd: false,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'en',
      })
    ).toMatchObject({ status: 'needs_clarification', missingFields: ['start'] });
  });

  it('asks for a missing start in Polish', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: { summary: 'Dentysta' },
        evidenceTexts: ['Dodaj Dentysta jutro.'],
        hasExplicitStart: false,
        hasExplicitEnd: false,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'pl',
      })
    ).toMatchObject({
      status: 'needs_clarification',
      reply: expect.stringContaining('O której ma się rozpocząć'),
      missingFields: ['start'],
    });
  });

  it('asks directly for end when the start cannot produce a safe proposed instant', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: 'Dentist',
          start: 'not-an-instant',
          end: 'also-not-an-instant',
        },
        evidenceTexts: ['Schedule Dentist tomorrow at noon.'],
        hasExplicitStart: true,
        hasExplicitEnd: false,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'en',
      })
    ).toEqual({
      status: 'needs_clarification',
      reply: 'When should “Dentist” end?',
      missingFields: ['end'],
    });
  });

  it('asks directly for an invalid proposed end in Polish', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: { summary: 'Dentysta', start: 'nie-data' },
        evidenceTexts: ['Dodaj Dentysta jutro o 12:00.'],
        hasExplicitStart: true,
        hasExplicitEnd: false,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'pl',
      })
    ).toEqual({
      status: 'needs_clarification',
      reply: 'Do której ma trwać wydarzenie „Dentysta”?',
      missingFields: ['end'],
    });
  });

  it.each([
    ['pl', 'Do której ma trwać wydarzenie „Dentysta”?'],
    ['en', 'When should “Dentysta” end?'],
  ] as const)('asks for a structurally missing explicit end in %s', (replyLanguage, reply) => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: { summary: 'Dentysta', start: '2026-08-18T09:00:00', end: '' },
        evidenceTexts: ['Dodaj Dentysta 18 sierpnia o 09:00 do 10:00.'],
        hasExplicitStart: true,
        hasExplicitEnd: true,
        runtimeTimeZone: '',
        replyLanguage,
      })
    ).toEqual({ status: 'needs_clarification', reply, missingFields: ['end'] });
  });

  it('keeps a ready event without a time zone when no runtime default exists', () => {
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: 'Dentist',
          start: '2026-08-18T09:00:00',
          end: '2026-08-18T10:00:00',
        },
        evidenceTexts: ['Schedule Dentist on 2026-08-18 from 09:00 to 10:00.'],
        hasExplicitStart: true,
        hasExplicitEnd: true,
        runtimeTimeZone: '',
        replyLanguage: 'en',
      })
    ).toEqual({
      status: 'ready',
      toolArgs: {
        summary: 'Dentist',
        start: '2026-08-18T09:00:00',
        end: '2026-08-18T10:00:00',
      },
    });
  });

  it('proposes an offset-free end and does not claim that grounded location is omitted', () => {
    const result = assessCalendarEventReadiness({
      toolArgs: {
        summary: 'Dentist',
        start: '2026-08-18T09:00:00',
        end: '2026-08-18T12:00:00',
        location: 'Smile Clinic',
      },
      evidenceTexts: ['Schedule Dentist on 2026-08-18 at 09:00 at Smile Clinic.'],
      hasExplicitStart: true,
      hasExplicitEnd: false,
      runtimeTimeZone: '',
      replyLanguage: 'en',
    });

    expect(result).toMatchObject({
      status: 'needs_clarification',
      draft: {
        toolArgs: {
          end: '2026-08-18T10:00:00',
          location: 'Smile Clinic',
        },
      },
    });
    expect(result.status).toBe('needs_clarification');
    if (result.status !== 'needs_clarification') throw new Error('expected clarification');
    expect(result.reply).not.toContain('omit the location');
  });

  it('uses the Polish tournament fallback only for grounded meta summaries', () => {
    const metaSummary =
      'Przeanalizowałem szczegóły turnieju OPEN B++ i przygotowałem propozycję wydarzenia kalendarzowego.';
    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: metaSummary,
          start: '2026-08-14T18:00:00+02:00',
          end: '2026-08-14T19:00:00+02:00',
        },
        evidenceTexts: [metaSummary],
        hasExplicitStart: true,
        hasExplicitEnd: true,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'pl',
      })
    ).toMatchObject({ status: 'ready', toolArgs: { summary: 'Turniej OPEN B++' } });

    expect(
      assessCalendarEventReadiness({
        toolArgs: {
          summary: metaSummary.replace('OPEN B++', 'INNY'),
          start: '2026-08-14T18:00:00+02:00',
          end: '2026-08-14T19:00:00+02:00',
        },
        evidenceTexts: [metaSummary],
        hasExplicitStart: true,
        hasExplicitEnd: true,
        runtimeTimeZone: 'Europe/Warsaw',
        replyLanguage: 'pl',
      })
    ).toMatchObject({ status: 'needs_clarification', missingFields: ['summary'] });
  });

  it('rejects absent and tokenless titles', () => {
    for (const summary of [undefined, 'AB']) {
      expect(
        assessCalendarEventReadiness({
          toolArgs: {
            ...(summary === undefined ? {} : { summary }),
            start: '2026-08-14T18:00:00+02:00',
            end: '2026-08-14T19:00:00+02:00',
          },
          evidenceTexts: ['Event'],
          hasExplicitStart: true,
          hasExplicitEnd: true,
          runtimeTimeZone: 'Europe/Warsaw',
          replyLanguage: 'pl',
        })
      ).toMatchObject({ status: 'needs_clarification', missingFields: ['summary'] });
    }
  });

  it.each(['Tak', 'yes', 'Pasuje.', 'sounds good', 'może być'])(
    'recognizes a narrow draft acceptance: %s',
    (message) => {
      expect(isCalendarDraftAcceptance(message)).toBe(true);
    }
  );

  it.each(['Tak, ale do 21:00', 'nie', 'add it', 'what did you assume?'])(
    'does not treat corrections, rejection, or questions as acceptance: %s',
    (message) => {
      expect(isCalendarDraftAcceptance(message)).toBe(false);
    }
  );

  it('accepts only a complete persisted safe-default draft', () => {
    const draft = VALID_SAFE_DEFAULT_DRAFT;

    expect(parseAcceptedCalendarEventDraft(draft)).toEqual(draft);
    expect(
      parseAcceptedCalendarEventDraft({
        ...draft,
        fields: {
          ...draft.fields,
          end: { ...draft.fields.end, source: 'user_message' },
        },
      })
    ).toBeNull();
    expect(
      parseAcceptedCalendarEventDraft({
        ...draft,
        fields: {
          ...draft.fields,
          summary: { ...draft.fields.summary, source: 'safe_default' },
        },
      })
    ).toBeNull();
    expect(
      parseAcceptedCalendarEventDraft({
        ...draft,
        fields: {
          ...draft.fields,
          end: { ...draft.fields.end, value: '2026-08-18T12:00:00+02:00' },
        },
      })
    ).toBeNull();
    expect(parseAcceptedCalendarEventDraft({ version: 1, toolArgs: {} })).toBeNull();
    expect(parseAcceptedCalendarEventDraft(null)).toBeNull();
  });

  it.each([
    ['primitive draft', 'invalid'],
    ['array draft', []],
    ['wrong version', { ...VALID_SAFE_DEFAULT_DRAFT, version: 2 }],
    ['non-object args', { ...VALID_SAFE_DEFAULT_DRAFT, toolArgs: null }],
    ['non-object fields', { ...VALID_SAFE_DEFAULT_DRAFT, fields: null }],
    ['non-array omitted fields', { ...VALID_SAFE_DEFAULT_DRAFT, omittedFields: null }],
    [
      'missing summary arg',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        toolArgs: { ...VALID_SAFE_DEFAULT_DRAFT.toolArgs, summary: '' },
      },
    ],
    [
      'missing start arg',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        toolArgs: { ...VALID_SAFE_DEFAULT_DRAFT.toolArgs, start: '' },
      },
    ],
    [
      'missing end arg',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        toolArgs: { ...VALID_SAFE_DEFAULT_DRAFT.toolArgs, end: '' },
      },
    ],
    [
      'non-object summary field',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: { ...VALID_SAFE_DEFAULT_DRAFT.fields, summary: null },
      },
    ],
    [
      'invalid summary status',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          summary: { ...VALID_SAFE_DEFAULT_DRAFT.fields.summary, status: 'invented' },
        },
      },
    ],
    [
      'ambiguous summary status',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          summary: {
            ...VALID_SAFE_DEFAULT_DRAFT.fields.summary,
            status: 'ambiguous',
            source: 'none',
          },
        },
      },
    ],
    [
      'missing summary value',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          summary: { status: 'missing', source: 'none' },
        },
      },
    ],
    [
      'invalid field source',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          summary: { ...VALID_SAFE_DEFAULT_DRAFT.fields.summary, source: 'invented' },
        },
      },
    ],
    [
      'non-string field value',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          summary: { ...VALID_SAFE_DEFAULT_DRAFT.fields.summary, value: 7 },
        },
      },
    ],
    [
      'non-object start field',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: { ...VALID_SAFE_DEFAULT_DRAFT.fields, start: null },
      },
    ],
    [
      'non-object end field',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: { ...VALID_SAFE_DEFAULT_DRAFT.fields, end: null },
      },
    ],
    [
      'non-object timezone field',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: { ...VALID_SAFE_DEFAULT_DRAFT.fields, timeZone: null },
      },
    ],
    [
      'wrong start provenance',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          start: { ...VALID_SAFE_DEFAULT_DRAFT.fields.start, source: 'runtime' },
        },
      },
    ],
    [
      'wrong start value',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          start: { ...VALID_SAFE_DEFAULT_DRAFT.fields.start, value: '2026-08-18T11:00:00+02:00' },
        },
      },
    ],
    [
      'wrong timezone value',
      {
        ...VALID_SAFE_DEFAULT_DRAFT,
        fields: {
          ...VALID_SAFE_DEFAULT_DRAFT.fields,
          timeZone: { ...VALID_SAFE_DEFAULT_DRAFT.fields.timeZone, value: 'UTC' },
        },
      },
    ],
    ['non-string omitted field', { ...VALID_SAFE_DEFAULT_DRAFT, omittedFields: [7] }],
  ])('rejects malformed persisted calendar draft: %s', (_name, draft) => {
    expect(parseAcceptedCalendarEventDraft(draft)).toBeNull();
  });

  it('accepts persisted drafts with an omitted or explicitly user-confirmed time zone', () => {
    const withoutTimeZone = {
      ...VALID_SAFE_DEFAULT_DRAFT,
      toolArgs: {
        summary: VALID_SAFE_DEFAULT_DRAFT.toolArgs.summary,
        start: VALID_SAFE_DEFAULT_DRAFT.toolArgs.start,
        end: VALID_SAFE_DEFAULT_DRAFT.toolArgs.end,
      },
      fields: {
        ...VALID_SAFE_DEFAULT_DRAFT.fields,
        timeZone: { status: 'missing', source: 'none' },
      },
    };
    const explicitTimeZone = {
      ...VALID_SAFE_DEFAULT_DRAFT,
      fields: {
        ...VALID_SAFE_DEFAULT_DRAFT.fields,
        timeZone: {
          value: 'Europe/Warsaw',
          status: 'user_confirmed',
          source: 'user_message',
        },
      },
    };

    expect(parseAcceptedCalendarEventDraft(withoutTimeZone)).toEqual(withoutTimeZone);
    expect(parseAcceptedCalendarEventDraft(explicitTimeZone)).toEqual(explicitTimeZone);
  });
});
