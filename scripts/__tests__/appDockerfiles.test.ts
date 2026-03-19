import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const APPS_DIR = path.join(REPO_ROOT, 'apps');

function getDockerfilePaths(): string[] {
  return fs
    .readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(APPS_DIR, entry.name, 'Dockerfile'))
    .filter((dockerfilePath) => fs.existsSync(dockerfilePath));
}

function getLineNumber(content: string, pattern: RegExp): number | null {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? null : index + 1;
}

describe('app Dockerfiles', () => {
  it('copy workspace packages before pnpm install', () => {
    const dockerfilePaths = getDockerfilePaths();
    const failures: string[] = [];

    for (const dockerfilePath of dockerfilePaths) {
      const content = fs.readFileSync(dockerfilePath, 'utf8');
      const installLine = getLineNumber(content, /^\s*RUN\s+pnpm install --frozen-lockfile\s*$/);
      const packagesCopyLine = getLineNumber(content, /^\s*COPY\s+packages\/\s+\.\/packages\/\s*$/);

      if (installLine === null || packagesCopyLine === null) {
        continue;
      }

      if (packagesCopyLine > installLine) {
        failures.push(
          `${path.relative(REPO_ROOT, dockerfilePath)} copies packages at line ${String(
            packagesCopyLine
          )} after pnpm install at line ${String(installLine)}`
        );
      }
    }

    expect(failures).toEqual([]);
  });
});
