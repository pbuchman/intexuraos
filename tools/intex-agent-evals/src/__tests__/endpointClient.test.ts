import { describe, expect, it } from 'vitest';
import {
  EndpointClientError,
  createEndpointClient,
  createSyntheticRunIdentity,
  materializeEndpointRequest,
  type EndpointClient,
  type EndpointConversationResponse,
  type EndpointTimer,
  type SyntheticRunIdentity,
} from '../endpointClient.js';
import { IntexEvalScenarioSchema, type IntexEvalScenario } from '../scenarioSchema.js';
import { createConfirmationScenario, createScenario } from './scenarioFixtures.js';

const UUID = '123E4567-E89B-12D3-A456-426614174000';
const AUTH_TOKEN = 'private-auth-token-sentinel';

describe('endpoint client identity and request materialization', () => {
  it('creates a bounded lowercase synthetic identity from a canonical UUID', () => {
    expect(createSyntheticRunIdentity('intex-eval-001', () => UUID)).toEqual({
      runId: 'intex-eval-001-123e4567-e89b-12d3-a456-426614174000',
      userId: 'test-intex-agent-intex-eval-001-123e4567-e89b-12d3-a456-426614174000',
    });
    expect(createSyntheticRunIdentity('intex-eval-001').runId).toMatch(
      /^intex-eval-001-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

  it.each([
    ['invalid scenario', 'private/scenario-sentinel', UUID],
    ['invalid uuid', 'intex-eval-001', 'private-uuid-sentinel'],
  ])('rejects %s without echoing input', (_label, scenarioId, uuid) => {
    expect(() => createSyntheticRunIdentity(scenarioId, () => uuid)).toThrow(
      'invalid synthetic run identity'
    );
    try {
      createSyntheticRunIdentity(scenarioId, () => uuid);
    } catch (error) {
      expect(String(error)).not.toMatch(/private\/scenario-sentinel|private-uuid-sentinel/u);
    }
  });

  it('materializes exact generated messages, timestamps, source type, and confirmation fields', () => {
    const scenario = parsedConfirmationScenario();
    const identity = fixedIdentity();

    const request = materializeEndpointRequest(scenario, identity);

    expect(request).toEqual({
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      userId: identity.userId,
      runId: identity.runId,
      scenarioId: scenario.id,
      currentDateTime: scenario.currentDateTime,
      timeZone: scenario.timeZone,
      turns: [
        {
          kind: 'message',
          messageId: `wamid-test-${identity.runId}-0`,
          text: scenario.turns[0]?.kind === 'message' ? scenario.turns[0].text : '',
          timestamp: '2026-07-16T08:00:00.000Z',
          sourceType: 'whatsapp_audio_transcript',
        },
        {
          kind: 'confirmation_button',
          previousTurnIndex: 0,
          decision: 'accept',
          messageId: `wamid-test-${identity.runId}-1`,
          timestamp: '2026-07-16T08:00:01.000Z',
        },
      ],
    });
    expect(request).not.toHaveProperty('toolMocks');
  });

  it('uses whatsapp_text when a tracked message omits sourceType', () => {
    const request = materializeEndpointRequest(parsedScenario(), fixedIdentity());
    expect(request.turns[0]).toMatchObject({ sourceType: 'whatsapp_text' });
  });
});

describe('endpoint client transport and strict parsing', () => {
  it('posts the exact authenticated request and parses strict diagnostics', async () => {
    const scenario = parsedScenario();
    const identity = fixedIdentity();
    const calls: { url: string; init: RequestInit }[] = [];
    const timer = new ManualTimer();
    const client = createEndpointClient({
      internalAuthToken: AUTH_TOKEN,
      timeoutMs: 12_345,
      timer,
      fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return jsonResponse({
          success: true,
          data: validResponse(scenario, identity),
          diagnostics: {
            requestId: 'request-1',
            durationMs: 25,
            downstreamStatus: 200,
            downstreamRequestId: 'downstream-1',
            endpointCalled: 'intex-agent',
          },
        });
      }) as typeof fetch,
    });

    await expect(client.runScenario(scenario, identity)).resolves.toEqual(
      validResponse(scenario, identity)
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8134/internal/intex-agent/test/conversation');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': AUTH_TOKEN,
      },
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(
      materializeEndpointRequest(scenario, identity)
    );
    expect(String(calls[0]?.init.body)).not.toContain('toolMocks');
    expect(timer.timeoutMs).toBe(12_345);
    expect(timer.clearCount).toBe(1);
  });

  it('accepts a success envelope without diagnostics', async () => {
    const scenario = parsedScenario();
    const identity = fixedIdentity();
    const client = clientForBody({ success: true, data: validResponse(scenario, identity) });

    await expect(client.runScenario(scenario, identity)).resolves.toEqual(
      validResponse(scenario, identity)
    );
  });

  it('fails before fetch when internal auth is empty', async () => {
    let calls = 0;
    const client = createEndpointClient({
      internalAuthToken: '',
      timeoutMs: 100,
      fetchFn: (async () => {
        calls += 1;
        return jsonResponse({});
      }) as typeof fetch,
    });

    await expectFailure(client.runScenario(parsedScenario(), fixedIdentity()), {
      code: 'missing_internal_auth',
    });
    expect(calls).toBe(0);
  });

  it.each([401, 404, 500])('maps HTTP %s without reading the body', async (status) => {
    const client = createEndpointClient({
      internalAuthToken: AUTH_TOKEN,
      timeoutMs: 100,
      fetchFn: (async () =>
        ({
          status,
          async text(): Promise<string> {
            throw new Error('private-body-read-sentinel');
          },
        }) as Response) as typeof fetch,
    });

    await expectFailure(client.runScenario(parsedScenario(), fixedIdentity()), {
      code: 'endpoint_http_failed',
      httpStatus: status,
    });
  });

  it('maps transport rejection without retaining the cause', async () => {
    const client = createEndpointClient({
      internalAuthToken: AUTH_TOKEN,
      timeoutMs: 100,
      fetchFn: (async () => {
        throw new Error('private-transport-sentinel');
      }) as typeof fetch,
    });

    const error = await captureFailure(client.runScenario(parsedScenario(), fixedIdentity()));
    expect(error).toMatchObject({
      code: 'endpoint_transport_failed',
      message: 'endpoint_transport_failed',
    });
    expect(serializeFailure(error)).not.toContain('private-transport-sentinel');
  });

  it('uses one abort deadline for a stalled response body', async () => {
    const timer = new ManualTimer();
    const client = createEndpointClient({
      internalAuthToken: AUTH_TOKEN,
      timeoutMs: 100,
      timer,
      fetchFn: (async () =>
        ({
          status: 200,
          text: async () => await new Promise<string>(() => undefined),
        }) as Response) as typeof fetch,
    });

    const pending = client.runScenario(parsedScenario(), fixedIdentity());
    await Promise.resolve();
    timer.fire();

    await expectFailure(pending, { code: 'endpoint_timeout' });
    expect(timer.clearCount).toBe(1);
  });

  it('maps a response-body failure without retaining the cause', async () => {
    const client = createEndpointClient({
      internalAuthToken: AUTH_TOKEN,
      timeoutMs: 100,
      fetchFn: (async () =>
        ({
          status: 200,
          async text(): Promise<string> {
            throw new Error('private-body-sentinel');
          },
        }) as Response) as typeof fetch,
    });

    const error = await captureFailure(client.runScenario(parsedScenario(), fixedIdentity()));
    expect(error.code).toBe('endpoint_transport_failed');
    expect(serializeFailure(error)).not.toContain('private-body-sentinel');
  });

  it.each([
    ['invalid JSON', '{private-invalid-json-sentinel'],
    [
      '200 error envelope',
      JSON.stringify({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'private-error-envelope-sentinel' },
      }),
    ],
    ['non-finite recursive value', validRawEnvelopeWith('1e309')],
  ])('maps %s to a safe malformed response', async (_label, body) => {
    const client = clientForRawBody(body);
    const error = await captureFailure(client.runScenario(parsedScenario(), fixedIdentity()));
    expect(error).toMatchObject({
      code: 'malformed_endpoint_response',
      message: 'malformed_endpoint_response',
    });
    expect(serializeFailure(error)).not.toMatch(
      /private-invalid-json-sentinel|private-error-envelope-sentinel/u
    );
  });

  it.each([
    [
      'envelope unknown key',
      (value: Record<string, unknown>): void => {
        value['unknown'] = true;
      },
    ],
    [
      'diagnostics missing request id',
      (value: Record<string, unknown>): void => {
        value['diagnostics'] = { durationMs: 1 };
      },
    ],
    [
      'turn missing required field',
      (value: Record<string, unknown>): void => {
        delete firstTurn(value)['toolCalls'];
      },
    ],
    [
      'turn unknown field',
      (value: Record<string, unknown>): void => {
        firstTurn(value)['rawText'] = 'private-turn-sentinel';
      },
    ],
    [
      'reply button unknown field',
      (value: Record<string, unknown>): void => {
        firstReplyButton(value)['unknown'] = true;
      },
    ],
    [
      'session snapshot wrong type',
      (value: Record<string, unknown>): void => {
        asRecord(firstTurn(value)['sessionAfterTurn'])['status'] = 42;
      },
    ],
    [
      'timeline event unknown field',
      (value: Record<string, unknown>): void => {
        firstTimelineEvent(value)['userId'] = 'private-event-user-sentinel';
      },
    ],
    [
      'recursive record array',
      (value: Record<string, unknown>): void => {
        const call = firstToolCall(value);
        call['argsSummary'] = { unsupported: [] };
      },
    ],
  ])('rejects strict schema violation: %s', async (_label, mutate) => {
    const scenario = parsedScenario();
    const identity = fixedIdentity();
    const envelope = validEnvelope(scenario, identity);
    mutate(envelope);
    const error = await captureFailure(clientForBody(envelope).runScenario(scenario, identity));
    expect(error.code).toBe('malformed_endpoint_response');
    expect(serializeFailure(error)).not.toMatch(
      /private-turn-sentinel|private-event-user-sentinel/u
    );
  });
});

