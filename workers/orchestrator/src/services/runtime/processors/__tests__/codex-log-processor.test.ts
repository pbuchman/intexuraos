import { describe, expect, it } from 'vitest';
import { formatCodexMessages } from '../codex-log-processor.js';

describe('formatCodexMessages', () => {
  describe('session lifecycle events', () => {
    it('formats thread.started as session line', () => {
      const input = '{"type":"thread.started","thread_id":"thread-abc-123"}\n';
      expect(formatCodexMessages(input)).toBe('[codex] Session started: thread=thread-abc-123\n');
    });

    it('formats turn.started as single line', () => {
      const input = '{"type":"turn.started"}\n';
      expect(formatCodexMessages(input)).toBe('[codex] Turn started\n');
    });

    it('formats turn.completed with usage and cache percentage', () => {
      const input =
        JSON.stringify({
          type: 'turn.completed',
          usage: {
            input_tokens: 3144447,
            cached_input_tokens: 2966912,
            output_tokens: 14332,
          },
        }) + '\n';
      expect(formatCodexMessages(input)).toBe(
        '[codex] Turn completed | input: 3144447 tokens (94% cached) | output: 14332 tokens\n'
      );
    });

    it('formats turn.completed with zero input tokens without NaN', () => {
      const input =
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 0, output_tokens: 5 },
        }) + '\n';
      expect(formatCodexMessages(input)).toBe(
        '[codex] Turn completed | input: 0 tokens (0% cached) | output: 5 tokens\n'
      );
    });

    it('formats turn.completed with missing usage fields gracefully', () => {
      const input = '{"type":"turn.completed"}\n';
      expect(formatCodexMessages(input)).toBe(
        '[codex] Turn completed | input: ? tokens (0% cached) | output: ? tokens\n'
      );
    });
  });

  describe('item.started events', () => {
    it('removes item.started lines entirely', () => {
      const input =
        JSON.stringify({
          type: 'item.started',
          item: {
            id: 'item_1',
            type: 'command_execution',
            command: '/bin/sh -lc "ls -la"',
            aggregated_output: '',
            exit_code: null,
            status: 'in_progress',
          },
        }) + '\n';
      // item.started should produce empty output (removed)
      const result = formatCodexMessages(input);
      expect(result).toBe('');
    });

    it('removes item.started for agent_message type', () => {
      const input =
        JSON.stringify({
          type: 'item.started',
          item: { id: 'item_0', type: 'agent_message', text: '' },
        }) + '\n';
      expect(formatCodexMessages(input)).toBe('');
    });
  });

  describe('agent messages', () => {
    it('formats agent_message as [msg] line', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_0',
            type: 'agent_message',
            text: 'Starting review of PR #1487.',
          },
        }) + '\n';
      expect(formatCodexMessages(input)).toBe('[msg] Starting review of PR #1487.\n');
    });

    it('preserves multi-line agent messages', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_0',
            type: 'agent_message',
            text: 'Line one.\nLine two.\nLine three.',
          },
        }) + '\n';
      expect(formatCodexMessages(input)).toBe('[msg] Line one.\nLine two.\nLine three.\n');
    });
  });

  describe('command execution', () => {
    it('formats successful command with output', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_1',
            type: 'command_execution',
            command: '/bin/sh -lc "gh pr view 1487 --json url"',
            aggregated_output: '{"url":"https://github.com/org/repo/pull/1487"}\n',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toBe(
        '[cmd] $ gh pr view 1487 --json url  → ok (1 lines)\n' +
          '    | {"url":"https://github.com/org/repo/pull/1487"}\n'
      );
    });

    it('formats failed command with EXIT code', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_2',
            type: 'command_execution',
            command: '/bin/sh -lc "false"',
            aggregated_output: 'command not found\n',
            exit_code: 1,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toContain('[cmd] $ false  → EXIT 1 (1 lines)');
      expect(result).toContain('    | command not found');
    });

    it('formats command with empty output', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_3',
            type: 'command_execution',
            command: '/bin/sh -lc "true"',
            aggregated_output: '',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toBe('[cmd] $ true  → ok (0 lines)\n');
    });

    it('strips /bin/sh -lc double-quoted wrapper', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_4',
            type: 'command_execution',
            command: '/bin/sh -lc "sed -n \'1,220p\' /repo/file.ts"',
            aggregated_output: '',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toContain("[cmd] $ sed -n '1,220p' /repo/file.ts");
    });

    it('strips /bin/sh -lc single-quoted wrapper', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_5',
            type: 'command_execution',
            command: "/bin/sh -lc 'gh pr view 1487'",
            aggregated_output: '',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toContain('[cmd] $ gh pr view 1487');
    });

    it('preserves command without /bin/sh wrapper', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_6',
            type: 'command_execution',
            command: 'node script.js',
            aggregated_output: '',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toContain('[cmd] $ node script.js');
    });
  });

  describe('line truncation', () => {
    it('truncates individual output lines exceeding 200 chars', () => {
      const longLine = 'a'.repeat(250);
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_7',
            type: 'command_execution',
            command: '/bin/sh -lc "cat file"',
            aggregated_output: longLine + '\n',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      const outputLine = result.split('\n').find((l) => l.startsWith('    | ')) ?? '';
      expect(outputLine).not.toBe('');
      expect(outputLine.length).toBeLessThan(250);
      expect(outputLine).toContain('[...]');
    });

    it('truncates long commands at 300 chars', () => {
      const longCmd = 'echo ' + 'x'.repeat(350);
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_8',
            type: 'command_execution',
            command: `/bin/sh -lc "${longCmd}"`,
            aggregated_output: '',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toContain('[...]');
    });
  });

  describe('command output truncation', () => {
    it('truncates output exceeding 20 lines with head/tail', () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${String(i + 1)}`);
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_9',
            type: 'command_execution',
            command: '/bin/sh -lc "cat bigfile"',
            aggregated_output: lines.join('\n') + '\n',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);

      // Should contain first 12 lines
      expect(result).toContain('    | line 1');
      expect(result).toContain('    | line 12');

      // Should contain omission marker
      expect(result).toContain('[... 33 lines omitted ...]');

      // Should contain last 5 lines
      expect(result).toContain('    | line 46');
      expect(result).toContain('    | line 50');

      // Should NOT contain middle lines
      expect(result).not.toContain('    | line 20');
    });

    it('does not truncate output with exactly 20 lines', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${String(i + 1)}`);
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_10',
            type: 'command_execution',
            command: '/bin/sh -lc "cat file"',
            aggregated_output: lines.join('\n') + '\n',
            exit_code: 0,
            status: 'completed',
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).not.toContain('omitted');
      expect(result).toContain('    | line 1');
      expect(result).toContain('    | line 20');
    });
  });

  describe('edge cases in formatting', () => {
    it('handles item.completed with missing item field', () => {
      const input = '{"type":"item.completed"}\n';
      // No item field → passes through as raw JSON
      expect(formatCodexMessages(input)).toBe('{"type":"item.completed"}\n');
    });

    it('handles command with null exit_code', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_x',
            type: 'command_execution',
            command: '/bin/sh -lc "running"',
            exit_code: null,
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toContain('EXIT ?');
    });

    it('handles command with undefined aggregated_output', () => {
      const input =
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_y',
            type: 'command_execution',
            command: '/bin/sh -lc "cmd"',
            exit_code: 0,
          },
        }) + '\n';
      const result = formatCodexMessages(input);
      expect(result).toBe('[cmd] $ cmd  → ok (0 lines)\n');
    });
  });

  describe('error events', () => {
    it('formats error type as [error] line', () => {
      const input = '{"type":"error","message":"Rate limit exceeded"}\n';
      expect(formatCodexMessages(input)).toBe('[error] Rate limit exceeded\n');
    });
  });

  describe('mixed content and edge cases', () => {
    it('passes through non-JSON lines unchanged', () => {
      const input = '[entrypoint] GitHub token loaded\n';
      expect(formatCodexMessages(input)).toBe('[entrypoint] GitHub token loaded\n');
    });

    it('passes through invalid JSON unchanged', () => {
      const input = '{broken json\n';
      expect(formatCodexMessages(input)).toBe('{broken json\n');
    });

    it('passes through unknown JSON types unchanged', () => {
      const input = '{"type":"unknown_event","data":123}\n';
      expect(formatCodexMessages(input)).toBe('{"type":"unknown_event","data":123}\n');
    });

    it('handles mixed JSON and plain text in one chunk', () => {
      const chunk =
        '[entrypoint] Starting...\n' +
        '{"type":"thread.started","thread_id":"t-1"}\n' +
        '{"type":"turn.started"}\n';
      const result = formatCodexMessages(chunk);
      expect(result).toBe(
        '[entrypoint] Starting...\n' +
          '[codex] Session started: thread=t-1\n' +
          '[codex] Turn started\n'
      );
    });

    it('returns empty string for empty input', () => {
      expect(formatCodexMessages('')).toBe('');
    });

    it('handles chunk without trailing newline', () => {
      const input = '{"type":"turn.started"}';
      // No trailing newline means the regex won't match this as a complete line
      // (multiline regex requires line boundaries), so it passes through
      const result = formatCodexMessages(input);
      expect(result).toBe('[codex] Turn started');
    });
  });
});
