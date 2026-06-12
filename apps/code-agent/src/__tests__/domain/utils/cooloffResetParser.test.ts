import { describe, expect, it } from 'vitest';
import { parseCooloffResetTime } from '../../../domain/utils/cooloffResetParser.js';

describe('parseCooloffResetTime', () => {
  it('parses Codex try-again AM/PM times as UTC', () => {
    const result = parseCooloffResetTime({
      text: "Codex error: You've hit your usage limit. Visit settings or try again at 6:14 PM.",
      now: new Date('2026-05-05T17:44:20.623Z'),
    });

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.notBeforeAt.toISOString()).toBe('2026-05-05T18:14:00.000Z');
    expect(result.timezone).toBe('UTC');
    expect(result.sourceText).toBe('try again at 6:14 PM');
  });

  it('parses Codex 24-hour try-again times as UTC', () => {
    const result = parseCooloffResetTime({
      text: 'Codex error: try again at 18:14.',
      now: new Date('2026-05-05T17:44:20.623Z'),
    });

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.notBeforeAt.toISOString()).toBe('2026-05-05T18:14:00.000Z');
    expect(result.timezone).toBe('UTC');
    expect(result.sourceText).toBe('try again at 18:14');
  });

  it('normalizes explicit GMT try-again times to UTC', () => {
    const result = parseCooloffResetTime({
      text: 'Codex error: try again at 18:14 GMT.',
      now: new Date('2026-05-05T17:44:20.623Z'),
    });

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.notBeforeAt.toISOString()).toBe('2026-05-05T18:14:00.000Z');
    expect(result.timezone).toBe('UTC');
  });

  it('handles 12 AM and 12 PM boundaries', () => {
    const midnight = parseCooloffResetTime({
      text: 'Codex error: try again at 12:00 AM.',
      now: new Date('2026-05-05T23:00:00.000Z'),
    });
    const noon = parseCooloffResetTime({
      text: 'Codex error: try again at 12:00 PM.',
      now: new Date('2026-05-05T11:00:00.000Z'),
    });

    expect(midnight?.notBeforeAt.toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(noon?.notBeforeAt.toISOString()).toBe('2026-05-05T12:00:00.000Z');
  });

  it('rejects invalid AM/PM hours', () => {
    expect(
      parseCooloffResetTime({
        text: 'Codex error: try again at 13:14 PM.',
        now: new Date('2026-05-05T17:44:20.623Z'),
      })
    ).toBeNull();
  });

  it('rolls past same-day Codex times to the next UTC day when still within 24 hours', () => {
    const result = parseCooloffResetTime({
      text: 'Codex error: try again at 6:14 PM.',
      now: new Date('2026-05-05T18:14:01.000Z'),
    });

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.notBeforeAt.toISOString()).toBe('2026-05-06T18:14:00.000Z');
  });

  it('parses explicit Claude UTC reset times', () => {
    const result = parseCooloffResetTime({
      text: "Claude error: You've hit your limit · resets 10pm (UTC)",
      now: new Date('2026-04-23T12:00:00.000Z'),
    });

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.notBeforeAt.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(result.timezone).toBe('UTC');
    expect(result.sourceText).toBe('resets 10pm (UTC)');
  });

  it('parses singular explicit GMT reset times', () => {
    const result = parseCooloffResetTime({
      text: 'Claude error: limit reset 9am GMT',
      now: new Date('2026-04-23T08:00:00.000Z'),
    });

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.notBeforeAt.toISOString()).toBe('2026-04-23T09:00:00.000Z');
    expect(result.timezone).toBe('UTC');
    expect(result.sourceText).toBe('reset 9am GMT');
  });

  it('rejects invalid explicit reset hours', () => {
    expect(
      parseCooloffResetTime({
        text: 'Claude error: limit resets 25 UTC',
        now: new Date('2026-04-23T08:00:00.000Z'),
      })
    ).toBeNull();
  });

  it('returns null when no known reset wording is present', () => {
    expect(
      parseCooloffResetTime({
        text: 'TASK_RUNTIME_HARD_ERROR: usage limit reached',
        now: new Date('2026-05-05T17:44:20.623Z'),
      })
    ).toBeNull();
  });
});
