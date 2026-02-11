import { describe, it, expect } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { formatLogChunk } from '../../domain/services/logFormatter.js';

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
      expect(result[0]?.text).toBe('[hook] validate-lint \u2713 (exit 0)\n  line1\n  line2\n  ... 4 more lines ...\n  line7');
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
      expect(result[0]?.text).toBe('Let me read the file.');
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
      expect(result[0]?.text).toBe('Let me check the file.\n[tool] Read: /repo/src/index.ts');
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
      expect(result[0]?.text).toBe('Valid text');
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
      expect(result[0]?.text).toBe('  \u2192 5 lines');
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
      expect(result[0]?.text).toBe('  \u2192 ' + 'a'.repeat(200) + '...');
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
  });

  describe('unknown JSON types', () => {
    it('unknown type', () => {
      const json = JSON.stringify({ type: 'future_event', data: 'some data' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('{"type":"future_event","data":"some data"}');
    });

    it('future protocol types', () => {
      const json = JSON.stringify({ type: 'streaming_delta', chunk: 'abc' });
      const result = formatLogChunk(json, 0, ts());
      expect(result[0]?.text).toBe('{"type":"streaming_delta","chunk":"abc"}');
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
      expect(result[1]?.sequence).toBe(1);
    });

    it('skipped lines do not consume sequence numbers', () => {
      const result = formatLogChunk('line1\n\n\nline2', 0, ts());
      expect(result).toHaveLength(2);
      expect(result[0]?.sequence).toBe(0);
      expect(result[1]?.sequence).toBe(1);
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
      expect(result).toHaveLength(5);
      expect(result[0]?.text).toBe('[init] Model: opus');
      expect(result[1]?.text).toBe('Starting task');
      expect(result[2]?.text).toBe('[tool] Read: /test.ts');
      expect(result[3]?.text).toBe('  \u2192 export const x = 1;');
      expect(result[4]?.text).toBe('[done] 1.5s, 1 turns');
    });
  });
});
