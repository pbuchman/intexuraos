import { describe, it, expect } from 'vitest';
import { stripDockerHeaders } from '../services/log-formatter.js';

function dockerFrame(streamType: number, payload: string): string {
  const header = String.fromCharCode(streamType, 0, 0, 0, 0, 0, 0, payload.length);
  return header + payload;
}

describe('stripDockerHeaders', () => {
  it('strips stdout Docker headers', () => {
    const raw = dockerFrame(1, '[entrypoint] Starting');
    expect(stripDockerHeaders(raw)).toBe('[entrypoint] Starting');
  });

  it('strips stderr Docker headers', () => {
    const raw = dockerFrame(2, 'Warning: something');
    expect(stripDockerHeaders(raw)).toBe('Warning: something');
  });

  it('passes through lines without Docker headers', () => {
    expect(stripDockerHeaders('plain text line')).toBe('plain text line');
  });

  it('handles mixed Docker and plain content', () => {
    const raw = dockerFrame(1, '[entrypoint] Start') + '\nplain line';
    expect(stripDockerHeaders(raw)).toBe('[entrypoint] Start\nplain line');
  });

  it('strips mid-content Docker headers spanning multiple frames', () => {
    const header = String.fromCharCode(1, 0, 0, 0, 0, 0, 0, 10);
    const raw =
      dockerFrame(1, '{"type":"assistant","message":{"content":[{"type":"text","text":"hel') +
      header +
      'lo world"}]}}';
    expect(stripDockerHeaders(raw)).toBe(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello world"}]}}'
    );
  });

  it('strips consecutive mid-content Docker headers', () => {
    const header = String.fromCharCode(2, 0, 0, 0, 0, 0, 0, 5);
    const raw = 'part1' + header + 'part2' + header + 'part3';
    expect(stripDockerHeaders(raw)).toBe('part1part2part3');
  });

  it('returns empty string for empty input', () => {
    expect(stripDockerHeaders('')).toBe('');
  });

  it('handles Docker header with JSON payload', () => {
    const json = JSON.stringify({ type: 'system', subtype: 'init' });
    const raw = dockerFrame(1, json);
    expect(stripDockerHeaders(raw)).toBe(json);
  });

  it('does not strip frames where first byte stream type > 2', () => {
    const raw = dockerFrame(1, 'keep') + String.fromCharCode(3) + 'rest';
    const result = stripDockerHeaders(raw);
    expect(result).toContain('keep');
    expect(result).toContain(String.fromCharCode(3));
    expect(result).toContain('rest');
  });
});
