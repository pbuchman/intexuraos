import { describe, it, expect } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { FormatterState } from '../../../../domain/services/logFormatter.js';
import {
  collapseOutput,
  flushCodexPartial,
  formatRawCodexLogChunk,
  formatResult,
  formatSystem,
} from '../../../../domain/services/logFormatter/progressFormatter.js';
import type { StreamJsonMessage } from '../../../../domain/services/logFormatter/markdownFormatter.js';

function ts(): Timestamp {
  return Timestamp.now();
}

function newState(): FormatterState {
  return { toolCallsById: new Map<string, string>(), lastToolName: undefined };
}

describe('formatSystem', () => {
  it('renders hook_started with the provided hook name', () => {
    const msg: StreamJsonMessage = {
      type: 'system',
      subtype: 'hook_started',
      hook_name: 'pre-commit',
    };
    expect(formatSystem(msg)).toBe('[hook] pre-commit started');
  });

  it('falls back to "unknown" when hook_started has no hook_name', () => {
    const msg: StreamJsonMessage = { type: 'system', subtype: 'hook_started' };
    expect(formatSystem(msg)).toBe('[hook] unknown started');
  });

  it('renders a success hook_response with the check marker', () => {
    const msg: StreamJsonMessage = {
      type: 'system',
      subtype: 'hook_response',
      hook_name: 'lint',
      exit_code: 0,
    };
    expect(formatSystem(msg)).toBe('[hook] lint ✓ (exit 0)');
  });

  it('renders a failed hook_response with the cross marker', () => {
    const msg: StreamJsonMessage = {
      type: 'system',
      subtype: 'hook_response',
      hook_name: 'lint',
      exit_code: 1,
    };
    expect(formatSystem(msg)).toBe('[hook] lint ✗ (exit 1)');
  });

  it('indents each line of hook_response output by two spaces', () => {
    const msg: StreamJsonMessage = {
      type: 'system',
      subtype: 'hook_response',
      hook_name: 'lint',
      exit_code: 0,
      output: 'first\nsecond\nthird',
    };
    expect(formatSystem(msg)).toBe('[hook] lint ✓ (exit 0)\n  first\n  second\n  third');
  });

  it('renders init with model, tool count, and mcp server statuses', () => {
    const msg: StreamJsonMessage = {
      type: 'system',
      subtype: 'init',
      model: 'claude-sonnet',
      tools: ['Read', 'Write', 'Bash'],
      mcp_servers: [
        { name: 'linear', status: 'connected' },
        { name: 'sentry', status: 'disconnected' },
      ],
    };
    expect(formatSystem(msg)).toBe(
      '[init] Model: claude-sonnet | Tools: 3 | MCP: linear ✓, sentry ✗',
    );
  });

  it('renders an unknown subtype using the [system] prefix', () => {
    const msg: StreamJsonMessage = { type: 'system', subtype: 'some_sub' };
    expect(formatSystem(msg)).toBe('[system] some_sub');
  });

  it('renders a bare [system] label when no subtype is provided', () => {
    const msg: StreamJsonMessage = { type: 'system' };
    expect(formatSystem(msg)).toBe('[system]');
  });

  it('snapshots a hook_response with multi-line output', () => {
    const msg: StreamJsonMessage = {
      type: 'system',
      subtype: 'hook_response',
      hook_name: 'lint',
      exit_code: 0,
      output: 'check one\ncheck two',
    };
    expect(formatSystem(msg)).toMatchInlineSnapshot(`
      "[hook] lint ✓ (exit 0)
        check one
        check two"
    `);
  });
});

describe('formatResult', () => {
  it('prefixes [error] and uses the provided result string', () => {
    const msg: StreamJsonMessage = { type: 'result', is_error: true, result: 'Boom!' };
    expect(formatResult(msg)).toBe('[error] Boom!');
  });

  it('falls back to "Task failed" when is_error is true without a result', () => {
    const msg: StreamJsonMessage = { type: 'result', is_error: true };
    expect(formatResult(msg)).toBe('[error] Task failed');
  });

  it('joins duration, turns, and cost into the [done] summary', () => {
    const msg: StreamJsonMessage = {
      type: 'result',
      duration_ms: 4321,
      num_turns: 7,
      total_cost_usd: 0.12345,
    };
    expect(formatResult(msg)).toBe('[done] 4.3s, 7 turns, $0.123');
  });

  it('falls back to duration_api_ms when duration_ms is missing', () => {
    const msg: StreamJsonMessage = { type: 'result', duration_api_ms: 2500 };
    expect(formatResult(msg)).toBe('[done] 2.5s');
  });

  it('renders [done] Completed when no metrics are provided', () => {
    const msg: StreamJsonMessage = { type: 'result' };
    expect(formatResult(msg)).toBe('[done] Completed');
  });
});

