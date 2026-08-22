import { describe, expect, it } from 'vitest';
import {
  IntexAgentCalendarUpdatePlanningOutputSchema,
  type IntexAgentCalendarUpdatePlanningOutput,
} from '../calendarUpdatePlanningSchemas.js';
import {
  INTEX_AGENT_CALENDAR_UPDATE_PLANNING_RESPONSE_FORMAT,
  IntexAgentCalendarUpdatePlanningProviderOutputSchema,
} from '../structuredOutput.js';

const allMutableChanges = {
  summary: 'Google Photos archive',
  description: null,
  location: null,
  start: { dateTime: '2026-08-22T19:00:00+02:00', timeZone: 'Europe/Warsaw' },
  end: { dateTime: '2026-08-22T20:00:00+02:00', timeZone: 'Europe/Warsaw' },
  attendeesToAdd: ['new@example.com'],
  attendeesToRemove: ['old@example.com'],
};

function updateOperation(index: number): {
  eventId: string;
  eventSummary: string;
  changes: { start: { date: string }; end: { date: string } };
} {
  const day = String(index + 1).padStart(2, '0');
  const nextDay = String(index + 2).padStart(2, '0');
  return {
    eventId: `event-${String(index)}`,
    eventSummary: `Google Photos ${String(index)}`,
    changes: {
      start: { date: `2026-08-${day}` },
      end: { date: `2026-08-${nextDay}` },
    },
  };
}

describe('IntexAgentCalendarUpdatePlanningOutputSchema', () => {
  it('accepts a proposal-only reply without update operations', () => {
    expect(
      IntexAgentCalendarUpdatePlanningOutputSchema.parse({
        outcome: 'proposal_only',
        reply: 'Proponowane daty to 22, 23, 24 i 25 sierpnia.',
      })
    ).toEqual({
      outcome: 'proposal_only',
      reply: 'Proponowane daty to 22, 23, 24 i 25 sierpnia.',
    });
  });

  it('accepts a targeted clarification without update operations', () => {
    expect(
      IntexAgentCalendarUpdatePlanningOutputSchema.parse({
        outcome: 'needs_clarification',
        question: 'Czy mam przenieść wszystkie cztery wydarzenia Google Photos?',
      })
    ).toEqual({
      outcome: 'needs_clarification',
      question: 'Czy mam przenieść wszystkie cztery wydarzenia Google Photos?',
    });
  });

  it('accepts one singular update operation with every mutable change field', () => {
    const output: IntexAgentCalendarUpdatePlanningOutput = {
      outcome: 'updates',
      operations: [
        {
          eventId: 'event-2019',
          eventSummary: 'Google Photos od 04.2019',
          changes: allMutableChanges,
        },
      ],
    };

    expect(IntexAgentCalendarUpdatePlanningOutputSchema.parse(output)).toEqual(output);
  });

  it('accepts only real calendar dates and offset ISO date-times with an IANA time zone', () => {
    const output = {
      outcome: 'updates',
      operations: [
        {
          eventId: 'all-day-event',
          eventSummary: 'Leap day archive',
          changes: {
            start: { date: '2028-02-29', timeZone: 'Europe/Warsaw' },
            end: { date: '2028-03-01', timeZone: 'Europe/Warsaw' },
          },
        },
        {
          eventId: 'timed-event',
          eventSummary: 'Timed archive',
          changes: {
            start: { dateTime: '2026-08-22T19:00:00+02:00', timeZone: 'Europe/Warsaw' },
            end: { dateTime: '2026-08-22T20:00:00+02:00', timeZone: 'Europe/Warsaw' },
          },
        },
      ],
    };

    expect(IntexAgentCalendarUpdatePlanningOutputSchema.parse(output)).toEqual(output);
  });

  it('accepts at most twenty singular update operations with unique event IDs', () => {
    const operations = Array.from({ length: 20 }, (_, index) => updateOperation(index));

    expect(
      IntexAgentCalendarUpdatePlanningOutputSchema.safeParse({ outcome: 'updates', operations })
        .success
    ).toBe(true);
  });

  it('reports the duplicate target at the repeated operation', () => {
    const duplicate = IntexAgentCalendarUpdatePlanningOutputSchema.safeParse({
      outcome: 'updates',
      operations: [updateOperation(0), { ...updateOperation(1), eventId: 'event-0' }],
    });

    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'Each calendar event may appear only once in an update plan',
          path: ['operations', 1, 'eventId'],
        })
      );
    }
  });

  it.each([
    [],
    Array.from({ length: 21 }, (_, index) => updateOperation(index)),
    [updateOperation(0), { ...updateOperation(1), eventId: updateOperation(0).eventId }],
  ])('rejects empty, oversized, or duplicate-target update plans', (operations) => {
    expect(
      IntexAgentCalendarUpdatePlanningOutputSchema.safeParse({ outcome: 'updates', operations })
        .success
    ).toBe(false);
  });

  it.each([
    { eventId: '', eventSummary: 'Google Photos', changes: { summary: 'Archive' } },
    { eventId: 'event-1', eventSummary: '   ', changes: { summary: 'Archive' } },
    { eventId: 'event-1', eventSummary: 'Google Photos', changes: {} },
    {
      eventId: 'event-1',
      eventSummary: 'Google Photos',
      changes: { start: { date: '2026-08-22' } },
    },
    {
      eventId: 'event-1',
      eventSummary: 'Google Photos',
      changes: {
        start: { date: '2026-08-22' },
        end: { dateTime: '2026-08-23T00:00:00+02:00' },
      },
    },
    {
      eventId: 'event-1',
      eventSummary: 'Google Photos',
      changes: { attendeesToAdd: ['not-an-email'] },
    },
  ])('rejects a malformed singular update operation: %j', (operation) => {
    expect(
      IntexAgentCalendarUpdatePlanningOutputSchema.safeParse({
        outcome: 'updates',
        operations: [operation],
      }).success
    ).toBe(false);
  });

  it.each([
    {
      start: {},
      end: { date: '2026-08-23' },
    },
    {
      start: {
        date: '2026-08-22',
        dateTime: '2026-08-22T00:00:00Z',
      },
      end: { date: '2026-08-23' },
    },
    {
      start: { date: '2026-02-29' },
      end: { date: '2026-03-01' },
    },
    {
      start: { date: '2026-8-22' },
      end: { date: '2026-08-23' },
    },
    {
      start: { date: '2026-08-22T00:00:00Z' },
      end: { date: '2026-08-23' },
    },
    {
      start: { dateTime: '2026-08-22T19:00:00' },
      end: { dateTime: '2026-08-22T20:00:00' },
    },
    {
      start: { dateTime: '2026-02-29T19:00:00+02:00' },
      end: { dateTime: '2026-03-01T20:00:00+02:00' },
    },
    {
      start: { dateTime: '2026-08-22T19:00:00+02:00', timeZone: 'Mars/Olympus' },
      end: { dateTime: '2026-08-22T20:00:00+02:00', timeZone: 'Mars/Olympus' },
    },
    {
      start: { dateTime: '2026-08-22T19:00:00+02:00', timeZone: '+02:00' },
      end: { dateTime: '2026-08-22T20:00:00+02:00', timeZone: '+02:00' },
    },
  ])('rejects invalid calendar temporal changes: %j', (changes) => {
    expect(
      IntexAgentCalendarUpdatePlanningOutputSchema.safeParse({
        outcome: 'updates',
        operations: [{ eventId: 'event-1', eventSummary: 'Google Photos', changes }],
      }).success
    ).toBe(false);
  });

  it.each([
    {
      outcome: 'updates',
      operations: [{ ...updateOperation(0), calendarId: 'primary' }],
    },
    {
      outcome: 'updates',
      operations: [
        {
          ...updateOperation(0),
          changes: { ...updateOperation(0).changes, unexpected: true },
        },
      ],
    },
    {
      outcome: 'updates',
      operations: [
        {
          ...updateOperation(0),
          changes: {
            ...updateOperation(0).changes,
            start: { date: '2026-08-22', unexpected: true },
          },
        },
      ],
    },
    { outcome: 'proposal_only', reply: 'Plan.', operations: [updateOperation(0)] },
    { outcome: 'needs_clarification', question: 'Which events?', reply: 'Extra.' },
    { outcome: 'updates', operations: [updateOperation(0)], reply: 'Extra.' },
  ])('rejects fields outside the exact outcome and operation shape: %j', (output) => {
    expect(IntexAgentCalendarUpdatePlanningOutputSchema.safeParse(output).success).toBe(false);
  });

  it.each([
    { outcome: 'proposal_only', reply: '' },
    { outcome: 'needs_clarification', question: '   ' },
    { outcome: 'proposal_only', question: 'Wrong field.' },
    { outcome: 'needs_clarification', reply: 'Wrong field.' },
  ])('rejects missing or blank outcome-specific user text: %j', (output) => {
    expect(IntexAgentCalendarUpdatePlanningOutputSchema.safeParse(output).success).toBe(false);
  });
});