describe('endpoint client correlation', () => {
  it.each([
    [
      'contract version',
      (data: Record<string, unknown>): void => {
        data['contractVersion'] = 'wrong';
      },
    ],
    [
      'mode',
      (data: Record<string, unknown>): void => {
        data['mode'] = 'wrong';
      },
    ],
    [
      'run id',
      (data: Record<string, unknown>): void => {
        data['runId'] = 'private-run-sentinel';
      },
    ],
    [
      'scenario id',
      (data: Record<string, unknown>): void => {
        data['scenarioId'] = 'intex-eval-999';
      },
    ],
    [
      'user id',
      (data: Record<string, unknown>): void => {
        data['userId'] = 'private-user-sentinel';
      },
    ],
    [
      'side-effect boundary',
      (data: Record<string, unknown>): void => {
        data['sideEffectBoundary'] = 'wrong';
      },
    ],
    [
      'turn count',
      (data: Record<string, unknown>): void => {
        asArray(data['turns']).pop();
      },
    ],
    [
      'duplicate turn index',
      (data: Record<string, unknown>): void => {
        asRecord(asArray(data['turns'])[1])['turnIndex'] = 0;
      },
    ],
    [
      'non-contiguous turn index',
      (data: Record<string, unknown>): void => {
        asRecord(asArray(data['turns'])[1])['turnIndex'] = 4;
      },
    ],
    [
      'turn kind',
      (data: Record<string, unknown>): void => {
        asRecord(asArray(data['turns'])[0])['kind'] = 'confirmation_button';
      },
    ],
    [
      'message id',
      (data: Record<string, unknown>): void => {
        asRecord(asArray(data['turns'])[0])['messageId'] = 'private-message-sentinel';
      },
    ],
    [
      'session snapshot id',
      (data: Record<string, unknown>): void => {
        asRecord(asRecord(asArray(data['turns'])[0])['sessionAfterTurn'])['id'] = 'wrong-session';
      },
    ],
    [
      'missing transition',
      (data: Record<string, unknown>): void => {
        asArray(data['sessionTransitions']).pop();
      },
    ],
    [
      'duplicate transition',
      (data: Record<string, unknown>): void => {
        asArray(data['sessionTransitions']).push(asArray(data['sessionTransitions'])[0]);
      },
    ],
    [
      'transition turn index',
      (data: Record<string, unknown>): void => {
        asRecord(asArray(data['sessionTransitions'])[1])['turnIndex'] = 9;
      },
    ],
    [
      'transition session id',
      (data: Record<string, unknown>): void => {
        asRecord(asArray(data['sessionTransitions'])[0])['sessionId'] = 'wrong-session';
      },
    ],
    [
      'final session id',
      (data: Record<string, unknown>): void => {
        data['finalSessionId'] = 'private-final-session-sentinel';
      },
    ],
  ])('rejects %s mismatch without leaking correlated values', async (_label, mutate) => {
    const scenario = parsedConfirmationScenario();
    const identity = fixedIdentity();
    const envelope = validEnvelope(scenario, identity);
    const data = asRecord(envelope['data']);
    mutate(data);

    const error = await captureFailure(clientForBody(envelope).runScenario(scenario, identity));
    expect(error).toMatchObject({
      code: 'endpoint_correlation_failed',
      message: 'endpoint_correlation_failed',
    });
    expect(serializeFailure(error)).not.toMatch(
      /private-run-sentinel|private-user-sentinel|private-message-sentinel|private-final-session-sentinel|private-auth-token-sentinel/u
    );
  });
});

