import { describe, it, expect } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { parseLogChunk } from '../../domain/services/logParser.js';

function ts(): Timestamp {
  return Timestamp.now();
}

describe('parseLogChunk', () => {
  describe('raw / non-JSON lines', () => {
    it('creates raw entry for plain text', () => {
      const entries = parseLogChunk('[entrypoint] Starting\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'raw',
        rawText: '[entrypoint] Starting',
        sequence: 0,
      });
    });

    it('creates raw entry for invalid JSON', () => {
      const entries = parseLogChunk('{broken json\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'raw',
        rawText: '{broken json',
      });
    });

    it('skips empty and whitespace-only lines', () => {
      const entries = parseLogChunk('\n  \n\n', 0, ts());
      expect(entries).toHaveLength(0);
    });

    it('handles multiple plain lines with incrementing sequence', () => {
      const entries = parseLogChunk('[entrypoint] Start\n[entrypoint] Ready\n', 5, ts());
      expect(entries).toHaveLength(2);
      expect(entries[0]?.sequence).toBe(5000);
      expect(entries[1]?.sequence).toBe(5001);
    });
  });

  describe('system events', () => {
    it('parses hook_started', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_started',
        hook_name: 'validate-lint',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'hook_started',
        hookName: 'validate-lint',
      });
    });

    it('parses hook_response with output and exit code', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'validate-lint',
        exit_code: 0,
        output: 'All checks passed\nLint OK',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'hook_response',
        hookName: 'validate-lint',
        hookExitCode: 0,
        hookOutput: 'All checks passed\nLint OK',
      });
    });

    it('parses init event', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'test-model-id',
        tools: ['Read', 'Write', 'Bash'],
        mcp_servers: [
          { name: 'linear', status: 'connected' },
          { name: 'sentry', status: 'connected' },
        ],
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'init',
        model: 'test-model-id',
        toolCount: 3,
        mcpServers: [
          { name: 'linear', status: 'connected' },
          { name: 'sentry', status: 'connected' },
        ],
      });
    });

    it('parses init with partial fields', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-6',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'init',
        model: 'claude-opus-4-6',
      });
      expect(entries[0]?.toolCount).toBeUndefined();
      expect(entries[0]?.mcpServers).toBeUndefined();
    });

    it('parses hook_started without hook_name', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_started',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'hook_started',
      });
      expect(entries[0]?.hookName).toBeUndefined();
    });

    it('parses hook_response without exit_code or output', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_name: 'validate-lint',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'hook_response',
        hookName: 'validate-lint',
      });
      expect(entries[0]?.hookExitCode).toBeUndefined();
      expect(entries[0]?.hookOutput).toBeUndefined();
    });

    it('parses init without model', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'init',
        tools: ['Read'],
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'init',
        toolCount: 1,
      });
      expect(entries[0]?.model).toBeUndefined();
    });

    it('parses other system subtypes', () => {
      const json = JSON.stringify({
        type: 'system',
        subtype: 'session_started',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
        systemSubtype: 'session_started',
      });
    });

    it('parses system with no subtype', () => {
      const json = JSON.stringify({ type: 'system' });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'system',
      });
      expect(entries[0]?.systemSubtype).toBeUndefined();
    });
  });

  describe('assistant messages', () => {
    it('creates assistant_text entry for text content', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'assistant_text',
        text: 'Hello world',
      });
    });

    it('creates separate entries for text and tool_use blocks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me read that file' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/index.ts' } },
          ],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        type: 'assistant_text',
        text: 'Let me read that file',
        sequence: 0,
      });
      expect(entries[1]).toMatchObject({
        type: 'tool_call',
        toolName: 'Read',
        toolContext: '/repo/src/index.ts',
        sequence: 1,
      });
    });

    it('skips empty text blocks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '   ' }] },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });

    it('skips assistant with no content', () => {
      const json = JSON.stringify({ type: 'assistant', message: {} });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });

    it('skips assistant with no message', () => {
      const json = JSON.stringify({ type: 'assistant' });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });

    it('extracts command context from tool_use in assistant', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'tool_call',
        toolName: 'Bash',
        toolContext: 'git status',
      });
    });

    it('extracts pattern context', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } }],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        toolName: 'Glob',
        toolContext: '**/*.ts',
      });
    });

    it('extracts query context', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Grep', input: { query: 'TODO' } }],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        toolName: 'Grep',
        toolContext: 'TODO',
      });
    });

    it('truncates long command context', () => {
      const longCmd = 'a'.repeat(100);
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: longCmd } }],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]?.toolContext?.length).toBeLessThan(100);
      expect(entries[0]?.toolContext).toContain('...');
    });

    it('truncates long query context', () => {
      const longQuery = 'b'.repeat(80);
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Grep', input: { query: longQuery } }],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]?.toolContext).toContain('...');
    });

    it('handles tool_use in assistant without extractable context', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'TaskList', input: { some_field: 123 } }],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'tool_call',
        toolName: 'TaskList',
      });
      expect(entries[0]?.toolContext).toBeUndefined();
    });

    it('skips non-text non-tool_use content blocks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'image' }] },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });
  });

  describe('standalone tool_use events', () => {
    it('parses tool_use with file_path', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/src/index.ts' },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'tool_call',
        toolName: 'Read',
        toolContext: '/repo/src/index.ts',
      });
    });

    it('parses tool_use with no input', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Read',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        type: 'tool_call',
        toolName: 'Read',
      });
      expect(entries[0]?.toolContext).toBeUndefined();
    });

    it('defaults tool name to unknown', () => {
      const json = JSON.stringify({ type: 'tool_use' });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        type: 'tool_call',
        toolName: 'unknown',
      });
    });
  });

  describe('tool_result events', () => {
    it('parses tool_result with content', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: 'File contents here',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'tool_result',
        content: 'File contents here',
      });
    });

    it('preserves full content (no truncation in storage)', () => {
      const longContent = 'x'.repeat(5000);
      const json = JSON.stringify({
        type: 'tool_result',
        content: longContent,
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]?.content).toBe(longContent);
    });

    it('stores isError flag', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: 'Error: file not found',
        is_error: true,
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        type: 'tool_result',
        isError: true,
      });
    });

    it('skips empty content', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: '',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });

    it('skips whitespace-only content', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: '   \n  ',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });

    it('skips missing content', () => {
      const json = JSON.stringify({ type: 'tool_result' });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });
  });

  describe('result events', () => {
    it('parses success result with all fields', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 4369,
        num_turns: 3,
        total_cost_usd: 0.245,
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'result',
        resultType: 'success',
        durationMs: 4369,
        numTurns: 3,
        totalCostUsd: 0.245,
      });
    });

    it('parses success with duration_api_ms fallback', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        duration_api_ms: 2142,
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        type: 'result',
        resultType: 'success',
        durationMs: 2142,
      });
    });

    it('parses success with no duration', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        type: 'result',
        resultType: 'success',
      });
      expect(entries[0]?.durationMs).toBeUndefined();
    });

    it('parses error result', () => {
      const json = JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Context limit exceeded',
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        type: 'result',
        resultType: 'error',
        errorMessage: 'Context limit exceeded',
      });
    });

    it('parses error with default message', () => {
      const json = JSON.stringify({
        type: 'result',
        is_error: true,
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]).toMatchObject({
        type: 'result',
        resultType: 'error',
        errorMessage: 'Unknown error',
      });
    });

    it('parses result without cost', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        duration_ms: 1000,
        num_turns: 1,
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]?.totalCostUsd).toBeUndefined();
    });
  });

  describe('unknown JSON types', () => {
    it('skips user messages', () => {
      const json = JSON.stringify({ type: 'user', message: { role: 'user' } });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });

    it('skips unknown types', () => {
      const json = JSON.stringify({ type: 'some_unknown_type' });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries).toHaveLength(0);
    });
  });

  describe('sequence numbering', () => {
    it('uses startSequence * 1000 + lineIndex', () => {
      const line1 = JSON.stringify({ type: 'system', subtype: 'init', model: 'test' });
      const line2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } });
      const entries = parseLogChunk(line1 + '\n' + line2 + '\n', 3, ts());
      expect(entries[0]?.sequence).toBe(3000);
      expect(entries[1]?.sequence).toBe(3001);
    });

    it('increments for multi-entry assistant messages', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'text' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/test' } },
          ],
        },
      });
      const entries = parseLogChunk(json + '\n', 0, ts());
      expect(entries[0]?.sequence).toBe(0);
      expect(entries[1]?.sequence).toBe(1);
    });
  });

  describe('mixed content', () => {
    it('handles real-world multi-line chunk', () => {
      const lines = [
        '[entrypoint] Starting Claude',
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-4-6', tools: ['Read', 'Write'] }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
        JSON.stringify({ type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'git status' } }),
        JSON.stringify({ type: 'tool_result', content: 'On branch main' }),
        JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 5000, num_turns: 2, total_cost_usd: 0.12 }),
      ].join('\n') + '\n';

      const entries = parseLogChunk(lines, 0, ts());
      expect(entries).toHaveLength(6);
      expect(entries[0]?.type).toBe('raw');
      expect(entries[1]?.type).toBe('system');
      expect(entries[2]?.type).toBe('assistant_text');
      expect(entries[3]?.type).toBe('tool_call');
      expect(entries[4]?.type).toBe('tool_result');
      expect(entries[5]?.type).toBe('result');
    });

    it('handles empty input', () => {
      const entries = parseLogChunk('', 0, ts());
      expect(entries).toHaveLength(0);
    });
  });
});
