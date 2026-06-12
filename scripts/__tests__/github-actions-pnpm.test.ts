import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const workflowDir = join(repoRoot, '.github', 'workflows');

function workflowFiles(): string[] {
  return readdirSync(workflowDir)
    .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
    .map((fileName) => join('.github', 'workflows', fileName));
}

function pinnedPnpmSetupVersions(relativePath: string): string[] {
  const lines = readFileSync(join(repoRoot, relativePath), 'utf8').split('\n');
  const violations: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.includes('uses: pnpm/action-setup@')) {
      continue;
    }

    for (let offset = 1; offset <= 8 && index + offset < lines.length; offset += 1) {
      const candidate = lines[index + offset] ?? '';
      if (/^\s*-\s+name:/.test(candidate)) {
        break;
      }
      if (/^\s*version:\s*['"]?\d/.test(candidate)) {
        violations.push(`${relativePath}:${index + offset + 1}`);
      }
    }
  }

  return violations;
}

describe('GitHub Actions pnpm setup', () => {
  it('uses the packageManager field instead of pinning a second pnpm version', () => {
    const violations = workflowFiles().flatMap(pinnedPnpmSetupVersions);

    expect(violations).toEqual([]);
  });
});
