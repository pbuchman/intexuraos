import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const CHECK_PATHS = [
  'apps',
  'packages',
  'workers',
  'scripts',
  'terraform',
  'ecosystem.config.cjs',
  'ecosystem.config.prod.cjs',
  'package.json',
  'pnpm-workspace.yaml',
  'docs/operations',
  'docs/architecture',
  'docs/packages',
  'docs/services',
] as const;

const EXCLUDED_PREFIXES = [
  'scripts/__tests__/otel-removal.test.ts',
  'scripts/test-results',
  'scripts/node_modules',
  'workers/orchestrator/src/__tests__/fixtures',
] as const;

const FORBIDDEN_PATTERNS = [
  '@intexuraos/infra-otel',
  '@opentelemetry/',
  'INTEXURAOS_DASH0',
  'OpenTelemetry',
  'OTEL_SERVICE_NAME',
  'otel-register',
  'pino-opentelemetry-transport',
] as const;

function listFiles(path: string): string[] {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) {
    return [];
  }

  if (statSync(absolute).isFile()) {
    return [absolute];
  }

  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    const relativeChild = relative(ROOT, child);
    if (
      entry === 'node_modules' ||
      entry === '.terraform' ||
      entry === 'dist' ||
      entry === 'coverage' ||
      EXCLUDED_PREFIXES.some((prefix) => relativeChild.startsWith(prefix))
    ) {
      return [];
    }
    return listFiles(relativeChild);
  });
}

describe('OpenTelemetry and Dash0 removal', () => {
  it('has no first-party OpenTelemetry or Dash0 references in active code and docs', () => {
    const violations = CHECK_PATHS.flatMap(listFiles).flatMap((file) => {
      const relativeFile = relative(ROOT, file);
      const content = readFileSync(file, 'utf8');
      return FORBIDDEN_PATTERNS.flatMap((pattern) =>
        content.includes(pattern) ? [`${relativeFile}: ${pattern}`] : []
      );
    });

    expect(violations).toEqual([]);
  });
});
