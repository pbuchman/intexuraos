# Intex Agent Internal Test Conversation Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal-auth API for testing Intex Agent chat conversations without Auth0, UI, WhatsApp delivery, or real downstream tool side effects.

**Architecture:** Add `POST /internal/intex-agent/test/conversation` inside `apps/intex-agent` for local and dev only; production returns 404. The route authenticates with the existing `X-Internal-Auth` token, accepts only test-namespaced users, then runs the existing `handleIncomingMessage()` domain flow turn-by-turn with real session persistence, real prompt/classifier/runner logic, captured WhatsApp replies, and a mocked `IntexAgentToolExecutor`. Unit tests may call the use case with a scripted runner dependency, but the request mode remains `live_llm_mock_tools`; the HTTP endpoint accepts only live LLM + mocked tools.

**Tech Stack:** TypeScript, Fastify, Vitest, Firestore, existing `@intexuraos/common-http` internal auth, existing `@intexuraos/llm-*`, existing `handleIncomingMessage()`, existing `SessionRepository`.

## Global Constraints

- The test endpoint is internal-only and must never use Auth0; require `X-Internal-Auth: <INTEXURAOS_INTERNAL_AUTH_TOKEN>`.
- The endpoint is disabled in production: when `INTEXURAOS_ENVIRONMENT === 'prod'`, return 404 before auth-specific behavior.
- The endpoint must call `logIncomingRequest()` with `bodyPreviewLength: 0`.
- The endpoint must not publish outbound WhatsApp messages; replies are captured and returned in the response.
- The endpoint must not call notes, calendar, research, bookmarks, code-agent, or external-save services; all tool executions use mocks.
- Preference mutation tools are also mock-only; the endpoint may read real prompt preferences for context but must never write prompt preferences.
- The endpoint must preserve the domain under test: session lifecycle, prompt preferences, classifier, runner, confirmations, fallback handling, and `handleIncomingMessage()` must stay in the execution path.
- The endpoint writes sessions/events to the same Firestore collections as normal `intex-agent`; request `userId` must match `^test-intex-agent-[a-z0-9._-]{1,96}$` and must include the normalized `runId`.
- Production/deployed runs must use UUID-based `intex_session_*`, `intex_event_*`, and `intex_confirmation_*` IDs. Deterministic IDs are allowed only through direct unit-test dependency injection.
- Returned debug data must be sanitized. Do not return secrets, internal auth tokens, raw API keys, private tool credentials, raw `toolArgs`, raw tool result bodies, `replyContext`, `sourceUrl`, `whatsappSender`, or prompt preference blocks.
- Route payload limits are part of the contract: body limit `64 * 1024`, `turns.maxItems = 5`, `text.maxLength = 4000`, `runId.maxLength = 128`, `userId.maxLength = 128`, `sourceUrl.maxLength = 2048`, and bounded per-tool mock result schemas.
- Keep the implementation backend-only; no web UI changes.
- Do not add new env vars; reuse existing `INTEXURAOS_INTERNAL_AUTH_TOKEN`, OpenRouter, service URLs, Firestore, and model config.
- 100% branch coverage remains required for `apps/intex-agent`.
- Before commit, run `pnpm run ci:tracked`.

---

## File Structure

Create:

- `apps/intex-agent/src/domain/testConversation/testConversationTypes.ts` - request/response contracts, tool mock config, captured reply/tool-call types.
- `apps/intex-agent/src/domain/testConversation/testToolMocks.ts` - mock `IntexAgentToolExecutor` implementation that records calls and returns configured JSON.
- `apps/intex-agent/src/domain/testConversation/testConversationSanitizer.ts` - response DTO redaction and normalized behavioral transcript helpers.
- `apps/intex-agent/src/domain/testConversation/runTestConversation.ts` - pure use case that drives `handleIncomingMessage()` over multiple turns and returns transcript, sessions, events, and tool calls.
- `apps/intex-agent/src/routes/testConversationRoutes.ts` - Fastify route for `POST /internal/intex-agent/test/conversation`.
- `apps/intex-agent/src/__tests__/domain/testToolMocks.test.ts` - tool mock behavior tests.
- `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts` - use-case tests with scripted runner.
- `apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts` - redaction and response-shaping tests.
- `apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts` - internal auth, schema, and route response tests.
- `scripts/cleanup-intex-agent-test-conversations.mjs` - guarded cleanup for test-namespaced sessions/events and prompt preference docs.

Modify:

- `apps/intex-agent/src/server.ts` - register `testConversationRoutes`.
- `apps/intex-agent/src/services.ts` - add `testConversationRunner` to `ServiceContainer`; build it in `initServices()`.
- `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` - export any small helper types needed by the test runner only if already local and safe.
- `docs/superpowers/specs/2026-06-24-intex-agent-dev-api-test-scenarios.md` - document that API scenario runners should use the new internal endpoint when testing without UI/OAuth.
- `docs/services/intex-agent/features.md` - add the internal conversation test endpoint as an operator/testing feature.
- `docs/services/intex-agent/technical.md` - document auth, side-effect boundaries, and Firestore persistence behavior.

Do not modify:

- `apps/web/**` - no UI is needed.
- `whatsapp-service` - this endpoint bypasses WhatsApp transport intentionally.
- Downstream agent clients - tools are mocked inside `intex-agent`.
- Terraform or `ecosystem.config.cjs` - no new env vars or service routes are required.

## Endpoint Changes

### Created

- `POST /internal/intex-agent/test/conversation` - internal test endpoint that runs one or more Intex Agent turns with captured replies and mocked tool execution.

### Modified

- `apps/intex-agent/src/server.ts` registers one additional internal route module.

### Removed

- None.

### Unchanged

- `POST /internal/intex-agent/messages` remains the real Pub/Sub/WhatsApp ingress path.
- Authenticated user routes under `/sessions`, `/preferences`, and `/prompt-preferences` remain Auth0-protected.
- Real WhatsApp replies still use the existing Pub/Sub publisher in normal runtime.
- Real tool execution remains unchanged in normal WhatsApp runtime.

