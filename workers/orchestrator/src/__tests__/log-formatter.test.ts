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

  it('strips ANSI color codes from plain content', () => {
    expect(stripDockerHeaders('\x1B[31mFAIL\x1B[39m')).toBe('FAIL');
  });

  it('strips ANSI codes from Docker-framed content', () => {
    const raw = dockerFrame(1, '\x1B[32m✓\x1B[39m test passed');
    expect(stripDockerHeaders(raw)).toBe('✓ test passed');
  });

  it('strips bold and background ANSI codes (vitest output)', () => {
    const raw = dockerFrame(2, '\x1B[41m\x1B[1m FAIL \x1B[22m\x1B[49m src/server.test.ts');
    expect(stripDockerHeaders(raw)).toBe(' FAIL  src/server.test.ts');
  });

  it('strips ANSI codes while preserving meaningful content', () => {
    const raw = '\x1B[2mTest Files\x1B[22m \x1B[1m\x1B[31m1 failed\x1B[39m\x1B[22m';
    expect(stripDockerHeaders(raw)).toBe('Test Files 1 failed');
  });

  it('strips Docker RFC3339 timestamps prefixed by `container.logs({ timestamps: true })`', () => {
    const raw =
      '2026-04-17T16:12:19.476123456Z - [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — APPLICABLE\n2026-04-17T16:12:19.500000000Z next line';
    expect(stripDockerHeaders(raw)).toBe(
      '- [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — APPLICABLE\nnext line'
    );
  });

  it('strips Docker timestamps even after ANSI and frame headers are stripped', () => {
    const header = String.fromCharCode(1, 0, 0, 0, 0, 0, 0, 80);
    const raw =
      header +
      '2026-04-17T16:12:19.476123456Z \x1B[32mOK\x1B[39m\n' +
      '2026-04-17T16:12:20.000000000Z plain';
    expect(stripDockerHeaders(raw)).toBe('OK\nplain');
  });

  it('leaves lines without a Docker timestamp prefix unchanged', () => {
    const raw = '[claude] - [1] mem_abc — APPLICABLE\nplain text\n2026 not-a-timestamp';
    expect(stripDockerHeaders(raw)).toBe(
      '[claude] - [1] mem_abc — APPLICABLE\nplain text\n2026 not-a-timestamp'
    );
  });
});
