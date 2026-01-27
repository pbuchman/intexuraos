import { describe, expect, it } from 'vitest';
import { stripMarkdown } from '../markdownUtils.js';

describe('stripMarkdown', () => {
  it('removes bold markdown markers (**)', () => {
    const result = stripMarkdown('This is **bold** text');
    expect(result).toBe('This is bold text');
  });

  it('removes bold markdown markers with underscores (__)', () => {
    const result = stripMarkdown('This is __bold__ text');
    expect(result).toBe('This is bold text');
  });

  it('removes italic markdown markers (single *)', () => {
    const result = stripMarkdown('This is *italic* text');
    expect(result).toBe('This is italic text');
  });

  it('removes italic markdown markers (single _)', () => {
    const result = stripMarkdown('This is _italic_ text');
    expect(result).toBe('This is italic text');
  });

  it('removes header markers (#)', () => {
    const result = stripMarkdown('# Header text');
    expect(result).toBe('Header text');
  });

  it('removes header markers for multiple levels', () => {
    const result = stripMarkdown('### Subheader text');
    expect(result).toBe('Subheader text');
  });

  it('removes code markers (`)', () => {
    const result = stripMarkdown('This is `code` text');
    expect(result).toBe('This is code text');
  });

  it('removes surrounding double quotes', () => {
    const result = stripMarkdown('"quoted text"');
    expect(result).toBe('quoted text');
  });

  it('removes surrounding single quotes', () => {
    const result = stripMarkdown("'quoted text'");
    expect(result).toBe('quoted text');
  });

  it('handles markdown links by showing link text only', () => {
    const result = stripMarkdown('[link text](https://example.com)');
    expect(result).toBe('link text');
  });

  it('trims whitespace from result', () => {
    const result = stripMarkdown('  # Header  ');
    expect(result).toBe('Header');
  });

  it('handles empty string', () => {
    const result = stripMarkdown('');
    expect(result).toBe('');
  });

  it('handles text with no markdown', () => {
    const result = stripMarkdown('Plain text without formatting');
    expect(result).toBe('Plain text without formatting');
  });

  it('handles combined markdown formatting', () => {
    const result = stripMarkdown('# **Header** with `code` and *italic*');
    expect(result).toBe('Header with code and italic');
  });

  it('handles multi-line content with headers', () => {
    const result = stripMarkdown('# First line\n## Second line\nThird line');
    expect(result).toBe('First line\nSecond line\nThird line');
  });
});
