import { describe, it, expect } from 'vitest';
import { formatLogChunk } from '../services/log-formatter.js';

function dockerFrame(streamType: number, payload: string): string {
  const header = String.fromCharCode(streamType, 0, 0, 0, 0, 0, 0, payload.length);
  return header + payload;
}

describe('formatLogChunk', () => {
  describe('Docker header stripping', () => {
    it('strips stdout Docker headers', () => {
      const raw = dockerFrame(1, '[entrypoint] Starting') + '\n';
      expect(formatLogChunk(raw)).toBe('[entrypoint] Starting\n');
    });

    it('strips stderr Docker headers', () => {
      const raw = dockerFrame(2, 'Warning: something') + '\n';
      expect(formatLogChunk(raw)).toBe('Warning: something\n');
    });

    it('passes through lines without Docker headers', () => {
      const raw = 'plain text line\n';
      expect(formatLogChunk(raw)).toBe('plain text line\n');
    });

    it('handles mixed Docker and plain lines', () => {
      const raw = dockerFrame(1, '[entrypoint] Start') + '\nplain line\n';
      expect(formatLogChunk(raw)).toBe('[entrypoint] Start\nplain line\n');
    });

    it('strips mid-content Docker headers spanning multiple frames', () => {
      const header = String.fromCharCode(1, 0, 0, 0, 0, 0, 0, 10);
      const raw =
        dockerFrame(1, '{"type":"assistant","message":{"content":[{"type":"text","text":"hel') +
        header +
        'lo world"}]}}' +
        '\n';
      expect(formatLogChunk(raw)).toBe('hello world\n');
    });

    it('strips consecutive mid-content Docker headers', () => {
      const header = String.fromCharCode(2, 0, 0, 0, 0, 0, 0, 5);
      const raw = 'part1' + header + 'part2' + header + 'part3\n';
      expect(formatLogChunk(raw)).toBe('part1part2part3\n');
    });
  });

  describe('JSON stream filtering', () => {
    it('skips system hook_started', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'hook_started', hook_id: 'abc' });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('skips system hook_response', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'hook_response', hook_id: 'abc' });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('skips system init', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'init', tools: ['Read', 'Write'] });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('shows other system subtypes', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'session_started' });
      expect(formatLogChunk(json + '\n')).toBe('[system] session_started\n');
    });

    it('shows system with no subtype', () => {
      const json = JSON.stringify({ type: 'system' });
      expect(formatLogChunk(json + '\n')).toBe('[system] \n');
    });

    it('skips unknown JSON types', () => {
      const json = JSON.stringify({ type: 'unknown_type' });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('skips user messages', () => {
      const json = JSON.stringify({ type: 'user', message: { role: 'user' } });
      expect(formatLogChunk(json + '\n')).toBe('');
    });
  });

  describe('assistant messages', () => {
    it('extracts text content', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      });
      expect(formatLogChunk(json + '\n')).toBe('Hello world\n');
    });

    it('extracts multiple text blocks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Line 1' },
            { type: 'text', text: 'Line 2' },
          ],
        },
      });
      expect(formatLogChunk(json + '\n')).toBe('Line 1\nLine 2\n');
    });

    it('extracts tool_use blocks from assistant', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read' }] },
      });
      expect(formatLogChunk(json + '\n')).toBe('[tool] Read\n');
    });

    it('skips assistant with no content', () => {
      const json = JSON.stringify({ type: 'assistant', message: {} });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('skips assistant with empty text', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '   ' }] },
      });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('skips assistant with no message', () => {
      const json = JSON.stringify({ type: 'assistant' });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('skips non-text non-tool_use content blocks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'image' }] },
      });
      expect(formatLogChunk(json + '\n')).toBe('');
    });
  });

  describe('result messages', () => {
    it('formats success result with all fields', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 4369,
        num_turns: 1,
        total_cost_usd: 0.245,
      });
      expect(formatLogChunk(json + '\n')).toBe('[done] Completed in 4.4s, 1 turn\n');
    });

    it('formats success with multiple turns', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 87000,
        num_turns: 8,
      });
      expect(formatLogChunk(json + '\n')).toBe('[done] Completed in 87.0s, 8 turns\n');
    });

    it('uses duration_api_ms as fallback', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_api_ms: 2142,
      });
      expect(formatLogChunk(json + '\n')).toBe('[done] Completed in 2.1s\n');
    });

    it('shows ? when no duration available', () => {
      const json = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
      });
      expect(formatLogChunk(json + '\n')).toBe('[done] Completed in ?\n');
    });

    it('formats error result', () => {
      const json = JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Context limit exceeded',
      });
      expect(formatLogChunk(json + '\n')).toBe('[error] Task failed: Context limit exceeded\n');
    });

    it('formats error with default message', () => {
      const json = JSON.stringify({
        type: 'result',
        is_error: true,
      });
      expect(formatLogChunk(json + '\n')).toBe('[error] Task failed: Unknown error\n');
    });
  });

  describe('tool_use messages', () => {
    it('shows tool name with file_path', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/src/index.ts' },
      });
      expect(formatLogChunk(json + '\n')).toBe('[tool] Read: /repo/src/index.ts\n');
    });

    it('shows tool name with command', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
      });
      expect(formatLogChunk(json + '\n')).toBe('[tool] Bash: git status\n');
    });

    it('truncates long commands', () => {
      const longCmd = 'a'.repeat(100);
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Bash',
        tool_input: { command: longCmd },
      });
      const result = formatLogChunk(json + '\n');
      expect(result).toContain('...');
      expect(result.length).toBeLessThan(100);
    });

    it('shows tool name with pattern', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.ts' },
      });
      expect(formatLogChunk(json + '\n')).toBe('[tool] Glob: **/*.ts\n');
    });

    it('shows tool name with query', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Grep',
        tool_input: { query: 'TODO' },
      });
      expect(formatLogChunk(json + '\n')).toBe('[tool] Grep: TODO\n');
    });

    it('truncates long queries', () => {
      const longQuery = 'b'.repeat(80);
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Grep',
        tool_input: { query: longQuery },
      });
      const result = formatLogChunk(json + '\n');
      expect(result).toContain('...');
    });

    it('shows tool name only when no recognized input', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'WebSearch',
        tool_input: { url: 'https://example.com' },
      });
      expect(formatLogChunk(json + '\n')).toBe('[tool] WebSearch\n');
    });

    it('shows tool name when no input at all', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool_name: 'Read',
      });
      expect(formatLogChunk(json + '\n')).toBe('[tool] Read\n');
    });

    it('defaults to unknown when no tool_name', () => {
      const json = JSON.stringify({ type: 'tool_use' });
      expect(formatLogChunk(json + '\n')).toBe('[tool] unknown\n');
    });
  });

  describe('tool_result messages', () => {
    it('shows abbreviated result', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: 'File contents here',
      });
      expect(formatLogChunk(json + '\n')).toBe('  \u2192 File contents here\n');
    });

    it('truncates long results', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: 'x'.repeat(300),
      });
      const result = formatLogChunk(json + '\n');
      expect(result).toContain('...');
      expect(result.length).toBeLessThan(220);
    });

    it('collapses multiline results', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: 'line1\nline2\nline3',
      });
      expect(formatLogChunk(json + '\n')).toBe('  \u2192 line1 line2 line3\n');
    });

    it('skips empty results', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: '',
      });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('skips whitespace-only results', () => {
      const json = JSON.stringify({
        type: 'tool_result',
        content: '   \n  ',
      });
      expect(formatLogChunk(json + '\n')).toBe('');
    });

    it('handles missing content', () => {
      const json = JSON.stringify({ type: 'tool_result' });
      expect(formatLogChunk(json + '\n')).toBe('');
    });
  });

  describe('mixed content', () => {
    it('handles Docker headers + JSON in same chunk', () => {
      const entryLine = dockerFrame(1, '[entrypoint] Start');
      const jsonLine = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      });
      const raw = entryLine + '\n' + jsonLine + '\n';
      expect(formatLogChunk(raw)).toBe('[entrypoint] Start\nHello\n');
    });

    it('returns empty string for empty input', () => {
      expect(formatLogChunk('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(formatLogChunk('\n\n\n')).toBe('');
    });

    it('handles Docker header with JSON payload', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'init' });
      const raw = dockerFrame(1, json) + '\n';
      expect(formatLogChunk(raw)).toBe('');
    });
  });
});
