import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { WORKER_TYPES } from '../../isolation/types.js';
import { getRuntimeForWorkerType } from '../index.js';

const createLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe('runtime registry', () => {
  it('keeps existing Claude worker types on the Claude runtime', () => {
    for (const [workerType, config] of Object.entries(WORKER_TYPES)) {
      if (config.runtime !== 'claude') {
        continue;
      }
      expect(getRuntimeForWorkerType(workerType as keyof typeof WORKER_TYPES).runtime).toBe(
        'claude'
      );
    }
  });
});

describe('Claude runtime contract', () => {
  it('emits a session-started event from Claude init messages', () => {
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-1', createLogger());

    const events = runtime.processLogChunk(
      state,
      `${JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'session-123',
        model: 'claude-sonnet',
        tools: ['Task'],
        mcp_servers: [{}],
        permissionMode: 'plan',
        version: '1.0.0',
      })}\n`
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'runtime_session_started',
        sessionId: 'session-123',
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('[claude] Session init'),
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('mcp=[?:fail]'),
      })
    );
  });

  it('emits a normalized completion event for successful Claude result lines', () => {
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-2', createLogger());

    const events = runtime.processLogChunk(
      state,
      '{"type":"result","is_error":false,"result":"done"}\n'
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'attempt_completed',
        exitCode: 0,
      })
    );
  });

  it('buffers split Claude result lines and emits a normalized failure event on flush', () => {
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-3', createLogger());

    const partialEvents = runtime.processLogChunk(state, '{"type":"result","is_error":true,');
    expect(partialEvents).toEqual([
      {
        type: 'log',
        text: '{"type":"result","is_error":true,',
      },
    ]);

    const remainingEvents = runtime.processLogChunk(state, '"result":"split_error_detected"}');
    expect(remainingEvents).toContainEqual({
      type: 'log',
      text: '"result":"split_error_detected"}',
    });
    expect(remainingEvents).toContainEqual(
      expect.objectContaining({
        type: 'attempt_failed',
        exitCode: 1,
        errorMessage: 'split_error_detected',
      })
    );

    const completionEvents = runtime.flushAttemptState(state);
    expect(completionEvents).toEqual([]);
  });

  it('formats hook, rate-limit, and tool result log lines through the runtime log event', () => {
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-4', createLogger());

    const events = runtime.processLogChunk(
      state,
      [
        JSON.stringify({ type: 'system', subtype: 'hook_started' }),
        JSON.stringify({ type: 'system', subtype: 'hook_response' }),
        JSON.stringify({ type: 'system', subtype: 'noop' }),
        JSON.stringify({ type: 'rate_limit_event' }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user' },
          tool_use_result: { large: 'payload' },
        }),
      ].join('\n') + '\n'
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('[hook] unknown started'),
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('[hook] unknown completed (0 lines)'),
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('[rate-limit] status=unknown'),
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('"type":"system","subtype":"noop"'),
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('"message":{"role":"user"}'),
      })
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('tool_use_result'),
      })
    );
  });

  it('ignores empty and non-json lines, warns on tool_use_error, and falls back to default failure text', () => {
    const logger = createLogger();
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-5', logger);

    const events = runtime.processLogChunk(
      state,
      '\n<tool_use_error>\nplain text\n{"type":"result","is_error":true}\n'
    );

    expect(logger.warn).toHaveBeenCalledWith(
      { taskId: 'task-5' },
      'Claude tool_use_error in stream (non-fatal sibling call failure)'
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'attempt_failed',
        exitCode: 1,
        errorMessage: 'Task failed',
      })
    );
  });

  it('returns no events for empty chunks or empty flushes', () => {
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-6', createLogger());

    expect(runtime.processLogChunk(state, '')).toEqual([]);
    expect(runtime.flushAttemptState(state)).toEqual([]);
  });

  it('preserves operator-scannable timeout marker in log stream', () => {
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-timeout', createLogger());

    // The entrypoint emits this stable marker when the `timeout` command kills the
    // Claude process (exit code 124 → 1). Operators scan for "MCP timeout" + "server=linear".
    const marker = '[entrypoint] MCP timeout server=linear timeout_ms=60000';

    const events = runtime.processLogChunk(state, marker + '\n');

    // The marker must appear verbatim in the log stream so operator log queries
    // (e.g. `gcloud logging read 'textPayload:"MCP timeout"'`) match reliably.
    expect(events).toContainEqual({
      type: 'log',
      text: marker + '\n',
    });

    // Verify the marker is NOT parsed as Claude JSON — it must not trigger
    // completion or failure events, only a plain log passthrough.
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'attempt_completed' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'attempt_failed' }));
  });

  it('keeps malformed result fragments buffered when no JSON object start is present', () => {
    const runtime = getRuntimeForWorkerType('auto');
    const state = runtime.createAttemptState('task-7', createLogger());

    const events = runtime.processLogChunk(state, '"type":"result"');

    expect(events).toEqual([
      {
        type: 'log',
        text: '"type":"result"',
      },
    ]);
    expect(runtime.flushAttemptState(state)).toEqual([]);
  });
});
