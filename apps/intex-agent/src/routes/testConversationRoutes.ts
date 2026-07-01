import { getErrorMessage } from '@intexuraos/common-core';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { IntexAgentToolName } from '../domain/sessions/types.js';
import type {
  TestConversationTurnInput,
  TestConversationHttpRequest,
} from '../domain/testConversation/testConversationTypes.js';
import { getServices } from '../services.js';

const TEST_USER_ID_PATTERN = /^test-intex-agent-[a-z0-9._-]{1,96}$/u;
const RUN_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const SECRET_FIELD_PATTERN =
  /token|secret|password|key|authorization|auth|credential|promptblock|preference|toolargs|replycontext|whatsappsender/iu;
const SECRET_TEXT_PATTERN =
  /\b(?:token|secret|password|credential|authorization|api\s*key)\b\s*(?::|=|\s)\s*\S+/iu;
const TOOL_MOCK_ALLOWED_RESULT_FIELDS: Record<IntexAgentToolName, ReadonlySet<string>> = {
  create_note: new Set(['status', 'message', 'resourceUrl']),
  create_calendar_event: new Set(['status', 'eventId', 'summary', 'htmlLink']),
  query_calendar_events: new Set(['status', 'mode', 'count', 'events']),
  create_research: new Set(['status', 'message', 'resourceUrl']),
  create_link: new Set(['status', 'bookmarkId', 'resourceUrl', 'url']),
  create_code_task: new Set(['status', 'message', 'codeTaskId', 'resourceUrl']),
  save_external: new Set(['status', 'message']),
  get_user_preferences: new Set(['status', 'currentVersion', 'items']),
  add_user_preference: new Set(['status', 'currentVersion', 'changedItemId']),
  update_user_preference: new Set(['status', 'currentVersion', 'changedItemId']),
  delete_user_preference: new Set(['status', 'currentVersion', 'changedItemId']),
};
const TOOL_MOCK_URL_FIELDS = new Set(['resourceUrl', 'htmlLink', 'url']);
const CALENDAR_EVENT_MOCK_FIELDS = new Set([
  'id',
  'summary',
  'start',
  'end',
  'timeZone',
  'location',
  'description',
  'status',
  'calendarId',
]);
const KNOWN_TOOL_NAMES = new Set<IntexAgentToolName>([
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

/* v8 ignore start -- schema: Fastify schema object cannot be tracked as executed through route injection behavior @preserve */
const testConversationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['contractVersion', 'mode', 'runId', 'userId', 'currentDateTime', 'turns'],
  properties: {
    contractVersion: { type: 'string', enum: ['2026-07-01'] },
    mode: { type: 'string' },
    runId: { type: 'string', minLength: 1, maxLength: 128 },
    scenarioId: { type: 'string', minLength: 1, maxLength: 128 },
    userId: { type: 'string', minLength: 1, maxLength: 128 },
    currentDateTime: { type: 'string', minLength: 1 },
    timeZone: { type: 'string', minLength: 1, maxLength: 128 },
    turns: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'text'],
            properties: {
              kind: { type: 'string', enum: ['message'] },
              messageId: { type: 'string', minLength: 1, maxLength: 256 },
              text: { type: 'string', maxLength: 4000 },
              timestamp: { type: 'string', minLength: 1 },
              sourceType: { type: 'string', minLength: 1, maxLength: 128 },
              sourceUrl: { type: 'string', maxLength: 2048 },
              whatsappSender: { type: 'string', maxLength: 128 },
              replyContext: {
                type: 'object',
                additionalProperties: false,
                required: ['replyToWamid', 'source', 'text', 'truncated'],
                properties: {
                  replyToWamid: { type: 'string', minLength: 1, maxLength: 256 },
                  source: {
                    type: 'string',
                    enum: ['inbound_user_message', 'outbound_assistant_message'],
                  },
                  text: { type: 'string', minLength: 1, maxLength: 4000 },
                  truncated: { type: 'boolean' },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'previousTurnIndex', 'decision'],
            properties: {
              kind: { type: 'string', enum: ['confirmation_button'] },
              previousTurnIndex: { type: 'integer', minimum: 0, maximum: 4 },
              decision: { type: 'string', enum: ['accept', 'reject'] },
              messageId: { type: 'string', minLength: 1, maxLength: 256 },
              timestamp: { type: 'string', minLength: 1 },
            },
          },
        ],
      },
    },
    toolMocks: {
      type: 'object',
      additionalProperties: true,
    },
  },
} as const;
/* v8 ignore stop @preserve */

