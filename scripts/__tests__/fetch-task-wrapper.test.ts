import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const REPO_WRAPPER_PATH = path.join(REPO_ROOT, 'scripts', 'fetch-task.sh');
const SKILL_FILE_PATH = path.join(REPO_ROOT, '.codex', 'skills', 'debug-code-task', 'SKILL.md');
const SESSION_SKILL_FILE_PATH = path.join(
  REPO_ROOT,
  '.codex',
  'skills',
  'debug-intex-session',
  'SKILL.md'
);
const SESSION_WRAPPER_PATH = path.join(
  REPO_ROOT,
  '.codex',
  'skills',
  'debug-intex-session',
  'scripts',
  'fetch-session.sh'
);
const SESSION_FETCHER_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'agent-tools',
  'fetch-intex-session.cjs'
);
const require = createRequire(import.meta.url);

interface RedactedString {
  redacted: true;
  len: number;
  sha256_12: string;
}

interface FetchSessionTestables {
  compareEvents: (a: Record<string, unknown>, b: Record<string, unknown>) => number;
  extractSessionId: (input: string) => string;
  normalizeFirestoreValue: (value: unknown) => unknown;
  redactString: (value: string) => RedactedString;
  sanitizeEvent: (event: Record<string, unknown>) => Record<string, unknown>;
  scrubSensitiveInline: (value: string) => string;
  shouldRedactString: (key: string, pathParts: string[]) => boolean;
  timestampMs: (value: unknown) => number;
}

function loadFetchSessionTestables(): FetchSessionTestables {
  const loaded = require(SESSION_FETCHER_PATH) as { __testables?: FetchSessionTestables };
  if (loaded.__testables === undefined) {
    throw new Error('fetch-session.cjs must export __testables');
  }
  return loaded.__testables;
}

