import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const productionMocks = vi.hoisted(() => ({
  rollback: vi.fn(async (): Promise<Record<string, unknown>> => ({ rolledBack: true })),
}));

vi.mock('../../scripts/lib/productionLifecycleOperations.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../scripts/lib/productionLifecycleOperations.js')>(),
  runProductionLifecycleRollback: productionMocks.rollback,
}));
import {
  parseLifecycleRollbackArgs,
  runCodeTaskLifecycleRollbackMain,
} from '../../scripts/rollbackCodeTaskLifecycleTime.js';
import { EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID } from '../../scripts/lib/codeTaskLifecycleBackfill.js';

const SHA = '1234567890abcdef1234567890abcdef12345678';
const JOURNAL_SHA = 'a'.repeat(64);
const validEnv = (credentialPath = '/tmp/key.json'): Record<string, string> => ({
  GOOGLE_APPLICATION_CREDENTIALS: credentialPath,
  INTEXURAOS_ENVIRONMENT: 'prod', INTEXURAOS_RUNTIME: 'prod',
  INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1', INTEXURAOS_COMMIT_SHA: SHA,
  INTEXURAOS_LIFECYCLE_DIRECT_DEPLOYMENT_URL: 'http://127.0.0.1/deployment.json',
  INTEXURAOS_LIFECYCLE_PUBLIC_DEPLOYMENT_URL: 'https://example.invalid/deployment.json',
  INTEXURAOS_LIFECYCLE_DIRECT_HEALTH_URL: 'http://127.0.0.1/health',
  INTEXURAOS_LIFECYCLE_PUBLIC_HEALTH_URL: 'https://example.invalid/health',
});
const validArgv = (): string[] => [
  `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`,
  '--journal=/tmp/journal.json', `--journal-sha=${JOURNAL_SHA}`, `--expected-release-sha=${SHA}`,
];
const credential = (): string => JSON.stringify({
  type: 'service_account', project_id: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
  client_email: 'maintenance@example.invalid', private_key: 'private-key',
});