function parsedScenario(): IntexEvalScenario {
  return IntexEvalScenarioSchema.parse(createScenario());
}

function parsedConfirmationScenario(): IntexEvalScenario {
  const fixture = createConfirmationScenario();
  const first = fixture.turns[0];
  if (first !== undefined) first.sourceType = 'whatsapp_audio_transcript';
  return IntexEvalScenarioSchema.parse(fixture);
}

function fixedIdentity(): SyntheticRunIdentity {
  return createSyntheticRunIdentity('intex-eval-001', () => UUID);
}

function validEnvelope(
  scenario: IntexEvalScenario,
  identity: SyntheticRunIdentity
): Record<string, unknown> {
  return {
    success: true,
    data: validResponse(scenario, identity),
    diagnostics: { requestId: 'request-1' },
  };
}

function validResponse(
  scenario: IntexEvalScenario,
  identity: SyntheticRunIdentity
): EndpointConversationResponse {
  const sessionId = 'intex_session_synthetic';
  const turns = scenario.turns.map((turn, turnIndex) => {
    const messageId = `wamid-test-${identity.runId}-${String(turnIndex)}`;
    return {
      turnIndex,
      kind: turn.kind,
      messageId,
      sessionId,
      ...(turn.kind === 'message' ? { submittedTextPreview: 'Synthetic preview' } : {}),
      assistantReplies: [
        {
          userId: identity.userId,
          message: 'Sanitized assistant reply.',
          replyToMessageId: messageId,
          correlationId: sessionId,
          ctaUrl: { displayText: 'Open', url: '[redacted-url]' },
          buttons: [{ type: 'reply' as const, reply: { id: 'button-id', title: 'Confirm' } }],
        },
      ],
      toolCalls: [
        {
          toolName: 'create_note' as const,
          status: 'completed' as const,
          argsSummary: { syntheticMarkerCount: 1, nested: { visible: true } },
          resultSummary: { status: 'completed' },
        },
      ],
      sessionAfterTurn: {
        id: sessionId,
        status: 'waiting_for_user' as const,
        startReason: 'no_active_session' as const,
        activeTool: 'create_note' as const,
      },
      timelineEvents: [
        {
          sessionId,
          id: `event-${String(turnIndex)}`,
          type: 'assistant_message' as const,
          createdAt: timestampAt(scenario.currentDateTime, turnIndex),
          payload: { textPreview: 'Sanitized assistant reply.' },
        },
      ],
    };
  });

  return {
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    runId: identity.runId,
    scenarioId: scenario.id,
    userId: identity.userId,
    finalSessionId: sessionId,
    turns,
    toolCalls: turns.flatMap((turn) => turn.toolCalls),
    sessions: [
      {
        id: sessionId,
        userId: identity.userId,
        channel: 'whatsapp',
        status: 'waiting_for_user',
        startedAt: scenario.currentDateTime,
        lastUserMessageAt: scenario.currentDateTime,
        lastAssistantMessageAt: scenario.currentDateTime,
        startReason: 'no_active_session',
        activeTool: 'create_note',
      },
    ],
    sessionTransitions: turns.map((turn) => ({
      turnIndex: turn.turnIndex,
      action: turn.turnIndex === 0 ? 'started' : 'continued',
      sessionId,
    })),
    eventsBySessionId: {
      [sessionId]: turns.flatMap((turn) =>
        turn.timelineEvents.map(({ sessionId: _sessionId, ...event }) => event)
      ),
    },
    behavioralTranscript: {
      turns: turns.map((turn) => ({
        turnIndex: turn.turnIndex,
        ...(turn.submittedTextPreview !== undefined
          ? { submittedTextPreview: turn.submittedTextPreview }
          : {}),
        assistantReplyPreviews: ['Sanitized assistant reply.'],
        sessionAction: turn.turnIndex === 0 ? 'started' : 'continued',
        toolOutcome: { toolName: 'create_note', status: 'completed' },
      })),
    },
    sideEffectBoundary: 'mocked_tools_no_downstream_writes',
    warnings: [],
  };
}

