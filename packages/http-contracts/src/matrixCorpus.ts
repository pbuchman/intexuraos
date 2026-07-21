import { z } from 'zod';

export const MATRIX_CORPUS_VISIBLE_VERSION = 1 as const;
export const MATRIX_CORPUS_SCENARIO_TOTAL = 20 as const;
export const MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS = 4096 as const;
export const MATRIX_CORPUS_MAX_HEADER_CODE_UNITS = 256 as const;
export const MATRIX_CORPUS_MAX_CAPABILITY_TTL_MILLISECONDS = 300_000 as const;
/** Caps the serialized mock schedule before it is embedded in an attested Pub/Sub payload. */
export const MATRIX_CORPUS_MAX_MOCK_PROFILE_UTF8_BYTES = 262_144 as const;
/**
 * 512 KiB covers the 256 KiB profile, maximally escaped bounded text, claims metadata,
 * and base64url expansion while keeping the eventual Pub/Sub message well below 10 MiB.
 */
export const MATRIX_CORPUS_MAX_JWS_PAYLOAD_SEGMENT_CODE_UNITS = 524_288 as const;
export const MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS =
  MATRIX_CORPUS_MAX_JWS_PAYLOAD_SEGMENT_CODE_UNITS + 2_050;

const SHA_256_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/;
const MOCK_ID_PATTERN = /^mock_[A-Za-z0-9_-]{1,120}$/;
const MOCK_PREFERENCE_ID_PATTERN = /^mock_pref_[A-Za-z0-9_-]{1,112}$/;
const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

export const matrixCorpusSha256DigestSchema = z.string().regex(SHA_256_DIGEST_PATTERN);
export const matrixCorpusKeyedDigestSchema = matrixCorpusSha256DigestSchema;
export const matrixCorpusDecimalFenceSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const matrixCorpusSafeIdSchema = z.string().regex(SAFE_ID_PATTERN);
const safeIdSchema = matrixCorpusSafeIdSchema;
const boundedTextSchema = z.string().min(1).max(4096);
const cannedMessageSchema = z.string().min(1).max(1024);
function hasValidRfc3339Offset(value: string): boolean {
  if (value.endsWith('Z')) return true;
  const match = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return hours <= 23 && minutes <= 59;
}

function hasBoundedFractionalSeconds(value: string): boolean {
  const match = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return true;
  return (match[1] as string).length <= 3;
}

export const matrixCorpusRfc3339TimestampSchema = z
  .string()
  .max(29)
  .datetime({ offset: true })
  .refine(hasValidRfc3339Offset, { message: 'Expected an RFC3339 offset within ±23:59' })
  .refine(hasBoundedFractionalSeconds, {
    message: 'RFC3339 fractional seconds must contain at most 3 digits',
  });
const rfc3339Schema = matrixCorpusRfc3339TimestampSchema;

function isCanonicalBase64urlSegment(value: string, maximumLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    value.length % 4 !== 1 &&
    BASE64URL_SEGMENT_PATTERN.test(value)
  );
}

const compactJwsSchema = z
  .string()
  .min(1)
  .max(MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS)
  .superRefine((value, context) => {
    const segments = value.split('.');
    if (segments.length !== 3) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Compact JWS requires 3 segments' });
      return;
    }
    const header = segments[0] as string;
    const payload = segments[1] as string;
    const signature = segments[2] as string;
    if (!isCanonicalBase64urlSegment(header, 1_024))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JWS header segment' });
    if (!isCanonicalBase64urlSegment(payload, MATRIX_CORPUS_MAX_JWS_PAYLOAD_SEGMENT_CODE_UNITS))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JWS payload segment' });
    if (!isCanonicalBase64urlSegment(signature, 1_024))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JWS signature segment' });
  });

function isIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const matrixCorpusIanaTimeZoneSchema = z.string().min(1).max(128).refine(isIanaTimeZone, {
  message: 'Expected an IANA time zone',
});
const ianaTimeZoneSchema = matrixCorpusIanaTimeZoneSchema;

function hasPositiveBoundedTtl(issuedAt: string, expiresAt: string): boolean {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  return expires > issued && expires - issued <= MATRIX_CORPUS_MAX_CAPABILITY_TTL_MILLISECONDS;
}