## Endpoint Exposure

- Local: call `http://localhost:8134/internal/intex-agent/test/conversation` with `X-Internal-Auth`.
- Dev on `home-dev`: call the host-local service URL with `X-Internal-Auth`, for example over SSH to `http://localhost:8134/internal/intex-agent/test/conversation`.
- Prod: disabled by the app. Public `/internal/intex-agent/...` routing exists for production internals, but this endpoint must return 404 when `INTEXURAOS_ENVIRONMENT === 'prod'`.
- `/api/intex-agent/internal/...` is not a valid public path and should remain blocked by nginx.

## Endpoint Contract

Request:

```json
{
  "contractVersion": "2026-07-01",
  "mode": "live_llm_mock_tools",
  "runId": "intex-e2e-20260701-001",
  "scenarioId": "calendar-empty-tomorrow",
  "userId": "test-intex-agent-intex-e2e-20260701-001",
  "currentDateTime": "2026-07-01T10:00:00.000Z",
  "timeZone": "Europe/Warsaw",
  "turns": [
    {
      "kind": "message",
      "messageId": "wamid-test-001",
      "text": "Jakie wydarzenia mam jutro w kalendarzu? intex-e2e-20260701-001",
      "timestamp": "2026-07-01T10:00:00.000Z",
      "sourceType": "whatsapp_text"
    }
  ],
  "toolMocks": {
    "query_calendar_events": {
      "mode": "success",
      "result": {
        "status": "completed",
        "mode": "list",
        "count": 0,
        "events": []
      }
    }
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "contractVersion": "2026-07-01",
    "mode": "live_llm_mock_tools",
    "runId": "intex-e2e-20260701-001",
    "scenarioId": "calendar-empty-tomorrow",
    "userId": "test-intex-agent-intex-e2e-20260701-001",
    "finalSessionId": "intex_session_...",
    "turns": [
      {
        "turnIndex": 0,
        "kind": "message",
        "messageId": "wamid-test-001",
        "sessionId": "intex_session_...",
        "assistantReplies": [
          {
            "message": "Nie masz żadnych wydarzeń zaplanowanych na jutro.",
            "replyToMessageId": "wamid-test-001",
            "correlationId": "intex_session_..."
          }
        ]
      }
    ],
    "toolCalls": [
      {
        "toolName": "query_calendar_events",
        "status": "completed",
        "argsSummary": {
          "mode": "list",
          "timeMin": "2026-07-02T00:00:00+02:00",
          "timeMax": "2026-07-03T00:00:00+02:00"
        },
        "resultSummary": {
          "status": "completed",
          "mode": "list",
          "count": 0
        }
      }
    ],
    "sessions": [
      {
        "id": "intex_session_...",
        "userId": "test-intex-agent-intex-e2e-20260701-001",
        "status": "waiting_for_user",
        "startedAt": "2026-07-01T10:00:00.000Z",
        "lastUserMessageAt": "2026-07-01T10:00:00.000Z",
        "lastAssistantMessageAt": "2026-07-01T10:00:00.000Z",
        "startReason": "no_active_session"
      }
    ],
    "sessionTransitions": [
      {
        "turnIndex": 0,
        "action": "started",
        "sessionId": "intex_session_..."
      }
    ],
    "eventsBySessionId": {
      "intex_session_...": [
        {
          "id": "intex_event_...",
          "type": "user_message",
          "createdAt": "2026-07-01T10:00:00.000Z",
          "payload": {
            "textPreview": "Jakie wydarzenia mam jutro w kalendarzu? intex-e2e-20260701-001"
          }
        },
        {
          "id": "intex_event_...",
          "type": "tool_call_completed",
          "createdAt": "2026-07-01T10:00:00.000Z",
          "payload": {
            "toolName": "query_calendar_events"
          }
        },
        {
          "id": "intex_event_...",
          "type": "assistant_message",
          "createdAt": "2026-07-01T10:00:00.000Z",
          "payload": {
            "textPreview": "Nie masz żadnych wydarzeń zaplanowanych na jutro."
          }
        }
      ]
    },
    "behavioralTranscript": {
      "turns": [
        {
          "turnIndex": 0,
          "submittedTextPreview": "Jakie wydarzenia mam jutro w kalendarzu? intex-e2e-20260701-001",
          "assistantReplyPreviews": ["Nie masz żadnych wydarzeń zaplanowanych na jutro."],
          "sessionAction": "started",
          "toolOutcome": {
            "toolName": "query_calendar_events",
            "status": "completed"
          }
        }
      ]
    },
    "sideEffectBoundary": "mocked_tools_no_downstream_writes",
    "warnings": []
  }
}
```

Request `turns` supports two forms:

- `{ "kind": "message", "text": "...", "messageId": "...", "timestamp": "...", "sourceType": "whatsapp_text" }`
- `{ "kind": "confirmation_button", "previousTurnIndex": 0, "decision": "accept" }`

`confirmation_button` is resolved by the use case after the referenced prior turn runs. It reads the captured reply buttons, finds the generated `intex_confirm:<confirmationId>:yes|no` button, and converts the semantic turn into a real `IntexIncomingMessage` with `sourceType: "whatsapp_button"` and `buttonResponse`.

`mode` values:

- `live_llm_mock_tools` - the only HTTP mode. Uses real LLM classifier and runner, real prompt preferences lookup, real Firestore sessions, captured replies, mocked tools.

Direct unit tests may call `runTestConversation()` with a scripted runner dependency, but `scripted_runner` and `scriptedResults` must not exist in any request/input schema.

`toolMocks` values:

```ts
export type TestToolMock =
  | { mode: 'success'; result: Record<string, unknown> }
  | { mode: 'failure'; message: string };
```

Default mock behavior:

- Read-only calendar query returns an empty successful list.
- Mutating tools return a successful JSON object with a stable mock id and resource URL.
- `save_external` returns success without external network access.
- Preference tools return mock-only preference results and do not write `intex_agent_prompt_preferences` or `intex_agent_prompt_preference_versions`.