describe('collapseOutput', () => {
  it('summarizes a large JSON array as compact one-liner', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i, value: `entry-${String(i)}` }));
    const json = JSON.stringify(items);
    expect(json.length).toBeGreaterThanOrEqual(200);

    const out = collapseOutput(json);
    expect(out).toBe(`  hook output: [30 items] [${String(json.length)} chars]`);
  });

  it('summarizes a large JSON object using its keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 10; i++) obj[`key${String(i)}`] = i;
    const padded = { ...obj, pad: 'x'.repeat(250) };
    const json = JSON.stringify(padded);
    expect(json.length).toBeGreaterThanOrEqual(200);

    const out = collapseOutput(json);
    expect(out.startsWith('  hook output: {11 keys: key0, key1, key2, key3, key4, ...}')).toBe(
      true,
    );
    expect(out.endsWith(`[${String(json.length)} chars]`)).toBe(true);
  });

  it('falls back to indented line-by-line output for non-JSON content', () => {
    const content = 'alpha\nbeta\n\ngamma';
    expect(collapseOutput(content)).toBe('  alpha\n  beta\n  gamma');
  });

  it('strips <system-reminder> blocks from the output', () => {
    const content = 'kept\n<system-reminder>secret</system-reminder>\nalso kept';
    expect(collapseOutput(content)).toBe('  kept\n  also kept');
  });
});

