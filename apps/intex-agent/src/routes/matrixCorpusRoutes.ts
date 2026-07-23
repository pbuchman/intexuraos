import { createHash } from 'node:crypto';

import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import {
  canonicalMatrixCorpusControlRequestDigestInputV1,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSha256DigestSchema,
  matrixCorpusSignedTerminalControlV1Schema,
  matrixCorpusSignedControlMutationV1Schema,
} from '@intexuraos/http-contracts';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { MatrixCorpusAttestationVerificationResult } from '../domain/matrixCorpus/attestation.js';
import type { MatrixCorpusContextService } from '../domain/matrixCorpus/contextService.js';
import type { MatrixCorpusContextRepository } from '../domain/matrixCorpus/ports/matrixCorpusContextRepository.js';
import type { MatrixCorpusManifestRepository } from '../domain/matrixCorpus/ports/matrixCorpusManifestRepository.js';
import type { MatrixCorpusEvidenceService } from '../domain/matrixCorpus/evidenceService.js';
import type { MatrixCorpusSessionRepository } from '../domain/ports/sessionRepository.js';
import type { TestRunRepository } from '../domain/testRuns/ports/testRunRepository.js';
import { digestMatrixCorpusFinalizationProjection } from '../domain/testRuns/projectionDigest.js';
import { TEST_RUN_RETENTION_QUERY_LIMIT } from '../domain/testRuns/retention.js';
import {
  intexAgentTestRunRecordV1Schema,
  matrixCorpusTerminalCandidateV1Schema,
  testRunProjectionCasCommandV1Schema,
  type TestRunProjectionCasCommandV1,
} from '../domain/testRuns/types.js';

const contextRegistrationSchema = z
  .object({
    runtimeAudience: z.literal('hetzner-prod'),
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    catalogDigest: matrixCorpusSha256DigestSchema,
    agentModel: z.literal('or:deepseek/deepseek-v4-flash'),
    evaluatorModel: z.literal('or:minimax/minimax-m3'),
    expectedTimeZone: z.literal('Europe/Warsaw'),
  })
  .strict();
const contextIdentitySchema = z
  .object({
    runtimeAudience: z.literal('hetzner-prod'),
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
  })
  .strict();
const projectionRequestSchema = z.union([
  z
    .object({ kind: z.literal('create'), record: intexAgentTestRunRecordV1Schema })
    .strict(),
  z
    .object({
      kind: z.literal('cas'),
      userId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      command: testRunProjectionCasCommandV1Schema,
    })
    .strict(),
]);
const authorizedContextRegistrationSchema = z
  .object({
    authorization: matrixCorpusSignedControlMutationV1Schema,
    request: contextRegistrationSchema,
  })
  .strict();
const authorizedContextFinalizationSchema = z
  .object({
    authorization: matrixCorpusSignedControlMutationV1Schema,
    request: contextIdentitySchema.extend({
      expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      artifactStageDigest: matrixCorpusSha256DigestSchema,
      terminalCandidate: matrixCorpusTerminalCandidateV1Schema,
    }),
  })
  .strict();
const authorizedProjectionSchema = z
  .object({
    authorization: matrixCorpusSignedControlMutationV1Schema,
    request: projectionRequestSchema,
  })
  .strict();
const artifactDeliveryCommandSchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    next: z.union([
      z
        .object({
          status: z.literal('staged'),
          jsonCandidateDigest: matrixCorpusSha256DigestSchema,
          markdownCandidateDigest: matrixCorpusSha256DigestSchema,
        })
        .strict(),
      z
        .object({
          status: z.literal('failed'),
          failureCode: z.enum(['REPORT_STAGING_FAILED', 'REPORT_VALIDATION_FAILED']),
        })
        .strict(),
      z
        .object({
          status: z.literal('failed'),
          failureCode: z.literal('REPORT_PUBLICATION_FAILED'),
          terminalControlEventId: matrixCorpusSafeIdSchema,
        })
        .strict(),
      z
        .object({
          status: z.literal('ready'),
          terminalControlEventId: matrixCorpusSafeIdSchema,
        })
        .strict(),
    ]),
    updatedAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict();
