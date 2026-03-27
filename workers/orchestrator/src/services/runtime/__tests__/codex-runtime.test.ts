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
        '[codex] Session started: thread=thread-123\n' + '[codex] Turn started\n' + '[msg] READY\n',
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

  it('buffers split Codex result lines and emits formatted output after reassembly', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-4', createLogger());

    // First chunk: incomplete JSON — no log event emitted (held in buffer)
    const partialEvents = runtime.processLogChunk(
      state,
      '{"type":"turn.completed","usage":{"input_tokens":1}'
    );

    expect(partialEvents).toEqual([]);

    // Second chunk: completes the JSON line — formatted log + completion event
    const remainingEvents = runtime.processLogChunk(state, '}\n');
    expect(remainingEvents).toContainEqual({
      type: 'log',
      text: '[codex] Turn completed | input: 1 tokens (0% cached) | output: ? tokens\n',
    });
    expect(remainingEvents).toContainEqual({
      type: 'attempt_completed',
      exitCode: 0,
    });

    const completionEvents = runtime.flushAttemptState(state);

    expect(completionEvents).toEqual([]);
  });

  it('formats split item.completed JSON across chunks correctly', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-4b', createLogger());

    const itemJson = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'Hello world',
      },
    });

    // Split the JSON roughly in half
    const midpoint = Math.floor(itemJson.length / 2);
    const chunk1 = itemJson.slice(0, midpoint);
    const chunk2 = itemJson.slice(midpoint) + '\n';

    // First chunk: incomplete JSON — no log event
    const events1 = runtime.processLogChunk(state, chunk1);
    expect(events1).toEqual([]);

    // Second chunk: completes the line — formatted output
    const events2 = runtime.processLogChunk(state, chunk2);
    expect(events2).toContainEqual({
      type: 'log',
      text: '[msg] Hello world\n',
    });
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

  it('flushes incomplete terminal markers without a JSON object prefix as log', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-8', createLogger());

    // Incomplete line without newline — held in buffer, no log event yet
    const events = runtime.processLogChunk(state, '"type":"turn.completed"');

    expect(events).toEqual([]);

    // flushState forwards buffered text as a log event rather than silently dropping it
    expect(runtime.flushAttemptState(state)).toEqual([
      { type: 'log', text: '"type":"turn.completed"\n' },
    ]);
  });

  it('flushes whitespace-only buffered state without emitting completion', () => {
    const runtime = getRuntime('codex');
    const state = runtime.createAttemptState('codex-task-9', createLogger());

    runtime.processLogChunk(state, '   ');

    expect(runtime.flushAttemptState(state)).toEqual([]);
  });
});