function timestampAt(base: string, seconds: number): string {
  const value = new Date(base);
  value.setSeconds(value.getSeconds() + seconds);
  return value.toISOString();
}

function clientForBody(body: unknown): EndpointClient {
  return createEndpointClient({
    internalAuthToken: AUTH_TOKEN,
    timeoutMs: 100,
    fetchFn: (async () => jsonResponse(body)) as typeof fetch,
  });
}

function clientForRawBody(body: string): EndpointClient {
  return createEndpointClient({
    internalAuthToken: AUTH_TOKEN,
    timeoutMs: 100,
    fetchFn: (async () => new Response(body, { status: 200 })) as typeof fetch,
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function captureFailure(promise: Promise<unknown>): Promise<EndpointClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EndpointClientError);
    return error as EndpointClientError;
  }
  throw new Error('Expected endpoint client failure');
}

async function expectFailure(
  promise: Promise<unknown>,
  expected: { code: string; httpStatus?: number }
): Promise<void> {
  const error = await captureFailure(promise);
  expect(error).toMatchObject({ ...expected, message: expected.code });
}

function serializeFailure(error: EndpointClientError): string {
  return JSON.stringify({
    name: error.name,
    message: error.message,
    code: error.code,
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
  });
}

class ManualTimer implements EndpointTimer {
  callback: (() => void) | undefined;
  timeoutMs: number | undefined;
  clearCount = 0;