const cleanupRequestSchema = z
  .object({
    targetRunId: matrixCorpusSafeIdSchema,
    targetLeaseFence: matrixCorpusDecimalFenceSchema,
    updatedAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict();

const safeIdJsonSchema = {
  type: 'string',
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$',
} as const;
const MATRIX_CORPUS_REQUEST_LOG_OPTIONS = {
  message: 'Received protected Matrix corpus request',
  bodyPreviewLength: 0,
  includeHeaders: false,
  includeParams: false,
} as const;
const fenceJsonSchema = { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } as const;
const digestJsonSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const timestampJsonSchema = { type: 'string', format: 'date-time', maxLength: 29 } as const;
const safeIntegerJsonSchema = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const verdictJsonSchema = {
  type: 'string',
  enum: ['pending', 'passed', 'failed', 'not_evaluated'],
} as const;
const scenarioLifecycleJsonSchema = {
  type: 'string',
  enum: ['pending', 'not_run', 'running', 'completed', 'stopped'],
} as const;
const toolNameJsonSchema = {
  type: 'string',
  enum: [
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
  ],
} as const;
const runParamsJsonSchema = closedJsonObject(['runId'], ['runId'], {
  runId: safeIdJsonSchema,
});
const internalHeadersJsonSchema = {
  type: 'object',
  required: ['x-internal-auth'],
  properties: { 'x-internal-auth': { type: 'string', minLength: 1, maxLength: 512 } },
} as const;
const controlAuthorizationJsonSchema = closedJsonObject(
  ['version', 'kind', 'eventId', 'leaseFence', 'payloadDigest', 'attestation'],
  ['version', 'kind', 'eventId', 'leaseFence', 'payloadDigest', 'attestation'],
  {
    version: { type: 'integer', enum: [1] },
    kind: { type: 'string', enum: ['matrix_corpus_control_mutation'] },
    eventId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    payloadDigest: digestJsonSchema,
    attestation: { type: 'string', minLength: 1, maxLength: 32_768 },
  }
);
const contextIdentityJsonProperties = {
  runtimeAudience: { type: 'string', enum: ['hetzner-prod'] },
  userId: safeIdJsonSchema,
  leaseFence: fenceJsonSchema,
} as const;
const currentAcceptanceBodyJsonSchema = closedJsonObject(
  ['runtimeAudience', 'userId'],
  ['runtimeAudience', 'userId'],
  {
    runtimeAudience: { type: 'string', enum: ['hetzner-prod'] },
    userId: safeIdJsonSchema,
  }
);
const contextRegistrationRequestJsonSchema = closedJsonObject(
  [
    'runtimeAudience',
    'userId',
    'leaseFence',
    'catalogDigest',
    'agentModel',
    'evaluatorModel',
    'expectedTimeZone',
  ],
  [
    'runtimeAudience',
    'userId',
    'leaseFence',
    'catalogDigest',
    'agentModel',
    'evaluatorModel',
    'expectedTimeZone',
  ],
  {
    ...contextIdentityJsonProperties,
    catalogDigest: digestJsonSchema,
    agentModel: { type: 'string', enum: ['or:deepseek/deepseek-v4-flash'] },
    evaluatorModel: { type: 'string', enum: ['or:minimax/minimax-m3'] },
    expectedTimeZone: { type: 'string', enum: ['Europe/Warsaw'] },
  }
);
const terminalCandidateJsonSchema = closedJsonObject(
  [
    'version',
    'runId',
    'userId',
    'leaseFence',
    'outcome',
    'projectionDigest',
    'artifactStageRevision',
    'artifactCandidateDigest',
    'createdAt',
  ],
  [
    'version',
    'runId',
    'userId',
    'leaseFence',
    'outcome',
    'projectionDigest',
    'artifactStageRevision',
    'artifactCandidateDigest',
    'createdAt',
  ],
  {
    version: { type: 'integer', enum: [1] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    outcome: {
      type: 'string',
      enum: ['completed_passed', 'completed_failed', 'stopped_not_evaluated'],
    },
    projectionDigest: digestJsonSchema,
    artifactStageRevision: { type: 'integer', minimum: 1 },
    artifactCandidateDigest: digestJsonSchema,
    createdAt: timestampJsonSchema,
  }
);
const artifactDeliveryJsonSchema = {
  oneOf: [
    ...(['pending', 'staged', 'ready'] as const).map((status) =>
      closedJsonObject(['status', 'failureCode', 'updatedAt'], ['status', 'failureCode', 'updatedAt'], {
        status: { type: 'string', enum: [status] },
        failureCode: { type: 'null' },
        updatedAt: timestampJsonSchema,
      })
    ),
    closedJsonObject(
      ['status', 'failureCode', 'updatedAt'],
      ['status', 'failureCode', 'updatedAt'],
      {
        status: { type: 'string', enum: ['failed'] },
        failureCode: {
          type: 'string',
          enum: [
            'REPORT_STAGING_INTERRUPTED',
            'REPORT_STAGING_FAILED',
            'REPORT_VALIDATION_FAILED',
            'REPORT_PUBLICATION_FAILED',
          ],
        },
        updatedAt: timestampJsonSchema,
      }
    ),
    closedJsonObject(
      ['status', 'failureCode', 'updatedAt'],
      ['status', 'failureCode', 'updatedAt'],
      {
        status: { type: 'string', enum: ['unknown'] },
        failureCode: { type: 'string', enum: ['REPORT_DELIVERY_STATUS_TIMEOUT'] },
        updatedAt: timestampJsonSchema,
      }
    ),
  ],
} as const;
const terminalWinnerJsonSchema = {
  oneOf: [
    closedJsonObject(
      ['kind', 'eventId', 'payloadDigest', 'outcome', 'acknowledgedAt'],
      ['kind', 'eventId', 'payloadDigest', 'outcome', 'acknowledgedAt'],
      {
        kind: { type: 'string', enum: ['release'] },
        eventId: safeIdJsonSchema,
        payloadDigest: digestJsonSchema,
        outcome: {
          type: 'string',
          enum: ['completed_passed', 'completed_failed', 'stopped_not_evaluated'],
        },
        acknowledgedAt: timestampJsonSchema,
      }
    ),
    closedJsonObject(
      ['kind', 'eventId', 'payloadDigest', 'outcome', 'acknowledgedAt'],
      ['kind', 'eventId', 'payloadDigest', 'outcome', 'acknowledgedAt'],
      {
        kind: { type: 'string', enum: ['abandoned'] },
        eventId: safeIdJsonSchema,
        payloadDigest: digestJsonSchema,
        outcome: {
          type: 'string',
          enum: ['stopped_not_evaluated', 'provisioning_noop', 'provisioning_rolled_back'],
        },
        acknowledgedAt: timestampJsonSchema,
      }
    ),
  ],
} as const;
const scenarioSummaryJsonProperties = {
  scenarioId: safeIdJsonSchema,
  scenarioNumber: { type: 'integer', minimum: 1, maximum: 20 },
  scenarioLabel: { type: 'string', minLength: 1, maxLength: 256 },
  scenarioRevision: safeIntegerJsonSchema,
  lifecycle: scenarioLifecycleJsonSchema,
  verdict: verdictJsonSchema,
  plannedTurns: { ...safeIntegerJsonSchema, maximum: 20 },
  completedTurns: { ...safeIntegerJsonSchema, maximum: 20 },
  expectedReplies: { ...safeIntegerJsonSchema, maximum: 100 },
  completedReplies: { ...safeIntegerJsonSchema, maximum: 100 },
  selectedTools: { type: 'array', maxItems: 11, uniqueItems: true, items: toolNameJsonSchema },
  deterministicVerdict: verdictJsonSchema,
  semanticVerdict: verdictJsonSchema,
  startedAt: nullableJsonSchema(timestampJsonSchema),
  finishedAt: nullableJsonSchema(timestampJsonSchema),
  durationMs: nullableJsonSchema(safeIntegerJsonSchema),
} as const;
const scenarioSummaryFields = [
  'scenarioId',
  'scenarioNumber',
  'scenarioLabel',
  'scenarioRevision',
  'lifecycle',
  'verdict',
  'plannedTurns',
  'completedTurns',
  'expectedReplies',
  'completedReplies',
  'selectedTools',
  'deterministicVerdict',
  'semanticVerdict',
  'startedAt',
  'finishedAt',
  'durationMs',
] as const;
const scenarioSummaryJsonSchema = closedJsonObject(
  scenarioSummaryFields,
  scenarioSummaryFields,
  scenarioSummaryJsonProperties
);
const scenarioFoundationFields = [
  ...scenarioSummaryFields,
  'eventWatermark',
  'sessionId',
  'sessionBindingDigest',
] as const;
const scenarioFoundationJsonSchema = closedJsonObject(
  scenarioFoundationFields,
  scenarioFoundationFields,
  {
    ...scenarioSummaryJsonProperties,
    eventWatermark: safeIntegerJsonSchema,
    sessionId: nullableJsonSchema(safeIdJsonSchema),
    sessionBindingDigest: nullableJsonSchema(digestJsonSchema),
  }
);
const totalsJsonSchema = closedJsonObject(
  [
    'scenarios',
    'turns',
    'replies',
    'tools',
    'evaluations',
  ],
  [
    'scenarios',
    'turns',
    'replies',
    'tools',
    'evaluations',
  ],
  {
    scenarios: closedJsonObject(
      ['planned', 'started', 'running', 'completed', 'passed', 'failed', 'notRun'],
      ['planned', 'started', 'running', 'completed', 'passed', 'failed', 'notRun'],
      {
        planned: { ...safeIntegerJsonSchema, maximum: 20 },
        started: { ...safeIntegerJsonSchema, maximum: 20 },
        running: { type: 'integer', enum: [0, 1] },
        completed: { ...safeIntegerJsonSchema, maximum: 20 },
        passed: { ...safeIntegerJsonSchema, maximum: 20 },
        failed: { ...safeIntegerJsonSchema, maximum: 20 },
        notRun: { ...safeIntegerJsonSchema, maximum: 20 },
      }
    ),
    turns: closedJsonObject(['planned', 'completed'], ['planned', 'completed'], {
      planned: safeIntegerJsonSchema,
      completed: safeIntegerJsonSchema,
    }),
    replies: closedJsonObject(
      ['expected', 'observed', 'judged'],
      ['expected', 'observed', 'judged'],
      { expected: safeIntegerJsonSchema, observed: safeIntegerJsonSchema, judged: safeIntegerJsonSchema }
    ),
    tools: closedJsonObject(
      ['selected', 'mockCompleted', 'mockFailed', 'unexpectedKnown'],
      ['selected', 'mockCompleted', 'mockFailed', 'unexpectedKnown'],
      {
        selected: safeIntegerJsonSchema,
        mockCompleted: safeIntegerJsonSchema,
        mockFailed: safeIntegerJsonSchema,
        unexpectedKnown: safeIntegerJsonSchema,
      }
    ),
    evaluations: closedJsonObject(
      ['deterministicPassed', 'deterministicFailed', 'minimaxPassed', 'minimaxFailed', 'pending'],
      ['deterministicPassed', 'deterministicFailed', 'minimaxPassed', 'minimaxFailed', 'pending'],
      {
        deterministicPassed: safeIntegerJsonSchema,
        deterministicFailed: safeIntegerJsonSchema,
        minimaxPassed: safeIntegerJsonSchema,
        minimaxFailed: safeIntegerJsonSchema,
        pending: safeIntegerJsonSchema,
      }
    ),
  }
);
const costJsonSchema = closedJsonObject(
  ['agentNanoUsd', 'evaluatorNanoUsd', 'totalNanoUsd'],
  ['agentNanoUsd', 'evaluatorNanoUsd', 'totalNanoUsd'],
  {
    agentNanoUsd: nullableJsonSchema(safeIntegerJsonSchema),
    evaluatorNanoUsd: nullableJsonSchema(safeIntegerJsonSchema),
    totalNanoUsd: nullableJsonSchema(safeIntegerJsonSchema),
  }
);
const testRunRecordJsonSchema = closedJsonObject(
  [
    'schemaVersion',
    'runId',
    'userId',
    'leaseFence',
    'revision',
    'corpusId',
    'corpusVersion',
    'catalogDigest',
    'runtimeAudience',
    'transport',
    'executionMode',
    'lifecycle',
    'verdict',
    'artifactDelivery',
    'agentModel',
    'evaluatorModel',
    'startedAt',
    'updatedAt',
    'finishedAt',
    'currentScenarioNumber',
    'totals',
    'cost',
    'retentionReconciled',
    'contextFinalizationTombstoneDigest',
    'artifactStageDigest',
    'terminalCandidate',
    'terminalWinner',
    'scenarios',
  ],
  [
    'schemaVersion',
    'runId',
    'userId',
    'leaseFence',
    'revision',
    'corpusId',
    'corpusVersion',
    'catalogDigest',
    'runtimeAudience',
    'transport',
    'executionMode',
    'lifecycle',
    'verdict',
    'artifactDelivery',
    'agentModel',
    'evaluatorModel',
    'startedAt',
    'updatedAt',
    'finishedAt',
    'currentScenarioNumber',
    'totals',
    'cost',
    'retentionReconciled',
    'contextFinalizationTombstoneDigest',
    'artifactStageDigest',
    'terminalCandidate',
    'terminalWinner',
    'scenarios',
  ],
  {
    schemaVersion: { type: 'integer', enum: [1] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    corpusId: safeIdJsonSchema,
    corpusVersion: { type: 'string', minLength: 1, maxLength: 64 },
    catalogDigest: digestJsonSchema,
    runtimeAudience: { type: 'string', enum: ['hetzner-prod'] },
    transport: { type: 'string', enum: ['matrix_whatsapp'] },
    executionMode: { type: 'string', enum: ['strict_mock_tools'] },
    lifecycle: {
      type: 'string',
      enum: ['preflight', 'running', 'finalizing', 'completed', 'stopped'],
    },
    verdict: { type: 'string', enum: ['pending', 'passed', 'failed', 'not_evaluated'] },
    artifactDelivery: artifactDeliveryJsonSchema,
    agentModel: { type: 'string', enum: ['or:deepseek/deepseek-v4-flash'] },
    evaluatorModel: { type: 'string', enum: ['or:minimax/minimax-m3'] },
    startedAt: timestampJsonSchema,
    updatedAt: timestampJsonSchema,
    finishedAt: nullableJsonSchema(timestampJsonSchema),
    currentScenarioNumber: nullableJsonSchema({ type: 'integer', minimum: 1, maximum: 20 }),
    totals: totalsJsonSchema,
    cost: costJsonSchema,
    retentionReconciled: { type: 'boolean' },
    contextFinalizationTombstoneDigest: nullableJsonSchema(digestJsonSchema),
    artifactStageDigest: nullableJsonSchema(digestJsonSchema),
    terminalCandidate: nullableJsonSchema(terminalCandidateJsonSchema),
    terminalWinner: nullableJsonSchema(terminalWinnerJsonSchema),
    scenarios: { type: 'array', minItems: 20, maxItems: 20, items: scenarioFoundationJsonSchema },
  }
);
const testRunSafeToolFactJsonSchema = closedJsonObject(['name', 'value'], ['name', 'value'], {
  name: {
    type: 'string',
    enum: [
      'contentLength', 'titleLength', 'summaryLength', 'promptLength', 'queryLength',
      'originalMessageLength', 'locationLength', 'descriptionLength', 'messageLength',
      'textLength', 'tagsCount', 'sourceMessageIdsCount', 'attendeesCount', 'resultCount',
      'maxResults', 'expectedVersion', 'currentVersion', 'hasUrl', 'hasSourceUrl',
      'hasCalendarId', 'hasItemId', 'hasLinearIssueId', 'startMatchesCatalog',
      'endMatchesCatalog', 'timeZoneMatchesCatalog', 'mode', 'workerType', 'taskMode',
    ],
  },
  value: {
    oneOf: [
      safeIntegerJsonSchema,
      { type: 'boolean' },
      {
        type: 'string',
        enum: ['list', 'count', 'codex', 'codex-xhigh', 'minimax', 'planning', 'execution'],
      },
    ],
  },
});
const testRunSafeToolEvidenceJsonSchema = closedJsonObject(
  ['event', 'toolName', 'turnIndex', 'ordinal', 'facts'],
  ['event', 'toolName', 'turnIndex', 'ordinal', 'facts'],
  {
    event: {
      type: 'string',
      enum: ['selected', 'mock_completed', 'mock_failed', 'unexpected_known_no_execution'],
    },
    toolName: toolNameJsonSchema,
    turnIndex: { ...safeIntegerJsonSchema, maximum: 19 },
    ordinal: { type: 'integer', minimum: 1, maximum: 20 },
    facts: { type: 'array', maxItems: 16, items: testRunSafeToolFactJsonSchema },
  }
);
const testRunSafeExpectedToolFactJsonSchema = closedJsonObject(
  ['name', 'operator', 'value'],
  ['name', 'operator', 'value'],
  {
    name: {
      type: 'string',
      enum: [
        'contentLength', 'titleLength', 'summaryLength', 'promptLength', 'queryLength',
        'originalMessageLength', 'locationLength', 'descriptionLength', 'messageLength',
        'textLength', 'tagsCount', 'sourceMessageIdsCount', 'attendeesCount', 'resultCount',
        'maxResults', 'expectedVersion', 'currentVersion', 'hasUrl', 'hasSourceUrl',
        'hasCalendarId', 'hasItemId', 'hasLinearIssueId', 'startMatchesCatalog',
        'endMatchesCatalog', 'timeZoneMatchesCatalog', 'mode', 'workerType', 'taskMode',
      ],
    },
    operator: { type: 'string', enum: ['exists', 'absent', 'equals'] },
    value: {
      oneOf: [
        { type: 'null' },
        safeIntegerJsonSchema,
        { type: 'boolean' },
        {
          type: 'string',
          enum: ['list', 'count', 'codex', 'codex-xhigh', 'minimax', 'planning', 'execution'],
        },
      ],
    },
  }
);
const testRunSafeDeterministicEvidenceJsonSchema = closedJsonObject(
  [
    'expectedToolName', 'actualToolName', 'expectedTurnIndex', 'actualTurnIndex',
    'expectedCount', 'actualCount', 'expectedTransition', 'actualTransition',
    'expectedFacts', 'actualFacts',
  ],
  [
    'expectedToolName', 'actualToolName', 'expectedTurnIndex', 'actualTurnIndex',
    'expectedCount', 'actualCount', 'expectedTransition', 'actualTransition',
    'expectedFacts', 'actualFacts',
  ],
  {
    expectedToolName: nullableJsonSchema(toolNameJsonSchema),
    actualToolName: nullableJsonSchema(toolNameJsonSchema),
    expectedTurnIndex: nullableJsonSchema({ ...safeIntegerJsonSchema, maximum: 19 }),
    actualTurnIndex: nullableJsonSchema({ ...safeIntegerJsonSchema, maximum: 19 }),
    expectedCount: nullableJsonSchema({ ...safeIntegerJsonSchema, maximum: 20 }),
    actualCount: nullableJsonSchema({ ...safeIntegerJsonSchema, maximum: 20 }),
    expectedTransition: nullableJsonSchema({
      type: 'string',
      enum: ['created', 'continued', 'superseded', 'completed', 'failed'],
    }),
    actualTransition: nullableJsonSchema({
      type: 'string',
      enum: ['created', 'continued', 'superseded', 'completed', 'failed'],
    }),
    expectedFacts: {
      type: 'array',
      maxItems: 16,
      items: testRunSafeExpectedToolFactJsonSchema,
    },
    actualFacts: { type: 'array', maxItems: 16, items: testRunSafeToolFactJsonSchema },
  }
);
const safeDeterministicCheckJsonSchema = closedJsonObject(
  ['code', 'status', 'turnIndex', 'replyIndex', 'evidence'],
  ['code', 'status', 'turnIndex', 'replyIndex', 'evidence'],
  {
    code: {
      type: 'string',
      enum: [
        'reply_count', 'tool_name', 'tool_count', 'tool_turn', 'tool_fact',
        'session_transition', 'lifecycle_event', 'user_message_count',
        'agent_usage_count', 'transport', 'reply_format',
      ],
    },
    status: { type: 'string', enum: ['pending', 'passed', 'failed'] },
    turnIndex: nullableJsonSchema({ ...safeIntegerJsonSchema, maximum: 19 }),
    replyIndex: nullableJsonSchema({ type: 'integer', minimum: 1, maximum: 100 }),
    evidence: testRunSafeDeterministicEvidenceJsonSchema,
  }
);
const safeUsageJsonSchema = closedJsonObject(
  ['logicalCalls', 'repairCount', 'inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  ['logicalCalls', 'repairCount', 'inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  {
    logicalCalls: { type: 'integer', enum: [1] },
    repairCount: { type: 'integer', enum: [0, 1] },
    inputTokens: safeIntegerJsonSchema,
    outputTokens: safeIntegerJsonSchema,
    totalTokens: safeIntegerJsonSchema,
    costNanoUsd: safeIntegerJsonSchema,
  }
);
const minimaxCriteriaFields = [
  'understoodIntent', 'helpful', 'conciseAndClear', 'professionalTone', 'noPassiveAggression',
] as const;
const minimaxCriteriaJsonSchema = closedJsonObject(
  minimaxCriteriaFields,
  minimaxCriteriaFields,
  Object.fromEntries(minimaxCriteriaFields.map((field) => [field, { type: 'boolean' }]))
);
const safeReplyEvaluationJsonSchema = closedJsonObject(
  ['turnIndex', 'replyIndex', 'verdict', 'score', 'criteria', 'failureCodes', 'latencyMs', 'usage'],
  ['turnIndex', 'replyIndex', 'verdict', 'score', 'criteria', 'failureCodes', 'latencyMs', 'usage'],
  {
    turnIndex: { ...safeIntegerJsonSchema, maximum: 19 },
    replyIndex: { type: 'integer', minimum: 1, maximum: 100 },
    verdict: { type: 'string', enum: ['passed', 'failed'] },
    score: { type: 'integer', minimum: 1, maximum: 5 },
    criteria: minimaxCriteriaJsonSchema,
    failureCodes: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', enum: minimaxCriteriaFields },
    },
    latencyMs: safeIntegerJsonSchema,
    usage: safeUsageJsonSchema,
  }
);
const testRunSafeAgentUsageJsonSchema = closedJsonObject(
  ['turnIndex', 'stage', 'callOrdinal', 'inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  ['turnIndex', 'stage', 'callOrdinal', 'inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  {
    turnIndex: { ...safeIntegerJsonSchema, maximum: 19 },
    stage: {
      type: 'string',
      enum: ['intent_classification', 'agent_generation', 'response_schema_repair'],
    },
    callOrdinal: { type: 'integer', minimum: 1, maximum: 3 },
    inputTokens: safeIntegerJsonSchema,
    outputTokens: safeIntegerJsonSchema,
    totalTokens: safeIntegerJsonSchema,
    costNanoUsd: safeIntegerJsonSchema,
  }
);
const scenarioProjectionJsonSchema = closedJsonObject(
  [
    'schemaVersion', 'runId', 'userId', 'sessionId', 'sessionBindingDigest', 'scenarioId',
    'scenarioNumber', 'scenarioLabel', 'runRevision', 'scenarioRevision', 'eventWatermark',
    'lifecycle', 'verdict', 'plannedTurns', 'completedTurns', 'toolEvidence',
    'deterministicChecks', 'replyEvaluations', 'agentUsage',
  ],
  [
    'schemaVersion', 'runId', 'userId', 'sessionId', 'sessionBindingDigest', 'scenarioId',
    'scenarioNumber', 'scenarioLabel', 'runRevision', 'scenarioRevision', 'eventWatermark',
    'lifecycle', 'verdict', 'plannedTurns', 'completedTurns', 'toolEvidence',
    'deterministicChecks', 'replyEvaluations', 'agentUsage',
  ],
  {
    schemaVersion: { type: 'integer', enum: [1] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    sessionId: safeIdJsonSchema,
    sessionBindingDigest: digestJsonSchema,
    scenarioId: safeIdJsonSchema,
    scenarioNumber: { type: 'integer', minimum: 1, maximum: 20 },
    scenarioLabel: { type: 'string', minLength: 1, maxLength: 256 },
    runRevision: safeIntegerJsonSchema,
    scenarioRevision: safeIntegerJsonSchema,
    eventWatermark: safeIntegerJsonSchema,
    lifecycle: scenarioLifecycleJsonSchema,
    verdict: verdictJsonSchema,
    plannedTurns: { ...safeIntegerJsonSchema, maximum: 20 },
    completedTurns: { ...safeIntegerJsonSchema, maximum: 20 },
    toolEvidence: { type: 'array', maxItems: 100, items: testRunSafeToolEvidenceJsonSchema },
    deterministicChecks: {
      type: 'array',
      maxItems: 128,
      items: safeDeterministicCheckJsonSchema,
    },
    replyEvaluations: { type: 'array', maxItems: 100, items: safeReplyEvaluationJsonSchema },
    agentUsage: { type: 'array', maxItems: 60, items: testRunSafeAgentUsageJsonSchema },
  }
);
const projectionScenarioCommandJsonSchema = closedJsonObject(
  [
    'scenarioId',
    'expectedScenarioRevision',
    'eventWatermark',
    'lifecycle',
    'verdict',
    'sessionId',
    'sessionBindingDigest',
    'summary',
    'projection',
  ],
  [
    'scenarioId',
    'expectedScenarioRevision',
    'eventWatermark',
    'lifecycle',
    'verdict',
    'sessionId',
    'sessionBindingDigest',
    'summary',
    'projection',
  ],
  {
    scenarioId: safeIdJsonSchema,
    expectedScenarioRevision: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    eventWatermark: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    lifecycle: scenarioLifecycleJsonSchema,
    verdict: verdictJsonSchema,
    sessionId: safeIdJsonSchema,
    sessionBindingDigest: digestJsonSchema,
    summary: scenarioSummaryJsonSchema,
    projection: scenarioProjectionJsonSchema,
  }
);
const projectionFinalizationJsonSchema = closedJsonObject(
  ['tombstoneDigest', 'artifactStageDigest', 'terminalCandidate'],
  ['tombstoneDigest', 'artifactStageDigest', 'terminalCandidate'],
  {
    tombstoneDigest: digestJsonSchema,
    artifactStageDigest: digestJsonSchema,
    terminalCandidate: terminalCandidateJsonSchema,
  }
);
const projectionCommandJsonSchema = closedJsonObject(
  ['expectedRevision', 'nextLifecycle', 'updatedAt', 'retentionReconciled', 'scenario', 'finalization'],
  ['expectedRevision', 'nextLifecycle', 'updatedAt', 'scenario', 'finalization'],
  {
    expectedRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    nextLifecycle: { type: 'string', enum: ['preflight', 'running', 'finalizing'] },
    updatedAt: timestampJsonSchema,
    retentionReconciled: { type: 'boolean', enum: [true] },
    scenario: nullableJsonSchema(projectionScenarioCommandJsonSchema),
    finalization: nullableJsonSchema(projectionFinalizationJsonSchema),
  }
);
const finalizationRequestJsonSchema = closedJsonObject(
  [
    'runtimeAudience',
    'userId',
    'leaseFence',
    'expectedRevision',
    'artifactStageDigest',
    'terminalCandidate',
  ],
  [
    'runtimeAudience',
    'userId',
    'leaseFence',
    'expectedRevision',
    'artifactStageDigest',
    'terminalCandidate',
  ],
  {
    ...contextIdentityJsonProperties,
    expectedRevision: { type: 'integer', minimum: 0 },
    artifactStageDigest: digestJsonSchema,
    terminalCandidate: terminalCandidateJsonSchema,
  }
);
const authorizedBodyJsonSchema = (
  requestSchema: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> =>
  closedJsonObject(['authorization', 'request'], ['authorization', 'request'], {
    authorization: controlAuthorizationJsonSchema,
    request: requestSchema,
  });
const projectionBodyJsonSchema = authorizedBodyJsonSchema({
  oneOf: [
    closedJsonObject(['kind', 'record'], ['kind', 'record'], {
      kind: { type: 'string', enum: ['create'] },
      record: testRunRecordJsonSchema,
    }),
    closedJsonObject(
      ['kind', 'userId', 'leaseFence', 'command'],
      ['kind', 'userId', 'leaseFence', 'command'],
      {
        kind: { type: 'string', enum: ['cas'] },
        userId: safeIdJsonSchema,
        leaseFence: fenceJsonSchema,
        command: projectionCommandJsonSchema,
      }
    ),
  ],
});
const artifactDeliveryBodyJsonSchema = closedJsonObject(
  ['expectedRevision', 'next', 'updatedAt'],
  ['expectedRevision', 'next', 'updatedAt'],
  {
    expectedRevision: safeIntegerJsonSchema,
    next: {
      oneOf: [
        closedJsonObject(
          ['status', 'jsonCandidateDigest', 'markdownCandidateDigest'],
          ['status', 'jsonCandidateDigest', 'markdownCandidateDigest'],
          {
            status: { type: 'string', enum: ['staged'] },
            jsonCandidateDigest: digestJsonSchema,
            markdownCandidateDigest: digestJsonSchema,
          }
        ),
        closedJsonObject(['status', 'failureCode'], ['status', 'failureCode'], {
          status: { type: 'string', enum: ['failed'] },
          failureCode: {
            type: 'string',
            enum: ['REPORT_STAGING_FAILED', 'REPORT_VALIDATION_FAILED'],
          },
        }),
        closedJsonObject(
          ['status', 'failureCode', 'terminalControlEventId'],
          ['status', 'failureCode', 'terminalControlEventId'],
          {
            status: { type: 'string', enum: ['failed'] },
            failureCode: { type: 'string', enum: ['REPORT_PUBLICATION_FAILED'] },
            terminalControlEventId: safeIdJsonSchema,
          }
        ),
        closedJsonObject(
          ['status', 'terminalControlEventId'],
          ['status', 'terminalControlEventId'],
          {
            status: { type: 'string', enum: ['ready'] },
            terminalControlEventId: safeIdJsonSchema,
          }
        ),
      ],
    },
    updatedAt: timestampJsonSchema,
  }
);
const artifactDeliveryHeadersJsonSchema = closedJsonObject(
  [
    'x-internal-auth',
    'x-matrix-corpus-runtime-audience',
    'x-matrix-corpus-user-id',
    'x-matrix-corpus-lease-fence',
  ],
  [
    'x-internal-auth',
    'x-matrix-corpus-runtime-audience',
    'x-matrix-corpus-user-id',
    'x-matrix-corpus-lease-fence',
  ],
  {
    'x-internal-auth': { type: 'string', minLength: 1, maxLength: 512 },
    'x-matrix-corpus-runtime-audience': { type: 'string', enum: ['hetzner-prod'] },
    'x-matrix-corpus-user-id': safeIdJsonSchema,
    'x-matrix-corpus-lease-fence': fenceJsonSchema,
  }
);
const cleanupBodyJsonSchema = closedJsonObject(
  ['targetRunId', 'targetLeaseFence', 'updatedAt'],
  ['targetRunId', 'targetLeaseFence', 'updatedAt'],
  {
    targetRunId: safeIdJsonSchema,
    targetLeaseFence: fenceJsonSchema,
    updatedAt: timestampJsonSchema,
  }
);
const terminalControlBodyJsonSchema = closedJsonObject(
  ['version', 'kind', 'eventId', 'leaseFence', 'payloadDigest', 'attestation'],
  ['version', 'kind', 'eventId', 'leaseFence', 'payloadDigest', 'attestation'],
  {
    version: { type: 'integer', enum: [1] },
    kind: { type: 'string', enum: ['matrix_corpus_terminal_control'] },
    eventId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    payloadDigest: digestJsonSchema,
    attestation: { type: 'string', minLength: 1, maxLength: 32_768 },
  }
);
const admissionResultJsonSchema = {
  oneOf: [
    closedJsonObject(['kind', 'current'], ['kind', 'current'], {
      kind: { type: 'string', enum: ['admission_ready'] },
      current: {
        type: 'string',
        enum: [
          'absent',
          'terminal_artifact_ready',
          'terminal_artifact_failed',
          'terminal_artifact_unknown',
        ],
      },
    }),
    closedJsonObject(['kind', 'reason'], ['kind', 'reason'], {
      kind: { type: 'string', enum: ['admission_blocked'] },
      reason: {
        type: 'string',
        enum: ['preflight', 'running', 'finalizing', 'artifact_pending', 'artifact_staged'],
      },
    }),
    closedJsonObject(['kind'], ['kind'], {
      kind: { type: 'string', enum: ['not_ready'] },
    }),
  ],
} as const;
const contextRegistrationResultJsonSchema = closedJsonObject(
  [
    'disposition',
    'runId',
    'userId',
    'leaseFence',
    'promptPreferencesVersion',
    'promptPreferencesDigest',
    'agentModel',
    'userTimeZone',
    'expiresAt',
  ],
  [
    'disposition',
    'runId',
    'userId',
    'leaseFence',
    'promptPreferencesVersion',
    'promptPreferencesDigest',
    'agentModel',
    'userTimeZone',
    'expiresAt',
  ],
  {
    disposition: { type: 'string', enum: ['applied', 'already_applied'] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    promptPreferencesVersion: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    promptPreferencesDigest: digestJsonSchema,
    agentModel: { type: 'string', enum: ['or:deepseek/deepseek-v4-flash'] },
    userTimeZone: { type: 'string', minLength: 1, maxLength: 128 },
    expiresAt: timestampJsonSchema,
  }
);
const finalizationResultJsonSchema = closedJsonObject(
  ['disposition', 'runId', 'userId', 'leaseFence', 'tombstoneDigest', 'scenarioContextCount', 'finalizedAt'],
  ['disposition', 'runId', 'userId', 'leaseFence', 'tombstoneDigest', 'scenarioContextCount', 'finalizedAt'],
  {
    disposition: { type: 'string', enum: ['applied', 'already_applied'] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    tombstoneDigest: digestJsonSchema,
    scenarioContextCount: { type: 'integer', minimum: 0, maximum: 20 },
    finalizedAt: timestampJsonSchema,
  }
);
const controlStatusResultJsonSchema = {
  oneOf: [
    closedJsonObject(['kind'], ['kind'], {
      kind: { type: 'string', enum: ['not_ready'] },
    }),
    closedJsonObject(
      [
        'kind',
        'runId',
        'userId',
        'leaseFence',
        'lifecycle',
        'revision',
        'contextReady',
        'manifestReady',
        'preflightProjectionReady',
        'retentionReconciled',
        'contextFinalizationTombstoneDigest',
        'terminalCandidateDigest',
        'artifactStageDigest',
        'terminalControlEventId',
      ],
      [
        'kind',
        'runId',
        'userId',
        'leaseFence',
        'lifecycle',
        'revision',
        'contextReady',
        'manifestReady',
        'preflightProjectionReady',
        'retentionReconciled',
        'contextFinalizationTombstoneDigest',
        'terminalCandidateDigest',
        'artifactStageDigest',
        'terminalControlEventId',
      ],
      {
        kind: { type: 'string', enum: ['status'] },
        runId: safeIdJsonSchema,
        userId: safeIdJsonSchema,
        leaseFence: fenceJsonSchema,
        lifecycle: {
          type: 'string',
          enum: ['preflight', 'running', 'finalizing', 'completed', 'stopped'],
        },
        revision: safeIntegerJsonSchema,
        contextReady: { type: 'boolean', enum: [true] },
        manifestReady: { type: 'boolean', enum: [true] },
        preflightProjectionReady: { type: 'boolean' },
        retentionReconciled: { type: 'boolean' },
        contextFinalizationTombstoneDigest: nullableJsonSchema(digestJsonSchema),
        terminalCandidateDigest: nullableJsonSchema(digestJsonSchema),
        artifactStageDigest: nullableJsonSchema(digestJsonSchema),
        terminalControlEventId: nullableJsonSchema(safeIdJsonSchema),
      }
    ),
  ],
} as const;
const projectionResultJsonSchema = closedJsonObject(
  ['disposition', 'runId', 'userId', 'leaseFence', 'revision', 'lifecycle', 'verdict'],
  ['disposition', 'runId', 'userId', 'leaseFence', 'revision', 'lifecycle', 'verdict'],
  {
    disposition: { type: 'string', enum: ['applied', 'already_applied'] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    lifecycle: {
      type: 'string',
      enum: ['preflight', 'running', 'finalizing', 'completed', 'stopped'],
    },
    verdict: { type: 'string', enum: ['pending', 'passed', 'failed', 'not_evaluated'] },
  }
);
const artifactDeliveryResultJsonSchema = closedJsonObject(
  [
    'disposition',
    'runId',
    'userId',
    'leaseFence',
    'revision',
    'lifecycle',
    'verdict',
    'artifactDelivery',
  ],
  [
    'disposition',
    'runId',
    'userId',
    'leaseFence',
    'revision',
    'lifecycle',
    'verdict',
    'artifactDelivery',
  ],
  {
    disposition: { type: 'string', enum: ['applied', 'already_applied'] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    revision: safeIntegerJsonSchema,
    lifecycle: {
      type: 'string',
      enum: ['preflight', 'running', 'finalizing', 'completed', 'stopped'],
    },
    verdict: verdictJsonSchema,
    artifactDelivery: artifactDeliveryJsonSchema,
  }
);
const cleanupCountsJsonSchema = closedJsonObject(
  [
    'runs',
    'sessions',
    'events',
    'confirmations',
    'ingestReceipts',
    'scenarioProjections',
    'scenarioContexts',
    'runContexts',
    'manifests',
  ],
  [
    'runs',
    'sessions',
    'events',
    'confirmations',
    'ingestReceipts',
    'scenarioProjections',
    'scenarioContexts',
    'runContexts',
    'manifests',
  ],
  {
    runs: safeIntegerJsonSchema,
    sessions: safeIntegerJsonSchema,
    events: safeIntegerJsonSchema,
    confirmations: safeIntegerJsonSchema,
    ingestReceipts: safeIntegerJsonSchema,
    scenarioProjections: safeIntegerJsonSchema,
    scenarioContexts: safeIntegerJsonSchema,
    runContexts: safeIntegerJsonSchema,
    manifests: safeIntegerJsonSchema,
  }
);
const cleanupResultJsonSchema = closedJsonObject(
  [
    'disposition',
    'runId',
    'userId',
    'leaseFence',
    'currentRevision',
    'retentionReconciled',
    'removed',
  ],
  [
    'disposition',
    'runId',
    'userId',
    'leaseFence',
    'currentRevision',
    'retentionReconciled',
    'removed',
  ],
  {
    disposition: { type: 'string', enum: ['applied', 'already_applied'] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    currentRevision: safeIntegerJsonSchema,
    retentionReconciled: { type: 'boolean', enum: [true] },
    removed: cleanupCountsJsonSchema,
  }
);
const terminalControlResultJsonSchema = closedJsonObject(
  ['kind', 'runId', 'leaseFence', 'requestEventId', 'requestPayloadDigest', 'winner'],
  ['kind', 'runId', 'leaseFence', 'requestEventId', 'requestPayloadDigest', 'winner'],
  {
    kind: { type: 'string', enum: ['acknowledged'] },
    runId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    requestEventId: safeIdJsonSchema,
    requestPayloadDigest: digestJsonSchema,
    winner: terminalWinnerJsonSchema,
  }
);

const evidenceParamsJsonSchema = closedJsonObject(
  ['runId', 'scenarioId'],
  ['runId', 'scenarioId'],
  { runId: safeIdJsonSchema, scenarioId: safeIdJsonSchema }
);
const scenarioStatusResultJsonSchema = {
  oneOf: [
    closedJsonObject(['kind'], ['kind'], { kind: { type: 'string', enum: ['not_ready'] } }),
    closedJsonObject(
      ['kind', 'runId', 'userId', 'leaseFence', 'scenarioId', 'sessionId', 'eventRevision', 'lifecycle', 'pendingConfirmationId'],
      ['kind', 'runId', 'userId', 'leaseFence', 'scenarioId', 'sessionId', 'eventRevision', 'lifecycle', 'pendingConfirmationId'],
      {
        kind: { type: 'string', enum: ['status'] },
        runId: safeIdJsonSchema,
        userId: safeIdJsonSchema,
        leaseFence: fenceJsonSchema,
        scenarioId: safeIdJsonSchema,
        sessionId: safeIdJsonSchema,
        eventRevision: safeIntegerJsonSchema,
        lifecycle: { type: 'string', enum: ['running', 'completed', 'stopped'] },
        pendingConfirmationId: nullableJsonSchema(safeIdJsonSchema),
      }
    ),
  ],
} as const;
const finalizationReadinessResultJsonSchema = {
  oneOf: [
    closedJsonObject(['kind'], ['kind'], { kind: { type: 'string', enum: ['not_ready'] } }),
    closedJsonObject(
      ['kind', 'runId', 'userId', 'leaseFence', 'revision', 'projectionDigest', 'artifactStageDigest'],
      ['kind', 'runId', 'userId', 'leaseFence', 'revision', 'projectionDigest', 'artifactStageDigest'],
      {
        kind: { type: 'string', enum: ['ready'] },
        runId: safeIdJsonSchema,
        userId: safeIdJsonSchema,
        leaseFence: fenceJsonSchema,
        revision: safeIntegerJsonSchema,
        projectionDigest: digestJsonSchema,
        artifactStageDigest: digestJsonSchema,
      }
    ),
  ],
} as const;
const retentionPlanResultJsonSchema = closedJsonObject(
  ['kind', 'runId', 'userId', 'leaseFence', 'records'],
  ['kind', 'runId', 'userId', 'leaseFence', 'records'],
  {
    kind: { type: 'string', enum: ['retention_plan'] },
    runId: safeIdJsonSchema,
    userId: safeIdJsonSchema,
    leaseFence: fenceJsonSchema,
    records: {
      type: 'array',
      minItems: 1,
      maxItems: TEST_RUN_RETENTION_QUERY_LIMIT,
      items: closedJsonObject(
        [
          'runId',
          'leaseFence',
          'startedAt',
          'lifecycle',
          'verdict',
          'artifactDelivery',
          'completedAt',
          'isCurrent',
        ],
        [
          'runId',
          'leaseFence',
          'startedAt',
          'lifecycle',
          'verdict',
          'artifactDelivery',
          'completedAt',
          'isCurrent',
        ],
        {
          runId: safeIdJsonSchema,
          leaseFence: fenceJsonSchema,
          startedAt: timestampJsonSchema,
          lifecycle: {
            type: 'string',
            enum: ['preflight', 'running', 'finalizing', 'completed', 'stopped'],
          },
          verdict: verdictJsonSchema,
          artifactDelivery: {
            type: 'string',
            enum: ['pending', 'staged', 'ready', 'failed', 'unknown'],
          },
          completedAt: nullableJsonSchema(timestampJsonSchema),
          isCurrent: { type: 'boolean' },
        }
      ),
    },
  }
);
const evidenceHeadersJsonSchema = {
  type: 'object',
  required: [
    'x-internal-auth',
    'x-matrix-corpus-runtime-audience',
    'x-matrix-corpus-user-id',
    'x-matrix-corpus-lease-fence',
    'x-matrix-corpus-session-id',
    'x-matrix-corpus-event-revision',
  ],
  properties: {
    ...internalHeadersJsonSchema.properties,
    'x-matrix-corpus-runtime-audience': { type: 'string', enum: ['hetzner-prod'] },
    'x-matrix-corpus-user-id': safeIdJsonSchema,
    'x-matrix-corpus-lease-fence': fenceJsonSchema,
    'x-matrix-corpus-session-id': safeIdJsonSchema,
    'x-matrix-corpus-event-revision': { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$' },
  },
} as const;
const safeToolFactJsonSchema = closedJsonObject(
  ['name', 'value'],
  ['name', 'value'],
  {
    name: {
      type: 'string',
      enum: [
        'contentLength', 'titleLength', 'summaryLength', 'promptLength', 'queryLength',
        'originalMessageLength', 'locationLength', 'descriptionLength', 'messageLength',
        'textLength', 'tagsCount', 'sourceMessageIdsCount', 'attendeesCount', 'resultCount',
        'maxResults', 'expectedVersion', 'currentVersion', 'hasUrl', 'hasSourceUrl',
        'hasCalendarId', 'hasItemId', 'hasLinearIssueId', 'startMatchesCatalog',
        'endMatchesCatalog', 'timeZoneMatchesCatalog', 'mode', 'workerType', 'taskMode',
      ],
    },
    value: {
      oneOf: [
        { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        { type: 'boolean' },
        {
          type: 'string',
          enum: ['list', 'count', 'codex', 'codex-xhigh', 'minimax', 'planning', 'execution'],
        },
      ],
    },
  }
);
const safeToolEvidenceJsonSchema = closedJsonObject(
  ['event', 'toolName', 'turnIndex', 'ordinal', 'facts'],
  ['event', 'toolName', 'turnIndex', 'ordinal', 'facts'],
  {
    event: {
      type: 'string',
      enum: ['selected', 'mock_completed', 'mock_failed', 'unexpected_known_no_execution'],
    },
    toolName: {
      type: 'string',
      enum: [
        'create_note', 'create_calendar_event', 'query_calendar_events', 'create_research',
        'create_link', 'create_code_task', 'save_external', 'get_user_preferences',
        'add_user_preference', 'update_user_preference', 'delete_user_preference',
      ],
    },
    turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
    ordinal: { type: 'integer', minimum: 1, maximum: 20 },
    facts: { type: 'array', maxItems: 16, items: safeToolFactJsonSchema },
  }
);
const safeAgentUsageJsonSchema = closedJsonObject(
  ['turnIndex', 'stage', 'callOrdinal', 'inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  ['turnIndex', 'stage', 'callOrdinal', 'inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  {
    turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
    stage: {
      type: 'string',
      enum: ['intent_classification', 'agent_generation', 'response_schema_repair'],
    },
    callOrdinal: { type: 'integer', minimum: 1, maximum: 60 },
    inputTokens: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    outputTokens: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    totalTokens: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    costNanoUsd: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  }
);
const safeAgentUsageTotalsJsonSchema = closedJsonObject(
  ['inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  ['inputTokens', 'outputTokens', 'totalTokens', 'costNanoUsd'],
  {
    inputTokens: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    outputTokens: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    totalTokens: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    costNanoUsd: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  }
);
const safeTurnTerminalJsonSchema = {
  oneOf: [
    closedJsonObject(
      [
        'status',
        'turnIndex',
        'replyCount',
        'replyDigests',
        'terminalMarkerDigest',
        'recordedAt',
      ],
      [
        'status',
        'turnIndex',
        'replyCount',
        'replyDigests',
        'terminalMarkerDigest',
        'recordedAt',
      ],
      {
        status: { type: 'string', enum: ['completed'] },
        turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
        replyCount: { type: 'integer', minimum: 1, maximum: 5 },
        replyDigests: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: digestJsonSchema,
        },
        terminalMarkerDigest: digestJsonSchema,
        recordedAt: timestampJsonSchema,
      }
    ),
    closedJsonObject(
      ['status', 'turnIndex', 'failureCode', 'terminalMarkerDigest', 'recordedAt'],
      ['status', 'turnIndex', 'failureCode', 'terminalMarkerDigest', 'recordedAt'],
      {
        status: { type: 'string', enum: ['failed'] },
        turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
        failureCode: {
          type: 'string',
          enum: [
            'AMBIGUOUS_EXTERNAL_EFFECT',
            'REPLY_PUBLICATION_REJECTED',
            'EXECUTION_REJECTED',
          ],
        },
        terminalMarkerDigest: digestJsonSchema,
        recordedAt: timestampJsonSchema,
      }
    ),
  ],
} as const;
const safeEvidenceResultJsonSchema = closedJsonObject(
  [
    'version',
    'eventRevision',
    'toolEvidence',
    'agentUsage',
    'agentUsageTotals',
    'sessionProof',
    'turnTerminals',
    'strictMockProof',
  ],
  [
    'version',
    'eventRevision',
    'toolEvidence',
    'agentUsage',
    'agentUsageTotals',
    'sessionProof',
    'turnTerminals',
    'strictMockProof',
  ],
  {
    version: { type: 'integer', enum: [1] },
    eventRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    toolEvidence: { type: 'array', maxItems: 100, items: safeToolEvidenceJsonSchema },
    agentUsage: { type: 'array', maxItems: 60, items: safeAgentUsageJsonSchema },
    agentUsageTotals: safeAgentUsageTotalsJsonSchema,
    sessionProof: closedJsonObject(
      [
        'status',
        'startReason',
        'userMessageCount',
        'sessionStartedCount',
        'supersededSessionCount',
      ],
      [
        'status',
        'startReason',
        'userMessageCount',
        'sessionStartedCount',
        'supersededSessionCount',
      ],
      {
        status: {
          type: 'string',
          enum: [
            'active',
            'waiting_for_user',
            'completed',
            'unsupported',
            'expired',
            'cancelled',
            'superseded',
          ],
        },
        startReason: {
          type: 'string',
          enum: [
            'no_active_session',
            'previous_completed',
            'previous_expired',
            'previous_superseded',
            'user_requested_new_session',
          ],
        },
        userMessageCount: { type: 'integer', minimum: 0, maximum: 20 },
        sessionStartedCount: { type: 'integer', minimum: 0, maximum: 20 },
        supersededSessionCount: { type: 'integer', minimum: 0, maximum: 20 },
      }
    ),
    turnTerminals: { type: 'array', maxItems: 20, items: safeTurnTerminalJsonSchema },
    strictMockProof: closedJsonObject(
      [
        'version',
        'status',
        'executionMode',
        'mockProfileDigest',
        'productionExecutorResolutions',
        'productionExecutorAdmissions',
      ],
      [
        'version',
        'status',
        'executionMode',
        'mockProfileDigest',
        'productionExecutorResolutions',
        'productionExecutorAdmissions',
      ],
      {
        version: { type: 'integer', enum: [1] },
        status: { type: 'string', enum: ['passed'] },
        executionMode: { type: 'string', enum: ['strict_mock_tools'] },
        mockProfileDigest: digestJsonSchema,
        productionExecutorResolutions: { type: 'integer', enum: [0] },
        productionExecutorAdmissions: { type: 'integer', enum: [0] },
      }
    ),
  }
);

export interface MatrixCorpusRoutesDependencies {
  enabled: boolean;
  configuredUserId: string;
  contextService: Pick<MatrixCorpusContextService, 'registerRun'>;
  contextRepository: Pick<MatrixCorpusContextRepository, 'getRunContext'>;
  manifestRepository: Pick<MatrixCorpusManifestRepository, 'getExact'>;
  testRunRepository: TestRunRepository;
  sessionRepository: Pick<MatrixCorpusSessionRepository, 'listMatrixCorpusEventsExact'>;
  evidenceService: MatrixCorpusEvidenceService;
  verifyAttestation(input: unknown): Promise<MatrixCorpusAttestationVerificationResult>;
  now(): string;
}

export function createMatrixCorpusRoutes(
  deps: MatrixCorpusRoutesDependencies
): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    if (!deps.enabled) {
      done();
      return;
    }

    fastify.post<{ Body: unknown }>(
      '/internal/matrix-corpus/current-acceptance',
      privateRouteSchema(
        'getMatrixCorpusCurrentAcceptance',
        'Read the current Matrix corpus admission state',
        { body: currentAcceptanceBodyJsonSchema },
        admissionResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const parsed = z
          .object({
            runtimeAudience: z.literal('hetzner-prod'),
            userId: matrixCorpusSafeIdSchema,
          })
          .strict()
          .safeParse(request.body);
        if (!parsed.success) return await invalidRequest(reply);
        if (parsed.data.userId !== deps.configuredUserId) return await notFound(reply);
        const result = await deps.testRunRepository.getCurrentAcceptance(parsed.data.userId);
        return result.ok ? await reply.ok(result.acceptance) : await reply.ok({ kind: 'not_ready' });
      }
    );

    fastify.post<{ Params: { runId: string }; Body: unknown }>(
      '/internal/matrix-corpus/runs/:runId/cleanup',
      privateRouteSchema(
        'cleanupExactMatrixCorpusRun',
        'Delete one terminal Matrix corpus run by exact manifest bindings',
        {
          params: runParamsJsonSchema,
          headers: artifactDeliveryHeadersJsonSchema,
          body: cleanupBodyJsonSchema,
        },
        cleanupResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const cleanup = cleanupRequestSchema.safeParse(readUnmodifiedBody(request));
        if (!cleanup.success) return await invalidRequest(reply);
        const currentIdentity = parseControlHeaders(request, request.params.runId);
        if (
          currentIdentity === null ||
          !hasExactUserAndRun(currentIdentity.userId, currentIdentity.runId, deps)
        )
          return await notFound(reply);
        const result = await deps.testRunRepository.cleanupExactRun({
          currentIdentity,
          targetIdentity: {
            runId: cleanup.data.targetRunId,
            userId: currentIdentity.userId,
            leaseFence: cleanup.data.targetLeaseFence,
          },
          updatedAt: cleanup.data.updatedAt,
        });
        if (!result.ok) return await repositoryFailure(reply, result.code);
        return await reply.ok({
          disposition: result.disposition,
          runId: currentIdentity.runId,
          userId: currentIdentity.userId,
          leaseFence: currentIdentity.leaseFence,
          currentRevision: result.currentRecord.revision,
          retentionReconciled: result.currentRecord.retentionReconciled,
          removed: result.removed,
        });
      }
    );

    fastify.get<{ Params: { runId: string } }>(
      '/internal/matrix-corpus/runs/:runId/retention-plan',
      privateRouteSchema(
        'getMatrixCorpusRetentionPlan',
        'Read the bounded exact-ID retention candidates for one provisioning run',
        {
          params: runParamsJsonSchema,
          headers: artifactDeliveryHeadersJsonSchema,
        },
        retentionPlanResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const currentIdentity = parseControlHeaders(request, request.params.runId);
        if (
          currentIdentity === null ||
          !hasExactUserAndRun(currentIdentity.userId, currentIdentity.runId, deps)
        )
          return await notFound(reply);
        const [current, listed] = await Promise.all([
          deps.testRunRepository.getExact(currentIdentity),
          deps.testRunRepository.listLatestForUser(
            currentIdentity.userId,
            TEST_RUN_RETENTION_QUERY_LIMIT
          ),
        ]);
        if (
          !current.ok ||
          !listed.ok ||
          current.record.lifecycle !== 'preflight' ||
          listed.records.length === 0 ||
          !listed.records.some(
            (record) =>
              record.runId === currentIdentity.runId &&
              record.leaseFence === currentIdentity.leaseFence
          )
        )
          return await repositoryFailure(reply, 'EVIDENCE_MISMATCH');
        return await reply.ok({
          kind: 'retention_plan',
          ...currentIdentity,
          records: listed.records.map((record) => ({
            runId: record.runId,
            leaseFence: record.leaseFence,
            startedAt: record.startedAt,
            lifecycle: record.lifecycle,
            verdict: record.verdict,
            artifactDelivery: record.artifactDelivery.status,
            completedAt: record.finishedAt,
            isCurrent: record.runId === currentIdentity.runId,
          })),
        });
      }
    );

    fastify.post<{ Params: { runId: string }; Body: unknown }>(
      '/internal/matrix-corpus/runs/:runId/context',
      privateRouteSchema(
        'registerMatrixCorpusRunContext',
        'Register encrypted Matrix corpus run context',
        {
          params: runParamsJsonSchema,
          body: authorizedBodyJsonSchema(contextRegistrationRequestJsonSchema),
        },
        contextRegistrationResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const parsed = authorizedContextRegistrationSchema.safeParse(request.body);
        if (!parsed.success) return await invalidRequest(reply);
        if (!hasExactUserAndRun(parsed.data.request.userId, request.params.runId, deps))
          return await notFound(reply);
        if (
          !(await hasValidControlMutation(
            deps,
            parsed.data.authorization,
            'register_context',
            request.params.runId,
            parsed.data.request,
            parsed.data.request.userId,
            parsed.data.request.leaseFence
          ))
        )
          return await invalidRequest(reply);
        const result = await deps.contextService.registerRun({
          ...parsed.data.request,
          runId: request.params.runId,
        });
        if (!result.ok) return await closedServiceFailure(reply, result.code);
        return await reply.ok({
          disposition: result.disposition,
          runId: request.params.runId,
          userId: parsed.data.request.userId,
          leaseFence: parsed.data.request.leaseFence,
          ...result.snapshot,
        });
      }
    );

    fastify.post<{ Params: { runId: string }; Body: unknown }>(
      '/internal/matrix-corpus/runs/:runId/context/finalize',
      privateRouteSchema('finalizeMatrixCorpusRun', 'Atomically finalize one Matrix corpus run', {
        params: runParamsJsonSchema,
        body: authorizedBodyJsonSchema(finalizationRequestJsonSchema),
      }, finalizationResultJsonSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const parsed = authorizedContextFinalizationSchema.safeParse(request.body);
        if (!parsed.success) return await invalidRequest(reply);
        if (!hasExactUserAndRun(parsed.data.request.userId, request.params.runId, deps))
          return await notFound(reply);
        if (
          !(await hasValidControlMutation(
            deps,
            parsed.data.authorization,
            'finalize_run',
            request.params.runId,
            parsed.data.request,
            parsed.data.request.userId,
            parsed.data.request.leaseFence
          ))
        )
          return await invalidRequest(reply);
        const result = await deps.testRunRepository.finalizeRun({
          identity: {
            runId: request.params.runId,
            userId: parsed.data.request.userId,
            leaseFence: parsed.data.request.leaseFence,
          },
          expectedRevision: parsed.data.request.expectedRevision,
          updatedAt: parsed.data.request.terminalCandidate.createdAt,
          artifactStageDigest: parsed.data.request.artifactStageDigest,
          terminalCandidate: parsed.data.request.terminalCandidate,
        });
        if (!result.ok) return await repositoryFailure(reply, result.code);
        return await reply.ok({
          disposition: result.disposition,
          runId: request.params.runId,
          userId: parsed.data.request.userId,
          leaseFence: parsed.data.request.leaseFence,
          tombstoneDigest: result.tombstoneDigest,
          scenarioContextCount: result.scenarioContextCount,
          finalizedAt: result.finalizedAt,
        });
      }
    );

    fastify.get<{ Params: { runId: string } }>(
      '/internal/matrix-corpus/runs/:runId/control-status',
      privateRouteSchema('getMatrixCorpusControlStatus', 'Read safe Matrix corpus control status', {
        params: runParamsJsonSchema,
        headers: {
          ...internalHeadersJsonSchema,
          required: [
            'x-internal-auth',
            'x-matrix-corpus-runtime-audience',
            'x-matrix-corpus-user-id',
            'x-matrix-corpus-lease-fence',
          ],
          properties: {
            ...internalHeadersJsonSchema.properties,
            'x-matrix-corpus-runtime-audience': { type: 'string', enum: ['hetzner-prod'] },
            'x-matrix-corpus-user-id': safeIdJsonSchema,
            'x-matrix-corpus-lease-fence': fenceJsonSchema,
          },
        },
      }, controlStatusResultJsonSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const identity = parseControlHeaders(request, request.params.runId);
        if (identity === null || !hasExactUserAndRun(identity.userId, identity.runId, deps))
          return await notFound(reply);

        const [context, manifest, run] = await Promise.all([
          deps.contextRepository.getRunContext({ ...identity, now: deps.now() }),
          deps.manifestRepository.getExact(identity),
          deps.testRunRepository.getExact(identity),
        ]);
        if (!context.ok || !manifest.ok || !run.ok)
          return await reply.ok({ kind: 'not_ready' });
        if (
          context.context.runId !== identity.runId ||
          manifest.manifest.catalogDigest !== run.record.catalogDigest ||
          (context.context.status === 'active' &&
            context.context.catalogDigest !== run.record.catalogDigest)
        )
          return await reply.ok({ kind: 'not_ready' });
        const tombstoneDigest =
          context.context.status === 'finalized'
            ? digestClosedValue(context.context)
            : run.record.contextFinalizationTombstoneDigest;
        return await reply.ok({
          kind: 'status',
          runId: identity.runId,
          userId: identity.userId,
          leaseFence: identity.leaseFence,
          lifecycle: run.record.lifecycle,
          revision: run.record.revision,
          contextReady: true,
          manifestReady: true,
          preflightProjectionReady:
            run.record.lifecycle === 'preflight' &&
            run.record.terminalCandidate === null &&
            manifest.manifest.terminalCandidate === null &&
            context.context.status === 'active',
          retentionReconciled: run.record.retentionReconciled,
          contextFinalizationTombstoneDigest: tombstoneDigest,
          terminalCandidateDigest:
            run.record.terminalCandidate === null
              ? null
              : digestClosedValue(run.record.terminalCandidate),
          artifactStageDigest: run.record.artifactStageDigest,
          terminalControlEventId: run.record.terminalWinner?.eventId ?? null,
        });
      }
    );

    fastify.get<{ Params: { runId: string; scenarioId: string } }>(
      '/internal/matrix-corpus/runs/:runId/scenarios/:scenarioId/status',
      privateRouteSchema(
        'getMatrixCorpusScenarioStatus',
        'Read exact Matrix corpus scenario/session status',
        {
          params: evidenceParamsJsonSchema,
          headers: {
            ...internalHeadersJsonSchema,
            required: [
              'x-internal-auth',
              'x-matrix-corpus-runtime-audience',
              'x-matrix-corpus-user-id',
              'x-matrix-corpus-lease-fence',
            ],
            properties: {
              ...internalHeadersJsonSchema.properties,
              'x-matrix-corpus-runtime-audience': { type: 'string', enum: ['hetzner-prod'] },
              'x-matrix-corpus-user-id': safeIdJsonSchema,
              'x-matrix-corpus-lease-fence': fenceJsonSchema,
            },
          },
        },
        scenarioStatusResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const identity = parseControlHeaders(request, request.params.runId);
        if (identity === null || !hasExactUserAndRun(identity.userId, identity.runId, deps))
          return await notFound(reply);
        const [run, manifest] = await Promise.all([
          deps.testRunRepository.getExact(identity),
          deps.manifestRepository.getExact(identity),
        ]);
        if (!run.ok || !manifest.ok) return await reply.ok({ kind: 'not_ready' });
        const binding = manifest.manifest.scenarioBindings.find(
          (entry) => entry.scenarioId === request.params.scenarioId
        );
        if (binding === undefined) return await reply.ok({ kind: 'not_ready' });
        const projected = run.record.scenarios.find(
          (entry) =>
            entry.scenarioId === request.params.scenarioId && entry.sessionId === binding.sessionId
        );
        const events = await deps.sessionRepository.listMatrixCorpusEventsExact({
          runId: identity.runId,
          scenarioId: binding.scenarioId,
          sessionId: binding.sessionId,
          userId: identity.userId,
          leaseFence: identity.leaseFence,
        });
        if (!events.ok) return await reply.ok({ kind: 'not_ready' });
        const sequences = events.events
          .map((event) => event.eventSequence)
          .filter((value): value is number => value !== undefined)
          .sort((left, right) => left - right);
        if (sequences.some((value, index) => value !== index + 1))
          return await reply.ok({ kind: 'not_ready' });
        const resolved = new Set(
          events.events
            .filter((event) => event.type === 'confirmation_resolved')
            .map((event) => event.payload['confirmationId'])
            .filter((value): value is string => typeof value === 'string')
        );
        const pending = events.events
          .filter((event) => event.type === 'confirmation_requested')
          .map((event) => event.payload['confirmationId'])
          .filter(
            (value): value is string =>
              typeof value === 'string' &&
              matrixCorpusSafeIdSchema.safeParse(value).success &&
              !resolved.has(value)
          );
        if (new Set(pending).size > 1) return await reply.ok({ kind: 'not_ready' });
        return await reply.ok({
          kind: 'status',
          runId: identity.runId,
          userId: identity.userId,
          leaseFence: identity.leaseFence,
          scenarioId: binding.scenarioId,
          sessionId: binding.sessionId,
          eventRevision: sequences.length,
          lifecycle:
            projected?.lifecycle === 'completed' || projected?.lifecycle === 'stopped'
              ? projected.lifecycle
              : 'running',
          pendingConfirmationId: pending[0] ?? null,
        });
      }
    );

    fastify.get<{ Params: { runId: string } }>(
      '/internal/matrix-corpus/runs/:runId/finalization-readiness',
      privateRouteSchema(
        'getMatrixCorpusFinalizationReadiness',
        'Read exact finalization projection digest after artifact staging',
        {
          params: runParamsJsonSchema,
          headers: {
            ...internalHeadersJsonSchema,
            required: [
              'x-internal-auth',
              'x-matrix-corpus-runtime-audience',
              'x-matrix-corpus-user-id',
              'x-matrix-corpus-lease-fence',
            ],
            properties: {
              ...internalHeadersJsonSchema.properties,
              'x-matrix-corpus-runtime-audience': { type: 'string', enum: ['hetzner-prod'] },
              'x-matrix-corpus-user-id': safeIdJsonSchema,
              'x-matrix-corpus-lease-fence': fenceJsonSchema,
            },
          },
        },
        finalizationReadinessResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const identity = parseControlHeaders(request, request.params.runId);
        if (identity === null || !hasExactUserAndRun(identity.userId, identity.runId, deps))
          return await notFound(reply);
        const [run, manifest] = await Promise.all([
          deps.testRunRepository.getExact(identity),
          deps.manifestRepository.getExact(identity),
        ]);
        if (
          !run.ok ||
          !manifest.ok ||
          run.record.lifecycle !== 'running' ||
          run.record.artifactDelivery.status !== 'staged' ||
          run.record.artifactStageDigest === null ||
          run.record.scenarios.some(
            (scenario) => !['completed', 'stopped', 'not_run'].includes(scenario.lifecycle)
          )
        ) return await reply.ok({ kind: 'not_ready' });
        const projectedScenarios = run.record.scenarios.filter(
          (scenario) => scenario.sessionId !== null
        );
        if (
          projectedScenarios.length !== manifest.manifest.scenarioBindings.length ||
          projectedScenarios.some(
            (scenario) =>
              !manifest.manifest.scenarioBindings.some(
                (binding) =>
                  binding.scenarioId === scenario.scenarioId &&
                  binding.sessionId === scenario.sessionId
              )
          )
        ) return await reply.ok({ kind: 'not_ready' });
        const scenarios = await Promise.all(
          projectedScenarios.map(async (scenario) =>
            await deps.testRunRepository.getScenarioConsistent({
              runId: identity.runId,
              userId: identity.userId,
              scenarioId: scenario.scenarioId,
            })
          )
        );
        const projections = [];
        for (const scenario of scenarios) {
          if (!scenario.ok) return await reply.ok({ kind: 'not_ready' });
          projections.push(scenario.projection);
        }
        return await reply.ok({
          kind: 'ready',
          runId: identity.runId,
          userId: identity.userId,
          leaseFence: identity.leaseFence,
          revision: run.record.revision,
          projectionDigest: digestMatrixCorpusFinalizationProjection(run.record, projections),
          artifactStageDigest: run.record.artifactStageDigest,
        });
      }
    );

    fastify.get<{ Params: { runId: string; scenarioId: string } }>(
      '/internal/matrix-corpus/runs/:runId/scenarios/:scenarioId/evidence',
      privateRouteSchema(
        'getMatrixCorpusSafeEvidence',
        'Read exact-revision closed Matrix corpus evidence',
        { params: evidenceParamsJsonSchema, headers: evidenceHeadersJsonSchema },
        safeEvidenceResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const parsed = parseEvidenceHeaders(request, request.params);
        if (
          parsed === null ||
          !hasExactUserAndRun(parsed.identity.userId, parsed.identity.runId, deps)
        )
          return await notFound(reply);
        let result: Awaited<ReturnType<MatrixCorpusEvidenceService['getExact']>>;
        try {
          result = await deps.evidenceService.getExact(parsed);
        } catch {
          request.log.warn(
            { stage: 'matrix_corpus_evidence', code: 'EVIDENCE_READ_FAILED', _skipSentry: true },
            'Matrix corpus evidence read failed'
          );
          return await reply.fail('INTERNAL_ERROR', 'Matrix corpus evidence unavailable');
        }
        if (!result.ok)
          return result.code === 'NOT_FOUND' ? await notFound(reply) : await conflict(reply);
        return await reply.ok(result.evidence);
      }
    );

    fastify.put<{ Params: { runId: string }; Body: unknown }>(
      '/internal/test-runs/:runId/projection',
      privateRouteSchema(
        'mutateMatrixCorpusTestRunProjection',
        'Create or advance the safe Matrix corpus Test Run projection',
        { params: runParamsJsonSchema, body: projectionBodyJsonSchema },
        projectionResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const parsed = authorizedProjectionSchema.safeParse(readUnmodifiedBody(request));
        if (!parsed.success) return await invalidRequest(reply);

        const projection = parsed.data.request;
        const userId = projection.kind === 'create' ? projection.record.userId : projection.userId;
        const leaseFence =
          projection.kind === 'create'
            ? projection.record.leaseFence
            : projection.leaseFence;
        if (!hasExactUserAndRun(userId, request.params.runId, deps))
          return await notFound(reply);
        if (projection.kind === 'create' && projection.record.runId !== request.params.runId)
          return await notFound(reply);
        if (
          !(await hasValidControlMutation(
            deps,
            parsed.data.authorization,
            projection.kind === 'create' ? 'create_projection' : 'advance_projection',
            request.params.runId,
            projection,
            userId,
            leaseFence
          ))
        )
          return await invalidRequest(reply);
        const result =
          projection.kind === 'create'
            ? await deps.testRunRepository.createOrGet(projection.record)
            : await deps.testRunRepository.applyProjection({
                identity: { runId: request.params.runId, userId, leaseFence },
                command: normalizeProjectionCommand(projection.command),
              });
        if (!result.ok) return await repositoryFailure(reply, result.code);
        return await reply.ok({
          disposition: result.disposition,
          runId: result.record.runId,
          userId: result.record.userId,
          leaseFence: result.record.leaseFence,
          revision: result.record.revision,
          lifecycle: result.record.lifecycle,
          verdict: result.record.verdict,
        });
      }
    );

    fastify.put<{ Params: { runId: string }; Body: unknown }>(
      '/internal/test-runs/:runId/artifact-delivery',
      privateRouteSchema(
        'mutateMatrixCorpusTestRunArtifactDelivery',
        'Advance the closed Matrix corpus Test Run artifact delivery state',
        {
          params: runParamsJsonSchema,
          headers: artifactDeliveryHeadersJsonSchema,
          body: artifactDeliveryBodyJsonSchema,
        },
        artifactDeliveryResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const command = artifactDeliveryCommandSchema.safeParse(readUnmodifiedBody(request));
        if (!command.success) return await invalidRequest(reply);
        const identity = parseControlHeaders(request, request.params.runId);
        if (
          identity === null ||
          !hasExactUserAndRun(identity.userId, identity.runId, deps)
        )
          return await notFound(reply);
        const result = await deps.testRunRepository.applyArtifactDelivery({
          identity,
          command: command.data,
        });
        if (!result.ok) return await repositoryFailure(reply, result.code);
        return await reply.ok({
          disposition: result.disposition,
          runId: result.record.runId,
          userId: result.record.userId,
          leaseFence: result.record.leaseFence,
          revision: result.record.revision,
          lifecycle: result.record.lifecycle,
          verdict: result.record.verdict,
          artifactDelivery: result.record.artifactDelivery,
        });
      }
    );

    fastify.post<{ Params: { runId: string }; Body: unknown }>(
      '/internal/matrix-corpus/runs/:runId/terminal-control',
      privateRouteSchema(
        'applyMatrixCorpusTerminalControl',
        'Apply signed first-wins Matrix corpus terminal control',
        { params: runParamsJsonSchema, body: terminalControlBodyJsonSchema },
        terminalControlResultJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!hasInternalAuth(request)) return await unauthorized(reply);
        const envelope = matrixCorpusSignedTerminalControlV1Schema.safeParse(request.body);
        if (!envelope.success) return await invalidRequest(reply);
        const verified = await deps.verifyAttestation(envelope.data);
        if (!verified.ok || verified.claims.kind !== 'matrix_corpus_terminal_control')
          return await invalidRequest(reply);
        const { claims } = verified;
        const control = claims.payload;
        if (
          control.runId !== request.params.runId ||
          !hasExactUserAndRun(control.userId, control.runId, deps)
        )
          return await notFound(reply);
        const identity = {
          runId: control.runId,
          userId: control.userId,
          leaseFence: control.leaseFence,
        };
        let winner;
        if (control.kind === 'abandoned') {
          const result = await deps.testRunRepository.applyAbandonedRecovery({
            identity,
            command: {
              kind: 'abandoned',
              eventId: control.eventId,
              payloadDigest: claims.payloadDigest,
              acknowledgedAt: deps.now(),
            },
          });
          if (!result.ok) return await repositoryFailure(reply, result.code);
          winner = result.winner;
        } else {
          const result = await deps.testRunRepository.applyTerminalControl({
            identity,
            command: {
              kind: 'release',
              eventId: control.eventId,
              payloadDigest: claims.payloadDigest,
              tombstoneDigest: control.tombstoneDigest,
              terminalCandidateDigest: control.terminalCandidateDigest,
              artifactStageDigest: control.artifactStageDigest,
              acknowledgedAt: deps.now(),
            },
          });
          if (!result.ok) return await repositoryFailure(reply, result.code);
          if (result.record.terminalWinner === null) return await conflict(reply);
          winner = result.record.terminalWinner;
        }
        return await reply.ok({
          kind: 'acknowledged',
          runId: identity.runId,
          leaseFence: identity.leaseFence,
          requestEventId: control.eventId,
          requestPayloadDigest: claims.payloadDigest,
          winner,
        });
      }
    );

    done();
  };
}

function normalizeProjectionCommand(
  command: z.infer<typeof testRunProjectionCasCommandV1Schema>
): TestRunProjectionCasCommandV1 {
  const { retentionReconciled, ...required } = command;
  return retentionReconciled === true
    ? { ...required, retentionReconciled: true }
    : required;
}

function hasInternalAuth(request: FastifyRequest): boolean {
  return validateInternalAuth(request).valid;
}

function hasExactUserAndRun(
  userId: string,
  runId: string,
  deps: MatrixCorpusRoutesDependencies
): boolean {
  return userId === deps.configuredUserId && matrixCorpusSafeIdSchema.safeParse(runId).success;
}

async function hasValidControlMutation(
  deps: MatrixCorpusRoutesDependencies,
  authorization: z.infer<typeof matrixCorpusSignedControlMutationV1Schema>,
  operation:
    | 'register_context'
    | 'finalize_run'
    | 'create_projection'
    | 'advance_projection',
  runId: string,
  request: Record<string, unknown>,
  userId: string,
  leaseFence: string
): Promise<boolean> {
  const verified = await deps.verifyAttestation(authorization);
  if (!verified.ok || verified.claims.kind !== 'matrix_corpus_control_mutation') return false;
  const { claims } = verified;
  const control = claims.payload;
  let requestDigest: string;
  try {
    requestDigest = createHash('sha256')
      .update(
        canonicalMatrixCorpusControlRequestDigestInputV1({
          version: 1,
          operation,
          runId,
          request,
        }),
        'utf8'
      )
      .digest('hex');
  } catch {
    return false;
  }
  return (
    claims.eventId === authorization.eventId &&
    claims.leaseFence === authorization.leaseFence &&
    claims.payloadDigest === authorization.payloadDigest &&
    control.kind === operation &&
    control.runId === runId &&
    control.userId === userId &&
    control.leaseFence === leaseFence &&
    control.requestDigest === requestDigest
  );
}

function parseControlHeaders(
  request: FastifyRequest,
  runId: string
): Readonly<{ runId: string; userId: string; leaseFence: string }> | null {
  const parsed = contextIdentitySchema.safeParse({
    runtimeAudience: request.headers['x-matrix-corpus-runtime-audience'],
    userId: request.headers['x-matrix-corpus-user-id'],
    leaseFence: request.headers['x-matrix-corpus-lease-fence'],
  });
  return parsed.success ? { runId, userId: parsed.data.userId, leaseFence: parsed.data.leaseFence } : null;
}

function parseEvidenceHeaders(
  request: FastifyRequest,
  params: Readonly<{ runId: string; scenarioId: string }>
): Readonly<{
  identity: {
    runId: string;
    scenarioId: string;
    sessionId: string;
    userId: string;
    leaseFence: string;
  };
  expectedEventRevision: number;
}> | null {
  const parsed = z
    .object({
      runtimeAudience: z.literal('hetzner-prod'),
      userId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      sessionId: matrixCorpusSafeIdSchema,
      eventRevision: z.string().regex(/^(0|[1-9][0-9]{0,15})$/u),
      runId: matrixCorpusSafeIdSchema,
      scenarioId: matrixCorpusSafeIdSchema,
    })
    .strict()
    .safeParse({
      runtimeAudience: request.headers['x-matrix-corpus-runtime-audience'],
      userId: request.headers['x-matrix-corpus-user-id'],
      leaseFence: request.headers['x-matrix-corpus-lease-fence'],
      sessionId: request.headers['x-matrix-corpus-session-id'],
      eventRevision: request.headers['x-matrix-corpus-event-revision'],
      runId: params.runId,
      scenarioId: params.scenarioId,
    });
  if (!parsed.success) return null;
  const expectedEventRevision = Number(parsed.data.eventRevision);
  if (!Number.isSafeInteger(expectedEventRevision)) return null;
  return {
    identity: {
      runId: parsed.data.runId,
      scenarioId: parsed.data.scenarioId,
      sessionId: parsed.data.sessionId,
      userId: parsed.data.userId,
      leaseFence: parsed.data.leaseFence,
    },
    expectedEventRevision,
  };
}

function digestClosedValue(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function readUnmodifiedBody(request: FastifyRequest): unknown {
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
  /* v8 ignore start -- schema: the registered Fastify raw-body plugin always provides rawBody for these JSON mutation routes, so the fallback cannot run in service composition @preserve */
  if (rawBody === undefined) return request.body;
  /* v8 ignore stop @preserve */
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  /* v8 ignore start -- schema: the closed run-context and terminal-candidate schemas passed to this helper cannot contain array fields @preserve */
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  /* v8 ignore stop @preserve */
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function closedJsonObject(
  allowed: readonly string[],
  required: readonly string[],
  properties: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...required],
    properties: Object.fromEntries(allowed.map((key) => [key, properties[key]])),
  } as const;
}

function nullableJsonSchema(
  schema: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return { oneOf: [schema, { type: 'null' }] } as const;
}

const diagnosticsJsonSchema = closedJsonObject(
  ['requestId', 'durationMs'],
  ['requestId', 'durationMs'],
  {
    requestId: { type: 'string', minLength: 1 },
    durationMs: { type: 'number', minimum: 0 },
  }
);

function successEnvelopeJsonSchema(
  data: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return closedJsonObject(['success', 'data', 'diagnostics'], ['success', 'data', 'diagnostics'], {
    success: { type: 'boolean', enum: [true] },
    data,
    diagnostics: diagnosticsJsonSchema,
  });
}

const failureEnvelopeJsonSchema = closedJsonObject(
  ['success', 'error', 'diagnostics'],
  ['success', 'error', 'diagnostics'],
  {
    success: { type: 'boolean', enum: [false] },
    error: closedJsonObject(['code', 'message'], ['code', 'message'], {
      code: { type: 'string', pattern: '^[A-Z][A-Z_]{1,63}$' },
      message: { type: 'string', minLength: 1 },
    }),
    diagnostics: diagnosticsJsonSchema,
  }
);

function privateRouteSchema(
  operationId: string,
  summary: string,
  input: Readonly<{
    params?: Readonly<Record<string, unknown>>;
    body?: Readonly<Record<string, unknown>>;
    headers?: Readonly<Record<string, unknown>>;
  }>,
  successDataSchema: Readonly<Record<string, unknown>>
): Readonly<{
  attachValidation: true;
  schema: Readonly<Record<string, unknown>>;
}> {
  return {
    attachValidation: true,
    schema: {
      operationId,
      summary,
      tags: ['intex-agent'],
      headers: input.headers ?? internalHeadersJsonSchema,
      ...(input.params === undefined ? {} : { params: input.params }),
      ...(input.body === undefined ? {} : { body: input.body }),
      response: {
        200: successEnvelopeJsonSchema(successDataSchema),
        400: failureEnvelopeJsonSchema,
        401: failureEnvelopeJsonSchema,
        404: failureEnvelopeJsonSchema,
        409: failureEnvelopeJsonSchema,
        410: failureEnvelopeJsonSchema,
        500: failureEnvelopeJsonSchema,
      },
    },
  } as const;
}

async function unauthorized(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('UNAUTHORIZED', 'Internal authentication failed');
}

async function invalidRequest(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('INVALID_REQUEST', 'Invalid Matrix corpus request');
}

async function notFound(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('NOT_FOUND', 'Matrix corpus resource not found');
}

async function conflict(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('CONFLICT', 'Matrix corpus state conflict');
}

async function closedServiceFailure(reply: FastifyReply, code: string): Promise<FastifyReply> {
  if (code === 'NOT_FOUND') return await notFound(reply);
  if (code === 'EXPIRED') return await reply.fail('GONE', 'Matrix corpus context expired');
  if (code === 'INVALID_INPUT') return await invalidRequest(reply);
  return await conflict(reply);
}

async function repositoryFailure(reply: FastifyReply, code: string): Promise<FastifyReply> {
  if (code === 'NOT_FOUND') return await notFound(reply);
  if (code === 'INVALID_INPUT') return await invalidRequest(reply);
  return await conflict(reply);
}
