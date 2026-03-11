import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Creates a temporary directory for hook testing
 * Returns a cleanup function that must be called after the test
 */
export function createTempDir(): {
  path: string;
  cleanup: () => void;
} {
  const tempBase = os.tmpdir();
  const uniqueId = randomUUID().slice(0, 8);
  const tempDir = path.join(tempBase, `hook-test-${uniqueId}`);

  fs.mkdirSync(tempDir, { recursive: true });

  const cleanup = (): void => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { path: tempDir, cleanup };
}

/**
 * Creates a temp file with content, returns the path
 */
export function createTempFile(tempDir: string, relativePath: string, content: string): string {
  const fullPath = path.join(tempDir, relativePath);
  const dirname = path.dirname(fullPath);

  fs.mkdirSync(dirname, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');

  return fullPath;
}

/**
 * Creates a mock package structure with dist/ and src/ directories
 */
export function createMockPackage(
  tempDir: string,
  packageName: string,
  options: { hasDist?: boolean; hasBuildScript?: boolean } = {}
): void {
  const pkgDir = path.join(tempDir, 'packages', packageName);

  // Create package.json
  const pkgJson: { name: string; scripts?: Record<string, string> } = {
    name: `@intexuraos/${packageName}`,
  };
  if (options.hasBuildScript) {
    pkgJson.scripts = { build: 'tsc' };
  }

  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');

  // Create src/ directory
  fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'src', 'index.ts'), 'export const foo = "bar";', 'utf-8');

  // Optionally create dist/
  if (options.hasDist) {
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.js'), 'export const foo = "bar";', 'utf-8');
  }
}

/**
 * Creates a mock hooks.log file with structured entries
 */
export function createHooksLog(
  tempDir: string,
  entries: {
    level: 'INFO' | 'WARNED' | 'BLOCKED';
    hook: string;
    pattern: string;
    file: string;
    message: string;
    suggestion: string;
  }[]
): void {
  const hooksDir = path.join(tempDir, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const logPath = path.join(hooksDir, 'hooks.log');
  const lines = entries.map(
    (e) =>
      `${new Date().toISOString()}\t${e.level}\t${e.hook}\t${e.pattern}\t${e.file}\t${e.message}\t${e.suggestion}`
  );

  fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');
}
