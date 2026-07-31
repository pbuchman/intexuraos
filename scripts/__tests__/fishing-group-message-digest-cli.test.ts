import { describe, expect, it, vi } from 'vitest';
import { runFishingMigrationCli } from '../message-digests/migrate-fishing-group.mjs';

type OperationName = 'dryRun' | 'apply' | 'verify' | 'activate' | 'compensate';
type OperationSpies = Record<OperationName, ReturnType<typeof vi.fn>>;

interface SafeReport {
  mode: string;
  migrationId: string;
  status: string;
  cutoverDate: string;
  replayStartDate: string;
  replayEndDate: string;
  counts: { canonicalRuns: number };
  hashes: { replay: string };
}

describe('fishing Message Digest migration CLI', () => {
  it.each([
    { flag: '--dry-run', mode: 'dry-run', operation: 'dryRun' },
    { flag: '--apply', mode: 'apply', operation: 'apply' },
    { flag: '--verify', mode: 'verify', operation: 'verify' },
    { flag: '--compensate', mode: 'compensate', operation: 'compensate' },
  ] as const)('dispatches $flag with protected inputs and one safe report', async (scenario) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const operations = operationSpies(scenario.mode);
    const close = vi.fn(async () => undefined);
    const createPorts = vi.fn(async () => ({ ports: { synthetic: true }, close }));

    const exitCode = await runFishingMigrationCli({
      argv: [scenario.flag, '--migration-id', 'mdm_release_001'],
      environment: operationalEnvironment(scenario.mode),
      now: () => '2026-07-28T12:00:00.000Z',
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      createPorts,
      operations,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([`${JSON.stringify(safeReport(scenario.mode))}\n`]);
    expect(operations[scenario.operation]).toHaveBeenCalledWith(
      expect.objectContaining({
        migrationId: 'mdm_release_001',
        now: '2026-07-28T12:00:00.000Z',
        binding: expect.objectContaining({
          projectId: 'private-project-sentinel',
          userId: 'private-owner-sentinel',
          chatId: 'private-chat-sentinel',
        }),
      }),
      { synthetic: true }
    );
    expect(createPorts).toHaveBeenCalledWith(
      expect.objectContaining({ mode: scenario.mode, projectId: 'private-project-sentinel' })
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes the normalized deadline only to activation', async () => {
    const operations = operationSpies('activate');
    const stdout: string[] = [];

    const exitCode = await runFishingMigrationCli({
      argv: [
        '--activate',
        '--migration-id',
        'mdm_release_001',
        '--cutover-deadline',
        '2026-07-28T13:30:00+00:00',
      ],
      environment: operationalEnvironment('activate'),
      now: () => '2026-07-28T12:00:00.000Z',
      stdout: (value) => stdout.push(value),
      stderr: vi.fn(),
      createPorts: vi.fn(async () => ({ ports: { synthetic: true } })),
      operations,
    });

    expect(exitCode).toBe(0);
    expect(operations.activate).toHaveBeenCalledWith(
      expect.objectContaining({ cutoverDeadline: '2026-07-28T13:30:00.000Z' }),
      { synthetic: true }
    );
    expect(stdout).toEqual([`${JSON.stringify(safeReport('activate'))}\n`]);
  });

  it('requires WhatsApp owner configuration for every mode and LLM configuration only for apply', async () => {
    const createPorts = vi.fn(async () => ({ ports: { synthetic: true } }));
    const errors: string[] = [];
    const compensateErrors: string[] = [];

    const applyExit = await runFishingMigrationCli({
      argv: ['--apply', '--migration-id', 'mdm_release_001'],
      environment: protectedEnvironment(),
      now: () => '2026-07-28T12:00:00.000Z',
      stdout: vi.fn(),
      stderr: (value) => errors.push(value),
      createPorts,
      operations: operationSpies('apply'),
    });
    const compensateExit = await runFishingMigrationCli({
      argv: ['--compensate', '--migration-id', 'mdm_release_001'],
      environment: protectedEnvironment(),
      now: () => '2026-07-28T12:00:00.000Z',
      stdout: vi.fn(),
      stderr: (value) => compensateErrors.push(value),
      createPorts,
      operations: operationSpies('compensate'),
    });

    expect(applyExit).toBe(1);
    expect(errors).toEqual([
      `${JSON.stringify({ ok: false, code: 'MIGRATION_OPERATIONAL_CONFIG_INVALID' })}\n`,
    ]);
    expect(compensateExit).toBe(1);
    expect(compensateErrors).toEqual([
      `${JSON.stringify({ ok: false, code: 'MIGRATION_OPERATIONAL_CONFIG_INVALID' })}\n`,
    ]);
    expect(createPorts).not.toHaveBeenCalled();
  });

  it('never prints protected values, provider bodies, prompts, or unsafe operation reports', async () => {
    const privateValues = [
      'private-owner-sentinel',
      'private-chat-sentinel',
      'private-provider-body-sentinel',
      'private-prompt-sentinel',
    ];
    const output: string[] = [];
    const operations = operationSpies('dry-run');
    operations.dryRun.mockRejectedValueOnce(
      new Error(privateValues.join(' private-provider-body-sentinel '))
    );

    const exitCode = await runFishingMigrationCli({
      argv: ['--dry-run', '--migration-id', 'mdm_release_001'],
      environment: operationalEnvironment('dry-run'),
      now: () => '2026-07-28T12:00:00.000Z',
      stdout: (value) => output.push(value),
      stderr: (value) => output.push(value),
      createPorts: vi.fn(async () => ({ ports: { synthetic: true } })),
      operations,
    });

    expect(exitCode).toBe(1);
    expect(output).toEqual([
      `${JSON.stringify({ ok: false, code: 'MIGRATION_EXECUTION_FAILED' })}\n`,
    ]);
    for (const privateValue of privateValues) expect(output.join('')).not.toContain(privateValue);
  });

  it('rejects a report with any non-safe field instead of serializing it', async () => {
    const output: string[] = [];
    const operations = operationSpies('verify');
    operations.verify.mockResolvedValueOnce({
      report: { ...safeReport('verify'), privatePrompt: 'private-prompt-sentinel' },
    });

    const exitCode = await runFishingMigrationCli({
      argv: ['--verify', '--migration-id', 'mdm_release_001'],
      environment: operationalEnvironment('verify'),
      now: () => '2026-07-28T12:00:00.000Z',
      stdout: (value) => output.push(value),
      stderr: (value) => output.push(value),
      createPorts: vi.fn(async () => ({ ports: { synthetic: true } })),
      operations,
    });

    expect(exitCode).toBe(1);
    expect(output.join('')).not.toContain('private-prompt-sentinel');
    expect(output).toEqual([
      `${JSON.stringify({ ok: false, code: 'MIGRATION_REPORT_INVALID' })}\n`,
    ]);
  });
});

function operationSpies(successfulMode: string): OperationSpies {
  const operation = vi.fn(async () => ({ report: safeReport(successfulMode) }));
  return {
    dryRun: vi.fn(),
    apply: vi.fn(),
    verify: vi.fn(),
    activate: vi.fn(),
    compensate: vi.fn(),
    [operationName(successfulMode)]: operation,
  } as OperationSpies;
}

function operationName(mode: string): OperationName {
  if (mode === 'dry-run') return 'dryRun';
  if (mode === 'apply') return 'apply';
  if (mode === 'verify') return 'verify';
  if (mode === 'activate') return 'activate';
  return 'compensate';
}

function safeReport(mode: string): SafeReport {
  return {
    mode,
    migrationId: 'mdm_release_001',
    status: mode === 'activate' ? 'active' : 'ready',
    cutoverDate: '2026-07-28',
    replayStartDate: '2026-07-04',
    replayEndDate: '2026-07-27',
    counts: { canonicalRuns: 143 },
    hashes: { replay: 'a'.repeat(64) },
  };
}

function operationalEnvironment(mode: string): Record<string, string> {
  return {
    ...protectedEnvironment(),
    INTEXURAOS_WHATSAPP_SERVICE_URL: 'https://whatsapp.internal.example',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'private-internal-token',
    ...(mode === 'apply'
      ? {
          INTEXURAOS_OPENROUTER_APP_API_KEY: 'private-openrouter-key',
          INTEXURAOS_DIGEST_LLM_MODEL: 'anthropic/synthetic-model',
          INTEXURAOS_LLM_USAGE_SERVICE_URL: 'https://usage.internal.example',
        }
      : {}),
  };
}

function protectedEnvironment(): Record<string, string> {
  return {
    INTEXURAOS_GCP_PROJECT_ID: 'private-project-sentinel',
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_USER_ID: 'private-owner-sentinel',
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_ACCOUNT_ID: 'private-account-sentinel',
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_GENERATION_ID: 'private-generation-sentinel',
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_CHAT_ID: 'private-chat-sentinel',
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_GROUP_NAME: 'private-group-sentinel',
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_DIGEST_HASH: 'a'.repeat(64),
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_STATE_HASH: 'b'.repeat(64),
  };
}
