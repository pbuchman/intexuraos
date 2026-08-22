import { describe, expect, it } from 'vitest';
import {
  MATRIX_CORPUS_MAX_JWS_PAYLOAD_SEGMENT_CODE_UNITS,
  MATRIX_CORPUS_MAX_MOCK_PROFILE_UTF8_BYTES,
  MATRIX_CORPUS_MAX_HEADER_CODE_UNITS,
  MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS,
  MATRIX_CORPUS_SCENARIO_TOTAL,
  MATRIX_CORPUS_PRODUCTION_RUNTIME_AUDIENCE,
  MATRIX_CORPUS_VISIBLE_VERSION,
  canonicalMatrixCorpusCapabilityIssueDigestInputV1,
  canonicalMatrixCorpusControlMutationV1,
  canonicalMatrixCorpusControlRequestDigestInputV1,
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusIngressRequestV1,
  canonicalMatrixCorpusStrictToolMockProfileV1,
  canonicalMatrixCorpusTerminalControlV1,
  matrixCorpusAttestationClaimsV1Schema,
  matrixCorpusAttestedIngestPayloadV1Schema,
  matrixCorpusCapabilityIssueDigestInputV1Schema,
  matrixCorpusCapabilityIssueResponseV1Schema,
  matrixCorpusCapabilityIssueRequestV1Schema,
  matrixCorpusCapabilityTokenSchema,
  matrixCorpusCapabilityV1Schema,
  matrixCorpusCanonicalIngressDigestInputV1Schema,
  matrixCorpusCapabilityConsumeFactsV1Schema,
  matrixCorpusControlMutationV1Schema,
  matrixCorpusControlRequestDigestInputV1Schema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusIngestContextV1Schema,
  matrixCorpusExpectedToolScheduleV1Schema,
  matrixCorpusIanaTimeZoneSchema,
  matrixCorpusParsedIngressFactsV1Schema,
  matrixCorpusPromptDigestInputSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusRuntimeAudienceSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusTransportMessageIdSchema,
  matrixCorpusSha256DigestSchema,
  matrixCorpusSignedIngestV1Schema,
  matrixCorpusSignedControlMutationV1Schema,
  matrixCorpusSignedTerminalControlV1Schema,
  matrixCorpusTerminalControlV1Schema,
  matrixCorpusVisibleConfirmationHeaderV1Schema,
  matrixCorpusVisibleStartHeaderV1Schema,
  matrixCorpusVisibleTurnHeaderV1Schema,
  strictMockResultV1Schema,
  strictToolMockProfileV1Schema,
  type StrictToolMockProfileV1,
} from '../index.js';

describe('Matrix corpus runtime audience', () => {
  it('accepts the production audience while retaining legacy decoding', () => {
    expect(MATRIX_CORPUS_PRODUCTION_RUNTIME_AUDIENCE).toBe('hetzner-prod');
    expect(matrixCorpusRuntimeAudienceSchema.parse('hetzner-prod')).toBe('hetzner-prod');
    expect(matrixCorpusRuntimeAudienceSchema.parse('home-dev')).toBe('home-dev');
    expect(matrixCorpusRuntimeAudienceSchema.safeParse('prod')).toMatchObject({ success: false });
  });
});

const capability = `imc1_${'A'.repeat(42)}A`;
const digest = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const now = '2026-07-19T00:00:00.000Z';
const later = '2026-07-19T00:05:00.000Z';

function createLargeAcceptedProfile(): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: Array.from({ length: 20 }, (_, turnIndex) =>
      Array.from({ length: 10 }, (_, ordinalIndex) => ({
        turnIndex,
        toolName: 'create_note' as const,
        ordinal: ordinalIndex + 1,
        outcome: {
          kind: 'success' as const,
          result: {
            toolName: 'create_note' as const,
            status: 'completed' as const,
            message: 'x'.repeat(1024),
          },
        },
      }))
    ).flat(),
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
}

