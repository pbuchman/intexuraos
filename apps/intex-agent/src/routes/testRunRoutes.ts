import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import {
  testRunDtoV1Schema,
  testRunListDtoV1Schema,
  testScenarioDtoV1Schema,
} from '@intexuraos/http-contracts';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';

import type { TestRunRepository } from '../domain/testRuns/ports/testRunRepository.js';
import type { IntexAgentTestRunRecordV1 } from '../domain/testRuns/types.js';
import {
  isVisibleRetainedTestRun,
  selectRetainedTestRuns,
  TEST_RUN_RETENTION_QUERY_LIMIT,
} from '../domain/testRuns/retention.js';
import {
  mapPublicTestRun,
  mapPublicTestRunHeader,
  mapPublicTestScenario,
} from '../domain/testRuns/safeMapper.js';

type TestRunReadRepository = Pick<
  TestRunRepository,
  'listLatestForUser' | 'getScenarioConsistent'
>;

export interface TestRunRoutesDependencies {
  enabled: boolean;
  runtimeAudience: string;
  configuredUserId: string;
  repository: TestRunReadRepository;
}

const safeIdJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$',
} as const;
const TEST_RUN_REQUEST_LOG_OPTIONS = {
  message: 'Received protected Test Runs request',
  bodyPreviewLength: 0,
  includeHeaders: false,
  includeParams: false,
} as const;
const runParamsJsonSchema = closedObject(['runId'], {
  runId: safeIdJsonSchema,
});
const scenarioParamsJsonSchema = closedObject(['runId', 'scenarioId'], {
  runId: safeIdJsonSchema,
  scenarioId: safeIdJsonSchema,
});
const diagnosticsJsonSchema = closedObject(['requestId', 'durationMs'], {
  requestId: { type: 'string', minLength: 1 },
  durationMs: { type: 'number', minimum: 0 },
});
const failureEnvelopeJsonSchema = closedObject(['success', 'error', 'diagnostics'], {
  success: { type: 'boolean', enum: [false] },
  error: closedObject(['code', 'message'], {
    code: {
      type: 'string',
      enum: ['INVALID_REQUEST', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'INTERNAL_ERROR'],
    },
    message: { type: 'string', minLength: 1 },
  }),
  diagnostics: diagnosticsJsonSchema,
});

export function createTestRunRoutes(
  deps: TestRunRoutesDependencies
): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.get(
      '/test-runs',
      publicRouteSchema('listIntexAgentTestRuns', 'IntexAgentTestRunList'),
      async (request, reply) => {
        logIncomingRequest(request, TEST_RUN_REQUEST_LOG_OPTIONS);
        if (hasNonEmptyQuery(request)) return await invalidRequest(reply);
        preparePublicRead(reply);
        const userId = await authorizeEvaluator(request, reply, deps);
        if (userId === null) return;
        const retained = await readRetainedRuns(userId, deps, reply);
        if (retained === null) return;
        try {
          const data = testRunListDtoV1Schema.parse({
            runs: retained.map(mapPublicTestRunHeader),
          });
          return await reply.ok(data);
        } catch {
          return await internalFailure(reply);
        }
      }
    );

    fastify.get<{ Params: { runId: string } }>(
      '/test-runs/:runId',
      publicRouteSchema('getIntexAgentTestRun', 'IntexAgentTestRun', runParamsJsonSchema),
      async (request, reply) => {
        logIncomingRequest(request, TEST_RUN_REQUEST_LOG_OPTIONS);
        if (hasNonEmptyQuery(request)) return await invalidRequest(reply);
        preparePublicRead(reply);
        const userId = await authorizeEvaluator(request, reply, deps);
        if (userId === null) return;
        const retained = await readRetainedRuns(userId, deps, reply);
        if (retained === null) return;
        const record = retained.find((candidate) => candidate.runId === request.params.runId);
        if (record === undefined) return await notFound(reply);
        try {
          return await reply.ok(testRunDtoV1Schema.parse(mapPublicTestRun(record)));
        } catch {
          return await internalFailure(reply);
        }
      }
    );

    fastify.get<{ Params: { runId: string; scenarioId: string } }>(
      '/test-runs/:runId/scenarios/:scenarioId',
      publicRouteSchema(
        'getIntexAgentTestRunScenario',
        'IntexAgentTestScenario',
        scenarioParamsJsonSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, TEST_RUN_REQUEST_LOG_OPTIONS);
        if (hasNonEmptyQuery(request)) return await invalidRequest(reply);
        preparePublicRead(reply);
        const userId = await authorizeEvaluator(request, reply, deps);
        if (userId === null) return;
        const retained = await readRetainedRuns(userId, deps, reply);
        if (retained === null) return;
        if (!isVisibleRetainedTestRun(request.params.runId, retained))
          return await notFound(reply);
        const result = await deps.repository.getScenarioConsistent({
          runId: request.params.runId,
          scenarioId: request.params.scenarioId,
          userId,
        });
        if (!result.ok)
          return result.code === 'STALE_PROJECTION'
            ? await staleProjection(reply)
            : await notFound(reply);
        try {
          return await reply.ok(
            testScenarioDtoV1Schema.parse(
              mapPublicTestScenario({
                run: result.run,
                projection: result.projection,
                events: result.events,
              })
            )
          );
        } catch {
          return await staleProjection(reply);
        }
      }
    );

    done();
  };
}