`toolMocks` must be validated per tool with explicit schemas. Reject unknown tool names, nested arbitrary objects, secret-like field names (`token`, `secret`, `password`, `key`), huge arrays, and URLs outside `http`/`https` with bounded length.

---

## Task 1: Define Test Conversation Contracts

**Files:**

- Create: `apps/intex-agent/src/domain/testConversation/testConversationTypes.ts`
- Test: `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`

**Interfaces:**

- Produces: `TestConversationHttpRequest`
- Produces: `RunTestConversationInput`
- Produces: `TestConversationResponse`
- Produces: `TestConversationMode`
- Produces: `TestToolMock`
- Consumes: `IntexIncomingMessage`, `IntexAgentSession`, `IntexAgentSessionEvent`, `IntexAgentToolName`

- [ ] **Step 1: Write the failing type-use test**

Add this minimal compile-time/runtime test to `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type {
  TestConversationHttpRequest,
  TestConversationResponse,
} from '../../domain/testConversation/testConversationTypes.js';

describe('test conversation contract', () => {
  it('supports a live mocked-tools request and response transcript', () => {
    const request: TestConversationHttpRequest = {
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      userId: 'test-intex-agent-intex-e2e-contract',
      runId: 'intex-e2e-contract',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      turns: [
        {
          kind: 'message',
          messageId: 'wamid-contract-1',
          text: 'Jakie mam jutro wydarzenia? intex-e2e-contract',
          timestamp: '2026-07-01T10:00:00.000Z',
          sourceType: 'whatsapp_text',
        },
      ],
      toolMocks: {
        query_calendar_events: {
          mode: 'success',
          result: {
            status: 'completed',
            mode: 'list',
            count: 0,
            events: [],
          },
        },
      },
    };

    const response: TestConversationResponse = {
      runId: request.runId,
      userId: request.userId,
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      finalSessionId: 'intex_session_1',
      turns: [
        {
          turnIndex: 0,
          kind: 'message',
          messageId: 'wamid-contract-1',
          sessionId: 'intex_session_1',
          assistantReplies: [],
        },
      ],
      toolCalls: [],
      sessions: [],
      sessionTransitions: [],
      eventsBySessionId: {},
      behavioralTranscript: { turns: [] },
      sideEffectBoundary: 'mocked_tools_no_downstream_writes',
      warnings: [],
    };

    expect(response.runId).toBe('intex-e2e-contract');
  });
});
```

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts
```

Expected: FAIL with missing `testConversationTypes.js`.

- [ ] **Step 2: Implement the contract types**

Create `apps/intex-agent/src/domain/testConversation/testConversationTypes.ts`:

```ts
import type { WhatsAppInteractiveButton } from '@intexuraos/whatsapp-pubsub-client';
import type { IntexIncomingMessageReplyContext } from '../ports/incomingMessageHandler.js';
import type { IntexAgentSession, IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';

export type TestConversationMode = 'live_llm_mock_tools';

export interface MessageTurnInput {
  kind: 'message';
  messageId?: string;
  text: string;
  timestamp?: string;
  sourceType?: string;
  sourceUrl?: string;
  whatsappSender?: string;
  replyContext?: IntexIncomingMessageReplyContext;
}

export interface ConfirmationButtonTurnInput {
  kind: 'confirmation_button';
  previousTurnIndex: number;
  decision: 'accept' | 'reject';
  messageId?: string;
  timestamp?: string;
}

export type TestConversationTurnInput = MessageTurnInput | ConfirmationButtonTurnInput;

export type TestToolMock =
  | { mode: 'success'; result: Record<string, unknown> }
  | { mode: 'failure'; message: string };

export type TestToolMocks = Partial<Record<IntexAgentToolName, TestToolMock>>;

export interface TestConversationHttpRequest {
  contractVersion: '2026-07-01';
  mode: TestConversationMode;
  userId: string;
  runId: string;
  scenarioId?: string;
  currentDateTime: string;
  timeZone?: string;
  turns: TestConversationTurnInput[];
  toolMocks?: TestToolMocks;
}

export type RunTestConversationInput = TestConversationHttpRequest;

export interface CapturedAssistantReply {
  userId: string;
  message: string;
  replyToMessageId: string;
  correlationId: string;
  ctaUrl?: {
    displayText: string;
    url: string;
  };
  buttons?: WhatsAppInteractiveButton[];
}

export interface CapturedToolCall {
  toolName: IntexAgentToolName;
  status: 'completed' | 'failed';
  argsSummary?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  error?: string;
}

export interface TestConversationTurnResult {
  turnIndex: number;
  kind: TestConversationTurnInput['kind'];
  messageId: string;
  sessionId: string;
  assistantReplies: CapturedAssistantReply[];
}

export interface TestConversationResponse {
  contractVersion: '2026-07-01';
  mode: TestConversationMode;
  runId: string;
  scenarioId?: string;
  userId: string;
  finalSessionId: string | null;
  turns: TestConversationTurnResult[];
  toolCalls: CapturedToolCall[];
  sessions: IntexAgentSession[];
  sessionTransitions: Array<{
    turnIndex: number;
    action: 'started' | 'continued' | 'superseded_previous' | 'expired_previous';
    sessionId: string;
    previousSessionId?: string;
    previousEndReason?: string;
  }>;
  eventsBySessionId: Record<string, Array<{
    id: string;
    type: IntexAgentSessionEvent['type'];
    createdAt: string;
    payload: Record<string, unknown>;
  }>>;
  behavioralTranscript: {
    turns: Array<{
      turnIndex: number;
      submittedTextPreview?: string;
      assistantReplyPreviews: string[];
      sessionAction: string;
      confirmationAction?: 'accepted' | 'rejected' | 'stale';
      toolOutcome?: { toolName: IntexAgentToolName; status: 'completed' | 'failed' };
    }>;
  };
  sideEffectBoundary: 'mocked_tools_no_downstream_writes';
  warnings: string[];
}
```

Run the same test again.

Expected: PASS.

## Task 2: Mock Tool Executor And Captured Reply Publisher

**Files:**

- Create: `apps/intex-agent/src/domain/testConversation/testToolMocks.ts`
- Test: `apps/intex-agent/src/__tests__/domain/testToolMocks.test.ts`

**Interfaces:**

- Consumes: `TestToolMocks`
- Produces: `createTestToolExecutor(input: { mocks?: TestToolMocks; calls: CapturedToolCall[] }): IntexAgentToolExecutor`
- Produces: `createCapturedReplyPublisher(replies: CapturedAssistantReply[]): WhatsAppReplyPublisher`

- [ ] **Step 1: Write failing tests for mock tool success, failure, and call recording**

Create `apps/intex-agent/src/__tests__/domain/testToolMocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createCapturedReplyPublisher, createTestToolExecutor } from '../../domain/testConversation/testToolMocks.js';
import type { CapturedAssistantReply, CapturedToolCall } from '../../domain/testConversation/testConversationTypes.js';