function createOversizedProfile(): StrictToolMockProfileV1 {
  const events = Array.from({ length: 20 }, (_, index) => ({
    eventId: `mock_event_${String(index)}`,
    summary: 'x'.repeat(256),
    start: now,
    end: later,
    timeZone: 'Europe/Warsaw',
    description: 'x'.repeat(1024),
    status: 'confirmed' as const,
    calendarId: 'mock_calendar_1',
  }));
  return {
    version: 1,
    calls: Array.from({ length: 20 }, (_, turnIndex) => ({
      turnIndex,
      toolName: 'query_calendar_events',
      ordinal: 1,
      outcome: {
        kind: 'success',
        result: {
          toolName: 'query_calendar_events',
          status: 'completed',
          mode: 'list',
          count: events.length,
          events,
        },
      },
    })),
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
}

const profile = {
  version: 1,
  calls: [
    {
      turnIndex: 1,
      toolName: 'create_note',
      ordinal: 1,
      outcome: {
        kind: 'success',
        result: { toolName: 'create_note', status: 'completed', message: 'created' },
      },
    },
  ],
  forbiddenSelections: [],
  unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
} as const;

const turnFacts = {
  version: 1,
  phase: 'turn',
  scenarioNumber: 1,
  scenarioTotal: 20,
  turnIndex: 1,
  turnTotal: 1,
  startNewSession: false,
} as const;

const context = {
  version: 1,
  kind: 'matrix_corpus',
  runtimeAudience: 'home-dev',
  leaseFence: '1',
  ingestReceiptId: 'receipt_1',
  runId: 'run_1',
  scenarioId: 'scenario_1',
  scenarioNumber: 1,
  scenarioLabel: 'Scenario one',
  turnIndex: 0,
  phase: 'turn',
  startNewSession: false,
  promptNormalizationVersion: 1,
  promptDigest: digest,
  expectedSessionId: 'session_1',
  pendingConfirmationId: null,
  expectedDecision: null,
  mockProfile: profile,
  mockProfileDigest: digestB,
  expectedToolSchedule: [{ turnIndex: 1, toolName: 'create_note', ordinal: 1 }],
  currentDateTime: now,
  timeZone: 'Europe/Warsaw',
} as const;

const ordinaryIngest = {
  type: 'intex.message.ingest',
  userId: 'user_1',
  messageId: 'message_1',
  text: 'private natural text',
  sourceType: 'whatsapp_text',
  timestamp: now,
} as const;

const payload = {
  version: 1,
  kind: 'matrix_corpus_ingest_payload',
  ordinaryIngest,
  context,
} as const;

const issueRequest = {
  version: 1,
  runtimeAudience: 'home-dev',
  rawCapability: capability,
  runId: 'run_1',
  leaseFence: '1',
  userId: 'user_1',
  scenarioId: 'scenario_1',
  scenarioNumber: 1,
  scenarioLabel: 'Scenario one',
  matrixRoomBindingDigest: digest,
  whatsappAccountBindingDigest: digestB,
  whatsappSenderBindingDigest: 'c'.repeat(64),
  matrixIdempotencyKeyDigest: 'd'.repeat(64),
  promptNormalizationVersion: 1,
  promptDigest: 'f'.repeat(64),
  phase: 'turn',
  turnIndex: 1,
  expectedSessionId: 'session_1',
  pendingConfirmationId: null,
  expectedDecision: null,
  mockProfile: profile,
  mockProfileDigest: digestB,
  expectedToolSchedule: [{ turnIndex: 1, toolName: 'create_note', ordinal: 1 }],
  currentDateTime: now,
  timeZone: 'Europe/Warsaw',
} as const;

describe('Matrix corpus shared contract', () => {
  it('preserves the reviewed visible-header contract', () => {
    expect(MATRIX_CORPUS_VISIBLE_VERSION).toBe(1);
    expect(MATRIX_CORPUS_SCENARIO_TOTAL).toBe(20);
    expect(MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS).toBe(4096);
    expect(MATRIX_CORPUS_MAX_HEADER_CODE_UNITS).toBe(256);
    expect(
      matrixCorpusVisibleStartHeaderV1Schema.safeParse({
        kind: 'matrix_corpus',
        version: 1,
        phase: 'start',
        scenarioNumber: 1,
        scenarioTotal: 20,
        capability,
        naturalBody: 'body',
        textAfterHeaderRemoval: 'new session: body',
        startNewSession: true,
      }).success
    ).toBe(true);
    expect(
      matrixCorpusVisibleStartHeaderV1Schema.safeParse({
        kind: 'matrix_corpus',
        version: 1,
        phase: 'start',
        scenarioNumber: 1,
        scenarioTotal: 20,
        capability,
        naturalBody: 'new session',
        textAfterHeaderRemoval: 'new session',
        startNewSession: true,
      }).success
    ).toBe(true);
    expect(
      matrixCorpusVisibleTurnHeaderV1Schema.safeParse({
        kind: 'matrix_corpus',
        version: 1,
        phase: 'turn',
        scenarioNumber: 1,
        scenarioTotal: 20,
        turnIndex: 1,
        turnTotal: 1,
        capability,
        naturalBody: 'body',
        textAfterHeaderRemoval: 'body',
        startNewSession: false,
      }).success
    ).toBe(true);
    expect(
      matrixCorpusVisibleConfirmationHeaderV1Schema.safeParse({
        kind: 'matrix_corpus',
        version: 1,
        phase: 'confirmation',
        scenarioNumber: 1,
        scenarioTotal: 20,
        turnIndex: null,
        turnTotal: null,
        capability,
        naturalBody: 'body',
        textAfterHeaderRemoval: 'body',
        startNewSession: false,
      }).success
    ).toBe(true);
  });

  it('accepts only canonical 32-byte bearer tokens and exact digest primitives', () => {
    expect(matrixCorpusCapabilityTokenSchema.safeParse(capability).success).toBe(true);
    for (const invalid of [
      `${capability.slice(0, -1)}B`,
      `${capability}=`,
      `imc2_${'A'.repeat(42)}A`,
      `imc1_${'A'.repeat(41)}A`,
      `imc1_${'A'.repeat(43)}A`,
    ]) {
      expect(matrixCorpusCapabilityTokenSchema.safeParse(invalid).success).toBe(false);
    }
    expect(matrixCorpusSha256DigestSchema.safeParse(digest).success).toBe(true);
    expect(matrixCorpusSha256DigestSchema.safeParse(digest.toUpperCase()).success).toBe(false);
    expect(matrixCorpusDecimalFenceSchema.safeParse('1').success).toBe(true);
    for (const invalid of ['0', '01', '-1', '1'.repeat(21)]) {
      expect(matrixCorpusDecimalFenceSchema.safeParse(invalid).success).toBe(false);
    }
    expect(matrixCorpusSafeIdSchema.safeParse('run_1').success).toBe(true);
    expect(matrixCorpusSafeIdSchema.safeParse('auth0|operator_1').success).toBe(true);
    for (const invalid of ['', 'has space', 'mail@example.com', '🧪']) {
      expect(matrixCorpusSafeIdSchema.safeParse(invalid).success).toBe(false);
    }
    const paddedWamid = `wamid.${'A'.repeat(58)}==`;
    expect(matrixCorpusTransportMessageIdSchema.safeParse(paddedWamid).success).toBe(true);
    for (const invalid of ['wamid.bad=padding', 'wamid.has space', `wamid.${'A'.repeat(250)}==`]) {
      expect(matrixCorpusTransportMessageIdSchema.safeParse(invalid).success).toBe(false);
    }
    expect(matrixCorpusRfc3339TimestampSchema.safeParse(now).success).toBe(true);
    expect(matrixCorpusRfc3339TimestampSchema.safeParse('2026-07-19T00:00:00Z').success).toBe(true);
    expect(matrixCorpusRfc3339TimestampSchema.safeParse('2026-07-19T00:00:00').success).toBe(false);
    expect(
      matrixCorpusRfc3339TimestampSchema.safeParse('2026-07-19T00:00:00.123+23:59').success
    ).toBe(true);
    expect(matrixCorpusRfc3339TimestampSchema.safeParse('2026-07-19T00:00:00.1234Z').success).toBe(
      false
    );
    expect(matrixCorpusRfc3339TimestampSchema.safeParse('2026-07-19T00:00:00+24:00').success).toBe(
      false
    );
    expect(
      matrixCorpusRfc3339TimestampSchema.safeParse(`2026-07-19T00:00:00.${'1'.repeat(100_000)}Z`)
        .success
    ).toBe(false);
    expect(matrixCorpusIanaTimeZoneSchema.safeParse('Europe/Warsaw').success).toBe(true);
    expect(matrixCorpusIanaTimeZoneSchema.safeParse('not/a-zone').success).toBe(false);
    expect(
      matrixCorpusPromptDigestInputSchema.safeParse({ body: 'body', startNewSession: true }).success
    ).toBe(true);
    expect(
      matrixCorpusPromptDigestInputSchema.safeParse({ body: '', startNewSession: true }).success
    ).toBe(false);
  });

  it('has a closed semantic result for each authoritative tool', () => {
    const results = [
      { toolName: 'create_note', status: 'completed', message: 'ok' },
      {
        toolName: 'create_calendar_event',
        status: 'completed',
        eventId: 'mock_event_1',
        summary: 'standup',
      },
      {
        toolName: 'update_calendar_event',
        status: 'completed',
        eventId: 'mock_event_1',
        summary: 'standup',
        attendeesAdded: ['patryk@example.com'],
      },
      {
        toolName: 'update_calendar_event',
        status: 'completed',
        eventId: 'mock_event_2',
        summary: 'all-day cleanup',
        changes: {
          start: { date: '2026-08-22' },
          end: { date: '2026-08-23' },
        },
      },
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        mode: 'count',
        count: 0,
        truncated: false,
      },
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        mode: 'list',
        count: 1,
        truncated: true,
        events: [
          {
            eventId: 'mock_event_1',
            etag: '"mock-event-1-v1"',
            summary: 'standup',
            start: { dateTime: now, timeZone: 'Europe/Warsaw' },
            end: { dateTime: later, timeZone: 'Europe/Warsaw' },
            status: 'confirmed',
            calendarId: 'mock_calendar_1',
          },
        ],
      },
      { toolName: 'create_research', status: 'completed', message: 'ok' },
      {
        toolName: 'create_link',
        status: 'completed',
        bookmarkId: 'mock_bookmark_1',
        resourceUrl: 'https://mock.invalid/bookmark/1',
        title: 'Bookmark',
      },
      { toolName: 'create_code_task', status: 'completed', codeTaskId: 'mock_code_task_1' },
      { toolName: 'save_external', status: 'completed', message: 'ok' },
      {
        toolName: 'get_user_preferences',
        status: 'completed',
        currentVersion: 1,
        items: [{ id: 'mock_pref_1', text: 'quiet mode' }],
      },
      {
        toolName: 'add_user_preference',
        status: 'completed',
        currentVersion: 2,
        changedItemId: 'mock_pref_1',
      },
      {
        toolName: 'update_user_preference',
        status: 'completed',
        currentVersion: 2,
        changedItemId: 'mock_pref_1',
      },
      {
        toolName: 'delete_user_preference',
        status: 'completed',
        currentVersion: 2,
        changedItemId: 'mock_pref_1',
      },
    ];
    for (const result of results)
      expect(strictMockResultV1Schema.safeParse(result).success).toBe(true);
    expect(strictMockResultV1Schema.safeParse({ ...results[0], extra: true }).success).toBe(false);
    expect(
      strictMockResultV1Schema.safeParse({ ...results[6], resourceUrl: 'https://real.example/x' })
        .success
    ).toBe(false);
    expect(
      strictMockResultV1Schema.safeParse({ ...results[1], eventId: 'real_event_1' }).success
    ).toBe(false);
    expect(
      strictMockResultV1Schema.safeParse({ ...results[0], message: 'x'.repeat(1025) }).success
    ).toBe(false);
    expect(
      strictMockResultV1Schema.safeParse({
        ...results[5],
        count: 21,
        events: Array.from({ length: 21 }, () => results[5]?.events?.[0]),
      }).success
    ).toBe(false);
    expect(
      strictMockResultV1Schema.safeParse({
        ...results[10],
        items: Array.from({ length: 51 }, (_, index) => ({
          id: `mock_pref_${String(index)}`,
          text: 'bounded',
        })),
      }).success
    ).toBe(false);
    const updateResult = {
      toolName: 'update_calendar_event',
      status: 'completed',
      eventId: 'mock_event_refinement',
      summary: 'refinement fixture',
    } as const;
    expect(
      strictMockResultV1Schema.safeParse({
        ...updateResult,
        changes: { summary: 'Updated summary' },
      }).success
    ).toBe(true);
    for (const changes of [
      {},
      { start: { date: '2026-08-22' } },
      { end: { date: '2026-08-23' } },
      {
        start: { date: '2026-08-22' },
        end: { dateTime: '2026-08-23T00:00:00Z' },
      },
      {
        start: { date: '2026-08-22' },
        end: { date: '2026-08-22' },
      },
    ]) {
      expect(strictMockResultV1Schema.safeParse({ ...updateResult, changes }).success).toBe(false);
    }
  });

  it('accepts only a bounded unique catalog-owned expected tool schedule', () => {
    expect(
      matrixCorpusExpectedToolScheduleV1Schema.safeParse([
        { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
        { turnIndex: 0, toolName: 'create_note', ordinal: 2 },
      ]).success
    ).toBe(true);
    expect(
      matrixCorpusExpectedToolScheduleV1Schema.safeParse([
        { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
        { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
      ]).success
    ).toBe(false);
    expect(
      matrixCorpusExpectedToolScheduleV1Schema.safeParse([
        { turnIndex: 0, toolName: 'unknown_tool', ordinal: 1 },
      ]).success
    ).toBe(false);
  });

  it('validates all-day calendar event dates and their chronological order', () => {
    const allDayResult = {
      toolName: 'query_calendar_events',
      status: 'completed',
      mode: 'list',
      count: 1,
      events: [
        {
          eventId: 'mock_event_all_day',
          summary: 'All-day event',
          start: { date: '2026-02-28' },
          end: { date: '2026-03-01' },
          calendarId: 'primary',
        },
      ],
    } as const;

    expect(strictMockResultV1Schema.safeParse(allDayResult).success).toBe(true);
    for (const invalidDate of ['2026-02-30', '9999-99-99']) {
      expect(
        strictMockResultV1Schema.safeParse({
          ...allDayResult,
          events: [
            {
              ...allDayResult.events[0],
              start: { date: invalidDate },
            },
          ],
        }).success
      ).toBe(false);
    }
  });

  it('enforces profile ordinals and no forbidden overlap', () => {
    expect(strictToolMockProfileV1Schema.safeParse(profile).success).toBe(true);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        calls: [{ ...profile.calls[0], ordinal: 2 }],
      }).success
    ).toBe(false);
    const queryProfile = {
      ...profile,
      calls: [
        {
          turnIndex: 0,
          toolName: 'query_calendar_events',
          ordinal: 1,
          argumentCatalog: {
            toolName: 'query_calendar_events',
            timeMin: '2026-08-10T00:00:00+02:00',
            timeMax: '2026-08-17T00:00:00+02:00',
            query: 'Photos',
          },
          outcome: {
            kind: 'success',
            result: {
              toolName: 'query_calendar_events',
              status: 'completed',
              mode: 'list',
              count: 0,
              events: [],
            },
          },
        },
      ],
    } as const;
    expect(strictToolMockProfileV1Schema.safeParse(queryProfile).success).toBe(true);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...queryProfile,
        calls: [
          {
            ...queryProfile.calls[0],
            argumentCatalog: { ...queryProfile.calls[0].argumentCatalog, timeMax: 'invalid' },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        calls: [{ ...profile.calls[0], argumentCatalog: queryProfile.calls[0].argumentCatalog }],
      }).success
    ).toBe(false);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        calls: [
          {
            ...profile.calls[0],
            outcome: {
              kind: 'success',
              result: {
                toolName: 'create_research',
                status: 'completed',
                message: 'wrong tool',
              },
            },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        calls: [
          {
            ...profile.calls[0],
            outcome: { kind: 'failure', code: 'MOCK_TOOL_FAILURE' },
          },
        ],
      }).success
    ).toBe(true);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        calls: Array.from({ length: 201 }, () => profile.calls[0]),
      }).success
    ).toBe(false);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        forbiddenSelections: Array.from({ length: 241 }, () => ({
          turnIndex: 0,
          toolName: 'create_note',
        })),
      }).success
    ).toBe(false);
    const largeProfile = createLargeAcceptedProfile();
    expect(new TextEncoder().encode(JSON.stringify(largeProfile)).byteLength).toBeLessThanOrEqual(
      MATRIX_CORPUS_MAX_MOCK_PROFILE_UTF8_BYTES
    );
    expect(strictToolMockProfileV1Schema.safeParse(largeProfile).success).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(createOversizedProfile())).byteLength
    ).toBeGreaterThan(MATRIX_CORPUS_MAX_MOCK_PROFILE_UTF8_BYTES);
    expect(strictToolMockProfileV1Schema.safeParse(createOversizedProfile()).success).toBe(false);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        calls: [profile.calls[0], { ...profile.calls[0], ordinal: 1 }],
      }).success
    ).toBe(false);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        forbiddenSelections: [
          { turnIndex: 1, toolName: 'create_note' },
          { turnIndex: 1, toolName: 'create_note' },
        ],
      }).success
    ).toBe(false);
    expect(
      strictToolMockProfileV1Schema.safeParse({
        ...profile,
        forbiddenSelections: [{ turnIndex: 1, toolName: 'create_note' }],
      }).success
    ).toBe(false);
  });

  it('enforces parsed ingress and context phase correlations', () => {
    expect(matrixCorpusParsedIngressFactsV1Schema.safeParse(turnFacts).success).toBe(true);
    expect(
      matrixCorpusParsedIngressFactsV1Schema.safeParse({ ...turnFacts, turnIndex: 0 }).success
    ).toBe(false);
    expect(
      matrixCorpusParsedIngressFactsV1Schema.safeParse({
        ...turnFacts,
        turnIndex: 20,
        turnTotal: 19,
      }).success
    ).toBe(false);
    expect(matrixCorpusIngestContextV1Schema.safeParse(context).success).toBe(true);
    expect(
      matrixCorpusIngestContextV1Schema.safeParse({ ...context, startNewSession: true }).success
    ).toBe(false);
    expect(
      matrixCorpusIngestContextV1Schema.safeParse({ ...context, expectedSessionId: null }).success
    ).toBe(false);
    expect(
      matrixCorpusIngestContextV1Schema.safeParse({ ...context, timeZone: 'not/a-zone' }).success
    ).toBe(false);
    expect(
      matrixCorpusIngestContextV1Schema.safeParse({
        ...context,
        currentDateTime: '2026-07-19T00:00:00+24:00',
      }).success
    ).toBe(false);

    const startContext = {
      ...context,
      phase: 'start' as const,
      turnIndex: 0,
      startNewSession: true,
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
    };
    expect(matrixCorpusIngestContextV1Schema.safeParse(startContext).success).toBe(true);
    for (const invalid of [
      { ...startContext, expectedSessionId: 'session_1' },
      { ...startContext, pendingConfirmationId: 'confirmation_1' },
      { ...startContext, expectedDecision: 'confirm' as const },
    ]) {
      expect(matrixCorpusIngestContextV1Schema.safeParse(invalid).success).toBe(false);
    }

    const confirmationContext = {
      ...context,
      phase: 'confirmation' as const,
      startNewSession: false,
      expectedSessionId: 'session_1',
      pendingConfirmationId: 'confirmation_1',
      expectedDecision: 'confirm' as const,
    };
    expect(matrixCorpusIngestContextV1Schema.safeParse(confirmationContext).success).toBe(true);
    for (const invalid of [
      { ...confirmationContext, startNewSession: true },
      { ...confirmationContext, expectedSessionId: null },
      { ...confirmationContext, pendingConfirmationId: null },
      { ...confirmationContext, expectedDecision: null },
    ]) {
      expect(matrixCorpusIngestContextV1Schema.safeParse(invalid).success).toBe(false);
    }
  });

  it('keeps ordinary ingress exact and cross-correlated with private context', () => {
    expect(matrixCorpusAttestedIngestPayloadV1Schema.safeParse(payload).success).toBe(true);
    expect(
      matrixCorpusAttestedIngestPayloadV1Schema.safeParse({ ...payload, extra: true }).success
    ).toBe(false);
    expect(
      matrixCorpusAttestedIngestPayloadV1Schema.safeParse({
        ...payload,
        ordinaryIngest: { ...ordinaryIngest, startNewSession: false },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusAttestedIngestPayloadV1Schema.safeParse({
        ...payload,
        context: { ...context, phase: 'start' },
      }).success
    ).toBe(false);
  });

  it('separates issue request, digest input, persistence, and safe issue response material', () => {
    expect(matrixCorpusCapabilityIssueRequestV1Schema.safeParse(issueRequest).success).toBe(true);
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
        ...issueRequest,
        phase: 'start',
        turnIndex: 1,
        expectedSessionId: null,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
        ...issueRequest,
        phase: 'confirmation',
      }).success
    ).toBe(false);

    const startRequest = {
      ...issueRequest,
      phase: 'start' as const,
      turnIndex: 0,
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
    };
    expect(matrixCorpusCapabilityIssueRequestV1Schema.safeParse(startRequest).success).toBe(true);
    for (const invalid of [
      { ...startRequest, expectedSessionId: 'session_1' },
      { ...startRequest, pendingConfirmationId: 'confirmation_1' },
      { ...startRequest, expectedDecision: 'confirm' as const },
    ]) {
      expect(matrixCorpusCapabilityIssueRequestV1Schema.safeParse(invalid).success).toBe(false);
    }

    const confirmationRequest = {
      ...issueRequest,
      phase: 'confirmation' as const,
      expectedSessionId: 'session_1',
      pendingConfirmationId: 'confirmation_1',
      expectedDecision: 'confirm' as const,
    };
    expect(matrixCorpusCapabilityIssueRequestV1Schema.safeParse(confirmationRequest).success).toBe(
      true
    );
    for (const invalid of [
      { ...confirmationRequest, expectedSessionId: null },
      { ...confirmationRequest, pendingConfirmationId: null },
      { ...confirmationRequest, expectedDecision: null },
    ]) {
      expect(matrixCorpusCapabilityIssueRequestV1Schema.safeParse(invalid).success).toBe(false);
    }
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
        ...issueRequest,
        expectedSessionId: null,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
        ...issueRequest,
        pendingConfirmationId: 'confirmation_1',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
        ...issueRequest,
        expectedDecision: 'confirm',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({ ...issueRequest, issuedAt: now })
        .success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
        ...issueRequest,
        expiresAt: later,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
        ...issueRequest,
        issueRequestDigest: 'e'.repeat(64),
      }).success
    ).toBe(false);
    const digestInput = { ...issueRequest, capabilityDigest: digest };
    delete (digestInput as { rawCapability?: string }).rawCapability;
    expect(matrixCorpusCapabilityIssueDigestInputV1Schema.safeParse(digestInput).success).toBe(
      true
    );
    const persisted = {
      ...digestInput,
      issueRequestDigest: 'e'.repeat(64),
      issuedAt: now,
      expiresAt: later,
      consumedAt: null,
      consumedTransportMessageIdDigest: null,
      ingestOutboxId: null,
      revokedAt: null,
    };
    expect(matrixCorpusCapabilityV1Schema.safeParse(persisted).success).toBe(true);
    expect(
      matrixCorpusCapabilityV1Schema.safeParse({
        ...persisted,
        expiresAt: '2026-07-19T00:00:00.001Z',
      }).success
    ).toBe(true);
    expect(matrixCorpusCapabilityV1Schema.safeParse({ ...persisted, expiresAt: now }).success).toBe(
      false
    );
    expect(
      matrixCorpusCapabilityV1Schema.safeParse({
        ...persisted,
        expiresAt: '2026-07-18T23:59:59.999Z',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityV1Schema.safeParse({
        ...persisted,
        expiresAt: '2026-07-19T00:05:00.001Z',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityV1Schema.safeParse({ ...persisted, rawCapability: capability }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityV1Schema.safeParse({ ...persisted, consumedAt: now }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityV1Schema.safeParse({
        ...persisted,
        consumedAt: now,
        consumedTransportMessageIdDigest: digest,
        ingestOutboxId: 'outbox_1',
        revokedAt: now,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueResponseV1Schema.safeParse({
        version: 1,
        runId: issueRequest.runId,
        leaseFence: issueRequest.leaseFence,
        scenarioId: issueRequest.scenarioId,
        phase: issueRequest.phase,
        turnIndex: issueRequest.turnIndex,
        issuedAt: now,
        expiresAt: later,
      }).success
    ).toBe(true);
    expect(
      matrixCorpusCapabilityIssueResponseV1Schema.safeParse({
        version: 1,
        runId: issueRequest.runId,
        leaseFence: issueRequest.leaseFence,
        scenarioId: issueRequest.scenarioId,
        phase: issueRequest.phase,
        turnIndex: issueRequest.turnIndex,
        issuedAt: now,
        expiresAt: later,
        capabilityDigest: digest,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueResponseV1Schema.safeParse({
        version: 1,
        runId: issueRequest.runId,
        leaseFence: issueRequest.leaseFence,
        scenarioId: issueRequest.scenarioId,
        phase: issueRequest.phase,
        turnIndex: issueRequest.turnIndex,
        issuedAt: now,
        expiresAt: now,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityIssueResponseV1Schema.safeParse({
        version: 1,
        runId: issueRequest.runId,
        leaseFence: issueRequest.leaseFence,
        scenarioId: issueRequest.scenarioId,
        phase: 'start',
        turnIndex: 1,
        issuedAt: now,
        expiresAt: later,
      }).success
    ).toBe(false);
  });

  it('covers every ingress fact and rejects mismatched duplicated consume fields', () => {
    const ingress = {
      version: 1,
      capabilityDigest: digest,
      transportMessageIdDigest: digestB,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digestB,
      whatsappSenderBindingDigest: 'c'.repeat(64),
      parsedIngress: turnFacts,
      promptDigest: context.promptDigest,
      expectedSessionId: context.expectedSessionId,
      pendingConfirmationId: null,
      expectedDecision: null,
      ordinaryMessageId: ordinaryIngest.messageId,
      ordinaryTimestamp: ordinaryIngest.timestamp,
      ingestReceiptId: context.ingestReceiptId,
      payloadDigest: digest,
      ingestOutboxId: 'outbox_1',
    };
    expect(matrixCorpusCanonicalIngressDigestInputV1Schema.safeParse(ingress).success).toBe(true);
    const consume = { version: 1, ingressRequest: ingress, ingressRequestDigest: digestB, payload };
    expect(matrixCorpusCapabilityConsumeFactsV1Schema.safeParse(consume).success).toBe(true);
    expect(
      matrixCorpusCapabilityConsumeFactsV1Schema.safeParse({
        ...consume,
        ingressRequest: { ...ingress, ordinaryMessageId: 'message_2' },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityConsumeFactsV1Schema.safeParse({
        ...consume,
        ingressRequest: { ...ingress, promptDigest: 'c'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityConsumeFactsV1Schema.safeParse({
        ...consume,
        ingressRequest: {
          ...ingress,
          parsedIngress: {
            version: 1,
            phase: 'confirmation',
            scenarioNumber: 1,
            scenarioTotal: 20,
            turnIndex: null,
            turnTotal: null,
            startNewSession: false,
          },
        },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCapabilityConsumeFactsV1Schema.safeParse({
        ...consume,
        payload: { ...payload, context: { ...context, turnIndex: 1 } },
      }).success
    ).toBe(false);
  });

  it('binds terminal and signed envelope claims to the exact payload event and fence', () => {
    const terminal = {
      version: 1,
      kind: 'release',
      eventId: 'event_1',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      createdAt: now,
      tombstoneDigest: digest,
      terminalCandidateDigest: digestB,
      artifactStageDigest: 'c'.repeat(64),
    };
    expect(matrixCorpusTerminalControlV1Schema.safeParse(terminal).success).toBe(true);
    expect(
      matrixCorpusTerminalControlV1Schema.safeParse({ ...terminal, kind: 'abandoned' }).success
    ).toBe(false);
    const claims = {
      version: 1,
      kind: 'matrix_corpus_terminal_control',
      issuer: 'whatsapp-service',
      audience: 'intex-agent',
      runtimeAudience: 'home-dev',
      keyVersion: 'key_1',
      eventId: terminal.eventId,
      leaseFence: terminal.leaseFence,
      payloadDigest: digest,
      issuedAt: now,
      expiresAt: later,
      payload: terminal,
    };
    expect(matrixCorpusAttestationClaimsV1Schema.safeParse(claims).success).toBe(true);
    expect(
      matrixCorpusAttestationClaimsV1Schema.safeParse({ ...claims, expiresAt: now }).success
    ).toBe(false);
    expect(
      matrixCorpusAttestationClaimsV1Schema.safeParse({
        ...claims,
        expiresAt: '2026-07-19T00:05:00.001Z',
      }).success
    ).toBe(false);
    const signed = {
      version: 1,
      kind: 'matrix_corpus_terminal_control',
      eventId: terminal.eventId,
      leaseFence: terminal.leaseFence,
      payloadDigest: digest,
      attestation: 'aaa.bbb.ccc',
    };
    expect(matrixCorpusSignedTerminalControlV1Schema.safeParse(signed).success).toBe(true);
    for (const invalidAttestation of ['a.a.a', 'aa=.aa.aa', 'aa.aa+.aa', '.aa.aa', 'aa.aa.aa.aa']) {
      expect(
        matrixCorpusSignedTerminalControlV1Schema.safeParse({
          ...signed,
          attestation: invalidAttestation,
        }).success
      ).toBe(false);
    }
    expect(
      matrixCorpusAttestationClaimsV1Schema.safeParse({ ...claims, eventId: 'event_2' }).success
    ).toBe(false);
    const ingestClaims = {
      ...claims,
      kind: 'matrix_corpus_ingest',
      eventId: context.ingestReceiptId,
      payload,
      payloadDigest: digest,
    };
    expect(matrixCorpusAttestationClaimsV1Schema.safeParse(ingestClaims).success).toBe(true);
    expect(
      matrixCorpusAttestationClaimsV1Schema.safeParse({ ...ingestClaims, expiresAt: now }).success
    ).toBe(false);
    expect(
      matrixCorpusAttestationClaimsV1Schema.safeParse({
        ...ingestClaims,
        eventId: ordinaryIngest.messageId,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusSignedIngestV1Schema.safeParse({
        version: 1,
        kind: 'matrix_corpus_ingest',
        ingestReceiptId: context.ingestReceiptId,
        leaseFence: '1',
        payloadDigest: digest,
        attestation: 'aaa.bbb.ccc',
      }).success
    ).toBe(true);

    const maxProfile = createLargeAcceptedProfile();
    const maxPrecisionTimestamp = '2026-07-19T00:00:00.123+00:00';
    const maxPrecisionExpiry = '2026-07-19T00:05:00.123+00:00';
    const maxPayload = {
      ...payload,
      ordinaryIngest: {
        ...ordinaryIngest,
        text: 'x'.repeat(4096),
        timestamp: maxPrecisionTimestamp,
      },
      context: {
        ...context,
        scenarioLabel: 'x'.repeat(128),
        mockProfile: maxProfile,
        currentDateTime: maxPrecisionTimestamp,
      },
    };
    expect(matrixCorpusAttestedIngestPayloadV1Schema.safeParse(maxPayload).success).toBe(true);
    const maxClaims = {
      ...ingestClaims,
      issuedAt: maxPrecisionTimestamp,
      expiresAt: maxPrecisionExpiry,
      payload: maxPayload,
    };
    expect(matrixCorpusAttestationClaimsV1Schema.safeParse(maxClaims).success).toBe(true);
    const claimsUtf8Length = new TextEncoder().encode(JSON.stringify(maxClaims)).byteLength;
    const payloadSegmentLength = Math.ceil((claimsUtf8Length * 8) / 6);
    expect(payloadSegmentLength).toBeLessThanOrEqual(
      MATRIX_CORPUS_MAX_JWS_PAYLOAD_SEGMENT_CODE_UNITS
    );
    expect(
      matrixCorpusSignedIngestV1Schema.safeParse({
        version: 1,
        kind: 'matrix_corpus_ingest',
        ingestReceiptId: context.ingestReceiptId,
        leaseFence: '1',
        payloadDigest: digest,
        attestation: `aa.${'A'.repeat(payloadSegmentLength)}.aa`,
      }).success
    ).toBe(true);
  });

  it('binds every authority mutation to a signed exact request digest', () => {
    const request = {
      version: 1,
      operation: 'register_context',
      runId: 'run_1',
      request: { userId: 'user_1', leaseFence: '1' },
    };
    expect(matrixCorpusControlRequestDigestInputV1Schema.safeParse(request).success).toBe(true);
    expect(
      matrixCorpusControlRequestDigestInputV1Schema.safeParse({
        ...request,
        request: { payload: 'x'.repeat(1024 * 1024 + 1) },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusControlRequestDigestInputV1Schema.safeParse({
        ...request,
        request: { unsupported: undefined },
      }).success
    ).toBe(false);
    expect(canonicalMatrixCorpusControlRequestDigestInputV1(request)).toBe(
      canonicalMatrixCorpusControlRequestDigestInputV1({
        ...request,
        request: { leaseFence: '1', userId: 'user_1' },
      })
    );
    const control = {
      version: 1,
      kind: 'register_context',
      eventId: 'control_event_1',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      requestDigest: digest,
      createdAt: now,
    };
    expect(matrixCorpusControlMutationV1Schema.safeParse(control).success).toBe(true);
    expect(canonicalMatrixCorpusControlMutationV1(control)).toContain(
      'matrix-corpus-control-mutation-v1'
    );
    const claims = {
      version: 1,
      kind: 'matrix_corpus_control_mutation',
      issuer: 'whatsapp-service',
      audience: 'intex-agent',
      runtimeAudience: 'home-dev',
      keyVersion: 'key_1',
      eventId: control.eventId,
      leaseFence: control.leaseFence,
      payloadDigest: digestB,
      issuedAt: now,
      expiresAt: later,
      payload: control,
    };
    expect(matrixCorpusAttestationClaimsV1Schema.safeParse(claims).success).toBe(true);
    expect(
      matrixCorpusAttestationClaimsV1Schema.safeParse({ ...claims, expiresAt: now }).success
    ).toBe(false);
    expect(
      matrixCorpusAttestationClaimsV1Schema.safeParse({
        ...claims,
        eventId: 'control_event_2',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusSignedControlMutationV1Schema.safeParse({
        version: 1,
        kind: 'matrix_corpus_control_mutation',
        eventId: control.eventId,
        leaseFence: control.leaseFence,
        payloadDigest: digestB,
        attestation: 'aaa.bbb.ccc',
      }).success
    ).toBe(true);
  });

  it('canonicalizes typed inputs with domain separation and no key-order ambiguity', () => {
    const profileCanonical = canonicalMatrixCorpusStrictToolMockProfileV1(profile);
    expect(profileCanonical).toBe(
      canonicalMatrixCorpusStrictToolMockProfileV1({ ...profile, calls: [...profile.calls] })
    );
    const { rawCapability: _rawCapability, ...issueCore } = issueRequest;
    const issueInput = { ...issueCore, capabilityDigest: digest };
    expect(profileCanonical).not.toBe(
      canonicalMatrixCorpusCapabilityIssueDigestInputV1(issueInput)
    );
    const issue = canonicalMatrixCorpusCapabilityIssueDigestInputV1(issueInput);
    expect(issue).toContain('matrix-corpus-capability-issue-digest-v1');
    const semanticInputAtServiceClock = (_serviceClock: string): typeof issueInput => ({
      ...issueInput,
    });
    expect(
      canonicalMatrixCorpusCapabilityIssueDigestInputV1(
        semanticInputAtServiceClock('2026-07-19T00:00:00.000Z')
      )
    ).toBe(
      canonicalMatrixCorpusCapabilityIssueDigestInputV1(
        semanticInputAtServiceClock('2026-07-19T00:04:59.000Z')
      )
    );
    expect(() =>
      canonicalMatrixCorpusCapabilityIssueDigestInputV1({ ...issueInput, issuedAt: now })
    ).toThrow();
    expect(() =>
      canonicalMatrixCorpusCapabilityIssueDigestInputV1({ ...issueInput, expiresAt: later })
    ).toThrow();
    expect(() =>
      canonicalMatrixCorpusCapabilityIssueDigestInputV1({
        ...issueInput,
        issueRequestDigest: 'e'.repeat(64),
      })
    ).toThrow();
    expect(() =>
      canonicalMatrixCorpusStrictToolMockProfileV1({ ...profile, unexpected: true })
    ).toThrow();
    const ingress = {
      version: 1,
      capabilityDigest: digest,
      transportMessageIdDigest: digestB,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digestB,
      whatsappSenderBindingDigest: 'c'.repeat(64),
      parsedIngress: turnFacts,
      promptDigest: context.promptDigest,
      expectedSessionId: context.expectedSessionId,
      pendingConfirmationId: null,
      expectedDecision: null,
      ordinaryMessageId: ordinaryIngest.messageId,
      ordinaryTimestamp: ordinaryIngest.timestamp,
      ingestReceiptId: context.ingestReceiptId,
      payloadDigest: digest,
      ingestOutboxId: 'outbox_1',
    };
    expect(canonicalMatrixCorpusIngressRequestV1(ingress)).not.toBe(
      canonicalMatrixCorpusIngestPayloadV1(payload)
    );
    expect(
      canonicalMatrixCorpusTerminalControlV1({
        version: 1,
        kind: 'abandoned',
        eventId: 'event_1',
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '1',
        createdAt: now,
        tombstoneDigest: null,
        terminalCandidateDigest: null,
        artifactStageDigest: null,
      })
    ).toContain('matrix-corpus-terminal-control-v1');
  });
});
