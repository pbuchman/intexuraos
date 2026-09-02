import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('agent feedback compatibility wrappers', () => {
  it('does not retain ignore rules for deleted Claude feedback directories', () => {
    const source = readFileSync('.gitignore', 'utf8');
    const claudeRules = source
      .split('\n')
      .filter((line) => line.startsWith('.claude/') || line.startsWith('!.claude/'));

    expect(claudeRules).toEqual([
      '.claude/settings.local.json',
      '.claude/settings.local.*.json',
      '!.claude/CLAUDE.md',
    ]);
  });

  it('keeps ci:tracked as a transparent ci.mjs alias without persistent feedback state', () => {
    const source = readFileSync('scripts/ci-tracked.mjs', 'utf8');

    expect(source).toContain("resolve(repoRoot, 'scripts/ci.mjs')");
    expect(source).toContain("stdio: 'inherit'");
    expect(source).not.toContain('.claude/');
    expect(source).not.toContain('appendFileSync');
  });

  it('keeps verify:workspace:tracked as a transparent workspace verifier alias', () => {
    const source = readFileSync('scripts/verify-workspace-tracked.mjs', 'utf8');

    expect(source).toContain("resolve(repoRoot, 'scripts/verify-workspace.sh')");
    expect(source).toContain('process.argv.slice(2)');
    expect(source).toContain("stdio: 'inherit'");
    expect(source).not.toContain('.claude/');
    expect(source).not.toContain('appendFileSync');
  });
});