export const testConversationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: unknown }>(
    '/internal/intex-agent/test/conversation',
    {
      bodyLimit: 64 * 1024,
      onRequest: (_request, reply, done): void => {
        if (process.env['INTEXURAOS_ENVIRONMENT'] === 'prod') {
          void reply.fail('NOT_FOUND', 'Route not found');
          return;
        }
        done();
      },
      schema: {
        operationId: 'runIntexAgentTestConversation',
        summary: 'Run an internal Intex Agent test conversation',
        description:
          'Internal local/dev-only endpoint for test conversations with captured replies and mocked tool execution.',
        tags: ['internal'],
        body: testConversationBodySchema,
      },
    },
    async (
      request: FastifyRequest<{ Body: unknown }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/intex-agent/test/conversation',
        bodyPreviewLength: 0,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn('Internal auth failed for intex-agent test conversation');
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for intex-agent test conversation'
        );
      }

      const validationError = validateTestConversationRequest(request.body);
      if (validationError !== null) {
        request.log.warn(
          { runId: safeBodyString(request.body, 'runId'), userId: safeBodyString(request.body, 'userId') },
          'Invalid intex-agent test conversation request'
        );
        return await reply.fail('INVALID_REQUEST', validationError);
      }
      const validatedBody = request.body as TestConversationHttpRequest;

      try {
        request.log.info(
          {
            runId: validatedBody.runId,
            userId: validatedBody.userId,
            mode: validatedBody.mode,
            turnCount: validatedBody.turns.length,
          },
          'Running intex-agent test conversation'
        );
        const result = await getServices().testConversationRunner.run(validatedBody);
        return await reply.ok(result);
      } catch (error) {
        request.log.error(
          { error: getErrorMessage(error, 'Unknown test conversation error') },
          'Intex-agent test conversation failed'
        );
        return await reply.fail('INTERNAL_ERROR', 'Test conversation failed');
      }
    }
  );

  done();
};

function validateTestConversationRequest(input: unknown): string | null {
  /* v8 ignore start -- schema: Fastify rejects non-object bodies before custom validation @preserve */
  if (!isRecord(input)) {
    return 'Request body must be an object';
  }
  /* v8 ignore stop @preserve */
  if (input['mode'] !== 'live_llm_mock_tools') {
    return 'mode must be live_llm_mock_tools';
  }
  const runId = input['runId'];
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    return 'runId must be lowercase and contain only letters, numbers, dot, underscore, or dash';
  }
  const userId = input['userId'];
  if (typeof userId !== 'string' || !TEST_USER_ID_PATTERN.test(userId)) {
    return 'userId must use the test-intex-agent namespace';
  }
  if (userId !== `test-intex-agent-${runId}`) {
    return 'userId must equal test-intex-agent-<runId>';
  }
  const currentDateTime = input['currentDateTime'];
  /* v8 ignore start -- schema: Fastify schema validation guarantees currentDateTime is a string before custom validation @preserve */
  if (typeof currentDateTime !== 'string') {
    return 'currentDateTime must be a valid date-time string';
  }
  /* v8 ignore stop @preserve */
  const date = Date.parse(currentDateTime);
  if (!Number.isFinite(date)) {
    return 'currentDateTime must be a valid date-time string';
  }
  const turns = input['turns'];
  /* v8 ignore start -- schema: Fastify schema validation guarantees turns is an array before custom validation @preserve */
  if (!Array.isArray(turns)) {
    return 'turns must be an array';
  }
  /* v8 ignore stop @preserve */
  const confirmationError = validateConfirmationTurns(turns as TestConversationTurnInput[]);
  if (confirmationError !== null) {
    return confirmationError;
  }
  return validateToolMocks(input['toolMocks']);
}

function validateConfirmationTurns(turns: readonly TestConversationTurnInput[]): string | null {
  for (const [index, turn] of turns.entries()) {
    if (turn.kind === 'confirmation_button' && turn.previousTurnIndex >= index) {
      return 'confirmation_button previousTurnIndex must reference an earlier turn';
    }
  }
  return null;
}

function validateToolMocks(mocks: unknown): string | null {
  if (mocks === undefined) {
    return null;
  }
  /* v8 ignore start -- schema: Fastify rejects non-object toolMocks before custom validation @preserve */
  if (!isRecord(mocks)) {
    return 'toolMocks must be an object';
  }
  /* v8 ignore stop @preserve */
  for (const [toolName, mock] of Object.entries(mocks)) {
    if (!KNOWN_TOOL_NAMES.has(toolName as IntexAgentToolName)) {
      return `Unknown tool mock: ${toolName}`;
    }
    const mockError = validateToolMock(toolName as IntexAgentToolName, mock);
    if (mockError !== null) {
      return mockError;
    }
  }
  return null;
}