describe('lifecycle rollback CLI', () => {
  it('requires an exact project, immutable journal proof, and exact release SHA', () => {
    expect(parseLifecycleRollbackArgs([
      `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`,
      '--journal=/var/lib/intexuraos/lifecycle/op_123.json',
      `--journal-sha=${JOURNAL_SHA}`,
      `--expected-release-sha=${SHA}`,
    ])).toEqual({
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      journalPath: '/var/lib/intexuraos/lifecycle/op_123.json',
      journalSha256: JOURNAL_SHA,
      expectedReleaseSha: SHA,
    });

    for (const argv of [
      ['malformed'],
      ['--unknown=value'],
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`],
      ['--project=wrong-project'],
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, `--journal-sha=${JOURNAL_SHA}`, `--expected-release-sha=${SHA}`],
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--journal=relative.json', `--journal-sha=${JOURNAL_SHA}`, `--expected-release-sha=${SHA}`],
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--journal=/tmp/journal.json', '--journal-sha=bad', `--expected-release-sha=${SHA}`],
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--journal=/tmp/journal.json', `--journal-sha=${JOURNAL_SHA}`, '--expected-release-sha=UNKNOWN'],
    ]) {
      expect(() => parseLifecycleRollbackArgs(argv)).toThrow();
    }
  });

  it('reports one sanitized technical failure without journal entries or document IDs', async () => {
    const lines: string[] = [];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const flush = vi.fn(async () => undefined);

    await runCodeTaskLifecycleRollbackMain({
      argv: [
        `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`,
        '--journal=/tmp/journal.json',
        `--journal-sha=${JOURNAL_SHA}`,
        `--expected-release-sha=${SHA}`,
      ],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json',
        INTEXURAOS_ENVIRONMENT: 'prod',
        INTEXURAOS_RUNTIME: 'prod',
        INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
        INTEXURAOS_COMMIT_SHA: SHA,
      },
      deps: {
        readFile: async () => JSON.stringify({
          type: 'service_account',
          project_id: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
          client_email: 'maintenance@example.invalid',
          private_key: 'private-key',
        }),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) }) as never,
        runRollback: async () => {
          throw Object.assign(new Error('task_private_1 private-user'), {
            code: 'JOURNAL_CAS_CONFLICT',
            entries: [{ documentId: 'task_private_1' }],
          });
        },
      },
      telemetry: { logger: logger as never, flush },
      writeLine: (line) => lines.push(line),
      setExitCode: vi.fn(),
    });

    expect(lines).toEqual([JSON.stringify({ ok: false, error: 'JOURNAL_CAS_CONFLICT' })]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/task_private_1|private-user/u);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('covers successful, empty, termination, and non-Error dependency outcomes', async () => {
    const outcomes: (() => Promise<Record<string, unknown>>)[] = [
      async (): Promise<Record<string, unknown>> => ({ rolledBack: true }),
      async (): Promise<Record<string, unknown>> => undefined as never,
      async (): Promise<never> => { throw 'non-error'; },
      async (): Promise<never> => { throw { code: 42 }; },
      async (): Promise<never> => { throw { code: 'lowercase' }; },
      async (): Promise<never> => { throw Object.assign(new Error('invalid code'), { code: 'lowercase' }); },
    ];
    const expected = [
      { rolledBack: true }, { ok: true },
      { ok: false, error: 'UNEXPECTED_FAILURE' },
      { ok: false, error: 'UNEXPECTED_FAILURE' },
      { ok: false, error: 'UNEXPECTED_FAILURE' },
      { ok: false, error: 'UNEXPECTED_FAILURE' },
    ];
    for (const [index, outcome] of outcomes.entries()) {
      const lines: string[] = [];
      await runCodeTaskLifecycleRollbackMain({
        argv: validArgv(), env: validEnv(),
        deps: {
          readFile: async () => credential(),
          createFirestore: () => ({ terminate: vi.fn(async () => undefined) }) as never,
          runRollback: outcome,
        },
        telemetry: {
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
          flush: vi.fn(async () => undefined),
        },
        writeLine: (line) => lines.push(line), setExitCode: vi.fn(),
      });
      expect(JSON.parse(lines[0] ?? '{}')).toEqual(expected[index]);
    }

    const lines: string[] = [];
    await runCodeTaskLifecycleRollbackMain({
      argv: validArgv(), env: validEnv(),
      deps: {
        readFile: async () => credential(),
        createFirestore: () => ({ terminate: vi.fn(async () => { throw Object.assign(new Error('terminate'), { code: 'TERMINATE_FAILED' }); }) }) as never,
        runRollback: async () => ({ rolledBack: true }),
      },
      telemetry: {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        flush: vi.fn(async () => undefined),
      },
      writeLine: (line) => lines.push(line), setExitCode: vi.fn(),
    });
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ ok: false, error: 'TERMINATE_FAILED' });

    const primaryLines: string[] = [];
    await runCodeTaskLifecycleRollbackMain({
      argv: validArgv(), env: validEnv(),
      deps: {
        readFile: async () => credential(),
        createFirestore: () => ({ terminate: vi.fn(async () => { throw new Error('secondary'); }) }) as never,
        runRollback: async () => { throw Object.assign(new Error('primary'), { code: 'PRIMARY_FAILED' }); },
      },
      telemetry: {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        flush: vi.fn(async () => undefined),
      },
      writeLine: (line) => primaryLines.push(line), setExitCode: vi.fn(),
    });
    expect(JSON.parse(primaryLines[0] ?? '{}')).toEqual({ ok: false, error: 'PRIMARY_FAILED' });
  });

  it('uses default file, Firestore, production runner, output, exit, and telemetry adapters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lifecycle-rollback-'));
    const keyPath = join(directory, 'key.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const previousExitCode = process.exitCode;
    await writeFile(keyPath, credential(), 'utf8');
    try {
      productionMocks.rollback.mockResolvedValueOnce({ rolledBack: true });
      await runCodeTaskLifecycleRollbackMain({ argv: validArgv(), env: validEnv(keyPath) });
      expect(stdout).toHaveBeenCalledWith(`${JSON.stringify({ rolledBack: true })}\n`);
      await runCodeTaskLifecycleRollbackMain({ argv: ['--bad'], env: {} });
      expect(process.exitCode).toBe(1);
    } finally {
      stdout.mockRestore();
      process.exitCode = previousExitCode;
      await rm(directory, { recursive: true });
    }
  });
});