describe('test tool mocks', () => {
  it('returns configured successful tool JSON and records the call', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({
      calls,
      mocks: {
        query_calendar_events: {
          mode: 'success',
          result: { status: 'completed', mode: 'list', count: 0, events: [] },
        },
      },
    });

    const raw = await executor.queryCalendarEvents({
      mode: 'list',
      timeMin: '2026-07-02T00:00:00+02:00',
      timeMax: '2026-07-03T00:00:00+02:00',
    });

    expect(JSON.parse(raw)).toEqual({ status: 'completed', mode: 'list', count: 0, events: [] });
    expect(calls).toEqual([
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        argsSummary: {
          mode: 'list',
          timeMin: '2026-07-02T00:00:00+02:00',
          timeMax: '2026-07-03T00:00:00+02:00',
        },
        resultSummary: { status: 'completed', mode: 'list', count: 0 },
      },
    ]);
  });

  it('throws configured failures and records the error', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({
      calls,
      mocks: {
        create_note: { mode: 'failure', message: 'mock note failure' },
      },
    });

    await expect(executor.createNote({ content: 'x' })).rejects.toThrow('mock note failure');
    expect(calls).toEqual([
      {
        toolName: 'create_note',
        status: 'failed',
        error: 'mock note failure',
      },
    ]);
  });

  it('captures assistant replies without publishing to WhatsApp', async () => {
    const replies: CapturedAssistantReply[] = [];
    const publisher = createCapturedReplyPublisher(replies);

    await publisher.publishReply({
      userId: 'user-1',
      message: 'Reply',
      replyToMessageId: 'wamid-1',
      correlationId: 'session-1',
    });

    expect(replies).toEqual([
      {
        userId: 'user-1',
        message: 'Reply',
        replyToMessageId: 'wamid-1',
        correlationId: 'session-1',
      },
    ]);
  });
});
```

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/testToolMocks.test.ts
```

Expected: FAIL with missing `testToolMocks.js`.

- [ ] **Step 2: Implement mock tool executor and captured publisher**

Implement every `IntexAgentToolExecutor` method. Test every method with configured success, default success, configured failure, call recording, JSON serialization, zero-arg `getUserPreferences`, and captured reply `ctaUrl`/`buttons`. Use this pattern for each method:

```ts
function runMockTool(
  toolName: IntexAgentToolName,
  args: Record<string, unknown>,
  mocks: TestToolMocks | undefined,
  calls: CapturedToolCall[]
): string {
  const mock = mocks?.[toolName] ?? defaultMock(toolName, args);
  if (mock.mode === 'failure') {
    calls.push({ toolName, status: 'failed', error: mock.message });
    throw new Error(mock.message);
  }
  calls.push({
    toolName,
    status: 'completed',
    argsSummary: summarizeToolArgs(toolName, args),
    resultSummary: summarizeToolResult(toolName, mock.result),
  });
  return JSON.stringify(mock.result);
}
```

Default mock results:

```ts
const DEFAULT_MOCK_RESULTS: Record<IntexAgentToolName, Record<string, unknown>> = {
  create_note: { status: 'completed', message: 'Mock note created.', resourceUrl: '/#/notes/mock-note' },
  create_calendar_event: { status: 'completed', eventId: 'mock-calendar-event', summary: 'Mock event', htmlLink: 'https://calendar.test/mock-calendar-event' },
  query_calendar_events: { status: 'completed', mode: 'list', count: 0, events: [] },
  create_research: { status: 'completed', message: 'Mock research draft created.', resourceUrl: '/#/research/mock-research' },
  create_link: { status: 'completed', bookmarkId: 'mock-bookmark', resourceUrl: '/#/bookmarks/mock-bookmark', url: 'https://example.test' },
  create_code_task: { status: 'completed', codeTaskId: 'task_mock', resourceUrl: '/#/code-tasks/task_mock' },
  save_external: { status: 'completed', message: 'Mock external save completed.' },
  get_user_preferences: { status: 'completed', version: 0, items: [] },
  add_user_preference: { status: 'completed', version: 1, item: { id: 'pref_mock', text: 'Mock preference' } },
  update_user_preference: { status: 'completed', version: 1, item: { id: 'pref_mock', text: 'Mock preference updated' } },
  delete_user_preference: { status: 'completed', version: 1, deletedItemId: 'pref_mock' },
};
```

Run the test again.

Expected: PASS.

## Task 3: Add Test Conversation Use Case

**Files:**

- Create: `apps/intex-agent/src/domain/testConversation/runTestConversation.ts`
- Test: `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`

**Interfaces:**

- Consumes: `SessionRepository`
- Consumes: `IntexAgentRunner`
- Consumes: `RunTestConversationInput`
- Produces: `runTestConversation(input: RunTestConversationInput, deps: RunTestConversationDeps): Promise<TestConversationResponse>`