function preparePublicRead(reply: FastifyReply): void {
  void reply.header('Cache-Control', 'no-store');
}

async function authorizeEvaluator(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: TestRunRoutesDependencies
): Promise<string | null> {
  const user = await requireAuth(request, reply);
  if (user === null) return null;
  if (!deps.enabled || deps.runtimeAudience !== 'hetzner-prod' || user.userId !== deps.configuredUserId) {
    await notFound(reply);
    return null;
  }
  return user.userId;
}

async function readRetainedRuns(
  userId: string,
  deps: TestRunRoutesDependencies,
  reply: FastifyReply
): Promise<IntexAgentTestRunRecordV1[] | null> {
  const listed = await deps.repository.listLatestForUser(
    userId,
    TEST_RUN_RETENTION_QUERY_LIMIT
  );
  if (!listed.ok) {
    await internalFailure(reply);
    return null;
  }
  try {
    return selectRetainedTestRuns(listed.records);
  } catch {
    await internalFailure(reply);
    return null;
  }
}

async function notFound(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('NOT_FOUND', 'Test Runs resource not found');
}

async function invalidRequest(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('INVALID_REQUEST', 'Invalid Test Runs request');
}

function hasNonEmptyQuery(request: FastifyRequest): boolean {
  /* v8 ignore start -- upstream: Fastify always provides raw.url for an injected or network request; empty fallback only guards a malformed adapter @preserve */
  const url = request.raw.url ?? '';
  /* v8 ignore stop @preserve */
  const queryStart = url.indexOf('?');
  return queryStart >= 0 && queryStart < url.length - 1;
}

async function staleProjection(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('CONFLICT', 'Test Runs projection is stale; retry the request');
}

async function internalFailure(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('INTERNAL_ERROR', 'Test Runs data unavailable');
}

function publicRouteSchema(
  operationId: string,
  responseSchemaId: string,
  params?: Readonly<Record<string, unknown>>
): Readonly<{ schema: Readonly<Record<string, unknown>> }> {
  return {
    schema: {
      operationId,
      summary: operationId,
      tags: ['intex-agent'],
      security: [{ bearerAuth: [] }],
      querystring: closedObject([], {}),
      ...(params === undefined ? {} : { params }),
      response: {
        200: successEnvelopeJsonSchema(responseSchemaId),
        400: failureEnvelopeJsonSchema,
        401: failureEnvelopeJsonSchema,
        404: failureEnvelopeJsonSchema,
        409: failureEnvelopeJsonSchema,
        500: failureEnvelopeJsonSchema,
      },
    },
  } as const;
}

function successEnvelopeJsonSchema(schemaId: string): Readonly<Record<string, unknown>> {
  return closedObject(['success', 'data', 'diagnostics'], {
    success: { type: 'boolean', enum: [true] },
    data: { $ref: `${schemaId}#` },
    diagnostics: diagnosticsJsonSchema,
  });
}

function closedObject(
  required: readonly string[],
  properties: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...required],
    properties,
  } as const;
}
