import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('agent feedback compatibility wrappers', () => {
  it('keeps ci:tracked as a transparent ci.mjs alias without persistent feedback state', () => {
    const source = readFileSync('scripts/ci-tracked.mjs', 'utf8');

    expect(source).toContain("resolve(repoRoot, 'scripts/ci.mjs')");
    expect(source).toContain("stdio: 'inherit'");
    expect(source).not.toContain('.claude/ci-failures');
    expect(source).not.toContain('appendFileSync');
  });

  it('keeps verify:workspace:tracked as a transparent workspace verifier alias', () => {
    const source = readFileSync('scripts/verify-workspace-tracked.mjs', 'utf8');

    expect(source).toContain("resolve(repoRoot, 'scripts/verify-workspace.sh')");
    expect(source).toContain('process.argv.slice(2)');
    expect(source).toContain("stdio: 'inherit'");
    expect(source).not.toContain('.claude/ci-failures');
    expect(source).not.toContain('appendFileSync');
  });
});
