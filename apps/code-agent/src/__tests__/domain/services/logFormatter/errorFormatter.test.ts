import { describe, it, expect } from 'vitest';
import {
  formatErrorToolResult,
  stripSystemReminders,
} from '../../../../domain/services/logFormatter/errorFormatter.js';

describe('stripSystemReminders', () => {
  it('removes a single system-reminder block', () => {
    const input = 'before\n<system-reminder>keep-out</system-reminder>\nafter';
    expect(stripSystemReminders(input)).toBe('before\nafter');
  });

  it('removes multiple system-reminder blocks', () => {
    const input =
      'a\n<system-reminder>one</system-reminder>\nb\n<system-reminder>two</system-reminder>\nc';
    expect(stripSystemReminders(input)).toBe('a\nb\nc');
  });

  it('collapses the resulting multiple blank lines into a single newline', () => {
    const input = 'line1\n\n<system-reminder>x</system-reminder>\n\nline2';
    expect(stripSystemReminders(input)).toBe('line1\nline2');
  });

  it('trims trailing whitespace after stripping', () => {
    const input = 'body\n<system-reminder>x</system-reminder>\n\n  ';
    expect(stripSystemReminders(input)).toBe('body');
  });

  it('returns input unchanged when no system-reminder is present', () => {
    const input = 'hello\nworld\n\nmore';
    expect(stripSystemReminders(input)).toBe(input);
  });
});

describe('formatErrorToolResult', () => {
  it('prefixes single-line content with the unicode error marker', () => {
    expect(formatErrorToolResult('boom')).toBe('  ✗ boom');
  });

  it('indents continuation lines with four spaces for multi-line input', () => {
    const out = formatErrorToolResult('first\nsecond\nthird');
    expect(out).toBe('  ✗ first\n    second\n    third');
  });

  it('strips a <tool_use_error> wrapper around the content', () => {
    const out = formatErrorToolResult('<tool_use_error>nested message</tool_use_error>');
    expect(out).toBe('  ✗ nested message');
  });

  it('returns an empty string for empty input', () => {
    expect(formatErrorToolResult('')).toBe('');
  });

  it('returns an empty string for whitespace-only content after stripping', () => {
    expect(formatErrorToolResult('   \n  \t')).toBe('');
  });

  it('applies head+tail truncation when content exceeds char and line thresholds', () => {
    const line = 'x'.repeat(60); // 60 chars per line
    const totalLines = 100; // > 50 lines
    const content = Array.from({ length: totalLines }, (_, i) => `${line}-${String(i)}`).join(
      '\n',
    );
    expect(content.length).toBeGreaterThan(2048);

    const out = formatErrorToolResult(content);
    expect(out).toContain('[... 50 lines omitted ...]');
    // first content line keeps the marker prefix
    expect(out.startsWith('  ✗ ')).toBe(true);
    // last original line is preserved in tail
    expect(out.endsWith(`${line}-99`)).toBe(true);
  });

  it('renders a representative multi-line error (snapshot)', () => {
    const out = formatErrorToolResult(
      '<tool_use_error>Failed to read file\nPermission denied\nCheck ACL</tool_use_error>',
    );
    expect(out).toMatchInlineSnapshot(`
      "  ✗ Failed to read file
          Permission denied
          Check ACL"
    `);
  });
});
