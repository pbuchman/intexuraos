# Calendar Event Queries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Intex Agent to answer read-only calendar event questions such as "What are my events scheduled for next week?" and "How many times last month did I have Dentist?"

**Architecture:** Add a typed internal calendar-agent list-events endpoint, expose it through `@intexuraos/internal-clients`, then add one read-only `query_calendar_events` Intex Agent tool that calls that client. Keep the existing one-tool-per-turn safety model; the new tool is the only path for calendar inspection and it must not create, update, or delete events.

**Tech Stack:** Fastify routes, `@intexuraos/http-contracts` Zod schemas, `@intexuraos/internal-clients`, Intex Agent tool-calling runner, Vitest, `pnpm run verify:workspace:tracked`.

## Global Constraints

- No implementation in the planning PR; execute this plan in an execution task.
- Use `gh` for branch, diff, log, and PR operations when available; use `git add` and `git commit` only where `gh` has no equivalent.
- Maintain TypeScript strictness: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`.
- Follow test-first workflow: write failing tests, confirm failure, implement, verify pass.
- Bump `INTEX_AGENT_SYSTEM_PROMPT.version` because prompt behavior changes from rejecting calendar reads to permitting a read tool.
- Do not add new environment variables.
- Keep all calendar reads bounded by `timeMin` and `timeMax`.
- Interpret "next week" as the next calendar week after the current week; interpret "last month" as the previous calendar month unless the user says "last 30 days".

---

## File Structure

- Modify `packages/http-contracts/src/zod/calendar-agent.ts`: add list-events request, data, and response schemas.
- Modify `packages/http-contracts/src/zod/index.ts`, `packages/http-contracts/src/index.ts`, `packages/http-contracts/src/fastify-schemas.ts`, and `packages/http-contracts/src/openapi-schemas.ts`: export/register the new contract components.
- Modify `packages/http-contracts/src/__tests__/zod-contracts.test.ts`, `packages/http-contracts/src/__tests__/fastify-schemas.test.ts`, and `packages/http-contracts/src/__tests__/openapi-schemas.test.ts`: cover the new schemas.
- Modify `apps/calendar-agent/src/routes/internalRoutes.ts`: create `POST /internal/calendar/events/query`.
- Modify `apps/calendar-agent/src/__tests__/fakes.ts` and `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts`: capture list-events inputs and test the internal endpoint.
- Modify `packages/internal-clients/src/calendar-agent/types.ts`, `packages/internal-clients/src/calendar-agent/client.ts`, and `packages/internal-clients/src/calendar-agent/__tests__/client.test.ts`: expose `listEvents`.
- Modify `apps/intex-agent/src/domain/sessions/types.ts`: add `query_calendar_events` to `IntexAgentToolName`.
- Modify `apps/intex-agent/src/domain/agent/toolDefinitions.ts`: define `QueryCalendarEventsToolArgs` and the read-only tool schema.
- Modify `apps/intex-agent/src/domain/agent/toolExecutor.ts`: call the calendar client and return event/count JSON to the LLM.
- Modify `apps/intex-agent/src/domain/agent/intentGate.ts`: route read-only calendar questions to `query_calendar_events`.
- Modify `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` and `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`: pass current date-time into the runner and expose the new tool.
- Modify `apps/intex-agent/src/domain/agent/systemPrompt.ts`: document the read-only tool and relative date rules.
- Modify Intex Agent tests under `apps/intex-agent/src/__tests__/domain/`: cover the tool, executor, intent gate, runner, and prompt.
- Modify `docs/services/intex-agent/features.md`, `docs/services/intex-agent/technical.md`, and `docs/services/intex-agent/technical-debt.md`: update the service capability docs.

## Endpoint Changes

- Created: `POST /internal/calendar/events/query`
- Modified: none
- Removed: none
- Unchanged: public `GET /events`, public `GET /events/:eventId`, internal `POST /internal/calendar/events`

## Contracts

`POST /internal/calendar/events/query` request body:

```ts
{
  userId: string;
  calendarId?: string;
  timeMin: string;
  timeMax: string;
  maxResults?: number;
  q?: string;
}
```

`POST /internal/calendar/events/query` success body:

```ts
{
  success: true;
  data: {
    events: CalendarCreatedEvent[];
  };
}
```

`query_calendar_events` tool arguments:

```ts
{
  mode: 'list' | 'count';
  timeMin: string;
  timeMax: string;
  query?: string;
  calendarId?: string;
  maxResults?: number;
}
```

Tool execution result returned to the model:

```ts
{
  status: 'completed';
  mode: 'list' | 'count';
  count: number;
  timeMin: string;
  timeMax: string;
  query?: string;
  events?: Array<{
    id: string;
    summary: string;
    start: CalendarEventDateTime;
    end: CalendarEventDateTime;
    location?: string;
    htmlLink?: string;
  }>;
}
```

## Task 1: Calendar-Agent Internal List Endpoint

**Files:**
- Modify: `packages/http-contracts/src/zod/calendar-agent.ts`
- Modify: `packages/http-contracts/src/zod/index.ts`
- Modify: `packages/http-contracts/src/index.ts`
- Modify: `packages/http-contracts/src/fastify-schemas.ts`
- Modify: `packages/http-contracts/src/openapi-schemas.ts`
- Modify: `packages/http-contracts/src/__tests__/zod-contracts.test.ts`
- Modify: `packages/http-contracts/src/__tests__/fastify-schemas.test.ts`
- Modify: `packages/http-contracts/src/__tests__/openapi-schemas.test.ts`
- Modify: `apps/calendar-agent/src/routes/internalRoutes.ts`
- Modify: `apps/calendar-agent/src/__tests__/fakes.ts`
- Modify: `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts`

**Interfaces:**
- Consumes: existing `listEvents(request, deps)` use case from `apps/calendar-agent/src/domain/useCases/listEvents.ts`.
- Produces: internal endpoint `POST /internal/calendar/events/query` returning `{ events: CalendarCreatedEvent[] }`.

- [ ] **Step 1: Write failing contract tests**

Add assertions that parse a bounded query and reject missing bounds:

```ts
expect(calendarListEventsRequestSchema.parse({
  userId: 'user-1',
  calendarId: 'primary',
  timeMin: '2026-06-29T00:00:00.000Z',
  timeMax: '2026-07-06T00:00:00.000Z',
  maxResults: 20,
  q: 'Dentist',
})).toMatchObject({ userId: 'user-1', q: 'Dentist' });

