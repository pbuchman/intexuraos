/**
 * Tests for cooloffRetryPrompt.
 *
 * INT-1463: Parser for Claude usage-limit reset timestamps.
 */

import { describe, expect, it } from 'vitest';
import {
  COOLOFF_RETRY_PROMPT_VERSION,
  cooloffRetryPrompt,
  parseCooloffResponse,
} from '../../../domain/prompts/cooloffRetryPrompt.js';

// The exact production message observed for tasks task_ac5fb880-3c0b-44b5-a906-dbedcb41793e
// and task_8f4bc53b-37f9-4d9c-a784-0090b207084f (INT-1463 evidence section).
const PRODUCTION_RESET_TEXT = "You've hit your limit · resets 10pm (UTC)";

describe('cooloffRetryPrompt', () => {
  describe('COOLOFF_RETRY_PROMPT_VERSION', () => {
    it('is a semver string', () => {
      expect(COOLOFF_RETRY_PROMPT_VERSION).toBe('1.0.0');
    });
  });

  describe('cooloffRetryPrompt metadata', () => {
    it('has correct name, description, and semver version', () => {
      expect(cooloffRetryPrompt.name).toBe('cooloff-retry');
      expect(cooloffRetryPrompt.description).toContain('UTC');
      expect(cooloffRetryPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(cooloffRetryPrompt.version).toBe(COOLOFF_RETRY_PROMPT_VERSION);
    });
  });

  describe('cooloffRetryPrompt.build', () => {
    it('includes the production reset string, recent log lines, and user timezone', () => {
      const now = new Date('2026-04-23T12:00:00Z');
      const prompt = cooloffRetryPrompt.build({
        errorCode: 'TASK_RUNTIME_HARD_ERROR',
        errorMessage: `Non-zero exit code: 1; Claude error: ${PRODUCTION_RESET_TEXT}`,
        recentLogLines: ['log-line-A', 'log-line-B', 'log-line-C'],
        userTimezone: 'Europe/Warsaw',
        now,
      });

      expect(prompt).toContain(PRODUCTION_RESET_TEXT);
      expect(prompt).toContain('log-line-A');
      expect(prompt).toContain('log-line-B');
      expect(prompt).toContain('log-line-C');
      expect(prompt).toContain('Europe/Warsaw');
      // Anchors against the known-now instant.
      expect(prompt).toContain(now.toISOString());
      // Must tell the LLM to emit an ISO-8601 UTC timestamp.
      expect(prompt).toMatch(/ISO-8601 UTC/i);
    });

    it('falls back to a UTC note when userTimezone is missing', () => {
      const prompt = cooloffRetryPrompt.build({
        errorCode: 'TASK_RUNTIME_HARD_ERROR',
        errorMessage: `Claude error: ${PRODUCTION_RESET_TEXT}`,
        recentLogLines: [],
        now: new Date('2026-04-23T12:00:00Z'),
      });

      expect(prompt).toMatch(/assume UTC/i);
    });

    it('caps log lines at 20', () => {
      const manyLines = Array.from({ length: 50 }, (_, i) => `log-line-${String(i)}`);
      const prompt = cooloffRetryPrompt.build({
        errorCode: 'TASK_RUNTIME_HARD_ERROR',
        errorMessage: 'rate limit',
        recentLogLines: manyLines,
        now: new Date('2026-04-23T12:00:00Z'),
      });

      // The last 20 lines are included; earlier ones are dropped.
      expect(prompt).toContain('log-line-49');
      expect(prompt).toContain('log-line-30');
      expect(prompt).not.toContain('log-line-29');
    });
  });

  describe('parseCooloffResponse', () => {
    const now = new Date('2026-04-23T12:00:00Z');

    it('parses a valid LLM JSON body for the production reset string', () => {
      const future = new Date(now.getTime() + 10 * 60 * 60 * 1000); // +10h (10pm UTC)
      const raw = JSON.stringify({
        notBeforeAt: future.toISOString(),
        timezone: 'UTC',
        sourceText: 'resets 10pm (UTC)',
        reason: 'Claude usage limit resets at 10:00 PM UTC',
      });

      const result = parseCooloffResponse(raw, now);

      expect(result).not.toBeNull();
      if (result === null) return;
      expect(result.notBeforeAt).toBeInstanceOf(Date);
      expect(result.notBeforeAt.toISOString()).toBe(future.toISOString());
      expect(result.timezone).toBe('UTC');
      expect(result.sourceText).toBe('resets 10pm (UTC)');
      expect(result.reason).toBe('Claude usage limit resets at 10:00 PM UTC');
    });

    it('strips markdown code-fence wrapping', () => {
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const raw = `\`\`\`json
{"notBeforeAt":"${future.toISOString()}","reason":"r"}
\`\`\``;

      const result = parseCooloffResponse(raw, now);
      expect(result).not.toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(parseCooloffResponse('not a json blob', now)).toBeNull();
    });

    it('returns null when notBeforeAt is in the past', () => {
      const past = new Date(now.getTime() - 60_000);
      const raw = JSON.stringify({ notBeforeAt: past.toISOString(), reason: 'past' });
      expect(parseCooloffResponse(raw, now)).toBeNull();
    });

    it('returns null when notBeforeAt is more than 24 hours in the future', () => {
      const tooFar = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      const raw = JSON.stringify({ notBeforeAt: tooFar.toISOString(), reason: 'far' });
      expect(parseCooloffResponse(raw, now)).toBeNull();
    });

    it('returns null when notBeforeAt is missing', () => {
      const raw = JSON.stringify({ reason: 'no timestamp' });
      expect(parseCooloffResponse(raw, now)).toBeNull();
    });

    it('returns null when reason is missing', () => {
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const raw = JSON.stringify({ notBeforeAt: future.toISOString() });
      expect(parseCooloffResponse(raw, now)).toBeNull();
    });

    it('returns null when notBeforeAt is not a string', () => {
      const raw = JSON.stringify({ notBeforeAt: 1234567890, reason: 'number' });
      expect(parseCooloffResponse(raw, now)).toBeNull();
    });

    it('returns null when notBeforeAt is an unparsable string', () => {
      const raw = JSON.stringify({ notBeforeAt: 'not-a-date', reason: 'bad' });
      expect(parseCooloffResponse(raw, now)).toBeNull();
    });

    it('returns null when the root is not an object', () => {
      expect(parseCooloffResponse('"just a string"', now)).toBeNull();
    });

    it('drops timezone when it is not a string', () => {
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const raw = JSON.stringify({
        notBeforeAt: future.toISOString(),
        timezone: 42,
        reason: 'r',
      });

      const result = parseCooloffResponse(raw, now);
      expect(result).not.toBeNull();
      if (result === null) return;
      expect(result.timezone).toBeUndefined();
    });

    it('drops sourceText when it is not a string', () => {
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const raw = JSON.stringify({
        notBeforeAt: future.toISOString(),
        sourceText: true,
        reason: 'r',
      });

      const result = parseCooloffResponse(raw, now);
      expect(result).not.toBeNull();
      if (result === null) return;
      expect(result.sourceText).toBeUndefined();
    });
  });
});
