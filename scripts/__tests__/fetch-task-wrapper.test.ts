import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  '.claude',
  'skills',
  'debug-intex-session',
  'scripts',
  'fetch-session.cjs'
);

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

    expect(content).toContain("collection('intex_agent_sessions')");
    expect(content).toContain("collection('intex_agent_session_events')");
    expect(content).toContain('sha256_12');
    expect(content).toContain('redacted');
  });
});