/** Exactly 32 bytes in canonical unpadded base64url, prefixed by the V1 capability tag. */
export const matrixCorpusCapabilityTokenSchema = z
  .string()
  .regex(/^imc1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

export const matrixCorpusPromptDigestInputSchema = z
  .object({ body: boundedTextSchema, startNewSession: z.boolean() })
  .strict();

function scenarioFraction(scenarioNumber: number): string {
  return `${String(scenarioNumber).padStart(3, '0')}/020`;
}

function hasLegalVisibleSourceLength(header: string, naturalBody: string): boolean {
  return header.length + 2 + naturalBody.length <= MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS;
}

const matrixCorpusHeaderBaseSchema = z
  .object({
    kind: z.literal('matrix_corpus'),
    version: z.literal(MATRIX_CORPUS_VISIBLE_VERSION),
    scenarioNumber: z.number().int().min(1).max(MATRIX_CORPUS_SCENARIO_TOTAL),
    scenarioTotal: z.literal(MATRIX_CORPUS_SCENARIO_TOTAL),
    capability: matrixCorpusCapabilityTokenSchema,
    naturalBody: z.string().min(1).max(MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS),
    textAfterHeaderRemoval: z.string().min(1).max(MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS),
  })
  .strict();

export const matrixCorpusVisibleStartHeaderV1Schema = matrixCorpusHeaderBaseSchema
  .extend({ phase: z.literal('start'), startNewSession: z.literal(true) })
  .refine(
    (value) =>
      value.textAfterHeaderRemoval === `new session: ${value.naturalBody}` &&
      hasLegalVisibleSourceLength(
        `new session: 🧪 Scenario ${scenarioFraction(value.scenarioNumber)} · Matrix corpus · tools mocked · ${value.capability}`,
        value.naturalBody
      )
  );

export const matrixCorpusVisibleTurnHeaderV1Schema = matrixCorpusHeaderBaseSchema
  .extend({
    phase: z.literal('turn'),
    turnIndex: z.number().int().min(1).max(MATRIX_CORPUS_SCENARIO_TOTAL),
    turnTotal: z.number().int().min(1).max(MATRIX_CORPUS_SCENARIO_TOTAL),
    startNewSession: z.literal(false),
  })
  .refine(
    (value) =>
      value.turnIndex <= value.turnTotal &&
      value.textAfterHeaderRemoval === value.naturalBody &&
      hasLegalVisibleSourceLength(
        `🧪 Scenario ${scenarioFraction(value.scenarioNumber)} · step ${String(value.turnIndex)}/${String(value.turnTotal)} · ${value.capability}`,
        value.naturalBody
      )
  );

export const matrixCorpusVisibleConfirmationHeaderV1Schema = matrixCorpusHeaderBaseSchema
  .extend({
    phase: z.literal('confirmation'),
    turnIndex: z.null(),
    turnTotal: z.null(),
    startNewSession: z.literal(false),
  })
  .refine(
    (value) =>
      value.textAfterHeaderRemoval === value.naturalBody &&
      hasLegalVisibleSourceLength(
        `🧪 Scenario ${scenarioFraction(value.scenarioNumber)} · confirmation · ${value.capability}`,
        value.naturalBody
      )
  );

export type MatrixCorpusVisiblePhase = 'start' | 'turn' | 'confirmation';
export type MatrixCorpusReservedHeaderReason =
  | 'malformed_header'
  | 'message_too_large'
  | 'header_too_large'
  | 'empty_body';
export type MatrixCorpusVisibleHeaderV1 =
  | z.infer<typeof matrixCorpusVisibleStartHeaderV1Schema>
  | z.infer<typeof matrixCorpusVisibleTurnHeaderV1Schema>
  | z.infer<typeof matrixCorpusVisibleConfirmationHeaderV1Schema>;
export type MatrixCorpusVisibleMessageParseResult =
  | { kind: 'ordinary' }
  | MatrixCorpusVisibleHeaderV1
  | { kind: 'reserved_malformed'; reason: MatrixCorpusReservedHeaderReason };

export const intexAgentToolNameV1Schema = z.enum([
  'create_note',
  'create_calendar_event',
  'query_calendar_events',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'get_user_preferences',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);
export type IntexAgentToolNameV1 = z.infer<typeof intexAgentToolNameV1Schema>;

const syntheticIdSchema = z.string().regex(MOCK_ID_PATTERN);
const mockUrlSchema = z.string().regex(/^https:\/\/mock\.invalid\/[A-Za-z0-9_/-]{1,180}$/);
const calendarEventSchema = z
  .object({
    eventId: syntheticIdSchema,
    summary: z.string().min(1).max(256),
    start: rfc3339Schema,
    end: rfc3339Schema,
    timeZone: ianaTimeZoneSchema,
    location: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(1024).optional(),
    status: z.enum(['confirmed', 'tentative', 'cancelled']),
    calendarId: syntheticIdSchema,
  })
  .strict()
  .refine((event) => Date.parse(event.end) > Date.parse(event.start), {
    message: 'Calendar event end must follow start',
  });

export const strictMockResultV1Schema = z.union([
  z
    .object({
      toolName: z.literal('create_note'),
      status: z.literal('completed'),
      message: cannedMessageSchema,
    })
    .strict(),
  z
    .object({
      toolName: z.literal('create_calendar_event'),
      status: z.literal('completed'),
      eventId: syntheticIdSchema,
      summary: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      toolName: z.literal('query_calendar_events'),
      status: z.literal('completed'),
      mode: z.literal('count'),
      count: z.number().int().min(0).max(20),
    })
    .strict(),
  z
    .object({
      toolName: z.literal('query_calendar_events'),
      status: z.literal('completed'),
      mode: z.literal('list'),
      count: z.number().int().min(0).max(20),
      events: z.array(calendarEventSchema).max(20),
    })
    .strict()
    .refine((result) => result.count === result.events.length, {
      message: 'Calendar count must equal list length',
    }),
  z
    .object({
      toolName: z.literal('create_research'),
      status: z.literal('completed'),
      message: cannedMessageSchema,
    })
    .strict(),
  z
    .object({
      toolName: z.literal('create_link'),
      status: z.literal('completed'),
      bookmarkId: syntheticIdSchema,
      resourceUrl: mockUrlSchema,
      title: z.string().min(1).max(256).optional(),
    })
    .strict(),
  z
    .object({
      toolName: z.literal('create_code_task'),
      status: z.literal('completed'),
      codeTaskId: syntheticIdSchema,
    })
    .strict(),
  z
    .object({
      toolName: z.literal('save_external'),
      status: z.literal('completed'),
      message: cannedMessageSchema,
    })
    .strict(),
  z
    .object({
      toolName: z.literal('get_user_preferences'),
      status: z.literal('completed'),
      currentVersion: z.number().int().min(0).max(1_000_000),
      items: z
        .array(
          z
            .object({
              id: z.string().regex(MOCK_PREFERENCE_ID_PATTERN),
              text: z.string().min(1).max(512),
            })
            .strict()
        )
        .max(50),
    })
    .strict(),
  z
    .object({
      toolName: z.literal('add_user_preference'),
      status: z.literal('completed'),
      currentVersion: z.number().int().min(1).max(1_000_000),
      changedItemId: z.string().regex(MOCK_PREFERENCE_ID_PATTERN),
    })
    .strict(),
  z
    .object({
      toolName: z.literal('update_user_preference'),
      status: z.literal('completed'),
      currentVersion: z.number().int().min(1).max(1_000_000),
      changedItemId: z.string().regex(MOCK_PREFERENCE_ID_PATTERN),
    })
    .strict(),
  z
    .object({
      toolName: z.literal('delete_user_preference'),
      status: z.literal('completed'),
      currentVersion: z.number().int().min(1).max(1_000_000),
      changedItemId: z.string().regex(MOCK_PREFERENCE_ID_PATTERN),
    })
    .strict(),
]);
export type StrictMockResultV1 = z.infer<typeof strictMockResultV1Schema>;

const strictMockCallSchema = z
  .object({
    turnIndex: z.number().int().min(0).max(19),
    toolName: intexAgentToolNameV1Schema,
    ordinal: z.number().int().min(1).max(20),
    outcome: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('success'), result: strictMockResultV1Schema }).strict(),
      z.object({ kind: z.literal('failure'), code: z.literal('MOCK_TOOL_FAILURE') }).strict(),
    ]),
  })
  .strict();
