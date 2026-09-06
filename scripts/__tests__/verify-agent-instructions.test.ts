import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAgentInstructions } from '../verify-agent-instructions.mjs'; // @allow-missing-js -- .mjs import

const CLAUDE_POINTER = '# CLAUDE.md\n\nRead and follow `../AGENTS.md`.\n';

describe('agent instruction contract', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'agent-instructions-'));
    mkdirSync(join(fixtureRoot, '.claude'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'AGENTS.md'), '# Project\n\nShared rules.\n');
    writeFileSync(join(fixtureRoot, '.claude/CLAUDE.md'), CLAUDE_POINTER);
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('accepts canonical AGENTS and pointer-only CLAUDE files', () => {
    expect(validateAgentInstructions(fixtureRoot)).toEqual([]);
  });

  it('rejects duplicated rules in CLAUDE.md', () => {
    writeFileSync(
      join(fixtureRoot, '.claude/CLAUDE.md'),
      '# CLAUDE.md\n\nRead and follow `../AGENTS.md`.\n\nRun extra checks.\n'
    );

    expect(validateAgentInstructions(fixtureRoot)).toContain(
      '.claude/CLAUDE.md must be the exact compatibility pointer'
    );
  });

  it('rejects an oversized general instruction file', () => {
    writeFileSync(join(fixtureRoot, 'AGENTS.md'), 'x'.repeat(4097));

    expect(validateAgentInstructions(fixtureRoot)).toContain(
      'AGENTS.md must be at most 4096 bytes'
    );
  });

  it('rejects a missing general instruction file', () => {
    rmSync(join(fixtureRoot, 'AGENTS.md'));

    expect(validateAgentInstructions(fixtureRoot)).toContain('AGENTS.md is missing');
  });

  it('rejects a general instruction file that routes authority into .claude', () => {
    writeFileSync(
      join(fixtureRoot, 'AGENTS.md'),
      '# Project\n\n`.claude/CLAUDE.md` is the source of truth.\n'
    );

    expect(validateAgentInstructions(fixtureRoot)).toContain(
      'AGENTS.md must not route general rules into .claude/'
    );
  });
});
