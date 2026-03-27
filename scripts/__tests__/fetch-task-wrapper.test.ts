import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const REPO_WRAPPER_PATH = path.join(REPO_ROOT, 'scripts', 'fetch-task.sh');
const SKILL_FILE_PATH = path.join(REPO_ROOT, '.codex', 'skills', 'debug-code-task', 'SKILL.md');

describe('debug-code-task fetch wrapper', () => {
  it('documents the bundled wrapper explicitly', () => {
    const content = fs.readFileSync(SKILL_FILE_PATH, 'utf8');

    expect(content).toMatch(/`\.codex\/skills\/debug-code-task\/scripts\/fetch-task\.sh`/);
    expect(content).not.toMatch(/`scripts\/fetch-task\.sh`/);
  });

  it('provides a repo-level compatibility wrapper', () => {
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
