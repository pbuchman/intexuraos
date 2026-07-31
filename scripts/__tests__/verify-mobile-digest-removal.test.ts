import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'verify-mobile-digest-removal.mjs');
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..');

function writeFixture(rootDir: string, relativePath: string, body: string): void {
  const fullPath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
}

function runVerifier(rootDir: string): SpawnSyncReturns<string> {
  return spawnSync('node', [SCRIPT, '--root', rootDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function seedCleanFixture(rootDir: string): void {
  writeFixture(
    rootDir,
    'apps/mobile-notifications-service/package.json',
    JSON.stringify({ dependencies: { '@intexuraos/common-core': 'workspace:*' } })
  );
  writeFixture(
    rootDir,
    'apps/mobile-notifications-service/src/domain/notifications/usecases/createConnection.ts',
    "return createHash('sha256').update(signature).digest('hex');\n"
  );
  writeFixture(
    rootDir,
    'packages/internal-clients/src/index.ts',
    "export * from './user-service';\n"
  );
  writeFixture(rootDir, 'packages/llm-prompts/src/index.ts', "export * from './message-digest';\n");
}

describe('verify-mobile-digest-removal', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'verify-mobile-digest-removal-'));
    seedCleanFixture(rootDir);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('allows only the enumerated signature hash call in active Mobile source', () => {
    const result = runVerifier(rootDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Mobile digest removal verification passed');
    expect(result.stderr).toBe('');
  });

  it('rejects a missing repository root instead of treating it as an empty tree', () => {
    const missingRoot = path.join(rootDir, 'missing-root');

    const result = runVerifier(missingRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('repository root');
    expect(result.stderr).toContain(missingRoot);
  });

  it.each([
    'apps/mobile-notifications-service/src',
    'apps/mobile-notifications-service/src/domain/notifications/usecases/createConnection.ts',
    'apps/mobile-notifications-service/package.json',
    'packages/internal-clients/src/index.ts',
    'packages/llm-prompts/src/index.ts',
  ])('rejects missing required audit input %s', (relativePath) => {
    rmSync(path.join(rootDir, relativePath), { recursive: true, force: true });

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(relativePath);
    expect(result.stderr).toContain('required');
  });

  it('rejects a required file path that is a directory', () => {
    const manifestPath = path.join(rootDir, 'apps/mobile-notifications-service/package.json');
    rmSync(manifestPath);
    mkdirSync(manifestPath);

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('apps/mobile-notifications-service/package.json');
    expect(result.stderr).toContain('must be a file');
  });

  it.each([
    'messageDigest',
    'dailyDigest',
    'digestRoutes',
    'backfill',
    'mobile_daily_summaries',
    'mobile_group_states',
    'mobile_digest_locks',
    'mobile_digest_backfill_runs',
    'grupa-wedkarska-skool',
    'INTEXURAOS_DIGEST_LLM_MODEL',
    '@intexuraos/whatsapp-pubsub-client',
  ])('rejects retired Mobile identifier %s', (identifier) => {
    writeFixture(
      rootDir,
      'apps/mobile-notifications-service/src/residual.ts',
      `export const residual = ${JSON.stringify(identifier)};\n`
    );

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/residual.ts');
    expect(result.stderr).toContain(identifier);
  });

  it('rejects a cryptographic digest call outside the one explicit hashing file', () => {
    writeFixture(
      rootDir,
      'apps/mobile-notifications-service/src/otherHash.ts',
      "export const value = createHash('sha256').update('x').digest('hex');\n"
    );

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/otherHash.ts');
  });

  it('rejects any other digest reference even inside the hashing allowlist file', () => {
    writeFixture(
      rootDir,
      'apps/mobile-notifications-service/src/domain/notifications/usecases/createConnection.ts',
      "// old digest pipeline\nreturn createHash('sha256').update(signature).digest('hex');\n"
    );

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('old digest pipeline');
  });

  it.each([
    '@intexuraos/infra-pubsub',
    '@intexuraos/llm-factory',
    '@intexuraos/llm-pricing',
    '@intexuraos/llm-prompts',
    '@intexuraos/whatsapp-pubsub-client',
  ])('rejects retired Mobile dependency %s', (dependency) => {
    writeFixture(
      rootDir,
      'apps/mobile-notifications-service/package.json',
      JSON.stringify({ dependencies: { [dependency]: 'workspace:*' } })
    );

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(dependency);
  });

  it.each([
    'packages/internal-clients/src/mobile-notifications-service/client.ts',
    'packages/llm-prompts/src/digest/index.ts',
  ])('rejects retired implementation path %s', (relativePath) => {
    writeFixture(rootDir, relativePath, 'export {};\n');

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(relativePath);
  });

  it('passes on the repository after the removal is complete', () => {
    const result = runVerifier(REPOSITORY_ROOT);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