describe('formatRawCodexLogChunk', () => {
  it('passes each non-empty line through unchanged', () => {
    const state = newState();
    const result = formatRawCodexLogChunk('one\ntwo\nthree\n', 0, ts(), state);
    expect(result.map((l) => l.text)).toEqual(['one', 'two', 'three']);
  });

  it('buffers the last line on state.partialLine when input does not end with newline', () => {
    const state = newState();
    const result = formatRawCodexLogChunk('one\ntwo\npartial', 0, ts(), state);
    expect(result.map((l) => l.text)).toEqual(['one', 'two']);
    expect(state.partialLine).toBe('partial');
  });

  it('does not buffer when input ends with a newline', () => {
    const state = newState();
    const result = formatRawCodexLogChunk('one\ntwo\n', 0, ts(), state);
    expect(result.map((l) => l.text)).toEqual(['one', 'two']);
    expect(state.partialLine).toBeUndefined();
  });

  it('does not buffer when state is undefined (stateless call cannot reassemble)', () => {
    const result = formatRawCodexLogChunk('one\npartial', 0, ts());
    expect(result.map((l) => l.text)).toEqual(['one', 'partial']);
  });

  it('returns an empty array for empty input', () => {
    expect(formatRawCodexLogChunk('', 0, ts(), newState())).toEqual([]);
  });

  it('concatenates a previous partialLine with the first new line', () => {
    const state: FormatterState = {
      toolCallsById: new Map<string, string>(),
      lastToolName: undefined,
      partialLine: 'pre-',
    };
    const result = formatRawCodexLogChunk('fix\nsecond\n', 0, ts(), state);
    expect(result.map((l) => l.text)).toEqual(['pre-fix', 'second']);
    expect(state.partialLine).toBeUndefined();
  });

  it('formats Codex file_change items into repo-relative [file] lines', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_105',
          type: 'file_change',
          changes: [
            {
              path: '/repo/apps/mobile-notifications-service/src/routes/internalRoutes.ts',
              kind: 'update',
            },
          ],
          status: 'completed',
        },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual([
      '[file] update apps/mobile-notifications-service/src/routes/internalRoutes.ts',
    ]);
  });

  it('formats every changed file with a distinct sequence', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_105',
          type: 'file_change',
          changes: [
            {
              path: '/repo/apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts',
              kind: 'update',
            },
            {
              path: '/repo/apps/mobile-notifications-service/src/routes/internalRoutes.ts',
              kind: 'update',
            },
          ],
          status: 'completed',
        },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 7, ts(), state);

    expect(result.map((line) => line.sequence)).toEqual([7000, 7001]);
    expect(result.map((line) => line.text)).toEqual([
      '[file] update apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts',
      '[file] update apps/mobile-notifications-service/src/routes/internalRoutes.ts',
    ]);
  });

  it('formats Codex agent messages into [msg] lines', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', type: 'agent_message', text: 'Focused tests are green.' },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual(['[msg] Focused tests are green.']);
  });

  it('formats Codex completed error items into [error] lines', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_error', type: 'error', message: 'command timed out' },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual(['[error] command timed out']);
  });

  it('formats Codex command executions with bounded output gutters', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_2',
          type: 'command_execution',
          command:
            '/bin/sh -lc "pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx"',
          aggregated_output:
            'PASS apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx\n',
          exit_code: 0,
          status: 'completed',
        },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual([
      '[cmd] $ pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx  -> ok (1 lines)\n' +
        '    | PASS apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx',
    ]);
  });

  it('formats Codex command failures without output gutters', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_3',
          type: 'command_execution',
          command: '/bin/sh -lc "pnpm lint"',
          exit_code: 2,
          status: 'completed',
        },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual(['[cmd] $ pnpm lint  -> EXIT 2 (0 lines)']);
  });

  it('truncates long Codex commands and long command output with head and tail lines', () => {
    const state = newState();
    const outputLines = Array.from({ length: 24 }, (_, index) => `line-${String(index).padStart(2, '0')}`);
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_4',
          type: 'command_execution',
          command: `pnpm ${'very-long-argument-'.repeat(30)}`,
          aggregated_output: outputLines.join('\n'),
          exit_code: 0,
          status: 'completed',
        },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);
    const [text] = result.map((line) => line.text);

    expect(text).toContain('[...]');
    expect(text).toContain('    | line-00');
    expect(text).toContain('    | line-11');
    expect(text).toContain('    | [... 7 lines omitted ...]');
    expect(text).toContain('    | line-19');
    expect(text).toContain('    | line-23');
  });

  it('uses Codex fallback labels for incomplete command, item, and usage payloads', () => {
    const state = newState();
    const input =
      [
        JSON.stringify({ type: 'turn.completed' }),
        JSON.stringify({ type: 'turn.failed' }),
        JSON.stringify({ type: 'item.completed' }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'command_execution', command: 'pnpm test', exit_code: null },
        }),
      ].join('\n') + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual([
      '[codex] Turn completed | input: ? tokens (0% cached) | output: ? tokens',
      '[error] Codex turn failed',
      '[event] item.completed',
      '[cmd] $ pnpm test  -> EXIT ? (0 lines)',
    ]);
  });

  it('keeps external file paths and defaults missing file change kinds', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'file_change',
          changes: [
            { path: 123, kind: 'update' },
            { path: '/tmp/outside-repo.txt' },
          ],
        },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual(['[file] change /tmp/outside-repo.txt']);
  });

  it('falls back to an event label when file_change has no changes array', () => {
    const state = newState();
    const input =
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'file_change' },
      }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual(['[event] item.completed']);
  });

  it('formats lifecycle and error events while preserving non-JSON text', () => {
    const state = newState();
    const input =
      [
        '[entrypoint] Code worker starting',
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 2 },
        }),
        JSON.stringify({ type: 'error', message: 'rate limited' }),
      ].join('\n') + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual([
      '[entrypoint] Code worker starting',
      '[codex] Session started: thread=thread-123',
      '[codex] Turn started',
      '[codex] Turn completed | input: 10 tokens (50% cached) | output: 2 tokens',
      '[error] rate limited',
    ]);
  });

  it('suppresses item.started and emits compact labels for unknown JSON events', () => {
    const state = newState();
    const input =
      [
        JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }),
        JSON.stringify({ type: 'unknown_event', data: 123 }),
      ].join('\n') + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual(['[event] unknown_event']);
  });

  it('preserves JSON objects that do not declare a Codex event type', () => {
    const state = newState();
    const input = JSON.stringify({ message: 'no event type' }) + '\n';

    const result = formatRawCodexLogChunk(input, 0, ts(), state);

    expect(result.map((line) => line.text)).toEqual(['{"message":"no event type"}']);
  });
});

describe('flushCodexPartial', () => {
  it('returns [] when state.partialLine is undefined', () => {
    expect(flushCodexPartial(0, ts(), newState())).toEqual([]);
  });

  it('returns [] when state.partialLine is whitespace-only', () => {
    const state: FormatterState = {
      toolCallsById: new Map<string, string>(),
      lastToolName: undefined,
      partialLine: '   \t',
    };
    const flushed = flushCodexPartial(0, ts(), state);
    expect(flushed).toEqual([]);
    expect(state.partialLine).toBeUndefined();
  });

  it('returns a single entry for a buffered partial and clears the buffer', () => {
    const timestamp = ts();
    const state: FormatterState = {
      toolCallsById: new Map<string, string>(),
      lastToolName: undefined,
      partialLine: 'remaining text',
    };
    const flushed = flushCodexPartial(5, timestamp, state);
    expect(flushed).toEqual([{ sequence: 5000, text: 'remaining text', timestamp }]);
    expect(state.partialLine).toBeUndefined();
  });

  it('suppresses a buffered item.started partial after parsing it', () => {
    const state: FormatterState = {
      toolCallsById: new Map<string, string>(),
      lastToolName: undefined,
      partialLine: JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }),
    };

    expect(flushCodexPartial(0, ts(), state)).toEqual([]);
    expect(state.partialLine).toBeUndefined();
  });
});