describe('Intex Agent calendar-update planning strict provider output', () => {
  it('exports a provider-compatible strict response format with operation limits', () => {
    expect(INTEX_AGENT_CALENDAR_UPDATE_PLANNING_RESPONSE_FORMAT).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'intex_agent_calendar_update_planning',
        strict: true,
        schema: {
          type: 'object',
          properties: expect.any(Object),
          required: expect.any(Array),
          additionalProperties: false,
        },
      },
    });

    const rootSchema = INTEX_AGENT_CALENDAR_UPDATE_PLANNING_RESPONSE_FORMAT.json_schema.schema;
    const rootProperties = rootSchema['properties'] as Record<string, unknown>;
    expect(rootSchema).not.toHaveProperty('anyOf');
    expect([...(rootSchema['required'] as string[])].sort()).toEqual(
      Object.keys(rootProperties).sort()
    );
    expect(JSON.stringify(rootProperties['operations'])).toContain('"minItems":1');
    expect(JSON.stringify(rootProperties['operations'])).toContain('"maxItems":20');
    expect(JSON.stringify(rootProperties['operations'])).toContain('"additionalProperties":false');
    expect(JSON.stringify(rootProperties['operations'])).toContain('"format":"date"');
    expect(JSON.stringify(rootProperties['operations'])).toContain('"format":"date-time"');
  });

  it('normalizes provider null placeholders before validating an updates outcome', () => {
    const parsed = IntexAgentCalendarUpdatePlanningProviderOutputSchema.safeParse({
      outcome: 'updates',
      reply: null,
      question: null,
      operations: [updateOperation(0)],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ outcome: 'updates', operations: [updateOperation(0)] });
    }
  });

  it('keeps unknown and non-null cross-outcome fields fail-closed', () => {
    expect(
      IntexAgentCalendarUpdatePlanningProviderOutputSchema.safeParse({
        outcome: 'proposal_only',
        reply: 'Plan.',
        question: null,
        operations: null,
        unknown: null,
      }).success
    ).toBe(false);
    expect(
      IntexAgentCalendarUpdatePlanningProviderOutputSchema.safeParse({
        outcome: 'proposal_only',
        reply: 'Plan.',
        question: 'Extra.',
        operations: null,
      }).success
    ).toBe(false);
  });
});