function validateToolMock(toolName: IntexAgentToolName, mock: unknown): string | null {
  if (!isRecord(mock) || (mock['mode'] !== 'success' && mock['mode'] !== 'failure')) {
    return 'toolMocks entries must declare success or failure mode';
  }
  if (mock['mode'] === 'failure') {
    const unsupportedKeys = Object.keys(mock).filter((key) => key !== 'mode' && key !== 'message');
    if (unsupportedKeys.length > 0) {
      return `tool mock failure contains unsupported field: ${unsupportedKeys.join(', ')}`;
    }
    const message = mock['message'];
    if (typeof message !== 'string') {
      return 'tool mock failure message must be a string';
    }
    const messageError = validateBoundedString(message, 'tool mock failure message');
    if (messageError !== null) {
      return messageError;
    }
    return SECRET_TEXT_PATTERN.test(message)
      ? 'tool mock failure message must not contain secret-like text'
      : null;
  }
  const unsupportedKeys = Object.keys(mock).filter((key) => key !== 'mode' && key !== 'result');
  if (unsupportedKeys.length > 0) {
    return `tool mock success contains unsupported field: ${unsupportedKeys.join(', ')}`;
  }
  const result = mock['result'];
  if (!isRecord(result)) {
    return 'tool mock success result must be an object';
  }
  return validateMockResult(toolName, result);
}

function validateMockResult(
  toolName: IntexAgentToolName,
  result: Record<string, unknown>
): string | null {
  const allowedFields = TOOL_MOCK_ALLOWED_RESULT_FIELDS[toolName];
  for (const [key, value] of Object.entries(result)) {
    if (!allowedFields.has(key)) {
      return `toolMocks result field is not allowed for ${toolName}: ${key}`;
    }
    const valueError = validateMockValue(toolName, value, key);
    if (valueError !== null) {
      return valueError;
    }
  }
  return null;
}

function validateMockValue(
  toolName: IntexAgentToolName,
  value: unknown,
  key: string
): string | null {
  if (typeof value === 'string') {
    const stringError = validateBoundedString(value, `toolMocks result field ${key}`);
    if (stringError !== null) return stringError;
    if (TOOL_MOCK_URL_FIELDS.has(key)) {
      return validateHttpUrl(value, key);
    }
    return null;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) {
      return `toolMocks result array is too large: ${key}`;
    }
    if (toolName === 'query_calendar_events' && key === 'events') {
      return validateCalendarEventMocks(value);
    }
    return value.every((item) => item === null || typeof item !== 'object')
      ? null
      : `toolMocks result array contains nested objects: ${key}`;
  }
  return `toolMocks result nested objects are not allowed: ${key}`;
}

function validateCalendarEventMocks(events: readonly unknown[]): string | null {
  for (const event of events) {
    if (!isRecord(event)) {
      return 'toolMocks calendar events must be objects';
    }
    for (const [key, value] of Object.entries(event)) {
      if (!CALENDAR_EVENT_MOCK_FIELDS.has(key) || SECRET_FIELD_PATTERN.test(key)) {
        return `toolMocks calendar event field is not allowed: ${key}`;
      }
      const stringError =
        typeof value === 'string' ? validateBoundedString(value, `toolMocks calendar event field ${key}`) : null;
      if (stringError !== null) {
        return stringError;
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && value !== null) {
        return `toolMocks calendar event field is unsupported: ${key}`;
      }
    }
  }
  return null;
}

function validateBoundedString(value: string, label: string): string | null {
  return value.length <= 2048 ? null : `${label} is too long`;
}

function validateHttpUrl(value: string, key: string): string | null {
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/#/')) {
    return null;
  }
  return `toolMocks result URL must be http, https, or app-relative: ${key}`;
}

function safeBodyString(body: unknown, key: string): string | undefined {
  /* v8 ignore start -- schema: Fastify rejects non-object bodies before custom validation logging @preserve */
  if (!isRecord(body)) {
    return undefined;
  }
  /* v8 ignore stop @preserve */
  const value = body[key];
  /* v8 ignore start -- schema: route custom validation only logs schema-valid string runId and userId values @preserve */
  return typeof value === 'string' ? value : undefined;
  /* v8 ignore stop @preserve */
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