- [ ] **Step 1: Write failing tests for domain execution and evidence capture**

Add tests to `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts` covering:

```ts
it('runs two message turns through handleIncomingMessage and returns sanitized evidence', async () => {
  const repository = new MemorySessionRepository();
  const result = await runTestConversation(
    {
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      userId: 'test-intex-agent-intex-e2e-scripted',
      runId: 'intex-e2e-scripted',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      turns: [
        { kind: 'message', messageId: 'wamid-1', text: 'Jakie wydarzenia jutro? intex-e2e-scripted', timestamp: '2026-07-01T10:00:00.000Z' },
        { kind: 'message', messageId: 'wamid-2', text: 'Co dalej?', timestamp: '2026-07-01T10:01:00.000Z' },
      ],
    },
    {
      sessionRepository: repository,
      runner: new ScriptedRunner([
        { outcome: 'completed', reply: 'Nie masz żadnych wydarzeń jutro.', toolName: 'query_calendar_events', toolResult: { status: 'completed', count: 0 } },
        { outcome: 'no_action', reply: 'Co mogę teraz dla Ciebie zrobić?' },
      ]),
      sessionTimeoutMs: 30 * 60 * 1000,
      ids: fixedTestIds(),
      logger: silentLogger(),
    }
  );

  expect(result.userId).toBe('test-intex-agent-intex-e2e-scripted');
  expect(result.finalSessionId).toBe('intex_session_test_1');
  expect(result.turns).toHaveLength(2);
  expect(result.turns[0]?.assistantReplies[0]?.message).toContain('Nie masz żadnych wydarzeń');
  expect(result.turns[1]?.assistantReplies[0]?.message).toContain('Co mogę teraz');
  expect(result.eventsBySessionId['intex_session_test_1']?.map((event) => event.type)).toContain('assistant_message');
  expect(JSON.stringify(result)).not.toContain('toolArgs');
});
```

Also add a two-turn confirmation test:

- first scripted/live-equivalent turn returns `needs_confirmation` for `create_note`
- second request turn uses `{ kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' }`
- the use case resolves the captured `intex_confirm:<id>:yes` button into `buttonResponse`
- assertions cover `confirmation_resolved`, `tool_call_completed`, captured reply, and one mocked tool call

Add rejection/stale button tests:

- `{ decision: 'reject' }` records `confirmation_resolved` with `rejected` and no mocked tool call
- a mismatched `previousTurnIndex` returns `INVALID_REQUEST` from route-level validation before execution

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts
```

Expected: FAIL with missing `runTestConversation.js`.

- [ ] **Step 2: Implement `runTestConversation()` around `handleIncomingMessage()`**

Implementation requirements:

- Build one `IntexIncomingMessage` per requested turn.
- Resolve semantic `confirmation_button` turns after the referenced prior turn has produced captured buttons.
- Default `sourceType` to `whatsapp_text`.
- Default timestamps from `currentDateTime`, incrementing one second per turn when a turn omits `timestamp`.
- Default message IDs to `wamid-test-${runId}-${index}`.
- Accept `ids` through `RunTestConversationDeps`. Unit tests pass deterministic IDs; runtime wiring passes UUID-based IDs.
- Capture replies per turn by slicing the reply array before and after each `handleIncomingMessage()` call.
- After all turns, load every touched session and event through `SessionRepository`.
- Return sanitized evidence only. Use `testConversationSanitizer.ts` to build `sessions`, `sessionTransitions`, `eventsBySessionId`, and `behavioralTranscript`.

Core implementation shape:

```ts
export interface RunTestConversationDeps {
  sessionRepository: SessionRepository;
  runner: IntexAgentRunner;
  sessionTimeoutMs: number;
  ids: IdGenerator;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export async function runTestConversation(
  input: RunTestConversationInput,
  deps: RunTestConversationDeps
): Promise<TestConversationResponse> {
  const replies: CapturedAssistantReply[] = [];
  const replyPublisher = createCapturedReplyPublisher(replies);
  let sessionId: string | null = null;

  const turnResults: TestConversationTurnResult[] = [];

  for (const [index, turn] of input.turns.entries()) {
    const incomingMessage = resolveIncomingMessageForTurn(input, turn, index, replies);
    const replyStart = replies.length;
    const result = await handleIncomingMessage(
      incomingMessage,
      {
        sessionRepository: deps.sessionRepository,
        runner: deps.runner,
        replyPublisher,
        clock: { now: () => turn.timestamp ?? timestampForTurn(input.currentDateTime, index) },
        ids: {
          sessionId: deps.ids.sessionId,
          eventId: deps.ids.eventId,
          confirmationId: deps.ids.confirmationId,
        },
        sessionTimeoutMs: deps.sessionTimeoutMs,
      }
    );
    sessionId = result.sessionId;
    turnResults.push({
      turnIndex: index,
      kind: turn.kind,
      messageId: incomingMessage.messageId,
      sessionId: result.sessionId,
      assistantReplies: replies.slice(replyStart),
    });
  }

  const evidence = await buildSanitizedConversationEvidence({
    input,
    sessionRepository: deps.sessionRepository,
    turnResults,
    finalSessionId: sessionId,
  });

  return {
    contractVersion: input.contractVersion,
    mode: 'live_llm_mock_tools',
    runId: input.runId,
    ...(input.scenarioId !== undefined ? { scenarioId: input.scenarioId } : {}),
    userId: input.userId,
    finalSessionId: sessionId,
    turns: turnResults,
    toolCalls: [],
    ...evidence,
    sideEffectBoundary: 'mocked_tools_no_downstream_writes',
    warnings: [],
  };
}
```

Run the test again.

Expected: PASS.

## Task 4: Build Live LLM Runner With Mocked Tools

**Files:**

- Modify: `apps/intex-agent/src/services.ts`
- Test: `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`

**Interfaces:**

- Produces: `createLiveMockedToolRunner(input: CreateLiveMockedToolRunnerInput): IntexAgentRunner` in `apps/intex-agent/src/services.ts`
- Consumes: `createIntexAgentRunner()`
- Consumes: `createIntexAgentToolExecutor()` only for normal runtime, not for test endpoint

- [ ] **Step 1: Add a failing test that live mode records mocked tool calls**

Add a test with a fake `IntexAgentRunner` produced from `createIntexAgentRunner()` and a fake `ToolCallingClient` that calls `query_calendar_events`. The test must assert:

- The tool call is captured in `toolCalls`.
- No downstream client fake is called.
- The assistant reply is captured, not published.

Use a fake client response that returns a valid runner JSON:

```ts
const fakeClient = {
  async run(input: { tools: { name: string; run(args: Record<string, unknown>): Promise<string> }[] }) {
    const tool = input.tools.find((candidate) => candidate.name === 'query_calendar_events');
    if (tool === undefined) throw new Error('query_calendar_events not available');
    await tool.run({
      mode: 'list',
      timeMin: '2026-07-02T00:00:00+02:00',
      timeMax: '2026-07-03T00:00:00+02:00',
    });
    return {
      ok: true,
      value: {
        content: JSON.stringify({
          outcome: 'completed',
          reply: 'Nie masz żadnych wydarzeń jutro.',
          toolName: 'query_calendar_events',
        }),
      },
    };
  },
};
```

Expected before implementation: FAIL because live mode does not wire mocks into the runner.

- [ ] **Step 2: Implement live mocked runner creation**

Add a factory that uses `createIntexAgentRunner()` with:

- real `client` and `responseRepairClient` in `initServices()`
- real `intentClassifier` in `initServices()`
- `createTestToolExecutor()` instead of `createIntexAgentToolExecutor()`
- real prompt preferences from `promptPreferencesRepository.getCurrent(userId)`
- `webAppUrl` from config

The factory must append tool calls to the same `CapturedToolCall[]` returned by the endpoint.

The production `ServiceContainer` shape becomes:

```ts
export interface ServiceContainer {
  config: ServiceConfig;
  sessionRepository: SessionRepository;
  preferencesRepository: PreferencesRepository;
  promptPreferencesRepository: PromptPreferencesRepository;
  externalSaveTester: ExternalSaveConnectionTestPort;
  incomingMessageHandler: IncomingMessageHandler;
  testConversationRunner: {
    run(input: TestConversationHttpRequest): Promise<TestConversationResponse>;
  };
}
```

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts
```

Expected: PASS.

## Task 5: Add Internal Test Conversation Route

**Files:**

- Create: `apps/intex-agent/src/routes/testConversationRoutes.ts`
- Modify: `apps/intex-agent/src/server.ts`
- Test: `apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts`

**Interfaces:**

- Consumes: `getServices().testConversationRunner.run()`
- Produces: `POST /internal/intex-agent/test/conversation`

- [ ] **Step 1: Write failing route tests**

Create `apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts` with these cases:

- missing `x-internal-auth` returns 401 and does not call `testConversationRunner`
- wrong `x-internal-auth` returns 401 and does not call `testConversationRunner`
- unset `INTEXURAOS_INTERNAL_AUTH_TOKEN` returns 401 and does not call `testConversationRunner`
- `from: noreply@google.com` does not bypass this route
- `INTEXURAOS_ENVIRONMENT=prod` returns 404 and does not call `testConversationRunner`
- non-test `userId`, e.g. `auth0|real-user`, returns 400 and does not call `testConversationRunner`
- test `userId` that does not contain normalized `runId` returns 400 and does not call `testConversationRunner`
- `mode: "scripted_runner"` returns 400 and does not call `testConversationRunner`
- too many turns, too-long text, too-long `sourceUrl`, oversized body, unknown tool mock, and secret-like mock fields return 400 or 413
- valid `live_llm_mock_tools` payload returns 200 and passes the sanitized payload to the runner
- route logging uses `bodyPreviewLength: 0`; captured test logs must not contain turn text, `toolMocks`, `scriptedResults`, auth tokens, or mock result bodies

Use a valid route payload like:

```ts
const payload = {
  contractVersion: '2026-07-01',
  mode: 'live_llm_mock_tools',
  runId: 'intex-e2e-route',
  userId: 'test-intex-agent-intex-e2e-route',
  currentDateTime: '2026-07-01T10:00:00.000Z',
  turns: [
    {
      kind: 'message',
      messageId: 'wamid-route-1',
      text: 'Jakie wydarzenia jutro? intex-e2e-route',
      timestamp: '2026-07-01T10:00:00.000Z',
    },
  ],
  toolMocks: {
    query_calendar_events: {
      mode: 'success',
      result: { status: 'completed', mode: 'list', count: 0, events: [] },
    },
  },
};
```

Expected before implementation: FAIL with route not found or missing container field.

- [ ] **Step 2: Implement route schema and handler**

Use `validateInternalAuth(request)` exactly like `apps/intex-agent/src/routes/internalRoutes.ts`.

Route behavior:

- `404` when `INTEXURAOS_ENVIRONMENT === 'prod'`.
- `401` when internal auth fails.
- `400` when `contractVersion`, `mode`, `runId`, `userId`, `currentDateTime`, or `turns` are invalid.
- `400` when `mode` is anything except `live_llm_mock_tools`.
- `400` when `userId` does not match `^test-intex-agent-[a-z0-9._-]{1,96}$` or does not contain normalized `runId`.
- `400` when `toolMocks` contains unknown tool names, unknown fields, nested arbitrary objects, secret-like field names, or oversized values.
- `413` when body exceeds `64 * 1024`.
- `200` with `reply.ok(response)` on success.
- Call `logIncomingRequest(request, { message: 'Received request to POST /internal/intex-agent/test/conversation', bodyPreviewLength: 0 })`.
- After validation, log safe metadata only: `runId`, `userId`, turn count, mode.

Register in `apps/intex-agent/src/server.ts`:

```ts
import { testConversationRoutes } from './routes/testConversationRoutes.js';

await app.register(testConversationRoutes);
```

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts
```

Expected: PASS.

## Task 6: Service Wiring For Deployed Live Mode

**Files:**

- Modify: `apps/intex-agent/src/services.ts`
- Test: `apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts`
- Test: `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`

**Interfaces:**

- Consumes: `ServiceConfig`
- Consumes: `sessionRepository`
- Consumes: `promptPreferencesRepository`
- Produces: `testConversationRunner.run(input)`

- [ ] **Step 1: Add failing service-wiring tests**

Add tests proving:

- live mode creates a fresh `createIntexAgentRunner()` per `run()` and per `executeConfirmed()` call
- prompt preferences are read through `promptPreferencesRepository.getCurrent(userId)`
- downstream clients (`notesClient`, `calendarClient`, `researchClient`, `bookmarksClient`, `codeClient`, `externalSaveClient`) are throw-on-call fakes and are never invoked
- two deployed-mode calls generate different session/event/confirmation IDs
- existing `setServices()` fixtures in `sessionRoutes.test.ts`, `preferencesRoutes.test.ts`, and `promptPreferencesRoutes.test.ts` are updated with an unused fake `testConversationRunner`

- [ ] **Step 2: Wire `testConversationRunner` in `initServices()`**

Implementation outline:

```ts
const testConversationRunner = {
  async run(input: TestConversationHttpRequest): Promise<TestConversationResponse> {
    const toolCalls: CapturedToolCall[] = [];
    const runner = createLiveMockedRunner({
      input,
      config,
      logger,
      toolCalls,
      promptPreferencesRepository,
      usageSink,
    });

    const response = await runTestConversation(input, {
      sessionRepository,
      runner,
      sessionTimeoutMs: config.sessionTimeoutMs,
      ids: {
        sessionId: () => `intex_session_${randomUUID()}`,
        eventId: () => `intex_event_${randomUUID()}`,
        confirmationId: () => `intex_confirmation_${randomUUID()}`,
      },
      logger,
    });

    return { ...response, toolCalls };
  },
};
```

Keep `domain/testConversation/runTestConversation.ts` pure. `createLiveMockedRunner()` belongs in `services.ts` and must create LLM clients the same way the normal runner does, but must pass `createTestToolExecutor({ mocks: input.toolMocks, calls: toolCalls })` into `createIntexAgentRunner()`.

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts
```

Expected: PASS.

## Task 7: Documentation And Scenario Harness Update

**Files:**

- Modify: `docs/superpowers/specs/2026-06-24-intex-agent-dev-api-test-scenarios.md`
- Modify: `docs/services/intex-agent/features.md`
- Modify: `docs/services/intex-agent/technical.md`

**Interfaces:**

- Produces: documented curl/API procedure for local/dev internal testing and explicit production disablement.

- [ ] **Step 1: Update dev API scenario spec**

Add this section after `## Dev API Execution Contract`:

```md
## Internal Test Conversation Endpoint

When the goal is to test Intex Agent chat behavior without UI login, OAuth, WhatsApp delivery, or real downstream tool mutations, use:

`POST /internal/intex-agent/test/conversation`

Required header:

`X-Internal-Auth: <INTEXURAOS_INTERNAL_AUTH_TOKEN>`

The endpoint preserves the Intex Agent conversation domain: session lifecycle, prompt preferences, classifier, runner, confirmation handling, fallback behavior, and timeline persistence. It replaces WhatsApp publishing with captured replies and replaces downstream tool execution with explicit mocks. It validates conversation/tool behavior, not downstream provider persistence.

Use `mode: "live_llm_mock_tools"` for behavioral prompt scenarios. Use a unique lowercase `runId` marker in every user message and set `userId` to `test-intex-agent-<runId>`. Assert `behavioralTranscript`, `sessions`, `sessionTransitions`, sanitized `eventsBySessionId`, and `toolCalls`; do not assert exact wording when the scenario only requires semantic meaning.

Scenario pass criteria are split:

- `internal_mock_tools`: assert intended tool calls and mocked results; no downstream resources are created.
- `full_dev_flow`: assert provider resources through real notes/calendar/code APIs.

Current Intex Agent sessions remain `waiting_for_user` after completed, no-action, clarification, and unsupported turns. Scenario docs must assert that current behavior plus outcome evidence events unless a separate implementation explicitly changes session-closing semantics.
```

- [ ] **Step 2: Add a curl example to `docs/services/intex-agent/technical.md`**

```bash
RUN_ID="intex-e2e-manual-$(date -u +%Y%m%dT%H%M%SZ)"
USER_ID="test-intex-agent-${RUN_ID}"
BASE_URL="${INTEXURAOS_INTEX_AGENT_URL:-http://localhost:8134}"
PAYLOAD="$(jq -n \
  --arg runId "$RUN_ID" \
  --arg userId "$USER_ID" \
  '{
    contractVersion: "2026-07-01",
    mode: "live_llm_mock_tools",
    runId: $runId,
    userId: $userId,
    currentDateTime: "2026-07-01T10:00:00.000Z",
    turns: [
      {
        kind: "message",
        messageId: ("wamid-" + $runId + "-1"),
        text: ("Jakie wydarzenia mam jutro w kalendarzu? " + $runId),
        timestamp: "2026-07-01T10:00:00.000Z"
      }
    ],
    toolMocks: {
      query_calendar_events: {
        mode: "success",
        result: {
          status: "completed",
          mode: "list",
          count: 0,
          events: []
        }
      }
    }
  }'
)"

curl -fsS \
  -H "content-type: application/json" \
  -H "x-internal-auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -X POST "${BASE_URL}/internal/intex-agent/test/conversation" \
  --data "$PAYLOAD" | jq -e '.success == true and (.data.toolCalls | length) >= 1'
```

- [ ] **Step 3: Verify docs mention the side-effect boundary**

Run:

```bash
rg -n "test/conversation|mocked tools|captured replies|X-Internal-Auth" docs/superpowers/specs/2026-06-24-intex-agent-dev-api-test-scenarios.md docs/services/intex-agent
```

Expected: at least one match in each modified documentation area.

## Task 8: Cleanup Strategy

**Files:**

- Create: `scripts/cleanup-intex-agent-test-conversations.mjs`
- Test: add script validation coverage through existing script test pattern if available; otherwise document manual dry-run verification in this task.

**Interfaces:**

- Produces: guarded cleanup for test-namespaced Firestore documents.

- [ ] **Step 1: Write guarded cleanup script**

The script must:

- require `--user-id test-intex-agent-*`
- require `--run-id <runId>` and verify the normalized `runId` appears in `userId`
- use `GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json`
- refuse to run if the credential file is not a service account key
- count matching docs before deletion
- support `--dry-run` by default and require `--execute` for writes
- delete only matching test docs from `intex_agent_sessions`, `intex_agent_session_events`, `intex_agent_prompt_preferences`, and `intex_agent_prompt_preference_versions`
- never accept product/Auth0 user IDs

- [ ] **Step 2: Document cleanup command**

Add this to `docs/services/intex-agent/technical.md`:

```bash
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
node scripts/cleanup-intex-agent-test-conversations.mjs \
  --user-id "test-intex-agent-${RUN_ID}" \
  --run-id "$RUN_ID" \
  --dry-run
```

- [ ] **Step 3: Verify cleanup safety**

Run:

```bash
node scripts/cleanup-intex-agent-test-conversations.mjs --user-id auth0-real-user --run-id real --dry-run
```

Expected: non-zero exit with a message that the user id is outside the allowed test namespace.

## Task 9: Verification

**Files:**

- All files from Tasks 1-8.

**Interfaces:**

- Produces: passing tracked CI for the feature branch.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @intexuraos/intex-agent test -- --run \
  apps/intex-agent/src/__tests__/domain/testToolMocks.test.ts \
  apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts \
  apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts \
  apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts
```

Expected: PASS.

- [ ] **Step 1b: Verify covered source paths**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test:coverage -- --run \
  apps/intex-agent/src/__tests__/domain/testToolMocks.test.ts \
  apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts \
  apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts \
  apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts
```

Expected: PASS with no uncovered branch/function/line entries for `apps/intex-agent/src/domain/testConversation/**` or `apps/intex-agent/src/routes/testConversationRoutes.ts`.

- [ ] **Step 2: Run workspace verification**

```bash
pnpm run verify:workspace:tracked -- intex-agent
```

Expected: PASS.

- [ ] **Step 3: Run full tracked CI**

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 4: Manual local API smoke test**

With local services running through `pnpm run dev`, call:

```bash
RUN_ID="intex-e2e-local-smoke-$(date -u +%Y%m%dT%H%M%SZ)"
USER_ID="test-intex-agent-${RUN_ID}"
BASE_URL="${INTEXURAOS_INTEX_AGENT_URL:-http://localhost:8134}"
PAYLOAD="$(jq -n \
  --arg runId "$RUN_ID" \
  --arg userId "$USER_ID" \
  '{
    contractVersion: "2026-07-01",
    mode: "live_llm_mock_tools",
    runId: $runId,
    userId: $userId,
    currentDateTime: "2026-07-01T10:00:00.000Z",
    turns: [
      {
        kind: "message",
        messageId: ("wamid-" + $runId + "-1"),
        text: ("Jakie wydarzenia mam jutro w kalendarzu? " + $runId),
        timestamp: "2026-07-01T10:00:00.000Z"
      }
    ],
    toolMocks: {
      query_calendar_events: {
        mode: "success",
        result: {
          status: "completed",
          mode: "list",
          count: 0,
          events: []
        }
      }
    }
  }'
)"

HTTP_CODE="$(
  curl -sS -o /tmp/intex-agent-test-conversation-response.json -w "%{http_code}" \
  -H "content-type: application/json" \
  -H "x-internal-auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -X POST "${BASE_URL}/internal/intex-agent/test/conversation" \
  --data "$PAYLOAD"
)"

test "$HTTP_CODE" = "200"
jq -e '
  .success == true
  and .data.sideEffectBoundary == "mocked_tools_no_downstream_writes"
  and (.data.turns[0].assistantReplies | length) >= 1
  and (.data.toolCalls[] | select(.toolName == "query_calendar_events" and .status == "completed"))
  and (.data.eventsBySessionId | tostring | contains("assistant_message"))
' /tmp/intex-agent-test-conversation-response.json
```

Expected:

- HTTP 200.
- Response contains `turns[0].assistantReplies[0].message`.
- Response contains a `toolCalls[]` entry for `query_calendar_events`.
- Response declares `sideEffectBoundary: mocked_tools_no_downstream_writes`.
- `eventsBySessionId` contains `user_message` and `assistant_message`.
- Downstream side-effect isolation is proven by focused tests with throw-on-call downstream fakes; manual smoke does not prove provider absence by itself.

## Self-Review Checklist

- Spec coverage: OAuth bypass is handled by internal auth; UI bypass is handled by curl/API; domain preservation is handled by `handleIncomingMessage()` plus live LLM runner; tool side effects are replaced by `createTestToolExecutor()`.
- Endpoint coverage: created, modified, removed, and unchanged endpoints are explicitly listed.
- Auth coverage: route tests cover missing auth, wrong auth, unset internal token, no Pub/Sub `from` bypass, prod 404, non-test user rejection, and valid internal auth.
- Side-effect coverage: tests assert captured replies, mock tool calls, mock-only preference tools, and throw-on-call downstream clients.
- Redaction coverage: sanitizer tests prove raw `toolArgs`, raw tool results, source URLs, reply contexts, WhatsApp sender values, secret-like fields, and auth values are not returned or logged.
- Documentation coverage: scenario spec and service docs include the endpoint and curl example.
- Verification coverage: focused tests, workspace verification, full tracked CI, and local smoke test are specified.