  set(callback: () => void, timeoutMs: number): unknown {
    this.callback = callback;
    this.timeoutMs = timeoutMs;
    return Symbol('timer');
  }

  clear(): void {
    this.clearCount += 1;
  }

  fire(): void {
    const callback = this.callback;
    if (callback === undefined) throw new Error('Timer callback missing');
    callback();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected record fixture');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected array fixture');
  return value;
}

function firstTurn(envelope: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asArray(asRecord(envelope['data'])['turns'])[0]);
}

function firstReplyButton(envelope: Record<string, unknown>): Record<string, unknown> {
  const replies = asArray(firstTurn(envelope)['assistantReplies']);
  return asRecord(asArray(asRecord(replies[0])['buttons'])[0]);
}

function firstTimelineEvent(envelope: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asArray(firstTurn(envelope)['timelineEvents'])[0]);
}

function firstToolCall(envelope: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asArray(firstTurn(envelope)['toolCalls'])[0]);
}

function validRawEnvelopeWith(recursiveValue: string): string {
  const scenario = parsedScenario();
  const identity = fixedIdentity();
  const raw = JSON.stringify(validEnvelope(scenario, identity));
  return raw.replace('"syntheticMarkerCount":1', `"syntheticMarkerCount":${recursiveValue}`);
}
