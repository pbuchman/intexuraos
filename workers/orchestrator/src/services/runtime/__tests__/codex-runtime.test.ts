import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { getRuntime } from '../index.js';

const createLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe('Codex runtime contract', () => {
  it('returns the codex runtime from the registry', () => {
    expect(getRuntime('codex').runtime).toBe('codex');
  });

  it('emits a session-started event from Codex thread.started lines', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-1', createLogger());

    const events = runtime.processLogChunk(
      state,
      [
        '{"type":"thread.started","thread_id":"thread-123"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"READY"}}',
      ].join('\n') + '\n'
    );

    expect(events).toContainEqual({
      type: 'log',
      text:
        '{"type":"thread.started","thread_id":"thread-123"}\n' +
        '{"type":"turn.started"}\n' +
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"READY"}}\n',
    });
    expect(events).toContainEqual({
      type: 'runtime_session_started',
      sessionId: 'thread-123',
    });
  });

  it('emits a normalized completion event from Codex turn.completed lines', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-2', createLogger());

    const events = runtime.processLogChunk(
      state,
      '{"type":"turn.completed","usage":{"input_tokens":22970,"cached_input_tokens":17024,"output_tokens":784}}\n'
    );

    expect(events).toContainEqual({
      type: 'attempt_completed',
      exitCode: 0,
    });
  });

  it('emits a normalized failure event from Codex turn.failed lines', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-3', createLogger());

    const events = runtime.processLogChunk(
      state,
      [
        '{"type":"error","message":"primary-error"}',
        '{"type":"turn.failed","error":{"message":"turn-failed-error"}}',
      ].join('\n') + '\n'
    );

    expect(events).toContainEqual({
      type: 'attempt_failed',
      exitCode: 1,
      errorMessage: 'turn-failed-error',
    });
  });

  it('buffers split Codex result lines and emits completion on flush', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-4', createLogger());

    const partialEvents = runtime.processLogChunk(
      state,
      '{"type":"turn.completed","usage":{"input_tokens":1}'
    );

    expect(partialEvents).toEqual([
      {
        type: 'log',
        text: '{"type":"turn.completed","usage":{"input_tokens":1}',
      },
    ]);

    const remainingEvents = runtime.processLogChunk(state, '}\n');
    expect(remainingEvents).toContainEqual({
      type: 'log',
      text: '}\n',
    });
    expect(remainingEvents).toContainEqual({
      type: 'attempt_completed',
      exitCode: 0,
    });

    const completionEvents = runtime.flushAttemptState(state);

    expect(completionEvents).toEqual([]);
  });

  it('falls back to the latest stream error when turn.failed omits its message', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-5', createLogger());

    const events = runtime.processLogChunk(
      state,
      [
        '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"item-error"}}',
        '{"type":"error","message":"stream-error"}',
        '{"type":"turn.failed","error":{}}',
      ].join('\n') + '\n'
    );

    expect(events).toContainEqual({
      type: 'attempt_failed',
      exitCode: 1,
      errorMessage: 'stream-error',
    });
  });

  it('ignores blank and non-json chunks and allows empty chunk processing', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-6', createLogger());

    expect(runtime.processLogChunk(state, '')).toEqual([]);
    expect(runtime.processLogChunk(state, '   \nplain text\n')).toContainEqual({
      type: 'log',
      text: '   \nplain text\n',
    });
  });

  it('falls back to the default message when turn.failed has no error details', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-7', createLogger());

    const events = runtime.processLogChunk(state, '{"type":"turn.failed","error":{}}\n');

    expect(events).toContainEqual({
      type: 'attempt_failed',
      exitCode: 1,
      errorMessage: 'Codex turn failed',
    });
  });

  it('keeps buffering incomplete terminal markers without a JSON object prefix', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-8', createLogger());

    const events = runtime.processLogChunk(state, '"type":"turn.completed"');

    expect(events).toEqual([
      {
        type: 'log',
        text: '"type":"turn.completed"',
      },
    ]);

    expect(runtime.flushAttemptState(state)).toEqual([]);
  });

  it('flushes whitespace-only buffered state without emitting completion', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-9', createLogger());

    runtime.processLogChunk(state, '   ');

    expect(runtime.flushAttemptState(state)).toEqual([]);
  });
});