expect(() => calendarListEventsRequestSchema.parse({
  userId: 'user-1',
  timeMin: '2026-06-29T00:00:00.000Z',
})).toThrow();
```

Add Fastify/OpenAPI schema assertions for `CalendarListEventsRequest` and `CalendarListEventsData`.

- [ ] **Step 2: Run contract tests to verify failure**

Run:

```bash
pnpm --filter @intexuraos/http-contracts test -- zod-contracts fastify-schemas openapi-schemas
```

Expected: FAIL because `calendarListEventsRequestSchema` and schema registrations do not exist.

- [ ] **Step 3: Implement calendar list contracts**

Add to `packages/http-contracts/src/zod/calendar-agent.ts`:

```ts
export const calendarListEventsRequestSchema = z
  .object({
    userId: z.string(),
    calendarId: z.string().optional(),
    timeMin: z.string(),
    timeMax: z.string(),
    maxResults: z.number().int().min(1).max(2500).optional(),
    q: z.string().optional(),
  })
  .strict();

export const calendarListEventsDataSchema = z
  .object({
    events: z.array(calendarCreatedEventSchema),
  })
  .strict();

export const calendarListEventsResponseSchema = createApiSuccessEnvelopeSchema(
  calendarListEventsDataSchema
);

export type CalendarListEventsRequest = z.infer<typeof calendarListEventsRequestSchema>;
export type CalendarListEventsData = z.infer<typeof calendarListEventsDataSchema>;
export type CalendarListEventsResponse = z.infer<typeof calendarListEventsResponseSchema>;
```

Export and register these in the package export files and schema registries.

- [ ] **Step 4: Write failing internal route tests**

In `apps/calendar-agent/src/__tests__/fakes.ts`, add a list call capture:

```ts
readonly listEventsCalls: {
  accessToken: string;
  calendarId: string;
  options: ListEventsInput;
}[] = [];
```

Push into it inside `FakeGoogleCalendarClient.listEvents`.

In `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts`, add:

```ts
it('lists events through the internal service endpoint', async () => {
  fakeCalendarClient.addEvent({
    id: 'event-1',
    summary: 'Dentist',
    start: { dateTime: '2026-06-30T09:00:00.000Z' },
    end: { dateTime: '2026-06-30T10:00:00.000Z' },
    htmlLink: 'https://calendar.google.com/event?eid=event-1',
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/calendar/events/query',
    headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    payload: {
      userId: 'user-456',
      calendarId: 'primary',
      timeMin: '2026-06-29T00:00:00.000Z',
      timeMax: '2026-07-06T00:00:00.000Z',
      maxResults: 20,
      q: 'Dentist',
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().data.events).toHaveLength(1);
  expect(fakeCalendarClient.listEventsCalls).toEqual([
    {
      accessToken: 'fake-google-token',
      calendarId: 'primary',
      options: {
        timeMin: '2026-06-29T00:00:00.000Z',
        timeMax: '2026-07-06T00:00:00.000Z',
        maxResults: 20,
        q: 'Dentist',
      },
    },
  ]);
});
```

Also test 401 without internal auth and 400 when `timeMax` is missing.

- [ ] **Step 5: Run calendar route tests to verify failure**

Run:

```bash
pnpm --filter @intexuraos/calendar-agent test -- routes/internalRoutes.test.ts
```

Expected: FAIL because `POST /internal/calendar/events/query` is not registered.

- [ ] **Step 6: Implement the internal route**

In `apps/calendar-agent/src/routes/internalRoutes.ts`, import `CalendarListEventsRequest`, `listEvents`, and `ListEventsRequest`. Register:

```ts
const errorResponseSchema = {
  description: 'Error',
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { $ref: 'ErrorBody#' },
    diagnostics: { $ref: 'Diagnostics#' },
  },
} as const;

fastify.post<{ Body: CalendarListEventsRequest }>(
  '/internal/calendar/events/query',
  {
    schema: {
      operationId: 'queryInternalCalendarEvents',
      summary: 'List calendar events for a user',
      description: 'Internal service endpoint for bounded Google Calendar event queries on behalf of a user',
      tags: ['internal'],
      body: { $ref: 'CalendarListEventsRequest#' },
      response: {
        200: {
          description: 'Success',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['events'],
              properties: {
                events: { type: 'array', items: { $ref: 'CalendarCreatedEvent#' } },
              },
            },
            diagnostics: { $ref: 'Diagnostics#' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        500: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  },
  async (request, reply) => {
    logIncomingRequest(request);

    const authResult = validateInternalAuth(request);
    if (!authResult.valid) {
      reply.status(401);
      return await reply.fail('UNAUTHORIZED', 'Unauthorized');
    }

    const services = getServices();
    const listRequest: ListEventsRequest = {
      userId: request.body.userId,
      options: {
        timeMin: request.body.timeMin,
        timeMax: request.body.timeMax,
        ...(request.body.maxResults !== undefined ? { maxResults: request.body.maxResults } : {}),
        ...(request.body.q !== undefined ? { q: request.body.q } : {}),
      },
    };
    if (request.body.calendarId !== undefined) {
      listRequest.calendarId = request.body.calendarId;
    }

    const result = await listEvents(listRequest, {
      userServiceClient: services.userServiceClient,
      googleCalendarClient: services.googleCalendarClient,
      logger: request.log,
    });

    if (!result.ok) {
      return await handleCalendarError(result.error, reply);
    }

    return await reply.ok({ events: result.value });
  }
);
```

- [ ] **Step 7: Verify Task 1**

Run:

```bash
pnpm --filter @intexuraos/http-contracts test -- zod-contracts fastify-schemas openapi-schemas
pnpm --filter @intexuraos/calendar-agent test -- routes/internalRoutes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add packages/http-contracts/src apps/calendar-agent/src
git commit -m "feat(calendar-agent): add internal event query endpoint"
```

## Task 2: Calendar Internal Client

**Files:**
- Modify: `packages/internal-clients/src/calendar-agent/types.ts`
- Modify: `packages/internal-clients/src/calendar-agent/client.ts`
- Modify: `packages/internal-clients/src/calendar-agent/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `CalendarListEventsRequest`, `CalendarCreatedEvent` from `@intexuraos/http-contracts`.
- Produces: `CalendarAgentServiceClient.listEvents(request, options?)`.

- [ ] **Step 1: Write failing client tests**

Add:

```ts
it('lists calendar events through the internal query endpoint', async () => {
  nock(BASE_URL)
    .post('/internal/calendar/events/query', {
      userId: 'user-1',
      timeMin: '2026-06-29T00:00:00.000Z',
      timeMax: '2026-07-06T00:00:00.000Z',
      q: 'Dentist',
      maxResults: 20,
    })
    .reply(200, {
      success: true,
      data: {
        events: [{
          id: 'event-1',
          summary: 'Dentist',
          start: { dateTime: '2026-06-30T09:00:00.000Z' },
          end: { dateTime: '2026-06-30T10:00:00.000Z' },
          htmlLink: 'https://calendar.google.com/event?eid=event-1',
        }],
      },
    });

  const client = createCalendarAgentServiceClient(config);
  const result = await client.listEvents({
    userId: 'user-1',
    timeMin: '2026-06-29T00:00:00.000Z',
    timeMax: '2026-07-06T00:00:00.000Z',
    q: 'Dentist',
    maxResults: 20,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value[0]).toMatchObject({
    id: 'event-1',
    summary: 'Dentist',
    htmlLink: 'https://calendar.google.com/event?eid=event-1',
  });
});
```

Also add an invalid-envelope test mirroring the existing `createEvent` invalid response cases.

- [ ] **Step 2: Run client tests to verify failure**

Run:

```bash
pnpm --filter @intexuraos/internal-clients test -- calendar-agent/client.test.ts
```

Expected: FAIL because `listEvents` is missing.

- [ ] **Step 3: Implement client types and method**

In `types.ts`, add:

```ts
import type { CalendarListEventsRequest } from '@intexuraos/http-contracts';

export type CalendarEvent = CalendarCreatedEvent;
export type ListCalendarEventsRequest = CalendarListEventsRequest;

export interface CalendarAgentServiceClient {
  listEvents(
    request: ListCalendarEventsRequest,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<CalendarEvent[]>>;
}
```

In `client.ts`, add:

```ts
const LIST_EVENTS_TIMEOUT_MS = 30_000;

async function listEvents(
  config: CalendarAgentServiceConfig,
  httpClient: InternalHttpClient,
  request: ListCalendarEventsRequest,
  options: CalendarAgentRequestOptions | undefined
): Promise<Result<CalendarEvent[]>> {
  const result = await httpClient.request<{ events: ContractCalendarCreatedEvent[] }>({
    path: '/internal/calendar/events/query',
    method: 'POST',
    body: request,
    timeoutMs: resolveTimeoutMs(LIST_EVENTS_TIMEOUT_MS, config, options),
    requestId: options?.requestId,
  });

  if (result.ok) {
    return ok(result.value.events.map(toCreatedCalendarEvent));
  }

  return err(mapCalendarHttpError(result.error, 'Failed to list calendar events'));
}
```

Expose it from `createCalendarAgentServiceClient`.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
pnpm --filter @intexuraos/internal-clients test -- calendar-agent/client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/internal-clients/src/calendar-agent
git commit -m "feat(internal-clients): support calendar event queries"
```

## Task 3: Intex Agent Calendar Query Tool

**Files:**
- Modify: `apps/intex-agent/src/domain/sessions/types.ts`
- Modify: `apps/intex-agent/src/domain/agent/toolDefinitions.ts`
- Modify: `apps/intex-agent/src/domain/agent/toolExecutor.ts`
- Modify: `apps/intex-agent/src/domain/agent/intentGate.ts`
- Modify: `apps/intex-agent/src/__tests__/domain/toolDefinitions.test.ts`
- Modify: `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts`
- Modify: `apps/intex-agent/src/__tests__/domain/intentGate.test.ts`

**Interfaces:**
- Consumes: `CalendarToolClient.listEvents(request)` from Task 2.
- Produces: read-only Intex Agent tool `query_calendar_events`.

- [ ] **Step 1: Write failing tool definition tests**

Update the expected tool list:

```ts
expect(tools.map((tool) => tool.name)).toEqual([
  'create_note',
  'create_calendar_event',
  'query_calendar_events',
  'create_research',
  'create_link',
  'create_code_task',
]);
```

Add:

```ts
it('describes read-only calendar event queries', () => {
  const calendarQueryTool = createIntexAgentToolDefinitions(createExecutor()).find(
    (tool) => tool.name === 'query_calendar_events'
  );

  expect(calendarQueryTool?.description).toContain('read-only');
  expect(calendarQueryTool?.description).toContain('list');
  expect(calendarQueryTool?.description).toContain('count');
  expect(calendarQueryTool?.parameters['required']).toEqual(['mode', 'timeMin', 'timeMax']);
});
```

Add a delegation test that passes `{ mode: 'count', timeMin, timeMax, query: 'Dentist' }` and expects `executor.calendarQueryArgs`.

- [ ] **Step 2: Write failing executor tests**

Extend `CalendarToolClient` fakes with `listEvents`.

Add count-mode test:

```ts
it('counts calendar events through the calendar client', async () => {
  const calendarClient = new FakeCalendarClient();
  calendarClient.listResult = ok([
    event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z'),
    event('event-2', 'Dentist follow-up', '2026-05-20T09:00:00.000Z'),
  ]);
  const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

  const result = await executor.queryCalendarEvents({
    mode: 'count',
    timeMin: '2026-05-01T00:00:00.000Z',
    timeMax: '2026-06-01T00:00:00.000Z',
    query: 'Dentist',
  });

  expect(calendarClient.listCalls).toEqual([{
    userId: 'user-1',
    timeMin: '2026-05-01T00:00:00.000Z',
    timeMax: '2026-06-01T00:00:00.000Z',
    maxResults: 2500,
    q: 'Dentist',
  }]);
  expect(JSON.parse(result)).toMatchObject({
    status: 'completed',
    mode: 'count',
    count: 2,
    query: 'Dentist',
  });
});
```

Add list-mode test expecting `events` in the JSON and default `maxResults: 20`.

- [ ] **Step 3: Write failing intent gate tests**

Replace the old read-only blocking cases with tool-routing cases:

```ts
it.each([
  'What are my events scheduled for next week?',
  'Show me tomorrow calendar events',
  'How many times last month did I have Dentist?',
  'Ile razy w zeszlym miesiacu mialem dentyste?',
])('allows read-only calendar queries: %s', (text) => {
  expect(classifyIntexAgentIntent(text)).toEqual({
    kind: 'tool',
    allowedToolNames: ['query_calendar_events'],
  });
});
```

Add a mixed intent test:

```ts
expect(classifyIntexAgentIntent('Create a note and show me next week calendar events')).toEqual({
  kind: 'unsupported',
  reason: 'multiple_resource_intents',
});
```

- [ ] **Step 4: Run Intex Agent domain tests to verify failure**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- domain/toolDefinitions.test.ts domain/toolExecutor.test.ts domain/intentGate.test.ts
```

Expected: FAIL because the tool, executor method, and gate behavior do not exist.

- [ ] **Step 5: Implement tool types and definition**

In `types.ts`, add `'query_calendar_events'` to `IntexAgentToolName`.

In `toolDefinitions.ts`, add:

```ts
export interface QueryCalendarEventsToolArgs {
  mode: 'list' | 'count';
  timeMin: string;
  timeMax: string;
  query?: string;
  calendarId?: string;
  maxResults?: number;
}
```

Add `queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string>` to `IntexAgentToolExecutor`.

Add a tool definition named `query_calendar_events` with required `mode`, `timeMin`, and `timeMax`, optional `query`, `calendarId`, and `maxResults`. Its description must say it is read-only, only for bounded list/count/search questions, and must not be used for creation.

Add parsers `toQueryCalendarEventsArgs`, `requiredCalendarQueryMode`, and `optionalPositiveInteger`.

- [ ] **Step 6: Implement executor method**

Extend `CalendarToolClient`:

```ts
listEvents(input: ListCalendarEventsRequest): Promise<Result<CalendarEvent[]>>;
```

Add `queryCalendarEvents`:

```ts
async queryCalendarEvents(args): Promise<string> {
  const maxResults = args.maxResults ?? (args.mode === 'count' ? 2500 : 20);
  const result = await deps.calendarClient.listEvents({
    userId: deps.userId,
    ...(args.calendarId !== undefined ? { calendarId: args.calendarId } : {}),
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    maxResults,
    ...(args.query !== undefined ? { q: args.query } : {}),
  });

  if (!result.ok) {
    throw new Error(`Failed to query calendar events: ${getErrorMessage(result.error)}`);
  }

  return JSON.stringify({
    status: 'completed',
    mode: args.mode,
    count: result.value.length,
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    ...(args.query !== undefined ? { query: args.query } : {}),
    ...(args.mode === 'list' ? { events: result.value.map(toCalendarQueryEvent) } : {}),
  });
}
```

`toCalendarQueryEvent` must preserve only `id`, `summary`, `start`, `end`, and optional `location`/`htmlLink`.

- [ ] **Step 7: Implement intent gate routing**

Replace read-only calendar rejection with bounded query tool exposure:

```ts
const isCalendarQuery = isReadOnlyCalendarQueryRequest(normalizedWithoutUrls);
if (toolNames.length === 1 && isCalendarQuery) {
  return { kind: 'unsupported', reason: 'multiple_resource_intents' };
}
if (toolNames.length === 0 && isCalendarQuery) {
  return { kind: 'tool', allowedToolNames: ['query_calendar_events'] };
}
```

Update calendar query detection to cover list/show/check/count questions, English and Polish calendar terms, and count questions with event-name phrases such as "How many times last month did I have Dentist?"

- [ ] **Step 8: Verify Task 3**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- domain/toolDefinitions.test.ts domain/toolExecutor.test.ts domain/intentGate.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add apps/intex-agent/src/domain apps/intex-agent/src/__tests__/domain
git commit -m "feat(intex-agent): add calendar query tool"
```

## Task 4: Runner Prompt, Current Date, And End-To-End Intex Behavior

**Files:**
- Modify: `apps/intex-agent/src/domain/agent/systemPrompt.ts`
- Modify: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- Modify: `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- Modify: `apps/intex-agent/src/services.ts` only if the runner input type needs adapter changes.
- Modify: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`
- Modify: `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`

**Interfaces:**
- Consumes: `query_calendar_events` tool from Task 3.
- Produces: runner calls that include current date-time context and expose only `query_calendar_events` for calendar read questions.

- [ ] **Step 1: Write failing runner tests**

Add:

```ts
it('exposes the calendar query tool and current date for read-only calendar questions', async () => {
  const client = new ToolExecutingFakeToolCallingClient({
    toolName: 'query_calendar_events',
    args: {
      mode: 'list',
      timeMin: '2026-06-29T00:00:00.000Z',
      timeMax: '2026-07-06T00:00:00.000Z',
      maxResults: 20,
    },
  }, [
    ok(toolResult({
      outcome: 'completed',
      reply: 'You have one event next week: Dentist on Tuesday at 09:00.',
      toolName: 'query_calendar_events',
    })),
  ]);
  const runner = createIntexAgentRunner({
    client,
    toolExecutor: fakeToolExecutor({
      queryCalendarEvents: async () => JSON.stringify({
        status: 'completed',
        mode: 'list',
        count: 1,
        timeMin: '2026-06-29T00:00:00.000Z',
        timeMax: '2026-07-06T00:00:00.000Z',
        events: [{
          id: 'event-1',
          summary: 'Dentist',
          start: { dateTime: '2026-06-30T09:00:00.000Z' },
          end: { dateTime: '2026-06-30T10:00:00.000Z' },
        }],
      }),
    }),
  });

  const result = await runner.run({
    session: session(),
    events: [],
    message: 'What are my events scheduled for next week?',
    currentDateTime: '2026-06-26T17:00:00.000Z',
  });

  expect(result).toMatchObject({
    outcome: 'completed',
    reply: 'You have one event next week: Dentist on Tuesday at 09:00.',
    toolName: 'query_calendar_events',
  });
  expect(client.calls[0]?.tools.map((tool) => tool.name)).toEqual(['query_calendar_events']);
  expect(client.calls[0]?.systemPrompt).toContain('Current date-time: 2026-06-26T17:00:00.000Z');
});
```

Add a count test for `How many times last month did I have Dentist?` where the fake tool returns count `3` and the model reply is preserved.

- [ ] **Step 2: Write failing message handler test**

In `handleIncomingMessage.test.ts`, ensure the handler passes the deterministic clock value to the runner:

```ts
expect(runner.calls[0]).toMatchObject({
  message: 'What are my events scheduled for next week?',
  currentDateTime: '2026-06-26T17:00:00.000Z',
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- domain/intexAgentRunner.test.ts domain/handleIncomingMessage.test.ts
```

Expected: FAIL because `currentDateTime` is not accepted/passed and the old prompt rejects calendar reads.

- [ ] **Step 4: Implement current date-time plumbing**

Add `currentDateTime: string` to `IntexAgentRunner.run` input in `handleIncomingMessage.ts`, pass `now` from `handleIncomingMessage`, and update test fakes.

In `intexAgentRunner.ts`, build the system prompt as:

```ts
const systemPrompt = `${INTEX_AGENT_SYSTEM_PROMPT.text}\nCurrent date-time: ${input.currentDateTime}`;
```

Use that value in the `client.run` call.

- [ ] **Step 5: Update prompt and runner tracking**

In `systemPrompt.ts`, bump:

```ts
version: '5.0.0'
```

Add rules:

```ts
'Use query_calendar_events only for read-only calendar questions that ask to list, show, check, count, or search existing events.',
'For query_calendar_events, always provide timeMin and timeMax as ISO date-time strings. For "next week", use the next calendar week after the current week. For "last month", use the previous calendar month unless the user says "last 30 days".',
'For event-name count questions, put the event name in query and set mode to count.',
'Never use query_calendar_events to create, update, delete, or reschedule events.',
```

Update `SUPPORTED_CAPABILITIES`, unsupported replies, and new-session text to mention calendar event lookup/counting.

In `createTrackingToolExecutor`, track `query_calendar_events` the same way as other tools. Do not add a deterministic reply branch for this tool; let `buildCompletedReply` fall back to the model reply when the tool result has no `message`, URL, or resource URL.

- [ ] **Step 6: Verify Task 4**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- domain/intexAgentRunner.test.ts domain/handleIncomingMessage.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/intex-agent/src/domain apps/intex-agent/src/services.ts apps/intex-agent/src/__tests__/domain
git commit -m "feat(intex-agent): answer calendar event questions"
```

## Task 5: Documentation And Full Verification

**Files:**
- Modify: `docs/services/intex-agent/features.md`
- Modify: `docs/services/intex-agent/technical.md`
- Modify: `docs/services/intex-agent/technical-debt.md`

**Interfaces:**
- Consumes: implemented calendar query behavior.
- Produces: updated service documentation for future agents and users.

- [ ] **Step 1: Update docs**

Update docs to state:

```md
- List existing Google Calendar events for bounded date questions such as next week.
- Count matching Google Calendar events for bounded date questions such as last month.
```

In `technical.md`, add `query_calendar_events` to the tool boundary and downstream service table. Replace the old statement that read-only calendar questions are blocked with the new rule: read-only calendar questions are routed only through `query_calendar_events`; other read-only personal-data tools remain unsupported.

In `technical-debt.md`, replace the blanket "Calendar inspection" unsupported note with "Only bounded calendar event list/count queries are supported; note search, bookmark lookup, WhatsApp history lookup, and code-task inspection remain unsupported."

- [ ] **Step 2: Run focused workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- http-contracts
pnpm run verify:workspace:tracked -- internal-clients
pnpm run verify:workspace:tracked -- calendar-agent
pnpm run verify:workspace:tracked -- intex-agent
```

Expected: all PASS.

- [ ] **Step 3: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 4: Commit Task 5**

```bash
git add docs/services/intex-agent
git commit -m "docs(intex-agent): document calendar event queries"
```

## Final Checks

- [ ] `query_calendar_events` is read-only and cannot create/update/delete events.
- [ ] Calendar query tool is exposed only when the intent gate classifies a single calendar read intent.
- [ ] Multiple resource intents still return unsupported without tool execution.
- [ ] Relative date questions receive `currentDateTime` in the prompt.
- [ ] Count questions pass the event-name phrase as `q` and use `mode: 'count'`.
- [ ] List questions use bounded `timeMin`/`timeMax` and default to a small `maxResults`.
- [ ] `pnpm run ci:tracked` passes before opening the execution PR.
