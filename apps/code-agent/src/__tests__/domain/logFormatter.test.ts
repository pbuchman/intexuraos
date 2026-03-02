import { describe, it, expect } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { formatLogChunk, createFormatterState } from '../../domain/services/logFormatter.js';

function ts(): Timestamp {
  return Timestamp.now();
}

describe('formatLogChunk', () => {
  describe('raw / non-JSON lines', () => {
    it('plain text passes through as-is', () => {
      const result = formatLogChunk('plain text log', 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('plain text log');
    });

    it('invalid JSON passes through as-is', () => {
      const result = formatLogChunk('{invalid json', 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('{invalid json');
    });

    it('empty/whitespace lines are skipped', () => {
      const result = formatLogChunk('line1\n\n  \n\t\nline2', 0, ts());
      expect(result).toHaveLength(2);
      expect(result[0]?.text).toBe('line1');
      expect(result[1]?.text).toBe('line2');
    });

    it('empty string input returns empty array', () => {
      const result = formatLogChunk('', 0, ts());
      expect(result).toEqual([]);
    });

    it('entrypoint lines are passed through', () => {
      const result = formatLogChunk('[entrypoint] Restoring default config files...', 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('[entrypoint] Restoring default config files...');
    });

    it('entrypoint lines included in multi-line chunk', () => {
      const result = formatLogChunk('[entrypoint] Starting...\nreal output\n[entrypoint] Done', 0, ts());
      expect(result).toHaveLength(3);
      expect(result[0]?.text).toBe('[entrypoint] Starting...');
      expect(result[1]?.text).toBe('real output');
      expect(result[2]?.text).toBe('[entrypoint] Done');
    });

    it('timestamp-prefixed entrypoint lines are passed through', () => {
      const result = formatLogChunk('2026-02-11 00:48:35 [entrypoint] Starting Claude...', 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('2026-02-11 00:48:35 [entrypoint] Starting Claude...');
    });
  });

  describe('system events', () => {
    it('hook_started', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'hook_started', hook_name: 'validate-lint' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] validate-lint started');
    });

    it('hook_started without name', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'hook_started' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] unknown started');
    });

    it('hook_response success (exit 0)', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'hook_response', hook_name: 'validate-lint', exit_code: 0 });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] validate-lint \u2713 (exit 0)');
    });

    it('hook_response failure (exit 1)', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'hook_response', hook_name: 'validate-lint', exit_code: 1 });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] validate-lint \u2717 (exit 1)');
    });

    it('hook_response with short output (≤5 lines)', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'validate-lint',
        exit_code: 0,
        output: 'line1\nline2\nline3'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] validate-lint \u2713 (exit 0)\n  line1\n  line2\n  line3');
    });

    it('hook_response with long output (>5 lines)', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'validate-lint',
        exit_code: 0,
        output: 'line1\nline2\nline3\nline4\nline5\nline6\nline7'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe(
        '[hook] validate-lint \u2713 (exit 0)\n  line1\n  line2\n  line3\n  line4\n  line5\n  line6\n  line7'
      );
    });

    it('hook_response with empty/whitespace output', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'validate-lint',
        exit_code: 0,
        output: '  \n\t\n  '
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] validate-lint \u2713 (exit 0)');
    });

    it('hook_response without exit_code', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'validate-lint'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] validate-lint \u2717 (exit ?)');
    });

    it('hook_response without hook_name', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        exit_code: 0
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[hook] unknown \u2713 (exit 0)');
    });

    it('init with all fields', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'test',
        tools: ['Read', 'Write', 'Bash'],
        mcp_servers: [
          { name: 'linear', status: 'connected' },
          { name: 'sentry', status: 'disconnected' }
        ]
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[init] Model: test | Tools: 3 | MCP: linear \u2713, sentry \u2717');
    });

    it('init with partial fields (model only)', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[init] Model: claude-opus-4');
    });

    it('init without any fields', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'init'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[init] ');
    });

    it('other system subtypes', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'session_started' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[system] session_started');
    });

    it('system with no subtype', () => {
      const json = JSON.stringify({ type: 'system' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[system]');
    });
  });

  describe('assistant messages', () => {
    it('text content', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Let me read the file.' }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[claude] Let me read the file.');
    });

    it('tool_use content', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/repo/src/index.ts' }
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Read: /repo/src/index.ts');
    });

    it('mixed text + tool_use', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check the file.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/index.ts' } }
          ]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[claude] Let me check the file.\n[tool] Read: /repo/src/index.ts');
    });

    it('empty text blocks are skipped', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: '  \n\t  ' },
            { type: 'text', text: 'Valid text' }
          ]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[claude] Valid text');
    });

    it('assistant with no content', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant' }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('assistant with no message', () => {
      const json = JSON.stringify({ type: 'assistant' });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('tool_use with command context', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'git status' }
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Bash: git status');
    });

    it('tool_use with pattern context', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'Glob',
            input: { pattern: '**/*.ts' }
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Glob: **/*.ts');
    });

    it('tool_use with query context', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'Grep',
            input: { query: 'TODO' }
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Grep: TODO');
    });

    it('long command truncated at 80 chars (77 + ...)', () => {
      const longCommand = 'a'.repeat(100);
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'Bash',
            input: { command: longCommand }
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Bash: ' + 'a'.repeat(77) + '...');
    });

    it('long query truncated at 60 chars (57 + ...)', () => {
      const longQuery = 'b'.repeat(100);
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'Grep',
            input: { query: longQuery }
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Grep: ' + 'b'.repeat(57) + '...');
    });

    it('tool_use without extractable context', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'TaskList',
            input: {}
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] TaskList');
    });
  });

  describe('standalone tool_use events', () => {
    it('tool_use with file_path', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/src/index.ts' }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Read: /repo/src/index.ts');
    });

    it('tool_use with no input', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Read'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Read');
    });

    it('tool_use without tool_name', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_input: { file_path: '/repo/src/index.ts' }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] unknown: /repo/src/index.ts');
    });
  });

  describe('standalone tool_result events', () => {
    it('standalone tool_result with string content', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: 'File contents here'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 File contents here');
    });

    it('standalone tool_result with is_error', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: 'Permission denied',
        is_error: true
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2717 Permission denied');
    });

    it('standalone tool_result with empty content', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: ''
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('standalone tool_result with non-string content', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: ['array', 'content']
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('strips system-reminder block from tool_result content', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content:
          'line 1\n<system-reminder>secret reminder</system-reminder>\nline 2'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 line 1\n    line 2');
    });
  });

  describe('user messages (tool results)', () => {
    it('short result (≤3 lines, ≤200 chars)', () => {
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            content: 'File contents here'
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 File contents here');
    });

    it('error result', () => {
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            content: 'File not found',
            is_error: true
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2717 File not found');
    });

    it('long result (>3 lines)', () => {
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            content: 'line1\nline2\nline3\nline4\nline5'
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 line1\n    line2\n    line3\n    line4\n    line5');
    });

    it('content over 200 chars but ≤3 lines', () => {
      const longContent = 'a'.repeat(250);
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            content: longContent
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 ' + longContent);
    });

    it('empty/whitespace content', () => {
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            content: '  \n\t  '
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('missing content', () => {
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result'
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('non-string tool_result content is treated as empty', () => {
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            content: ['array', 'content']
          }]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('non-tool_result blocks are ignored', () => {
      const json = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'Some text' },
            { type: 'tool_result', content: 'result data' }
          ]
        }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('  \u2192 result data');
    });

    it('user with no content array', () => {
      const json = JSON.stringify({
        type: 'user',
        message: { role: 'user' }
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });
  });

  describe('result events', () => {
    it('success with all fields', () => {
      const json = JSON.stringify({
        type: 'result',
        duration_ms: 4432,
        num_turns: 3,
        total_cost_usd: 0.245
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[done] 4.4s, 3 turns, $0.245');
    });

    it('success with duration_api_ms fallback', () => {
      const json = JSON.stringify({
        type: 'result',
        duration_api_ms: 2123
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[done] 2.1s');
    });

    it('success with no stats', () => {
      const json = JSON.stringify({ type: 'result' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[done] Completed');
    });

    it('error result', () => {
      const json = JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Context limit exceeded'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[error] Context limit exceeded');
    });

    it('error with no message', () => {
      const json = JSON.stringify({
        type: 'result',
        is_error: true
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[error] Task failed');
    });

    it('success with result text does not duplicate assistant output', () => {
      const json = JSON.stringify({
        type: 'result',
        duration_ms: 5000,
        num_turns: 2,
        total_cost_usd: 0.5,
        result: 'Final summary text'
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[done] 5.0s, 2 turns, $0.500');
    });

    it('success with empty result text', () => {
      const json = JSON.stringify({
        type: 'result',
        duration_ms: 1000,
        result: ''
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[done] 1.0s');
    });

    it('success with whitespace-only result text', () => {
      const json = JSON.stringify({
        type: 'result',
        duration_ms: 1000,
        result: '   \n\t  '
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[done] 1.0s');
    });
  });

  describe('unknown JSON types', () => {
    it('rate_limit_event is suppressed', () => {
      const json = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { limit: 100 } });
      const result = formatLogChunk(json, 0, ts());
      expect(result).toEqual([]);
    });

    it('unknown type shows compact [event] label', () => {
      const json = JSON.stringify({ type: 'future_event', data: 'some data' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[event] future_event');
    });

    it('future protocol types show compact [event] label', () => {
      const json = JSON.stringify({ type: 'streaming_delta', chunk: 'abc' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[event] streaming_delta');
    });
  });

  describe('sequence numbering', () => {
    it('uses startSequence * 1000 base', () => {
      const result = formatLogChunk('line1\nline2', 5, ts());
      expect(result[0]?.sequence).toBe(5000);
      expect(result[1]?.sequence).toBe(5001);
    });

    it('increments for multi-line chunks', () => {
      const json1 = JSON.stringify({ type: 'system', subtype: 'init' });
      const json2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } });
      const result = formatLogChunk(`${json1}\n${json2}`, 0, ts());
      expect(result[0]?.sequence).toBe(0);
      expect(result[1]?.text).toBe('[claude] hello');
      expect(result[1]?.sequence).toBe(1);
    });

    it('skipped lines do not consume sequence numbers', () => {
      const result = formatLogChunk('line1\n\n\nline2', 0, ts());
      expect(result).toHaveLength(2);
      expect(result[0]?.sequence).toBe(0);
      expect(result[1]?.sequence).toBe(1);
    });
  });

  describe('timestamp-prefixed JSON lines', () => {
    it('parses JSON with HH:MM:ss.mmm prefix and re-adds timestamp', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'init', model: 'opus' });
      const raw = `16:42:02.563 ${json}`;
      const result = formatLogChunk(raw, 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('16:42:02.563 [init] Model: opus');
    });

    it('parses assistant message with timestamp prefix', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Starting task' }] },
      });
      const raw = `09:15:30.001 ${json}`;
      const result = formatLogChunk(raw, 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('09:15:30.001 [claude] Starting task');
    });

    it('parses result message with timestamp prefix', () => {
      const json = JSON.stringify({ type: 'result', duration_ms: 3000, num_turns: 2 });
      const raw = `23:59:59.999 ${json}`;
      const result = formatLogChunk(raw, 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('23:59:59.999 [done] 3.0s, 2 turns');
    });

    it('does not add prefix when formatted output is empty', () => {
      const json = JSON.stringify({ type: 'assistant', message: { role: 'assistant' } });
      const raw = `10:00:00.000 ${json}`;
      const result = formatLogChunk(raw, 0, ts());
      expect(result).toEqual([]);
    });

    it('handles mixed timestamped and non-timestamped lines', () => {
      const json1 = JSON.stringify({ type: 'system', subtype: 'init', model: 'opus' });
      const json2 = JSON.stringify({ type: 'result', duration_ms: 1000 });
      const raw = `16:42:02.563 ${json1}\n${json2}`;
      const result = formatLogChunk(raw, 0, ts());
      expect(result).toHaveLength(2);
      expect(result[0]?.text).toBe('16:42:02.563 [init] Model: opus');
      expect(result[1]?.text).toBe('[done] 1.0s');
    });

    it('passes through non-JSON timestamped lines unchanged', () => {
      const raw = '16:42:02.563 [orchestrator] Task started...';
      const result = formatLogChunk(raw, 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('16:42:02.563 [orchestrator] Task started...');
    });
  });

  describe('mixed content', () => {
    it('real-world multi-line chunk with different types', () => {
      const chunk = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'opus' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Starting task' }] } }),
        JSON.stringify({ type: 'tool_use', tool_name: 'Read', tool_input: { file_path: '/test.ts' } }),
        JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'export const x = 1;' }] } }),
        JSON.stringify({ type: 'result', duration_ms: 1500, num_turns: 1 })
      ].join('\n');

      const result = formatLogChunk(chunk, 0, ts());
      expect(result).toHaveLength(4);
      expect(result[0]?.text).toBe('[init] Model: opus');
      expect(result[1]?.text).toBe('[claude] Starting task');
      expect(result[2]?.text).toBe('[tool] Read: /test.ts');
      expect(result[3]?.text).toBe('[done] 1.5s, 1 turns');
    });

    it('suppresses successful Read tool output but keeps Read errors', () => {
      const readCallId = 'call_123';
      const chunk = [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: readCallId,
              name: 'Read',
              input: { file_path: '/repo/apps/web/src/styles/index.css' }
            }]
          }
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: readCallId,
              content: '1\u2192body { color: red; }'
            }]
          }
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'call_456',
              name: 'Read',
              input: { file_path: '/repo/missing.ts' }
            }]
          }
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'call_456',
              content: 'File does not exist.',
              is_error: true
            }]
          }
        })
      ].join('\n');

      const result = formatLogChunk(chunk, 0, ts());
      expect(result).toHaveLength(3);
      expect(result[0]?.text).toBe('[tool] Read: /repo/apps/web/src/styles/index.css');
      expect(result[1]?.text).toBe('[tool] Read: /repo/missing.ts');
      expect(result[2]?.text).toBe('  \u2717 File does not exist.');
    });

    it('drops standalone system-reminder raw line', () => {
      const raw = [
        'before',
        '<system-reminder>remove this noise</system-reminder>',
        'after'
      ].join('\n');
      const result = formatLogChunk(raw, 0, ts());
      expect(result).toHaveLength(2);
      expect(result[0]?.text).toBe('before');
      expect(result[1]?.text).toBe('after');
    });
  });

  describe('cross-chunk state persistence', () => {
    it('suppresses Read tool result when assistant and user land in separate chunks', () => {
      const state = createFormatterState();

      const chunk1 = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'call_read_1',
            name: 'Read',
            input: { file_path: '/repo/src/server.ts' },
          }],
        },
      });

      const chunk2 = JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_read_1',
            content: '1→import express from "express";\n2→const app = express();',
          }],
        },
      });

      const result1 = formatLogChunk(chunk1, 0, ts(), state);
      expect(result1).toHaveLength(1);
      expect(result1[0]?.text).toBe('[tool] Read: /repo/src/server.ts');

      const result2 = formatLogChunk(chunk2, 1, ts(), state);
      expect(result2).toHaveLength(0);
    });

    it('shows non-Read tool result across chunks with correct prefix', () => {
      const state = createFormatterState();

      const chunk1 = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'git status' },
          }],
        },
      });

      const chunk2 = JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_bash_1',
            content: 'On branch main\nnothing to commit',
          }],
        },
      });

      formatLogChunk(chunk1, 0, ts(), state);
      const result2 = formatLogChunk(chunk2, 1, ts(), state);
      expect(result2).toHaveLength(1);
      expect(result2[0]?.text).toBe('  → On branch main\n    nothing to commit');
    });

    it('buffers incomplete JSON on last line and reassembles with next chunk', () => {
      const state = createFormatterState();

      // Simulate a user message with Read tool result split across chunks
      // First half: JSON starts but doesn't close
      const fullJson = JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_read_split',
            content: 'export const x = 1;',
          }],
        },
      });

      // Split the JSON roughly in the middle
      const splitPoint = Math.floor(fullJson.length / 2);
      const firstHalf = fullJson.slice(0, splitPoint);
      const secondHalf = fullJson.slice(splitPoint);

      // First chunk: set up Read tool context + incomplete JSON
      const setupLine = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'call_read_split',
            name: 'Read',
            input: { file_path: '/repo/file.ts' },
          }],
        },
      });
      const chunk1 = `${setupLine}\n${firstHalf}`;
      const result1 = formatLogChunk(chunk1, 0, ts(), state);
      // Should have the tool_use line but NOT the incomplete JSON
      expect(result1).toHaveLength(1);
      expect(result1[0]?.text).toBe('[tool] Read: /repo/file.ts');
      expect(state.partialLine).toBeDefined();

      // Second chunk starts with the rest of the JSON
      const result2 = formatLogChunk(secondHalf, 1, ts(), state);
      // Reassembled: user message with Read tool_result → suppressed
      expect(result2).toHaveLength(0);
      expect(state.partialLine).toBeUndefined();
    });

    it('does not buffer complete JSON on last line', () => {
      const state = createFormatterState();

      const completeJson = JSON.stringify({ type: 'system', subtype: 'init', model: 'opus' });
      const result = formatLogChunk(completeJson, 0, ts(), state);
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('[init] Model: opus');
      expect(state.partialLine).toBeUndefined();
    });

    it('does not buffer incomplete JSON without external state', () => {
      // Stateless call — incomplete JSON should pass through, not be silently lost
      const incomplete = '{"type":"result","duration_ms":50';
      const result = formatLogChunk(incomplete, 0, ts());
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe(incomplete);
    });

    it('does not buffer non-JSON last line', () => {
      const state = createFormatterState();

      const result = formatLogChunk('just plain text', 0, ts(), state);
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('just plain text');
      expect(state.partialLine).toBeUndefined();
    });

    it('buffered partial + next chunk produces valid formatted output', () => {
      const state = createFormatterState();

      const fullJson = JSON.stringify({
        type: 'result',
        duration_ms: 5000,
        num_turns: 3,
        total_cost_usd: 0.15,
      });

      const splitPoint = 20;
      const firstHalf = fullJson.slice(0, splitPoint);
      const secondHalf = fullJson.slice(splitPoint);

      // First chunk: incomplete JSON gets buffered
      const result1 = formatLogChunk(firstHalf, 0, ts(), state);
      expect(result1).toHaveLength(0);
      expect(state.partialLine).toBe(firstHalf);

      // Second chunk: reassembled and formatted as result
      const result2 = formatLogChunk(secondHalf, 1, ts(), state);
      expect(result2).toHaveLength(1);
      expect(result2[0]?.text).toBe('[done] 5.0s, 3 turns, $0.150');
      expect(state.partialLine).toBeUndefined();
    });

    it('correlates tool_use_id across chunks for correct suppression', () => {
      const state = createFormatterState();

      // Chunk 1: two tool_use blocks — Read and Bash
      const chunk1 = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: '/a.ts' } },
            { type: 'tool_use', id: 'call_2', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      });

      // Chunk 2: tool_result for call_1 (Read) — should be suppressed
      const chunk2Read = JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'file contents',
          }],
        },
      });

      // Chunk 3: tool_result for call_2 (Bash) — should show
      const chunk3Bash = JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_2',
            content: 'a.ts  b.ts',
          }],
        },
      });

      formatLogChunk(chunk1, 0, ts(), state);
      const readResult = formatLogChunk(chunk2Read, 1, ts(), state);
      const bashResult = formatLogChunk(chunk3Bash, 2, ts(), state);

      expect(readResult).toHaveLength(0);
      expect(bashResult).toHaveLength(1);
      expect(bashResult[0]?.text).toBe('  → a.ts  b.ts');
    });
  });

  describe('JSON tool result summarization', () => {
    it('gh pr view --json output is summarized', () => {
      const prData = JSON.stringify({
        additions: 513,
        baseRefName: 'development',
        changedFiles: 8,
        deletions: 3,
        headRefName: 'feat/task-progress',
        number: 909,
        state: 'OPEN',
        title: 'feat(INT-628): Enable task progress tracking in web app',
        url: 'https://github.com/org/repo/pull/909',
      });
      const json = JSON.stringify({ type: 'tool_result', content: prData });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe(
        '  \u2192 #909 feat(INT-628): Enable task progress tracking in web app | OPEN | +513/-3 | 8 files'
      );
    });

    it('gh api comment creation is summarized', () => {
      const commentData = JSON.stringify({
        html_url: 'https://github.com/org/repo/issues/909#issuecomment-3972072122',
        id: 3972072122,
        body: 'This is the comment body that goes on and on and is quite long with a lot of detail about the issue at hand and what needs to be fixed in the code base to resolve the problem fully.',
        user: { login: 'bot' },
        created_at: '2026-02-27T00:00:00Z',
      });
      const json = JSON.stringify({ type: 'tool_result', content: commentData });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 Created comment 3972072122 on #909');
    });

    it('generic JSON object shows key count summary', () => {
      const genericData: Record<string, unknown> = {
        url: 'https://example.com',
        id: 12345,
        body: 'a'.repeat(100),
        user: { login: 'test' },
        reactions: { total_count: 0 },
      };
      const content = JSON.stringify(genericData);
      const json = JSON.stringify({ type: 'tool_result', content });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe(
        `  \u2192 {5 keys: url, id, body, user, reactions} [${String(content.length)} chars]`
      );
    });

    it('short JSON (<200 chars) passes through unchanged', () => {
      const shortData = JSON.stringify({ ok: true, count: 5 });
      const json = JSON.stringify({ type: 'tool_result', content: shortData });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe(`  \u2192 ${shortData}`);
    });

    it('non-JSON content is unchanged', () => {
      const json = JSON.stringify({ type: 'tool_result', content: 'plain text output from command' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 plain text output from command');
    });

    it('error results are never summarized', () => {
      const prData = JSON.stringify({
        additions: 513,
        baseRefName: 'development',
        changedFiles: 8,
        deletions: 3,
        headRefName: 'feat/task-progress',
        number: 909,
        state: 'OPEN',
        title: 'feat(INT-628): Enable task progress tracking in web app',
        url: 'https://github.com/org/repo/pull/909',
      });
      const json = JSON.stringify({ type: 'tool_result', content: prData, is_error: true });
      const result = formatLogChunk(json, 0, ts());
      // Error results should NOT be summarized — they show the raw content with error prefix
      expect(result[0]?.text).toContain('  \u2717 ');
      expect(result[0]?.text).not.toContain('#909');
    });

    it('generic JSON with >5 keys shows ellipsis', () => {
      const paddedData: Record<string, unknown> = {
        a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 'x'.repeat(200),
      };
      const paddedContent = JSON.stringify(paddedData);
      const json = JSON.stringify({ type: 'tool_result', content: paddedContent });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toContain('{7 keys: a, b, c, d, e, ...}');
      expect(result[0]?.text).toContain('chars]');
    });

    it('content starting with { but not valid JSON passes through', () => {
      const badJson = '{not valid json at all but long enough to exceed the threshold ' + 'x'.repeat(200);
      const json = JSON.stringify({ type: 'tool_result', content: badJson });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toContain('  \u2192 {not valid json');
    });

    it('gh pr view with long title truncates at 60 chars', () => {
      const longTitle = 'feat(INT-999): This is a very long pull request title that exceeds sixty characters easily';
      const prData = JSON.stringify({
        additions: 10,
        baseRefName: 'development',
        changedFiles: 2,
        deletions: 5,
        headRefName: 'feat/long-title',
        number: 999,
        state: 'OPEN',
        title: longTitle,
        url: 'https://github.com/org/repo/pull/999',
      });
      const json = JSON.stringify({ type: 'tool_result', content: prData });
      const result = formatLogChunk(json, 0, ts());
      // Title should be truncated to 57 chars + '...'
      expect(result[0]?.text).toContain('#999 ' + longTitle.slice(0, 57) + '...');
    });

    it('gh pr view with missing optional numeric fields', () => {
      const prData = JSON.stringify({
        state: 'MERGED',
        title: 'Simple PR',
        headRefName: 'fix/something',
        url: 'https://github.com/org/repo/pull/100',
        // number, additions, deletions, changedFiles all missing
        padding: 'x'.repeat(200),
      });
      const json = JSON.stringify({ type: 'tool_result', content: prData });
      const result = formatLogChunk(json, 0, ts());
      // No number prefix, no stats — just title and state
      expect(result[0]?.text).toBe('  \u2192 Simple PR | MERGED');
    });

    it('gh pr view with non-string title and state', () => {
      const prData = JSON.stringify({
        state: 123,
        title: true,
        headRefName: 'fix/types',
        number: 'not-a-number',
        additions: 'many',
        deletions: 'few',
        changedFiles: 'some',
        padding: 'x'.repeat(200),
      });
      const json = JSON.stringify({ type: 'tool_result', content: prData });
      const result = formatLogChunk(json, 0, ts());
      // All type guards fail — everything filtered out, empty summary
      expect(result[0]?.text).toBe('  \u2192 ');
    });

    it('gh api comment with non-string url and non-number id', () => {
      const commentData = JSON.stringify({
        html_url: 12345,
        id: 'not-a-number',
        body: 'x'.repeat(200),
        user: { login: 'bot' },
      });
      const json = JSON.stringify({ type: 'tool_result', content: commentData });
      const result = formatLogChunk(json, 0, ts());
      // Type guards fail — empty id and no issue extraction
      expect(result[0]?.text).toBe('  \u2192 Created comment ');
    });

    it('JSON array of PR reviews is summarized', () => {
      const reviewArray = JSON.stringify([
        {
          id: 3874849122,
          user: { login: 'chatgpt-codex-connector[bot]' },
          body: 'Codex Review: here are some suggestions for improvement that are quite detailed and thorough and exceed the two hundred character threshold.',
          state: 'COMMENTED',
          html_url: 'https://github.com/org/repo/pull/976#pullrequestreview-3874849122',
          pull_request_url: 'https://api.github.com/repos/org/repo/pulls/976',
          submitted_at: '2026-03-02T08:56:54Z',
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: reviewArray });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [1 PR review on #976: COMMENTED by chatgpt-codex-connector[bot]]');
    });

    it('JSON array of review comments is summarized', () => {
      const commentsArray = JSON.stringify([
        {
          id: 2871235997,
          path: 'src/routes/webhookRoutes.ts',
          diff_hunk: '@@ -262,64 +264,113 @@',
          body: 'This branch treats any non-empty list as authoritative but that list can be incomplete and the validation is therefore insufficient for production use.',
          user: { login: 'chatgpt-codex-connector[bot]' },
          pull_request_url: 'https://api.github.com/repos/org/repo/pulls/976',
        },
        {
          id: 2871235998,
          path: 'src/services.ts',
          diff_hunk: '@@ -10,5 +10,8 @@',
          body: 'Missing null check here which could cause a runtime crash in production environments when the service container is not fully initialized.',
          user: { login: 'chatgpt-codex-connector[bot]' },
          pull_request_url: 'https://api.github.com/repos/org/repo/pulls/976',
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: commentsArray });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [2 review comments on #976]');
    });

    it('JSON array of issue comments is summarized', () => {
      const issueComments = JSON.stringify([
        {
          html_url: 'https://github.com/org/repo/pull/976#issuecomment-3982981848',
          id: 3982981848,
          body: 'INT-681 linkback comment that is long enough to need summarization and exceeds the two hundred character limit we have set in the formatter.',
          user: { login: 'linear[bot]' },
        },
        {
          html_url: 'https://github.com/org/repo/pull/976#issuecomment-3982996013',
          id: 3982996013,
          body: '@codex review this PR please and provide feedback on the implementation quality and test coverage that needs more attention in this area.',
          user: { login: 'pbuchman' },
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: issueComments });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [2 comments on #976]');
    });

    it('JSON empty array passes through unchanged', () => {
      const json = JSON.stringify({ type: 'tool_result', content: '[]' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 []');
    });

    it('JSON array without recognizable structure shows count and element keys', () => {
      const genericArray = JSON.stringify([
        { foo: 'bar', baz: 'x'.repeat(100) },
        { foo: 'qux', baz: 'y'.repeat(100) },
        { foo: 'quux', baz: 'z'.repeat(100) },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: genericArray });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe(`  \u2192 [3 items] [${String(genericArray.length)} chars]`);
    });

    it('JSON array of multiple PR reviews pluralizes', () => {
      const reviews = JSON.stringify([
        {
          id: 1,
          user: { login: 'bot1' },
          body: 'Review 1 that is long enough to matter for the summarization threshold requirement of two hundred characters in total content length.',
          state: 'APPROVED',
          html_url: 'https://github.com/org/repo/pull/100#pullrequestreview-1',
          pull_request_url: 'https://api.github.com/repos/org/repo/pulls/100',
        },
        {
          id: 2,
          user: { login: 'bot2' },
          body: 'Review 2',
          state: 'CHANGES_REQUESTED',
          html_url: 'https://github.com/org/repo/pull/100#pullrequestreview-2',
          pull_request_url: 'https://api.github.com/repos/org/repo/pulls/100',
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: reviews });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [2 PR reviews on #100: APPROVED by bot1]');
    });

    it('JSON array PR review with non-string fields falls back gracefully', () => {
      const reviews = JSON.stringify([
        {
          state: 123,
          pull_request_url: true,
          user: null,
          body: 'x'.repeat(200),
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: reviews });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [1 PR review]');
    });

    it('JSON array single review comment is singular', () => {
      const comments = JSON.stringify([
        {
          id: 1,
          path: 'src/index.ts',
          diff_hunk: '@@ -1,5 +1,8 @@',
          body: 'Single comment that is detailed enough to exceed the two hundred character minimum length threshold for summarization to kick in properly.',
          user: { login: 'bot' },
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: comments });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [1 review comment]');
    });

    it('JSON array single issue comment is singular', () => {
      const comments = JSON.stringify([
        {
          html_url: 'https://github.com/org/repo/pull/42#issuecomment-123',
          id: 123,
          body: 'Single issue comment that is detailed enough to exceed the two hundred character minimum length threshold for summarization to kick in properly.',
          user: { login: 'someone' },
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: comments });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [1 comment on #42]');
    });

    it('JSON array issue comment with non-string html_url falls back gracefully', () => {
      const comments = JSON.stringify([
        {
          html_url: 12345,
          id: 99,
          body: 'Comment with non-string html_url that is detailed enough to exceed the two hundred character minimum length threshold for summarization to kick in and produce a summary.',
          user: { login: 'bot' },
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: comments });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [1 comment]');
    });

    it('JSON array issue comment without PR number in URL', () => {
      const comments = JSON.stringify([
        {
          html_url: 'https://github.com/org/repo/comments/99',
          id: 99,
          body: 'Comment on something without a standard issue or pull URL pattern that would allow us to extract a PR or issue number from it.',
          user: { login: 'bot' },
        },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: comments });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 [1 comment]');
    });

    it('JSON array single generic item is singular', () => {
      const items = JSON.stringify([
        { foo: 'bar', baz: 'x'.repeat(200) },
      ]);
      const json = JSON.stringify({ type: 'tool_result', content: items });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe(`  \u2192 [1 item] [${String(items.length)} chars]`);
    });

    it('short JSON array (<200 chars) passes through unchanged', () => {
      const shortArray = JSON.stringify([{ id: 1 }, { id: 2 }]);
      const json = JSON.stringify({ type: 'tool_result', content: shortArray });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe(`  \u2192 ${shortArray}`);
    });

    it('gh api comment without issue number in URL', () => {
      const commentData = JSON.stringify({
        html_url: 'https://github.com/org/repo/comments/123456',
        id: 123456,
        body: 'A comment on something that is not an issue directly but still a valid comment with enough length to exceed the threshold for summarization.',
        user: { login: 'bot' },
      });
      const json = JSON.stringify({ type: 'tool_result', content: commentData });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('  \u2192 Created comment 123456');
    });
  });

  describe('extractToolContext additional keys', () => {
    it('Task tool shows description', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'Task',
            input: { description: 'Find authentication files', prompt: 'Search for auth', subagent_type: 'Explore' },
          }],
        },
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Task: Find authentication files');
    });

    it('long description truncated at 60 chars', () => {
      const longDesc = 'a'.repeat(100);
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'Task',
            input: { description: longDesc, prompt: 'do stuff', subagent_type: 'Explore' },
          }],
        },
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Task: ' + 'a'.repeat(57) + '...');
    });

    it('WebFetch shows url', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'WebFetch',
            input: { url: 'https://example.com/api', prompt: 'Extract data' },
          }],
        },
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] WebFetch: https://example.com/api');
    });

    it('long URL truncated at 80 chars', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(100);
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'WebFetch',
            input: { url: longUrl, prompt: 'Extract data' },
          }],
        },
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] WebFetch: ' + longUrl.slice(0, 77) + '...');
    });

    it('Skill shows skill name', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'Skill',
            input: { skill: 'commit' },
          }],
        },
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Skill: commit');
    });

    it('description does not override command (priority order)', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'npm test', description: 'Run tests' },
          }],
        },
      });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('[tool] Bash: npm test');
    });
  });
});