const forbiddenSelectionSchema = z
  .object({ turnIndex: z.number().int().min(0).max(19), toolName: intexAgentToolNameV1Schema })
  .strict();

export const strictToolMockProfileV1Schema = z
  .object({
    version: z.literal(1),
    calls: z.array(strictMockCallSchema).max(200),
    forbiddenSelections: z.array(forbiddenSelectionSchema).max(220),
    unexpectedKnownToolPolicy: z.literal('behavioral_failure_no_execution'),
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(profile)).byteLength >
      MATRIX_CORPUS_MAX_MOCK_PROFILE_UTF8_BYTES
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Serialized mock profile exceeds the 256 KiB attestation budget',
      });
    }
    const ordinalsByToolAndTurn = new Map<string, number[]>();
    const scheduled = new Set<string>();
    for (const call of profile.calls) {
      const key = `${String(call.turnIndex)}:${call.toolName}`;
      const ordinals = ordinalsByToolAndTurn.get(key) ?? [];
      ordinals.push(call.ordinal);
      ordinalsByToolAndTurn.set(key, ordinals);
      if (call.outcome.kind === 'success' && call.outcome.result.toolName !== call.toolName) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Mock result tool mismatch' });
      }
    }
    for (const [key, ordinals] of ordinalsByToolAndTurn) {
      const unique = new Set(ordinals);
      if (
        unique.size !== ordinals.length ||
        [...unique]
          .sort((left, right) => left - right)
          .some((ordinal, index) => ordinal !== index + 1)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Mock ordinals must be contiguous for ${key}`,
        });
      }
      scheduled.add(key);
    }
    const forbidden = new Set<string>();
    for (const selection of profile.forbiddenSelections) {
      const key = `${String(selection.turnIndex)}:${selection.toolName}`;
      if (forbidden.has(key))
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate forbidden selection' });
      if (scheduled.has(key))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Scheduled and forbidden selection overlap',
        });
      forbidden.add(key);
    }
  });
export type StrictToolMockProfileV1 = z.infer<typeof strictToolMockProfileV1Schema>;

export const matrixCorpusExpectedToolScheduleV1Schema = z
  .array(
    z
      .object({
        turnIndex: z.number().int().min(0).max(19),
        toolName: intexAgentToolNameV1Schema,
        ordinal: z.number().int().min(1).max(20),
      })
      .strict()
  )
  .max(200)
  .superRefine((schedule, context) => {
    const keys = schedule.map(
      ({ turnIndex, toolName, ordinal }) => `${String(turnIndex)}:${toolName}:${String(ordinal)}`
    );
    if (new Set(keys).size !== keys.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate expected tool call' });
  });
export type MatrixCorpusExpectedToolScheduleV1 = z.infer<
  typeof matrixCorpusExpectedToolScheduleV1Schema
>;

export const matrixCorpusParsedIngressFactsV1Schema = z.union([
  z
    .object({
      version: z.literal(1),
      phase: z.literal('start'),
      scenarioNumber: z.number().int().min(1).max(20),
      scenarioTotal: z.literal(20),
      turnIndex: z.null(),
      turnTotal: z.null(),
      startNewSession: z.literal(true),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      phase: z.literal('turn'),
      scenarioNumber: z.number().int().min(1).max(20),
      scenarioTotal: z.literal(20),
      turnIndex: z.number().int().min(1).max(20),
      turnTotal: z.number().int().min(1).max(20),
      startNewSession: z.literal(false),
    })
    .strict()
    .refine((value) => value.turnIndex <= value.turnTotal, {
      message: 'Turn index must not exceed turn total',
    }),
  z
    .object({
      version: z.literal(1),
      phase: z.literal('confirmation'),
      scenarioNumber: z.number().int().min(1).max(20),
      scenarioTotal: z.literal(20),
      turnIndex: z.null(),
      turnTotal: z.null(),
      startNewSession: z.literal(false),
    })
    .strict(),
]);
export type MatrixCorpusParsedIngressFactsV1 = z.infer<
  typeof matrixCorpusParsedIngressFactsV1Schema
>;

const phaseCorrelation = (
  value: {
    phase: MatrixCorpusVisiblePhase;
    turnIndex: number;
    startNewSession: boolean;
    expectedSessionId: string | null;
    pendingConfirmationId: string | null;
    expectedDecision: 'confirm' | 'reject' | null;
  },
  context: z.RefinementCtx
): void => {
  if (
    value.phase === 'start' &&
    (value.turnIndex !== 0 ||
      !value.startNewSession ||
      value.expectedSessionId !== null ||
      value.pendingConfirmationId !== null ||
      value.expectedDecision !== null)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Start phase correlation mismatch' });
  }
  if (
    value.phase === 'turn' &&
    (value.startNewSession ||
      value.expectedSessionId === null ||
      value.pendingConfirmationId !== null ||
      value.expectedDecision !== null)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Turn phase correlation mismatch' });
  }
  if (
    value.phase === 'confirmation' &&
    (value.startNewSession ||
      value.expectedSessionId === null ||
      value.pendingConfirmationId === null ||
      value.expectedDecision === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Confirmation phase correlation mismatch',
    });
  }
};

const ingestContextShape = {
  version: z.literal(1),
  kind: z.literal('matrix_corpus'),
  runtimeAudience: z.literal('home-dev'),
  leaseFence: matrixCorpusDecimalFenceSchema,
  ingestReceiptId: safeIdSchema,
  runId: safeIdSchema,
  scenarioId: safeIdSchema,
  scenarioNumber: z.number().int().min(1).max(20),
  scenarioLabel: z.string().min(1).max(128),
  turnIndex: z.number().int().min(0).max(19),
  phase: z.enum(['start', 'turn', 'confirmation']),
  startNewSession: z.boolean(),
  promptNormalizationVersion: z.literal(1),
  promptDigest: matrixCorpusSha256DigestSchema,
  expectedSessionId: safeIdSchema.nullable(),
  pendingConfirmationId: safeIdSchema.nullable(),
  expectedDecision: z.enum(['confirm', 'reject']).nullable(),
  mockProfile: strictToolMockProfileV1Schema,
  mockProfileDigest: matrixCorpusSha256DigestSchema,
  expectedToolSchedule: matrixCorpusExpectedToolScheduleV1Schema,
  currentDateTime: rfc3339Schema,
  timeZone: ianaTimeZoneSchema,
} as const;

export const matrixCorpusIngestContextV1Schema = z
  .object(ingestContextShape)
  .strict()
  .superRefine(phaseCorrelation);
export type MatrixCorpusIngestContextV1 = z.infer<typeof matrixCorpusIngestContextV1Schema>;

export const matrixCorpusOrdinaryIngestV1Schema = z
  .object({
    type: z.literal('intex.message.ingest'),
    userId: safeIdSchema,
    messageId: safeIdSchema,
    text: boundedTextSchema,
    sourceType: z.literal('whatsapp_text'),
    timestamp: rfc3339Schema,
  })
  .strict();
export type MatrixCorpusOrdinaryIngestV1 = z.infer<typeof matrixCorpusOrdinaryIngestV1Schema>;

export const matrixCorpusAttestedIngestPayloadV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('matrix_corpus_ingest_payload'),
    ordinaryIngest: matrixCorpusOrdinaryIngestV1Schema,
    context: matrixCorpusIngestContextV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.context.phase === 'start') !== value.context.startNewSession) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Payload start-session correlation mismatch',
      });
    }
  });
export type MatrixCorpusAttestedIngestPayloadV1 = z.infer<
  typeof matrixCorpusAttestedIngestPayloadV1Schema
>;

const capabilityIssueSemanticShape = {
  version: z.literal(1),
  runtimeAudience: z.literal('home-dev'),
  runId: safeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  userId: safeIdSchema,
  scenarioId: safeIdSchema,
  scenarioNumber: z.number().int().min(1).max(20),
  scenarioLabel: z.string().min(1).max(128),
  matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
  whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
  whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
  matrixIdempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
  promptNormalizationVersion: z.literal(1),
  promptDigest: matrixCorpusSha256DigestSchema,
  phase: z.enum(['start', 'turn', 'confirmation']),
  turnIndex: z.number().int().min(0).max(19),
  expectedSessionId: safeIdSchema.nullable(),
  pendingConfirmationId: safeIdSchema.nullable(),
  expectedDecision: z.enum(['confirm', 'reject']).nullable(),
  mockProfile: strictToolMockProfileV1Schema,
  mockProfileDigest: matrixCorpusSha256DigestSchema,
  expectedToolSchedule: matrixCorpusExpectedToolScheduleV1Schema,
  currentDateTime: rfc3339Schema,
  timeZone: ianaTimeZoneSchema,
} as const;

const capabilityIssueSemanticRefinements = (
  value: z.infer<z.ZodObject<typeof capabilityIssueSemanticShape>>,
  context: z.RefinementCtx
): void => {
  if (
    value.phase === 'start' &&
    (value.turnIndex !== 0 ||
      value.expectedSessionId !== null ||
      value.pendingConfirmationId !== null ||
      value.expectedDecision !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Start capability correlation mismatch',
    });
  }
  if (
    value.phase === 'turn' &&
    (value.expectedSessionId === null ||
      value.pendingConfirmationId !== null ||
      value.expectedDecision !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Turn capability correlation mismatch',
    });
  }
  if (
    value.phase === 'confirmation' &&
    (value.expectedSessionId === null ||
      value.pendingConfirmationId === null ||
      value.expectedDecision === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Confirmation capability correlation mismatch',
    });
  }
};

export const matrixCorpusCapabilityIssueRequestV1Schema = z
  .object({ ...capabilityIssueSemanticShape, rawCapability: matrixCorpusCapabilityTokenSchema })
  .strict()
  .superRefine(capabilityIssueSemanticRefinements);
export type MatrixCorpusCapabilityIssueRequestV1 = z.infer<
  typeof matrixCorpusCapabilityIssueRequestV1Schema
>;
export const matrixCorpusCapabilityIssueDigestInputV1Schema = z
  .object({ ...capabilityIssueSemanticShape, capabilityDigest: matrixCorpusKeyedDigestSchema })
  .strict()
  .superRefine(capabilityIssueSemanticRefinements);
export type MatrixCorpusCapabilityIssueDigestInputV1 = z.infer<
  typeof matrixCorpusCapabilityIssueDigestInputV1Schema
>;

export const matrixCorpusCapabilityV1Schema = z
  .object({
    ...capabilityIssueSemanticShape,
    capabilityDigest: matrixCorpusKeyedDigestSchema,
    issueRequestDigest: matrixCorpusKeyedDigestSchema,
    issuedAt: rfc3339Schema,
    expiresAt: rfc3339Schema,
    consumedAt: rfc3339Schema.nullable(),
    consumedTransportMessageIdDigest: matrixCorpusKeyedDigestSchema.nullable(),
    ingestOutboxId: safeIdSchema.nullable(),
    revokedAt: rfc3339Schema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    capabilityIssueSemanticRefinements(value, context);
    if (!hasPositiveBoundedTtl(value.issuedAt, value.expiresAt))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Capability TTL must be positive and at most 300 seconds',
      });
    const consumption = [
      value.consumedAt,
      value.consumedTransportMessageIdDigest,
      value.ingestOutboxId,
    ];
    const consumed = consumption.every((item) => item !== null);
    const unconsumed = consumption.every((item) => item === null);
    if (!consumed && !unconsumed)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Consumption fields must be all null or all present',
      });
    if (value.revokedAt !== null && !unconsumed)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Revoked capability must be unconsumed',
      });
  });
export type MatrixCorpusCapabilityV1 = z.infer<typeof matrixCorpusCapabilityV1Schema>;

export const matrixCorpusCapabilityIssueResponseV1Schema = z
  .object({
    version: z.literal(1),
    runId: safeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    scenarioId: safeIdSchema,
    phase: z.enum(['start', 'turn', 'confirmation']),
    turnIndex: z.number().int().min(0).max(19),
    issuedAt: rfc3339Schema,
    expiresAt: rfc3339Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasPositiveBoundedTtl(value.issuedAt, value.expiresAt))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Capability TTL must be positive and at most 300 seconds',
      });
    if (value.phase === 'start' && value.turnIndex !== 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Start capability response requires turn index zero',
      });
  });
export type MatrixCorpusCapabilityIssueResponseV1 = z.infer<
  typeof matrixCorpusCapabilityIssueResponseV1Schema
>;

export const matrixCorpusCanonicalIngressDigestInputV1Schema = z
  .object({
    version: z.literal(1),
    capabilityDigest: matrixCorpusKeyedDigestSchema,
    transportMessageIdDigest: matrixCorpusKeyedDigestSchema,
    userId: safeIdSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
    parsedIngress: matrixCorpusParsedIngressFactsV1Schema,
    promptDigest: matrixCorpusSha256DigestSchema,
    expectedSessionId: safeIdSchema.nullable(),
    pendingConfirmationId: safeIdSchema.nullable(),
    expectedDecision: z.enum(['confirm', 'reject']).nullable(),
    ordinaryMessageId: safeIdSchema,
    ordinaryTimestamp: rfc3339Schema,
    ingestReceiptId: safeIdSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    ingestOutboxId: safeIdSchema,
  })
  .strict();
export type MatrixCorpusCanonicalIngressDigestInputV1 = z.infer<
  typeof matrixCorpusCanonicalIngressDigestInputV1Schema
>;

export const matrixCorpusCapabilityConsumeFactsV1Schema = z
  .object({
    version: z.literal(1),
    ingressRequest: matrixCorpusCanonicalIngressDigestInputV1Schema,
    ingressRequestDigest: matrixCorpusSha256DigestSchema,
    payload: matrixCorpusAttestedIngestPayloadV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const { ingressRequest, payload } = value;
    const { context: ingestContext, ordinaryIngest } = payload;
    if (
      ingressRequest.userId !== ordinaryIngest.userId ||
      ingressRequest.ordinaryMessageId !== ordinaryIngest.messageId ||
      ingressRequest.ordinaryTimestamp !== ordinaryIngest.timestamp ||
      ingressRequest.ingestReceiptId !== ingestContext.ingestReceiptId
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ordinary ingress identity mismatch',
      });
    if (
      ingressRequest.promptDigest !== ingestContext.promptDigest ||
      ingressRequest.expectedSessionId !== ingestContext.expectedSessionId ||
      ingressRequest.pendingConfirmationId !== ingestContext.pendingConfirmationId ||
      ingressRequest.expectedDecision !== ingestContext.expectedDecision
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ingress context binding mismatch',
      });
    const parsed = ingressRequest.parsedIngress;
    if (
      parsed.phase !== ingestContext.phase ||
      parsed.scenarioNumber !== ingestContext.scenarioNumber ||
      parsed.startNewSession !== ingestContext.startNewSession
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Ingress phase mismatch' });
    if (parsed.phase === 'turn' && ingestContext.turnIndex !== parsed.turnIndex - 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Turn index must convert visible one-based index to capability zero-based index',
      });
  });
export type MatrixCorpusCapabilityConsumeFactsV1 = z.infer<
  typeof matrixCorpusCapabilityConsumeFactsV1Schema
>;

const terminalBaseShape = {
  version: z.literal(1),
  eventId: safeIdSchema,
  runId: safeIdSchema,
  userId: safeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  createdAt: rfc3339Schema,
} as const;
export const matrixCorpusTerminalControlV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      ...terminalBaseShape,
      kind: z.literal('release'),
      tombstoneDigest: matrixCorpusSha256DigestSchema,
      terminalCandidateDigest: matrixCorpusSha256DigestSchema,
      artifactStageDigest: matrixCorpusSha256DigestSchema,
    })
    .strict(),
  z
    .object({
      ...terminalBaseShape,
      kind: z.literal('abandoned'),
      tombstoneDigest: z.null(),
      terminalCandidateDigest: z.null(),
      artifactStageDigest: z.null(),
    })
    .strict(),
]);
export type MatrixCorpusTerminalControlV1 = z.infer<typeof matrixCorpusTerminalControlV1Schema>;

export const matrixCorpusControlMutationOperationV1Schema = z.enum([
  'register_context',
  'finalize_run',
  'create_projection',
  'advance_projection',
]);
export const matrixCorpusControlRequestDigestInputV1Schema = z
  .object({
    version: z.literal(1),
    operation: matrixCorpusControlMutationOperationV1Schema,
    runId: safeIdSchema,
    request: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((value, context) => {
    let canonical: string;
    try {
      canonical = canonicalizeJson(value.request);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Control mutation request must be JSON',
      });
      return;
    }
    if (Buffer.byteLength(canonical, 'utf8') > 1024 * 1024)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Control mutation request exceeds one MiB',
      });
  });
export type MatrixCorpusControlRequestDigestInputV1 = z.infer<
  typeof matrixCorpusControlRequestDigestInputV1Schema
>;

export const matrixCorpusControlMutationV1Schema = z
  .object({
    version: z.literal(1),
    kind: matrixCorpusControlMutationOperationV1Schema,
    eventId: safeIdSchema,
    runId: safeIdSchema,
    userId: safeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    requestDigest: matrixCorpusSha256DigestSchema,
    createdAt: rfc3339Schema,
  })
  .strict();
export type MatrixCorpusControlMutationV1 = z.infer<typeof matrixCorpusControlMutationV1Schema>;

const attestationCoreShape = {
  version: z.literal(1),
  issuer: z.literal('whatsapp-service'),
  audience: z.literal('intex-agent'),
  runtimeAudience: z.literal('home-dev'),
  keyVersion: safeIdSchema,
  eventId: safeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  payloadDigest: matrixCorpusSha256DigestSchema,
  issuedAt: rfc3339Schema,
  expiresAt: rfc3339Schema,
} as const;
export const matrixCorpusAttestationClaimsV1Schema = z.union([
  z
    .object({
      ...attestationCoreShape,
      kind: z.literal('matrix_corpus_ingest'),
      payload: matrixCorpusAttestedIngestPayloadV1Schema,
    })
    .strict()
    .superRefine((value, context) => {
      if (!hasPositiveBoundedTtl(value.issuedAt, value.expiresAt))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Attestation TTL must be positive and at most 300 seconds',
        });
      if (
        value.eventId !== value.payload.context.ingestReceiptId ||
        value.leaseFence !== value.payload.context.leaseFence
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Ingest claim identity mismatch',
        });
    }),
  z
    .object({
      ...attestationCoreShape,
      kind: z.literal('matrix_corpus_terminal_control'),
      payload: matrixCorpusTerminalControlV1Schema,
    })
    .strict()
    .superRefine((value, context) => {
      if (!hasPositiveBoundedTtl(value.issuedAt, value.expiresAt))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Attestation TTL must be positive and at most 300 seconds',
        });
      if (value.eventId !== value.payload.eventId || value.leaseFence !== value.payload.leaseFence)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Terminal claim identity mismatch',
        });
    }),
  z
    .object({
      ...attestationCoreShape,
      kind: z.literal('matrix_corpus_control_mutation'),
      payload: matrixCorpusControlMutationV1Schema,
    })
    .strict()
    .superRefine((value, context) => {
      if (!hasPositiveBoundedTtl(value.issuedAt, value.expiresAt))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Attestation TTL must be positive and at most 300 seconds',
        });
      if (value.eventId !== value.payload.eventId || value.leaseFence !== value.payload.leaseFence)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Control mutation claim identity mismatch',
        });
    }),
]);
export type MatrixCorpusAttestationClaimsV1 = z.infer<typeof matrixCorpusAttestationClaimsV1Schema>;

export const matrixCorpusSignedIngestV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('matrix_corpus_ingest'),
    ingestReceiptId: safeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    attestation: compactJwsSchema,
  })
  .strict();
export type MatrixCorpusSignedIngestV1 = z.infer<typeof matrixCorpusSignedIngestV1Schema>;
export const matrixCorpusSignedTerminalControlV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('matrix_corpus_terminal_control'),
    eventId: safeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    attestation: compactJwsSchema,
  })
  .strict();
export type MatrixCorpusSignedTerminalControlV1 = z.infer<
  typeof matrixCorpusSignedTerminalControlV1Schema
>;
export const matrixCorpusSignedControlMutationV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('matrix_corpus_control_mutation'),
    eventId: safeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    attestation: compactJwsSchema,
  })
  .strict();
export type MatrixCorpusSignedControlMutationV1 = z.infer<
  typeof matrixCorpusSignedControlMutationV1Schema
>;

function canonicalizeJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical input must be JSON');
}

function canonicalInput(domain: string, value: unknown): string {
  return canonicalizeJson({ domain, version: 1, value });
}

export function canonicalMatrixCorpusStrictToolMockProfileV1(input: unknown): string {
  return canonicalInput(
    'matrix-corpus-strict-tool-mock-profile-v1',
    strictToolMockProfileV1Schema.parse(input)
  );
}
export function canonicalMatrixCorpusCapabilityIssueDigestInputV1(input: unknown): string {
  return canonicalInput(
    'matrix-corpus-capability-issue-digest-v1',
    matrixCorpusCapabilityIssueDigestInputV1Schema.parse(input)
  );
}
export function canonicalMatrixCorpusIngressRequestV1(input: unknown): string {
  return canonicalInput(
    'matrix-corpus-ingress-request-v1',
    matrixCorpusCanonicalIngressDigestInputV1Schema.parse(input)
  );
}
export function canonicalMatrixCorpusIngestPayloadV1(input: unknown): string {
  return canonicalInput(
    'matrix-corpus-ingest-payload-v1',
    matrixCorpusAttestedIngestPayloadV1Schema.parse(input)
  );
}
export function canonicalMatrixCorpusTerminalControlV1(input: unknown): string {
  return canonicalInput(
    'matrix-corpus-terminal-control-v1',
    matrixCorpusTerminalControlV1Schema.parse(input)
  );
}
export function canonicalMatrixCorpusControlMutationV1(input: unknown): string {
  return canonicalInput(
    'matrix-corpus-control-mutation-v1',
    matrixCorpusControlMutationV1Schema.parse(input)
  );
}
export function canonicalMatrixCorpusControlRequestDigestInputV1(input: unknown): string {
  return canonicalInput(
    'matrix-corpus-control-request-digest-v1',
    matrixCorpusControlRequestDigestInputV1Schema.parse(input)
  );
}