describe('debug-code-task fetch wrapper', () => {
  it('documents the bundled wrapper explicitly', () => {
    const content = fs.readFileSync(SKILL_FILE_PATH, 'utf8');

    expect(content).toMatch(/`\.codex\/skills\/debug-code-task\/scripts\/fetch-task\.sh`/);
    expect(content).not.toMatch(/`scripts\/fetch-task\.sh`/);
  });

  it('rejects WhatsApp session routing explicitly', () => {
    const content = fs.readFileSync(SKILL_FILE_PATH, 'utf8');

    expect(content).toMatch(/code-task URL/i);
    expect(content).toMatch(/Do not use this skill/i);
    expect(content).toMatch(/whatsapp\/sessions\?session=intex_session_\*/);
    expect(content).toMatch(/`intex_session_\*`/);
  });

  // 30s timeout: spawnSync under the full vitest parallel test load (700+ suites,
  // 14k+ tests) occasionally balloons from 40ms to 10s+ due to process-creation
  // contention. Isolated runs are fine; full CI hit 10000ms timeouts. This margin
  // is 750x typical runtime and absorbs the parallel-load spike.
  it('provides a repo-level compatibility wrapper', { timeout: 30_000 }, () => {
    expect(fs.existsSync(REPO_WRAPPER_PATH)).toBe(true);

    const result = spawnSync(REPO_WRAPPER_PATH, [], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: fetch-task.sh <taskId> [--logs|--logs-only]');
  });
});

describe('debug-intex-session fetch wrapper', () => {
  it('documents the session trigger and bundled wrapper explicitly', () => {
    expect(fs.existsSync(SESSION_SKILL_FILE_PATH)).toBe(true);

    const content = fs.readFileSync(SESSION_SKILL_FILE_PATH, 'utf8');

    expect(content).toMatch(/^name: debug-intex-session$/m);
    expect(content).toMatch(/whatsapp\/sessions\?session=intex_session_\*/);
    expect(content).toMatch(/`intex_session_\*`/);
    expect(content).toMatch(/`\.codex\/skills\/debug-intex-session\/scripts\/fetch-session\.sh`/);
    expect(content).toMatch(/Do not use this skill/i);
    expect(content).toMatch(/`task_\*`/);
  });

  it('provides a safe bundled wrapper', { timeout: 30_000 }, () => {
    expect(fs.existsSync(SESSION_WRAPPER_PATH)).toBe(true);

    const result = spawnSync(SESSION_WRAPPER_PATH, [], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: fetch-session.sh <sessionId> [--events|--events-only]');
  });

  it('keeps private WhatsApp fields sanitized in the Firestore fetcher', () => {
    expect(fs.existsSync(SESSION_FETCHER_PATH)).toBe(true);

    const content = fs.readFileSync(SESSION_FETCHER_PATH, 'utf8');

    expect(content).toContain('INTEX_AGENT_SESSIONS_COLLECTION');
    expect(content).toContain("collection('intex_agent_session_events')");
    expect(content).toContain('sha256_12');
    expect(content).toContain('redacted');
  });

  it('redacts direct sensitive fields with stable hashes', () => {
    const { sanitizeEvent } = loadFetchSessionTestables();

    const sanitized = sanitizeEvent({
      id: 'event-1',
      userId: 'user-123',
      payload: {
        status: 'pending',
        text: 'Call me at +48 123 456 789',
        nested: {
          message: 'secret body',
        },
      },
    });

    expect(sanitized.id).toBe('event-1');
    expect(sanitized.payload).toMatchObject({
      status: 'pending',
      text: {
        redacted: true,
        len: 'Call me at +48 123 456 789'.length,
      },
      nested: {
        message: {
          redacted: true,
          len: 'secret body'.length,
        },
      },
    });
    expect(sanitized.userId).toMatchObject({
      redacted: true,
      len: 'user-123'.length,
    });
    expect((sanitized.userId as RedactedString).sha256_12).toHaveLength(12);
  });

  it('redacts tool arguments, result strings, and non-allowlisted payload strings', () => {
    const { sanitizeEvent } = loadFetchSessionTestables();

    const sanitized = sanitizeEvent({
      toolArgs: {
        accountId: 'acct-secret',
      },
      result: {
        display: 'private result',
      },
      payload: {
        toolName: 'calendar.create',
        reason: 'user-approved',
        arbitrary: 'private payload string',
      },
    });

    expect(sanitized).toMatchObject({
      toolArgs: {
        accountId: {
          redacted: true,
          len: 'acct-secret'.length,
        },
      },
      result: {
        display: {
          redacted: true,
          len: 'private result'.length,
        },
      },
      payload: {
        toolName: 'calendar.create',
        reason: 'user-approved',
        arbitrary: {
          redacted: true,
          len: 'private payload string'.length,
        },
      },
    });
  });

  it('scrubs inline phone numbers and tokens from otherwise allowed strings', () => {
    const { scrubSensitiveInline } = loadFetchSessionTestables();

    expect(scrubSensitiveInline('Call +48 (123) 456-789 with token sk-abcdefghijklmnop')).toBe(
      'Call [redacted-phone] with token [redacted-token]'
    );
    expect(scrubSensitiveInline('Request 12345 stayed visible')).toBe(
      'Request 12345 stayed visible'
    );
  });

  it('extracts session ids from query strings, paths, and raw inputs', () => {
    const { extractSessionId } = loadFetchSessionTestables();

    expect(
      extractSessionId('https://intexuraos.cloud/#/whatsapp/sessions?session=intex_session_query')
    ).toBe('intex_session_query');
    expect(extractSessionId('/whatsapp/sessions/intex_session_path')).toBe('intex_session_path');
    expect(extractSessionId(' intex_session_raw ')).toBe('intex_session_raw');
  });

  it('normalizes Firestore timestamps and undefined values', () => {
    const { normalizeFirestoreValue } = loadFetchSessionTestables();

    expect(
      normalizeFirestoreValue({
        toDate: () => new Date('2026-01-02T03:04:05.006Z'),
      })
    ).toBe('2026-01-02T03:04:05.006Z');
    expect(normalizeFirestoreValue({ _seconds: 1_767_000_000, _nanoseconds: 123_000_000 })).toBe(
      '2025-12-29T09:20:00.123Z'
    );
    expect(normalizeFirestoreValue(undefined)).toBeUndefined();
  });

  it('sorts events by timestamp, semantic type order, and id', () => {
    const { compareEvents } = loadFetchSessionTestables();

    const events = [
      { id: 'c', type: 'assistant_message', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a', type: 'user_message', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', type: 'user_message', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd', type: 'session_started', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'e', type: 'unknown', createdAt: 'not-a-date' },
    ];

    expect(events.sort(compareEvents).map((event) => event.id)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('exposes redaction branch helpers for behavior coverage', () => {
    const { redactString, shouldRedactString, timestampMs } = loadFetchSessionTestables();

    expect(redactString('secret')).toEqual({
      redacted: true,
      len: 6,
      sha256_12: '2bb80d537b1d',
    });
    expect(shouldRedactString('message', ['payload', 'message'])).toBe(true);
    expect(shouldRedactString('accountId', ['toolArgs', 'accountId'])).toBe(true);
    expect(shouldRedactString('display', ['result', 'display'])).toBe(true);
    expect(shouldRedactString('status', ['payload', 'status'])).toBe(false);
    expect(shouldRedactString('note', ['payload', 'note'])).toBe(true);
    expect(timestampMs({ _seconds: 1, _nanoseconds: 0 })).toBe(1000);
    expect(timestampMs(undefined)).toBe(0);
  });
});
