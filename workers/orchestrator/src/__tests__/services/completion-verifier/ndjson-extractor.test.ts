import { describe, it, expect } from 'vitest';
import { extractAssistantText } from '../../../services/completion-verifier/ndjson-extractor.js';

describe('extractAssistantText — pure NDJSON-aware text extractor', () => {
  it('extracts text content from a Claude assistant message event with un-escaped newlines', () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'PLANNING_AGENT_FINAL:\n- Outcome: planned\n- Summary: ok' },
        ],
      },
    });
    const result = extractAssistantText(event);
    const lines = result.split('\n');
    expect(lines).toContain('PLANNING_AGENT_FINAL:');
    expect(lines).toContain('- Outcome: planned');
    expect(lines).toContain('- Summary: ok');
  });

  it('extracts text from a Claude result event', () => {
    const event = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'EXECUTION_AGENT_FINAL:\n- Outcome: implemented\n- pr: https://x/y/1',
    });
    const lines = extractAssistantText(event).split('\n');
    expect(lines).toContain('EXECUTION_AGENT_FINAL:');
    expect(lines).toContain('- Outcome: implemented');
  });

  it('passes non-JSON lines through unchanged', () => {
    const input = '[entrypoint] Claude attempt finished with exit code: 0';
    expect(extractAssistantText(input)).toBe(input);
  });

  it('passes already-clean transcripts through unchanged (no JSON to extract)', () => {
    const input = ['PLANNING_AGENT_FINAL:', '- Outcome: planned', '- Summary: ok'].join('\n');
    expect(extractAssistantText(input)).toBe(input);
  });

  it('handles malformed JSON gracefully (passthrough, no throw)', () => {
    const input = '{this is not valid json at all';
    expect(() => extractAssistantText(input)).not.toThrow();
    expect(extractAssistantText(input)).toBe(input);
  });

  it('extracts only text blocks from a mixed-content assistant message (skips tool_use)', () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          { type: 'text', text: 'PLANNING_AGENT_FINAL:\n- Outcome: planned' },
        ],
      },
    });
    const lines = extractAssistantText(event).split('\n');
    expect(lines).toContain('PLANNING_AGENT_FINAL:');
    // tool_use input should NOT be emitted as text — only the text content
    expect(lines.some((l) => l.includes('"command"'))).toBe(false);
  });

  it('preserves order across mixed JSON and plain-text lines', () => {
    const lines = [
      '[entrypoint] Starting Claude in --print mode...',
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'first\nsecond' }] },
      }),
      '[entrypoint] Claude attempt finished with exit code: 0',
    ];
    const out = extractAssistantText(lines.join('\n')).split('\n');
    expect(out[0]).toBe('[entrypoint] Starting Claude in --print mode...');
    expect(out).toContain('first');
    expect(out).toContain('second');
    expect(out[out.length - 1]).toBe('[entrypoint] Claude attempt finished with exit code: 0');
  });

  it('emits nothing for assistant events without text blocks', () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
      },
    });
    // assistant event with only tool_use → original line passes through (no text to substitute)
    expect(extractAssistantText(event)).toBe(event);
  });

  it('passes other event types through unchanged (system, user, rate_limit_event)', () => {
    const events = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [] } }),
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
    ];
    const input = events.join('\n');
    expect(extractAssistantText(input)).toBe(input);
  });

  it('handles empty input', () => {
    expect(extractAssistantText('')).toBe('');
  });

  it('handles input with only whitespace and blank lines', () => {
    expect(extractAssistantText('\n\n  \n')).toBe('\n\n  \n');
  });

  it('passes through assistant event whose content is not an array (defensive against contract drift)', () => {
    // Real Claude SDK always sends `content` as an array. But if the SDK ever
    // ships a string or null in that field, we must NOT crash — pass the line
    // through so the locator can still find an own-line marker emitted via
    // verbose stderr (covers the line-51 non-array branch in the extractor).
    const event = JSON.stringify({ type: 'assistant', message: { content: 'not an array' } });
    expect(extractAssistantText(event)).toBe(event);
  });

  it('passes through assistant event whose message is missing entirely', () => {
    // optional-chain branch: `obj.message?.content` is undefined when message
    // is absent, which trips the same `Array.isArray` guard.
    const event = JSON.stringify({ type: 'assistant' });
    expect(extractAssistantText(event)).toBe(event);
  });

  it('passes through result event whose result field is non-string (defensive against contract drift)', () => {
    // Real Claude SDK result events always carry a string `result`. If the
    // field is ever shipped as a number or object (drift), we pass the line
    // through unchanged (covers the line-64 non-string branch in the
    // extractor).
    const event = JSON.stringify({ type: 'result', subtype: 'success', result: 42 });
    expect(extractAssistantText(event)).toBe(event);
  });

  it('substitutes JSON line with extracted text (replaces, does not duplicate)', () => {
    // Confirms semantics: the JSON line is REPLACED by its extracted text,
    // not appended. This keeps the locator regex matching cleanly.
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'X' }] },
    });
    const result = extractAssistantText(event);
    expect(result).toBe('X');
    expect(result).not.toContain('"type":"assistant"');
  });
});
