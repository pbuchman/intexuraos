import { spawnSync } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  FirebaseAuthError: class MockFirebaseAuthError extends Error {
    readonly code = 'auth/internal-error';
  },
  getAuth: vi.fn(),
}));

import * as deterministicEvaluatorModule from '../deterministicEvaluator.js';
import type { ReplyEvaluationInput } from '../deterministicEvaluator.js';
import * as endpointClientModule from '../endpointClient.js';
import type { EndpointConversationResponse, SyntheticRunIdentity } from '../endpointClient.js';
import * as matrixClientModule from '../live/matrixClient.js';
import * as matrixSmokeModule from '../live/runMatrixSmoke.js';
import type { MatrixSmokeResult } from '../live/runMatrixSmoke.js';
import type { MatrixCorpusPreflightResult } from '../matrixCorpus/preflight.js';
import type { MatrixCorpusRunResult } from '../matrixCorpus/runMatrixCorpus.js';
import * as miniMaxModule from '../minimaxJudge.js';
import * as preflightModule from '../preflight.js';
import type { PreflightCheckId, PreflightResult, SetupResult } from '../preflight.js';
import * as reportWriterModule from '../reportWriter.js';
import {
  EvaluationReportV1Schema,
  type EvaluationReportV1,
  type ReportWriteResult,
} from '../reportWriter.js';
import * as endpointCorpusModule from '../runEndpointCorpus.js';
import * as endpointScenarioModule from '../runEndpointScenario.js';
import type {
  JudgeReplyVerdict,
  JudgeUsageSummary,
  ScenarioLifecycleResult,
} from '../runEndpointScenario.js';
import * as scenarioCatalogModule from '../scenarioCatalog.js';
import { IntexEvalScenarioSchema, type IntexEvalScenario } from '../scenarioSchema.js';
import {
  createProductionCliDependencies,
  createNodeSetupInputPort,
  parseCliArgs,
  runCli,
  type ClockPort,
  type CliDependencies,
  type SetupInputPort,
  type TimedEndpointCorpusResult,
} from '../cli.js';
import { createScenario } from './scenarioFixtures.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const SCENARIOS = [
  IntexEvalScenarioSchema.parse(createScenario(1, 'intex-eval-001')),
  IntexEvalScenarioSchema.parse(createScenario(1, 'intex-eval-002')),
] as const;

const CANONICAL_PREFLIGHT_CHECK_IDS = [
  'runtime',
  'environment',
  'config',
  'matrix_files',
  'intex_agent_health',
  'whatsapp_health',
  'matrix_health',
  'firebase_identity',
  'matrix_identity',
  'whatsapp_delivery',
  'scenario_catalog',
  'minimax_probe',
] as const satisfies readonly PreflightCheckId[];

describe('parseCliArgs', () => {
  it.each([
    { argv: [] as const, command: { kind: 'full' } },
    { argv: ['setup'] as const, command: { kind: 'setup' } },
    { argv: ['preflight'] as const, command: { kind: 'preflight' } },
    { argv: ['endpoint'] as const, command: { kind: 'endpoint' } },
    { argv: ['full'] as const, command: { kind: 'full' } },
    {
      argv: ['scenario', 'intex-eval-003'] as const,
      command: { kind: 'scenario', scenarioId: 'intex-eval-003' },
    },
    {
      argv: ['--scenario', 'intex-eval-003'] as const,
      command: { kind: 'scenario', scenarioId: 'intex-eval-003' },
    },
    { argv: ['matrix-smoke'] as const, command: { kind: 'matrix-smoke' } },
    { argv: ['matrix-corpus'] as const, command: { kind: 'matrix-corpus' } },
    {
      argv: ['matrix-corpus', '--agent-model=or:minimax/minimax-m3'] as const,
      command: { kind: 'matrix-corpus', agentModel: 'or:minimax/minimax-m3' },
    },
  ])('accepts only the closed row $argv', ({ argv, command }) => {
    expect(parseCliArgs(argv)).toEqual({ ok: true, command });
  });

  it.each([
    ['--help'],
    ['help'],
    ['unknown'],
    ['--unknown'],
    ['scenario'],
    ['--scenario'],
    ['scenario', ''],
    ['--scenario', ''],
    ['scenario', 'intex-eval-003', 'extra'],
    ['--scenario', 'intex-eval-003', 'extra'],
    ['full', '--scenario', 'intex-eval-003'],
    ['endpoint', 'extra'],
    ['setup', 'extra'],
    ['preflight', 'extra'],
    ['matrix-smoke', 'extra'],
    ['matrix-corpus', '--agent-model=or:google/gemini-3-flash-preview'],
    ['matrix-corpus', '--agent-model='],
    ['matrix-corpus', '--agent-model=or:minimax/minimax-m3', 'extra'],
    ['scenario', 'intex-eval-003', 'scenario', 'intex-eval-004'],
  ])('rejects argv %j without reflecting its value', (...argv) => {
    expect(parseCliArgs(argv)).toEqual({ ok: false, code: 'INVALID_COMMAND' });
  });
});

describe('direct CLI module', () => {
  it('sets exit 2 and emits only the static invalid-command line', () => {
    const privateArgvSentinel = '--private-direct-argv-sentinel';
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('../cli.ts', import.meta.url)),
        privateArgvSentinel,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      }
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('cli result FAIL INVALID_COMMAND\n');
    expect(result.stderr).toBe('');
    expect(`${result.stdout}${result.stderr}`).not.toContain(privateArgvSentinel);
  });
});

describe('production setup input', () => {
  it('requires both input and output TTYs', async () => {
    const input = new FakeTtyInput();
    const output = new CapturingTtyOutput();
    const setupInput = createNodeSetupInputPort({ input, output });

    expect(setupInput.isInteractive()).toBe(true);
    input.isTTY = false;
    expect(setupInput.isInteractive()).toBe(false);
    input.isTTY = true;
    output.isTTY = false;
    expect(setupInput.isInteractive()).toBe(false);

    await setupInput.close();
  });

  it('reads the account alias without forwarding readline terminal rendering', async () => {
    const input = new FakeTtyInput();
    const output = new CapturingTtyOutput();
    const setupInput = createNodeSetupInputPort({ input, output });

    const answer = setupInput.readVisible('account_alias');
    input.write('operator-account\n');

    await expect(answer).resolves.toBe('operator-account');
    expect(output.text()).toBe('');
    expect(output.text()).not.toContain('operator-account');
    expect(output.text()).not.toContain('*');
    expect(input.isRaw).toBe(false);
    await setupInput.close();
  });

  it('reads protected values without echo or masking and restores raw mode', async () => {
    const input = new FakeTtyInput();
    const output = new CapturingTtyOutput();
    const setupInput = createNodeSetupInputPort({ input, output });
    const sentinel = '/private/token-file-sentinel';

    const answer = setupInput.readHidden('matrix_access_token_file');
    input.write(`${sentinel}\n`);

    await expect(answer).resolves.toBe(sentinel);
    expect(output.text()).toBe('\n');
    expect(output.text()).not.toContain(sentinel);
    expect(output.text()).not.toContain('*');
    expect(input.rawModes).toEqual([true, false]);
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
    await setupInput.close();
  });

  it.each([
    ['Ctrl-C', (input: FakeTtyInput): void => void input.write('\u0003')],
    ['EOF', (input: FakeTtyInput): void => void input.end()],
  ] as const)('restores TTY state after %s', async (_label, abort) => {
    const input = new FakeTtyInput();
    const output = new CapturingTtyOutput();
    const setupInput = createNodeSetupInputPort({ input, output });

    const answer = setupInput.readHidden('matrix_targets_file');
    abort(input);

    await expect(answer).rejects.toThrow('SETUP_INPUT_ABORTED');
    expect(output.text()).toBe('\n');
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
    await setupInput.close();
  });

  it('aborts an active read and restores listeners when closed', async () => {
    const input = new FakeTtyInput();
    const output = new CapturingTtyOutput();
    const setupInput = createNodeSetupInputPort({ input, output });
    const answer = setupInput.readHidden('canonical_user_id');
    const rejection = expect(answer).rejects.toThrow('SETUP_INPUT_ABORTED');

    await setupInput.close();

    await rejection;
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
  });

  it.each([
    ['visible', 'success'],
    ['visible', 'EOF'],
    ['visible', 'Ctrl-C'],
    ['visible', 'explicit close'],
    ['hidden', 'success'],
    ['hidden', 'EOF'],
    ['hidden', 'Ctrl-C'],
    ['hidden', 'explicit close'],
  ] as const)(
    'restores an initially enabled raw mode after a %s %s read',
    async (kind, outcome) => {
      const input = new FakeTtyInput();
      input.isRaw = true;
      const output = new CapturingTtyOutput();
      const setupInput = createNodeSetupInputPort({ input, output });
      const answer =
        kind === 'visible'
          ? setupInput.readVisible('account_alias')
          : setupInput.readHidden('canonical_user_id');

      if (outcome === 'success') {
        input.write('safe-answer\n');
        await expect(answer).resolves.toBe('safe-answer');
      } else {
        const rejection = expect(answer).rejects.toThrow('SETUP_INPUT_ABORTED');
        if (outcome === 'EOF') input.end();
        else if (outcome === 'Ctrl-C') input.write('\u0003');
        else await setupInput.close();
        await rejection;
      }

      expect(input.isRaw).toBe(true);
      expect(input.listenerCount('keypress')).toBe(0);
      await setupInput.close();
    }
  );
});

describe('runCli setup and preflight', () => {
  it('rejects invalid commands before invoking any dependency', async () => {
    const harness = createHarness();

    await expect(runCli(['--private-invalid-sentinel'], harness.dependencies)).resolves.toBe(2);

    expect(harness.stderr).toHaveBeenCalledOnce();
    expect(harness.stderr).toHaveBeenCalledWith('cli result FAIL INVALID_COMMAND');
    expect(harness.outputText()).not.toContain('private-invalid-sentinel');
    expect(harness.loadScenarios).not.toHaveBeenCalled();
    expect(harness.preflight).not.toHaveBeenCalled();
    expect(harness.createReportRunId).not.toHaveBeenCalled();
  });

  it('checks exact catalog membership before preflight or report creation', async () => {
    const harness = createHarness();

    await expect(runCli(['scenario', 'intex-eval-999'], harness.dependencies)).resolves.toBe(2);

    expect(harness.loadScenarios).toHaveBeenCalledOnce();
    expect(harness.stderr).toHaveBeenCalledWith('cli result FAIL INVALID_SCENARIO');
    expect(harness.preflight).not.toHaveBeenCalled();
    expect(harness.createReportRunId).not.toHaveBeenCalled();
    expect(harness.runEndpoint).not.toHaveBeenCalled();
    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    expect(harness.writeReport).not.toHaveBeenCalled();
  });

  it('requires an interactive setup without calling a reader or setup', async () => {
    const setupInput = createSetupInput({ interactive: false });
    const harness = createHarness({ setupInput });

    await expect(runCli(['setup'], harness.dependencies)).resolves.toBe(2);

    expect(setupInput.readVisible).not.toHaveBeenCalled();
    expect(setupInput.readHidden).not.toHaveBeenCalled();
    expect(harness.setup).not.toHaveBeenCalled();
    expect(setupInput.close).toHaveBeenCalledOnce();
    expect(harness.stdout).not.toHaveBeenCalled();
    expect(harness.stderr.mock.calls).toEqual([['setup result FAIL SETUP_TTY_REQUIRED']]);
  });

  it.each(['created', 'already_configured'] as const)(
    'collects the exact candidate once, closes input, and renders setup %s',
    async (state) => {
      const setupInput = createSetupInput({
        visible: ' alias-input-sentinel ',
        hidden: {
          canonical_user_id: ' user-id-input-sentinel ',
          matrix_user_id: ' matrix-id-input-sentinel ',
          matrix_access_token_file: ' token-path-input-sentinel ',
          matrix_targets_file: ' targets-path-input-sentinel ',
        },
      });
      const setupResult: SetupResult = {
        ok: true,
        exitCode: 0,
        state,
        accountAlias: 'safe-account',
        checks: [
          { check: 'runtime', status: 'passed' },
          { check: 'config', status: 'passed' },
        ],
      };
      const setup = vi.fn(async (_candidate: unknown) => setupResult);
      const harness = createHarness({ setupInput, setup });

      await expect(runCli(['setup'], harness.dependencies)).resolves.toBe(0);

      expect(setupInput.readVisible).toHaveBeenCalledWith('account_alias');
      expect(setupInput.readHidden.mock.calls).toEqual([
        ['canonical_user_id'],
        ['matrix_user_id'],
        ['matrix_access_token_file'],
        ['matrix_targets_file'],
      ]);
      expect(setup).toHaveBeenCalledOnce();
      expect(setup).toHaveBeenCalledWith({
        schemaVersion: 1,
        accountAlias: ' alias-input-sentinel ',
        userId: ' user-id-input-sentinel ',
        matrixUserId: ' matrix-id-input-sentinel ',
        matrixAccessTokenFile: ' token-path-input-sentinel ',
        matrixTargetsFile: ' targets-path-input-sentinel ',
      });
      expect(setupInput.close).toHaveBeenCalledOnce();
      expect(harness.stdout.mock.calls).toEqual([
        ['setup input account_alias'],
        ['setup input canonical_user_id'],
        ['setup input matrix_user_id'],
        ['setup input matrix_access_token_file'],
        ['setup input matrix_targets_file'],
        ['setup check runtime PASS'],
        ['setup check config PASS'],
        [`setup result PASS ${state} account safe-account`],
      ]);
      expect(harness.stderr).not.toHaveBeenCalled();
      expect(harness.outputText()).not.toContain('input-sentinel');
    }
  );

  it('renders only closed setup failure evidence', async () => {
    const setupResult: SetupResult = {
      ok: false,
      exitCode: 2,
      code: 'MATRIX_HEALTH_FAILED',
      checks: [
        { check: 'runtime', status: 'passed' },
        { check: 'matrix_health', status: 'failed', code: 'MATRIX_HEALTH_FAILED' },
      ],
    };
    const harness = createHarness({ setup: vi.fn(async () => setupResult) });

    await expect(runCli(['setup'], harness.dependencies)).resolves.toBe(2);

    expect(harness.stdout.mock.calls.slice(-1)).toEqual([['setup check runtime PASS']]);
    expect(harness.stderr.mock.calls).toEqual([
      ['setup check matrix_health FAIL MATRIX_HEALTH_FAILED'],
      ['setup result FAIL MATRIX_HEALTH_FAILED'],
    ]);
  });

  it('closes setup input and redacts a rejected read', async () => {
    const setupInput = createSetupInput();
    setupInput.readHidden.mockRejectedValueOnce(new Error('private-read-error-sentinel'));
    const harness = createHarness({ setupInput });

    await expect(runCli(['setup'], harness.dependencies)).resolves.toBe(2);

    expect(setupInput.close).toHaveBeenCalledOnce();
    expect(harness.setup).not.toHaveBeenCalled();
    expect(harness.stderr).toHaveBeenCalledWith('cli result FAIL UNEXPECTED_FAILURE');
    expect(harness.outputText()).not.toContain('private-read-error-sentinel');
  });

  it('closes setup input and redacts a setup throw', async () => {
    const setupInput = createSetupInput();
    const harness = createHarness({
      setupInput,
      setup: vi.fn(async () => {
        throw new Error('private-setup-error-sentinel');
      }),
    });

    await expect(runCli(['setup'], harness.dependencies)).resolves.toBe(2);

    expect(setupInput.close).toHaveBeenCalledOnce();
    expect(harness.stderr).toHaveBeenCalledWith('cli result FAIL UNEXPECTED_FAILURE');
    expect(harness.outputText()).not.toContain('private-setup-error-sentinel');
  });

  it('renders the complete fixed preflight success summary', async () => {
    const preflightResult = passingPreflight();
    const harness = createHarness({ preflight: vi.fn(async () => preflightResult) });

    await expect(runCli(['preflight'], harness.dependencies)).resolves.toBe(0);

    expect(harness.stdout.mock.calls).toEqual([
      ...CANONICAL_PREFLIGHT_CHECK_IDS.map((check) => [`preflight check ${check} PASS`]),
      [
        'preflight result PASS host home-dev intex-agent 8134 whatsapp-service 8113 ' +
          'matrix-adapter 8099 judge or:minimax/minimax-m3 scenarios 2 account safe-account',
      ],
    ]);
    expect(harness.stderr).not.toHaveBeenCalled();
  });

  it('renders only closed preflight failure evidence', async () => {
    const preflightResult: PreflightResult = {
      ok: false,
      exitCode: 2,
      code: 'MINIMAX_PROBE_TIMEOUT',
      checks: [
        ...CANONICAL_PREFLIGHT_CHECK_IDS.slice(0, -1).map((check) => ({
          check,
          status: 'passed' as const,
        })),
        { check: 'minimax_probe', status: 'failed', code: 'MINIMAX_PROBE_TIMEOUT' },
      ],
    };
    const harness = createHarness({ preflight: vi.fn(async () => preflightResult) });

    await expect(runCli(['preflight'], harness.dependencies)).resolves.toBe(2);

    expect(harness.stdout.mock.calls).toEqual(
      CANONICAL_PREFLIGHT_CHECK_IDS.slice(0, -1).map((check) => [`preflight check ${check} PASS`])
    );
    expect(harness.stderr.mock.calls).toEqual([
      ['preflight check minimax_probe FAIL MINIMAX_PROBE_TIMEOUT'],
      ['preflight result FAIL MINIMAX_PROBE_TIMEOUT'],
    ]);
  });

  it('redacts an unexpected preflight throw', async () => {
    const harness = createHarness({
      preflight: vi.fn(async () => {
        throw new Error('private-preflight-error-sentinel');
      }),
    });

    await expect(runCli(['preflight'], harness.dependencies)).resolves.toBe(2);

    expect(harness.stderr.mock.calls).toEqual([['cli result FAIL UNEXPECTED_FAILURE']]);
    expect(harness.outputText()).not.toContain('private-preflight-error-sentinel');
  });
});

describe('runCli evaluation orchestration and projection', () => {
  it.each([
    {
      label: 'default DeepSeek',
      argv: ['matrix-corpus'] as const,
      agentModel: 'or:deepseek/deepseek-v4-flash' as const,
    },
    {
      label: 'explicit MiniMax M3',
      argv: ['matrix-corpus', '--agent-model=or:minimax/minimax-m3'] as const,
      agentModel: 'or:minimax/minimax-m3' as const,
    },
  ])(
    'keeps $label model selection through preflight and every mutating execution port',
    async ({ argv, agentModel }) => {
      const order: string[] = [];
      const matrixCorpusPreflight = vi.fn(async () => {
        order.push('preflight');
        return {
          ok: true,
          exitCode: 0,
          checks: [],
          snapshot: {},
          catalog: {},
        } as unknown as Extract<MatrixCorpusPreflightResult, { ok: true }>;
      });
      const createReportRunId = vi.fn(() => {
        order.push('run-id');
        return 'eval-123e4567-e89b-12d3-a456-426614174000';
      });
      const runMatrixCorpus = vi.fn(async ({ runId }: { runId: string }) => {
        order.push('execute');
        return {
          run: {
            runId,
            effectiveKind: 'passed' as const,
            exitCode: 0 as const,
            failureCodes: [],
            scenarios: [
              { scenarioId: 'intex-eval-001', status: 'passed' as const, completedTurns: 2 },
            ],
            totals: {
              completedTurns: 59,
              judgedReplies: 59,
              agentCostNanoUsd: 1,
              evaluatorCostNanoUsd: 1,
            },
            terminalAcknowledged: true,
            cleanupCompleted: true,
          },
          reportReady: true,
          relativeReportDirectory: `.artifacts/intex-agent-evals/${runId}`,
        };
      });
      const harness = createHarness({ matrixCorpusPreflight, createReportRunId, runMatrixCorpus });

      await expect(runCli(argv, harness.dependencies)).resolves.toBe(0);

      expect(order).toEqual(['preflight', 'run-id', 'execute']);
      expect(matrixCorpusPreflight).toHaveBeenCalledWith(agentModel);
      expect(runMatrixCorpus).toHaveBeenCalledWith(expect.objectContaining({ agentModel }));
      expect(harness.loadScenarios).not.toHaveBeenCalled();
      expect(harness.stdout.mock.calls).toEqual([
        ['preflight result PASS'],
        ['evaluation run eval-123e4567-e89b-12d3-a456-426614174000 command matrix-corpus'],
        ['scenario intex-eval-001 PASS'],
        ['evaluation result PASS exit 0'],
        [
          'evaluation report .artifacts/intex-agent-evals/eval-123e4567-e89b-12d3-a456-426614174000',
        ],
      ]);
    }
  );

  it('returns infrastructure exit two and suppresses the report path when publication is not ready', async () => {
    const runId = 'eval-123e4567-e89b-12d3-a456-426614174000';
    const harness = createHarness({
      matrixCorpusPreflight: vi.fn(
        async () =>
          ({
            ok: true,
            exitCode: 0,
            checks: [],
            snapshot: {},
            catalog: {},
          }) as unknown as Extract<MatrixCorpusPreflightResult, { ok: true }>
      ),
      runMatrixCorpus: vi.fn(async () => ({
        run: {
          runId,
          effectiveKind: 'infrastructure_failure' as const,
          exitCode: 2 as const,
          failureCodes: ['REPORT_PUBLICATION_FAILED', 'PRIVATE_TOKEN_ABC123'],
          scenarios: [
            { scenarioId: 'intex-eval-001', status: 'passed' as const, completedTurns: 2 },
          ],
          totals: {
            completedTurns: 59,
            judgedReplies: 59,
            agentCostNanoUsd: 1,
            evaluatorCostNanoUsd: 1,
          },
          terminalAcknowledged: true,
          cleanupCompleted: true,
        },
        reportReady: false,
        relativeReportDirectory: `.artifacts/intex-agent-evals/${runId}`,
      })),
    });

    await expect(runCli(['matrix-corpus'], harness.dependencies)).resolves.toBe(2);

    expect(harness.stdout.mock.calls).toEqual([
      ['preflight result PASS'],
      [`evaluation run ${runId} command matrix-corpus`],
      ['scenario intex-eval-001 PASS'],
    ]);
    expect(harness.stderr.mock.calls).toEqual([
      ['evaluation failure REPORT_PUBLICATION_FAILED'],
      ['evaluation failure UNKNOWN_FAILURE'],
      ['evaluation result INFRASTRUCTURE_FAILURE exit 2'],
    ]);
    expect(harness.outputText()).not.toContain('PRIVATE_TOKEN_ABC123');
    expect(harness.outputText()).not.toContain('evaluation report');
    expect(harness.outputText()).not.toContain(`.artifacts/intex-agent-evals/${runId}`);
  });

  it('emits only one closed stderr line and touches no run port on matrix-corpus preflight failure', async () => {
    const harness = createHarness({
      matrixCorpusPreflight: vi.fn(
        async (): Promise<MatrixCorpusPreflightResult> => ({
          ok: false,
          exitCode: 2,
          code: 'RUN_CONFLICT',
        })
      ),
    });

    await expect(runCli(['matrix-corpus'], harness.dependencies)).resolves.toBe(2);

    expect(harness.stdout).not.toHaveBeenCalled();
    expect(harness.stderr.mock.calls).toEqual([['preflight result FAIL RUN_CONFLICT']]);
    expect(harness.createReportRunId).not.toHaveBeenCalled();
    expect(harness.runMatrixCorpus).not.toHaveBeenCalled();
  });

  it('runs the endpoint catalog in order and writes one strict privacy-safe report', async () => {
    const lifecycleResults = SCENARIOS.map((scenario) => lifecycleFor(scenario, 'passed'));
    const reports: EvaluationReportV1[] = [];
    const runEndpoint = vi.fn(async (scenarios: readonly IntexEvalScenario[]) => {
      expect(scenarios).toEqual(SCENARIOS);
      return timedCorpus(lifecycleResults, {
        'intex-eval-001': 125,
        'intex-eval-002': 250,
      });
    });
    const writeReport = vi.fn(async (report: EvaluationReportV1) => {
      reports.push(report);
      return reportSuccess(report.runId);
    });
    const harness = createHarness({
      clock: sequenceClock(
        new Date('2026-07-16T10:00:00.000Z'),
        new Date('2026-07-16T10:00:01.000Z')
      ),
      runEndpoint,
      writeReport,
    });

    await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(0);

    expect(runEndpoint).toHaveBeenCalledOnce();
    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    expect(writeReport).toHaveBeenCalledOnce();
    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      schemaVersion: 1,
      command: 'endpoint',
      startedAt: '2026-07-16T10:00:00.000Z',
      finishedAt: '2026-07-16T10:00:01.000Z',
      durationMs: 1_000,
      status: 'passed',
      exitCode: 0,
      preflight: {
        status: 'passed',
        host: 'home-dev',
        scenarioCount: 2,
        accountAlias: 'safe-account',
      },
      totals: {
        scenarioCount: 2,
        scenarioPassed: 2,
        scenarioBehavioralFailed: 0,
        scenarioInfrastructureFailed: 0,
        turnCount: 2,
        replyCount: 2,
        toolCallCount: 2,
        judgeVerdictCount: 2,
      },
      judgeUsage: {
        callCount: 2,
        repairCount: 0,
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        providerReportedUsd: 0.002,
        providerReportedUsdComplete: true,
      },
      scenarios: [
        {
          scenarioId: 'intex-eval-001',
          durationMs: 125,
          toolSummaries: [{ toolName: 'create_note', completedCount: 1, failedCount: 0 }],
          cleanup: { status: 'passed', deleted: 1, total: 1 },
        },
        {
          scenarioId: 'intex-eval-002',
          durationMs: 250,
          toolSummaries: [{ toolName: 'create_note', completedCount: 1, failedCount: 0 }],
          cleanup: { status: 'passed', deleted: 1, total: 1 },
        },
      ],
      failures: [],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private-assistant-text-sentinel');
    expect(serialized).not.toContain('private-rationale-sentinel');
    expect(serialized).not.toContain('private-id-sentinel');
    expect(serialized).not.toContain('private-argument-sentinel');
    expect(harness.stdout.mock.calls.slice(-4)).toEqual([
      ['scenario intex-eval-001 PASS'],
      ['scenario intex-eval-002 PASS'],
      ['evaluation result PASS exit 0'],
      [`evaluation report .artifacts/intex-agent-evals/${report.runId}`],
    ]);
    expect(harness.stderr).not.toHaveBeenCalled();
  });

  it('creates the run before preflight and preserves exact evaluation stage order', async () => {
    const order: string[] = [];
    const result = lifecycleFor(SCENARIOS[0], 'passed');
    const harness = createHarness({
      loadScenarios: vi.fn(async () => {
        order.push('catalog');
        return [SCENARIOS[0]];
      }),
      createReportRunId: vi.fn(() => {
        order.push('run-id');
        return 'eval-123e4567-e89b-12d3-a456-426614174000';
      }),
      clock: {
        now: vi
          .fn<() => Date>()
          .mockImplementationOnce(() => {
            order.push('clock-start');
            return new Date('2026-07-16T10:00:00.000Z');
          })
          .mockImplementationOnce(() => {
            order.push('clock-finish');
            return new Date('2026-07-16T10:00:00.100Z');
          }),
      },
      preflight: vi.fn(async () => {
        order.push('preflight');
        return passingPreflight();
      }),
      runEndpoint: vi.fn(async () => {
        order.push('endpoint');
        return timedCorpus([result], { 'intex-eval-001': 50 });
      }),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        order.push('report');
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(0);

    expect(order).toEqual([
      'catalog',
      'run-id',
      'clock-start',
      'preflight',
      'endpoint',
      'clock-finish',
      'report',
    ]);
  });

  it('runs only the exact selected scenario and never sends Matrix', async () => {
    const selected = SCENARIOS[1];
    const result = lifecycleFor(selected, 'passed');
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async (scenarios) => {
        expect(scenarios).toEqual([selected]);
        return timedCorpus([result], { [selected.id]: 75 });
      }),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['scenario', selected.id], harness.dependencies)).resolves.toBe(0);

    expect(harness.runEndpoint).toHaveBeenCalledOnce();
    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    expect(requiredItem(reports, 0)).toMatchObject({
      command: 'scenario',
      scenarios: [{ scenarioId: selected.id, durationMs: 75 }],
    });
  });

  it('writes a partial report when preflight fails before endpoint or Matrix work', async () => {
    const preflight: PreflightResult = {
      ok: false,
      exitCode: 2,
      code: 'MINIMAX_KEY_MISSING',
      checks: [
        ...CANONICAL_PREFLIGHT_CHECK_IDS.slice(0, -1).map((check) => ({
          check,
          status: 'passed' as const,
        })),
        { check: 'minimax_probe', status: 'failed', code: 'MINIMAX_KEY_MISSING' },
      ],
    };
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      preflight: vi.fn(async () => preflight),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['full'], harness.dependencies)).resolves.toBe(2);

    expect(harness.runEndpoint).not.toHaveBeenCalled();
    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      command: 'full',
      status: 'infrastructure_failure',
      exitCode: 2,
      preflight: { status: 'failed', code: 'MINIMAX_KEY_MISSING' },
      totals: { scenarioCount: 0 },
      scenarios: [],
      failures: [{ stage: 'preflight', code: 'MINIMAX_KEY_MISSING' }],
    });
    expect(harness.stderr.mock.calls).toContainEqual([
      'evaluation result INFRASTRUCTURE_FAILURE exit 2',
    ]);
  });

  it('stops full before Matrix after endpoint behavioral failure and preserves the report', async () => {
    const endpointResults = [
      lifecycleFor(SCENARIOS[0], 'behavioral_failure'),
      lifecycleFor(SCENARIOS[1], 'passed'),
    ];
    const matrixResult = matrixResultFor('passed');
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async () =>
        timedCorpus(endpointResults, {
          'intex-eval-001': 125,
          'intex-eval-002': 250,
        })
      ),
      runMatrixSmoke: vi.fn(async () => matrixResult),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['full'], harness.dependencies)).resolves.toBe(1);

    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      status: 'behavioral_failure',
      exitCode: 1,
      scenarios: [{ status: 'behavioral_failure' }, { status: 'passed' }],
    });
    expect(report).not.toHaveProperty('matrixSmoke');
    expect(harness.stdout.mock.calls).not.toContainEqual(['matrix-smoke PASS']);
    expect(harness.stdout.mock.calls).toContainEqual([
      'evaluation result BEHAVIORAL_FAILURE exit 1',
    ]);
  });

  it('aggregates endpoint and Matrix judge usage exactly once with independent provider totals', async () => {
    const endpointResult = lifecycleFor(SCENARIOS[0], 'passed');
    const endpointUsage: JudgeUsageSummary = {
      logicalCalls: 2,
      repairCount: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 20,
      providerReportedUsd: 0.003,
      providerReportedUsdComplete: true,
    };
    setLifecycleJudgeUsage(endpointResult, endpointUsage);
    const matrixResult = matrixResultFor('passed');
    const matrixUsage: JudgeUsageSummary = {
      logicalCalls: 1,
      repairCount: 0,
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 15,
      providerReportedUsd: 0.004,
      providerReportedUsdComplete: true,
    };
    setMatrixJudgeUsage(matrixResult, matrixUsage);
    const reports: EvaluationReportV1[] = [];
    const preflight = passingPreflight();
    preflight.summary.scenarioCount = 1;
    const harness = createHarness({
      preflight: vi.fn(async () => preflight),
      runEndpoint: vi.fn(async () => timedCorpus([endpointResult], { 'intex-eval-001': 125 })),
      runMatrixSmoke: vi.fn(async () => matrixResult),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(EvaluationReportV1Schema.parse(report));
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['full'], harness.dependencies)).resolves.toBe(0);

    const report = requiredItem(reports, 0);
    expect(report.judgeUsage).toEqual({
      callCount: 3,
      repairCount: 1,
      inputTokens: 17,
      outputTokens: 8,
      totalTokens: 35,
      providerReportedUsd: 0.007,
      providerReportedUsdComplete: true,
    });
    expect(report.judgeUsage.totalTokens).not.toBe(
      report.judgeUsage.inputTokens + report.judgeUsage.outputTokens
    );
    expect(report.matrixSmoke?.judgeUsage).toEqual({
      callCount: 1,
      repairCount: 0,
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 15,
      providerReportedUsd: 0.004,
      providerReportedUsdComplete: true,
    });
  });

  it('retains failed Matrix judge usage and marks aggregate provider cost incomplete', async () => {
    const endpointResult = lifecycleFor(SCENARIOS[0], 'passed');
    setLifecycleJudgeUsage(endpointResult, {
      logicalCalls: 1,
      repairCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 20,
      providerReportedUsd: 0.003,
      providerReportedUsdComplete: true,
    });
    const matrixResult: MatrixSmokeResult = {
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MINIMAX_JUDGE_TIMEOUT'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
      judge: {
        status: 'infrastructure_failure',
        code: 'MINIMAX_JUDGE_TIMEOUT',
        usage: {
          logicalCalls: 2,
          repairCount: 1,
          inputTokens: 7,
          outputTokens: 3,
          totalTokens: 15,
          providerReportedUsd: 0.004,
          providerReportedUsdComplete: false,
        },
      },
      durationMs: 80,
    };
    const reports: EvaluationReportV1[] = [];
    const preflight = passingPreflight();
    preflight.summary.scenarioCount = 1;
    const harness = createHarness({
      preflight: vi.fn(async () => preflight),
      runEndpoint: vi.fn(async () => timedCorpus([endpointResult], { 'intex-eval-001': 125 })),
      runMatrixSmoke: vi.fn(async () => matrixResult),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(EvaluationReportV1Schema.parse(report));
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['full'], harness.dependencies)).resolves.toBe(2);

    const report = requiredItem(reports, 0);
    expect(report.judgeUsage).toEqual({
      callCount: 3,
      repairCount: 1,
      inputTokens: 17,
      outputTokens: 8,
      totalTokens: 35,
      providerReportedUsd: 0.007,
      providerReportedUsdComplete: false,
    });
    expect(report.matrixSmoke?.judgeUsage.providerReportedUsdComplete).toBe(false);
    expect(report.failures).toContainEqual({
      stage: 'judge',
      code: 'MINIMAX_JUDGE_TIMEOUT',
    });
  });

  it('stops full before Matrix after endpoint infrastructure and preserves the partial report', async () => {
    const endpointResult = lifecycleFor(SCENARIOS[0], 'infrastructure_failure');
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async () => timedCorpus([endpointResult], { 'intex-eval-001': 125 })),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['full'], harness.dependencies)).resolves.toBe(2);

    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      status: 'infrastructure_failure',
      exitCode: 2,
      scenarios: [{ scenarioId: 'intex-eval-001', status: 'infrastructure_failure' }],
      failures: [{ stage: 'endpoint', code: 'endpoint_timeout', scenarioId: 'intex-eval-001' }],
    });
    expect(report).not.toHaveProperty('matrixSmoke');
  });

  it('publishes one strict partial full report when the endpoint runner throws', async () => {
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async () => {
        throw new Error('private-endpoint-runner-error-sentinel');
      }),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(EvaluationReportV1Schema.parse(report));
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['full'], harness.dependencies)).resolves.toBe(2);

    expect(harness.runEndpoint).toHaveBeenCalledOnce();
    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    expect(harness.writeReport).toHaveBeenCalledOnce();
    const report = requiredItem(reports, 0);
    expect(report).toMatchObject({
      command: 'full',
      status: 'infrastructure_failure',
      exitCode: 2,
      scenarios: [],
      failures: expect.arrayContaining([{ stage: 'endpoint', code: 'endpoint_failed' }]),
    });
    expect(harness.stderr.mock.calls).not.toContainEqual([
      'evaluation report FAIL REPORTING_FAILED',
    ]);
    expect(harness.outputText()).not.toContain('private-endpoint-runner-error-sentinel');
  });

  it('runs Matrix after a passed endpoint corpus and reports Matrix infrastructure failure', async () => {
    const endpointResults = [
      lifecycleFor(SCENARIOS[0], 'passed'),
      lifecycleFor(SCENARIOS[1], 'passed'),
    ];
    const matrixResult = matrixResultFor('infrastructure_failure');
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async () =>
        timedCorpus(endpointResults, {
          'intex-eval-001': 125,
          'intex-eval-002': 250,
        })
      ),
      runMatrixSmoke: vi.fn(async () => matrixResult),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['full'], harness.dependencies)).resolves.toBe(2);

    expect(harness.runMatrixSmoke).toHaveBeenCalledOnce();
    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      status: 'infrastructure_failure',
      exitCode: 2,
      scenarios: [{ status: 'passed' }, { status: 'passed' }],
      matrixSmoke: { status: 'infrastructure_failure', exitCode: 2 },
    });
    expect(report.failures).toContainEqual({
      stage: 'matrix_smoke',
      code: 'MATRIX_REPLY_TIMEOUT',
    });
  });

  it('runs matrix-smoke exactly once without loading or running endpoint scenarios', async () => {
    const matrixResult = matrixResultFor('behavioral_failure');
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runMatrixSmoke: vi.fn(async () => matrixResult),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['matrix-smoke'], harness.dependencies)).resolves.toBe(1);

    expect(harness.loadScenarios).not.toHaveBeenCalled();
    expect(harness.runEndpoint).not.toHaveBeenCalled();
    expect(harness.runMatrixSmoke).toHaveBeenCalledOnce();
    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      command: 'matrix-smoke',
      status: 'behavioral_failure',
      exitCode: 1,
      scenarios: [],
      matrixSmoke: {
        status: 'behavioral_failure',
        judge: { pass: false, failures: ['unhelpful'] },
      },
      failures: [{ stage: 'judge', code: 'unhelpful' }],
    });
  });

  it.each(['passed', 'behavioral_failure'] as const)(
    'upgrades a %s primary result when report publication fails without mutating the report input',
    async (kind) => {
      const lifecycle = lifecycleFor(SCENARIOS[0], kind);
      const reports: EvaluationReportV1[] = [];
      const harness = createHarness({
        runEndpoint: vi.fn(async () => timedCorpus([lifecycle], { 'intex-eval-001': 125 })),
        writeReport: vi.fn(async (report: EvaluationReportV1) => {
          reports.push(structuredClone(report));
          return { ok: false as const, code: 'REPORTING_FAILED' as const };
        }),
      });

      await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(2);

      expect(requiredItem(reports, 0)).toMatchObject({
        status: kind,
        exitCode: kind === 'passed' ? 0 : 1,
      });
      expect(harness.stdout.mock.calls).not.toContainEqual([
        expect.stringContaining('evaluation report .artifacts'),
      ]);
      expect(harness.stderr.mock.calls.slice(-2)).toEqual([
        ['evaluation result INFRASTRUCTURE_FAILURE exit 2'],
        ['evaluation report FAIL REPORTING_FAILED'],
      ]);
    }
  );

  it('normalizes a thrown writer to reporting failure and never prints its cause', async () => {
    const lifecycle = lifecycleFor(SCENARIOS[0], 'passed');
    const harness = createHarness({
      runEndpoint: vi.fn(async () => timedCorpus([lifecycle], { 'intex-eval-001': 125 })),
      writeReport: vi.fn(async () => {
        throw new Error('private-report-error-sentinel');
      }),
    });

    await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(2);

    expect(harness.stderr.mock.calls.slice(-2)).toEqual([
      ['evaluation result INFRASTRUCTURE_FAILURE exit 2'],
      ['evaluation report FAIL REPORTING_FAILED'],
    ]);
    expect(harness.outputText()).not.toContain('private-report-error-sentinel');
  });

  it('retains coherent failed-judge verdicts and paid-call usage without sensitive fields', async () => {
    const lifecycle = failedJudgeLifecycle(SCENARIOS[0]);
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async () => timedCorpus([lifecycle], { 'intex-eval-001': 375 })),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(2);

    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      status: 'infrastructure_failure',
      judgeUsage: {
        callCount: 2,
        repairCount: 1,
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        providerReportedUsd: 0.002,
        providerReportedUsdComplete: false,
      },
      totals: { judgeVerdictCount: 1 },
      scenarios: [
        {
          durationMs: 375,
          judgeVerdicts: [{ turnIndex: 0, replyIndex: 0, pass: true }],
        },
      ],
      failures: [
        {
          stage: 'judge',
          code: 'MINIMAX_JUDGE_TIMEOUT',
          scenarioId: 'intex-eval-001',
          turnIndex: 0,
          replyIndex: 1,
        },
      ],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private-rationale-sentinel');
    expect(serialized).not.toContain('private-assistant-text-sentinel');
  });

  it('retains behavior evidence when later cleanup failure upgrades the scenario', async () => {
    const lifecycle = lifecycleFor(SCENARIOS[0], 'behavioral_failure');
    lifecycle.cleanup = {
      status: 'infrastructure_failure',
      code: 'cleanup_count_mismatch',
      deleted: 1,
      total: 2,
    };
    lifecycle.effectiveKind = 'infrastructure_failure';
    lifecycle.exitCode = 2;
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async () => timedCorpus([lifecycle], { 'intex-eval-001': 125 })),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(2);

    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(report.scenarios[0]).toMatchObject({
      status: 'infrastructure_failure',
      deterministicFailures: [{ code: 'forbidden_tool_called', turnIndex: 0 }],
      judgeVerdicts: [{ pass: false, failures: ['unhelpful'] }],
      cleanup: {
        status: 'infrastructure_failure',
        code: 'cleanup_count_mismatch',
        deleted: 1,
        total: 2,
      },
    });
    expect(report.failures).toEqual(
      expect.arrayContaining([
        {
          stage: 'deterministic',
          code: 'forbidden_tool_called',
          scenarioId: 'intex-eval-001',
          turnIndex: 0,
        },
        {
          stage: 'judge',
          code: 'unhelpful',
          scenarioId: 'intex-eval-001',
          turnIndex: 0,
          replyIndex: 0,
        },
        {
          stage: 'cleanup',
          code: 'cleanup_count_mismatch',
          scenarioId: 'intex-eval-001',
        },
      ])
    );
  });

  it('projects exact deterministic assertion paths without expected, actual, or private values', async () => {
    const lifecycle = lifecycleFor(SCENARIOS[0], 'behavioral_failure');
    if (lifecycle.primary.deterministic.status !== 'completed') {
      throw new Error('Expected completed deterministic evaluation');
    }
    lifecycle.primary.deterministic.value.failures = [
      {
        code: 'tool_argument_assertion_failed',
        scenarioId: 'intex-eval-001',
        turnIndex: 0,
        path: 'contentLength',
        expected: 'private-expected-value-sentinel',
        actual: 'private-actual-value-sentinel',
      },
    ];
    const privatePathLifecycle = lifecycleFor(SCENARIOS[1], 'behavioral_failure');
    if (privatePathLifecycle.primary.deterministic.status !== 'completed') {
      throw new Error('Expected completed deterministic evaluation');
    }
    privatePathLifecycle.primary.deterministic.value.failures = [
      {
        code: 'tool_argument_assertion_failed',
        scenarioId: 'intex-eval-002',
        turnIndex: 0,
        path: 'private-tool-argument-path-sentinel',
      },
    ];
    const reports: EvaluationReportV1[] = [];
    const harness = createHarness({
      runEndpoint: vi.fn(async () =>
        timedCorpus([lifecycle, privatePathLifecycle], {
          'intex-eval-001': 125,
          'intex-eval-002': 250,
        })
      ),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(1);

    const report = requiredItem(reports, 0);
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
    expect(requiredItem(report.scenarios, 0).deterministicFailures).toEqual([
      { code: 'tool_argument_assertion_failed', turnIndex: 0, path: 'contentLength' },
    ]);
    expect(report.failures).toContainEqual({
      stage: 'deterministic',
      code: 'tool_argument_assertion_failed',
      scenarioId: 'intex-eval-001',
      turnIndex: 0,
      path: 'contentLength',
    });
    expect(requiredItem(report.scenarios, 1).deterministicFailures).toEqual([
      { code: 'tool_argument_assertion_failed', turnIndex: 0 },
    ]);
    expect(report.failures).toContainEqual({
      stage: 'deterministic',
      code: 'tool_argument_assertion_failed',
      scenarioId: 'intex-eval-002',
      turnIndex: 0,
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private-(?:expected|actual)-value-sentinel|private-tool-argument-path-sentinel|"expected"|"actual"/u
    );
  });

  it('rejects an unsafe generated report ID before preflight or paid work', async () => {
    const harness = createHarness({ createReportRunId: vi.fn(() => '../private-run-id') });

    await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(2);

    expect(harness.preflight).not.toHaveBeenCalled();
    expect(harness.runEndpoint).not.toHaveBeenCalled();
    expect(harness.runMatrixSmoke).not.toHaveBeenCalled();
    expect(harness.writeReport).not.toHaveBeenCalled();
    expect(harness.stderr).toHaveBeenCalledWith('cli result FAIL UNEXPECTED_FAILURE');
    expect(harness.outputText()).not.toContain('private-run-id');
  });

  it.each(['eval-safe-', 'eval.safe.'])(
    'accepts the complete safe report-ID grammar for %s',
    async (runId) => {
      const reports: EvaluationReportV1[] = [];
      const lifecycleResults = SCENARIOS.map((scenario) => lifecycleFor(scenario, 'passed'));
      const harness = createHarness({
        createReportRunId: vi.fn(() => runId),
        runEndpoint: vi.fn(async () =>
          timedCorpus(lifecycleResults, {
            'intex-eval-001': 125,
            'intex-eval-002': 250,
          })
        ),
        writeReport: vi.fn(async (report: EvaluationReportV1) => {
          reports.push(report);
          return reportSuccess(report.runId);
        }),
      });

      await expect(runCli(['endpoint'], harness.dependencies)).resolves.toBe(0);

      const report = requiredItem(reports, 0);
      expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
      expect(report.runId).toBe(runId);
    }
  );
});

describe('createProductionCliDependencies', () => {
  it('constructs nothing for invalid input and setup never constructs MiniMax or evaluation dependencies', async () => {
    const matrix = fakeMatrixClient();
    const setupPorts = { marker: 'setup-ports' } as unknown as preflightModule.SetupPorts;
    const createMatrixClient = vi
      .spyOn(matrixClientModule, 'createMatrixClient')
      .mockReturnValue(matrix);
    const createMiniMaxEvaluator = vi.spyOn(miniMaxModule, 'createMiniMaxEvaluator');
    const createSetupPorts = vi
      .spyOn(preflightModule, 'createProductionSetupPorts')
      .mockReturnValue(setupPorts);
    const createPreflightPorts = vi.spyOn(preflightModule, 'createProductionPreflightPorts');
    const setupEvaluator = vi
      .spyOn(preflightModule, 'setupEvaluatorConfig')
      .mockResolvedValue(passingSetup());
    const createEndpointClient = vi.spyOn(endpointClientModule, 'createEndpointClient');
    const createCleanupPort = vi.spyOn(endpointScenarioModule, 'createCleanupPort');
    const createMatrixRunner = vi.spyOn(matrixSmokeModule, 'createProductionMatrixSmokeRunner');
    const createReportWriter = vi.spyOn(reportWriterModule, 'createReportWriter');
    const dependencies = createProductionCliDependencies();
    const stdout = vi.fn<(line: string) => void>();
    const stderr = vi.fn<(line: string) => void>();
    const setupInput = createSetupInput();
    dependencies.output = { stdout, stderr };
    dependencies.setupInput = setupInput;

    await expect(runCli(['--invalid'], dependencies)).resolves.toBe(2);

    expect(createMatrixClient).not.toHaveBeenCalled();
    expect(createMiniMaxEvaluator).not.toHaveBeenCalled();
    expect(createSetupPorts).not.toHaveBeenCalled();
    expect(createPreflightPorts).not.toHaveBeenCalled();
    expect(createEndpointClient).not.toHaveBeenCalled();
    expect(createCleanupPort).not.toHaveBeenCalled();
    expect(createMatrixRunner).not.toHaveBeenCalled();
    expect(createReportWriter).not.toHaveBeenCalled();

    await expect(runCli(['setup'], dependencies)).resolves.toBe(0);

    expect(createMatrixClient).toHaveBeenCalledOnce();
    expect(createSetupPorts).toHaveBeenCalledOnce();
    expect(createSetupPorts).toHaveBeenCalledWith({ matrix });
    expect(setupEvaluator).toHaveBeenCalledOnce();
    expect(createMiniMaxEvaluator).not.toHaveBeenCalled();
    expect(createPreflightPorts).not.toHaveBeenCalled();
    expect(createEndpointClient).not.toHaveBeenCalled();
    expect(createCleanupPort).not.toHaveBeenCalled();
    expect(createMatrixRunner).not.toHaveBeenCalled();
    expect(createReportWriter).not.toHaveBeenCalled();
  });

  it('keeps preflight LLM-free and shares one MiniMax evaluator across endpoint and smoke judges', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T10:00:00.000Z'));
    vi.stubEnv('INTEXURAOS_OPENROUTER_APP_API_KEY', 'openrouter-key-sentinel');
    vi.stubEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN', 'internal-token-sentinel');
    const matrix = fakeMatrixClient();
    const evaluator = fakeMiniMaxEvaluator();
    const endpoint = {
      runScenario: vi.fn(async (scenario: IntexEvalScenario) => endpointResponseFor(scenario)),
    };
    const cleanup = { cleanup: vi.fn(async () => ({ deleted: 1, total: 1 })) };
    const preflightPorts = {
      marker: 'preflight-ports',
    } as unknown as preflightModule.PreflightPorts;
    const matrixResult = matrixResultFor('passed');
    const matrixRunner = vi.fn(async () => matrixResult);
    const writer = vi.fn(async (report: EvaluationReportV1) => reportSuccess(report.runId));

    const createMatrixClient = vi
      .spyOn(matrixClientModule, 'createMatrixClient')
      .mockReturnValue(matrix);
    const createMiniMaxEvaluator = vi
      .spyOn(miniMaxModule, 'createMiniMaxEvaluator')
      .mockReturnValue(evaluator);
    const createPreflightPorts = vi
      .spyOn(preflightModule, 'createProductionPreflightPorts')
      .mockReturnValue(preflightPorts);
    const runPreflight = vi
      .spyOn(preflightModule, 'runPreflight')
      .mockResolvedValue(passingPreflight());
    const loadCatalog = vi
      .spyOn(scenarioCatalogModule, 'loadScenarioCatalog')
      .mockResolvedValue([SCENARIOS[0]]);
    const createEndpointClient = vi
      .spyOn(endpointClientModule, 'createEndpointClient')
      .mockReturnValue(endpoint);
    const createCleanupPort = vi
      .spyOn(endpointScenarioModule, 'createCleanupPort')
      .mockReturnValue(cleanup);
    const runScenario = vi
      .spyOn(endpointScenarioModule, 'runEndpointScenario')
      .mockImplementation(async (scenario) => {
        vi.setSystemTime(new Date('2026-07-16T10:00:00.321Z'));
        return lifecycleFor(scenario, 'passed');
      });
    const runCorpus = vi.spyOn(endpointCorpusModule, 'runEndpointCorpus');
    const createMatrixRunner = vi
      .spyOn(matrixSmokeModule, 'createProductionMatrixSmokeRunner')
      .mockReturnValue(matrixRunner);
    const createReportWriter = vi
      .spyOn(reportWriterModule, 'createReportWriter')
      .mockReturnValue(writer);
    const dependencies = createProductionCliDependencies();
    const stdout = vi.fn<(line: string) => void>();
    const stderr = vi.fn<(line: string) => void>();
    dependencies.output = { stdout, stderr };

    await expect(runCli(['full'], dependencies)).resolves.toBe(0);

    expect(loadCatalog).toHaveBeenCalledOnce();
    expect(createMatrixClient).toHaveBeenCalledOnce();
    expect(createMiniMaxEvaluator).toHaveBeenCalledOnce();
    expect(createMiniMaxEvaluator).toHaveBeenCalledWith({ apiKey: 'openrouter-key-sentinel' });
    expect(createPreflightPorts).toHaveBeenCalledOnce();
    expect(createPreflightPorts).toHaveBeenCalledWith({
      matrix,
    });
    expect(runPreflight).toHaveBeenCalledWith(preflightPorts);
    expect(createEndpointClient).toHaveBeenCalledOnce();
    expect(createEndpointClient).toHaveBeenCalledWith({
      internalAuthToken: 'internal-token-sentinel',
      timeoutMs: 300_000,
    });
    expect(createCleanupPort).toHaveBeenCalledOnce();
    expect(createCleanupPort).toHaveBeenCalledWith();
    expect(runCorpus).toHaveBeenCalledOnce();
    expect(runScenario).toHaveBeenCalledOnce();
    const scenarioDependencies = requiredItem(runScenario.mock.calls, 0)[1];
    expect(scenarioDependencies).toMatchObject({
      endpoint,
      cleanup,
      evaluateDeterministically: deterministicEvaluatorModule.evaluateDeterministically,
      judgeReplies: evaluator.judgeReplies,
      createIdentity: endpointClientModule.createSyntheticRunIdentity,
    });
    expect(createMatrixRunner).toHaveBeenCalledOnce();
    expect(createMatrixRunner).toHaveBeenCalledWith({
      matrix,
      judgeMatrixSmokeReply: evaluator.judgeMatrixSmokeReply,
    });
    expect(matrixRunner).toHaveBeenCalledOnce();
    expect(createReportWriter).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledOnce();
    expect(requiredItem(writer.mock.calls, 0)[0].scenarios).toMatchObject([
      { scenarioId: 'intex-eval-001', durationMs: 321 },
    ]);
    expect(stdout.mock.calls).toContainEqual(['matrix-smoke PASS']);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('silent cleanup integration', () => {
  it('runs the real cleanup adapter without forwarding its summary to CLI output', async () => {
    const reports: EvaluationReportV1[] = [];
    const parsed = { safe: 'parsed-cleanup-input' };
    const parseArgs = vi.fn(() => parsed);
    const runCleanup = vi.fn(
      async (_input: unknown, output?: { writeLine(line: string): void }) => {
        output?.writeLine('private-cleanup-output-sentinel');
        return { deleted: 1, total: 1 };
      }
    );
    const cleanup = endpointScenarioModule.createCleanupPort(
      vi.fn(async () => ({ parseArgs, runCleanup }))
    );
    const harness = createHarness({
      runEndpoint: vi.fn(async (scenarios: readonly IntexEvalScenario[]) => {
        const scenario = requiredItem(scenarios, 0);
        const lifecycle = await endpointScenarioModule.runEndpointScenario(scenario, {
          endpoint: {
            runScenario: vi.fn(async () => endpointResponseFor(scenario)),
          },
          evaluateDeterministically: deterministicEvaluatorModule.evaluateDeterministically,
          judgeReplies: vi.fn(async (inputs: readonly ReplyEvaluationInput[]) => ({
            ok: true as const,
            verdicts: inputs.map((input) =>
              judgeVerdictFor(input.scenarioId, input.turnIndex, input.replyIndex, true)
            ),
            usage: { ...zeroJudgeUsage(), logicalCalls: inputs.length },
          })),
          cleanup,
          createIdentity: () => identityFor(scenario),
        });
        return timedCorpus([lifecycle], { [scenario.id]: 25 });
      }),
      writeReport: vi.fn(async (report: EvaluationReportV1) => {
        reports.push(report);
        return reportSuccess(report.runId);
      }),
    });

    await expect(runCli(['scenario', SCENARIOS[0].id], harness.dependencies)).resolves.toBe(1);

    expect(parseArgs).toHaveBeenCalledWith([
      '--user-id',
      identityFor(SCENARIOS[0]).userId,
      '--run-id',
      identityFor(SCENARIOS[0]).runId,
      '--execute',
    ]);
    expect(runCleanup).toHaveBeenCalledOnce();
    expect(runCleanup.mock.calls[0]?.[1]).toEqual({ writeLine: expect.any(Function) });
    expect(EvaluationReportV1Schema.parse(requiredItem(reports, 0))).toEqual(reports[0]);
    expect(harness.outputText()).not.toContain('private-cleanup-output-sentinel');
  });
});

const PASS_CRITERIA = {
  understoodIntent: true,
  helpful: true,
  conciseAndClear: true,
  professionalTone: true,
  noPassiveAggression: true,
} as const;

const FAIL_CRITERIA = {
  understoodIntent: true,
  helpful: false,
  conciseAndClear: true,
  professionalTone: true,
  noPassiveAggression: true,
} as const;

function fakeMatrixClient(): matrixClientModule.MatrixClient {
  return {
    whoAmI: vi.fn(async () => ({ ok: true as const, userId: '@safe:test.invalid' })),
    syncTargetRoom: vi.fn(async () => ({
      ok: true as const,
      nextBatch: 'safe-next-batch',
      limited: false,
      events: [],
    })),
  };
}

function fakeMiniMaxEvaluator(): miniMaxModule.MiniMaxEvaluator {
  return {
    probe: vi.fn(async () => ({ ok: true as const })),
    judgeReplies: vi.fn(async () => ({
      ok: true as const,
      verdicts: [],
      usage: zeroJudgeUsage(),
    })),
    judgeMatrixSmokeReply: vi.fn(async () => ({
      ok: true as const,
      verdict: {
        pass: true,
        score: 5,
        criteria: PASS_CRITERIA,
        failures: [],
        rationale: 'safe synthetic rationale',
      },
      usage: zeroJudgeUsage(),
    })),
  };
}

function zeroJudgeUsage(): JudgeUsageSummary {
  return {
    logicalCalls: 0,
    repairCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    providerReportedUsd: 0,
    providerReportedUsdComplete: true,
  };
}

function lifecycleFor(
  scenario: IntexEvalScenario,
  kind: ScenarioLifecycleResult['effectiveKind']
): ScenarioLifecycleResult {
  const identity = identityFor(scenario);
  if (kind === 'infrastructure_failure') {
    return {
      scenarioId: scenario.id,
      identity: { status: 'completed', value: identity },
      primary: {
        kind,
        endpoint: { status: 'infrastructure_failure', code: 'endpoint_timeout' },
        deterministic: { status: 'not_run' },
        judge: { status: 'not_run' },
      },
      cleanup: { status: 'passed', deleted: 1, total: 1 },
      effectiveKind: kind,
      exitCode: 2,
    };
  }

  const behavior = kind === 'behavioral_failure';
  const response = endpointResponseFor(scenario);
  const verdict = judgeVerdictFor(scenario.id, 0, 0, !behavior);
  return {
    scenarioId: scenario.id,
    identity: { status: 'completed', value: identity },
    primary: {
      kind,
      endpoint: { status: 'completed', value: response },
      deterministic: {
        status: 'completed',
        value: {
          passed: !behavior,
          failures: behavior
            ? [
                {
                  code: 'forbidden_tool_called',
                  scenarioId: scenario.id,
                  turnIndex: 0,
                  path: 'private-argument-sentinel',
                  expected: 0,
                  actual: 1,
                },
              ]
            : [],
          repliesForJudge: [replyInputFor(scenario.id, 0, 0, !behavior)],
        },
      },
      judge: {
        status: 'completed',
        value: {
          ok: true,
          verdicts: [verdict],
          usage: judgeUsage(),
        },
      },
    },
    cleanup: { status: 'passed', deleted: 1, total: 1 },
    effectiveKind: kind,
    exitCode: behavior ? 1 : 0,
  };
}

function failedJudgeLifecycle(scenario: IntexEvalScenario): ScenarioLifecycleResult {
  const identity = identityFor(scenario);
  const response = endpointResponseFor(scenario, 2);
  const usage: JudgeUsageSummary = {
    logicalCalls: 2,
    repairCount: 1,
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 30,
    providerReportedUsd: 0.002,
    providerReportedUsdComplete: false,
  };
  return {
    scenarioId: scenario.id,
    identity: { status: 'completed', value: identity },
    primary: {
      kind: 'infrastructure_failure',
      endpoint: { status: 'completed', value: response },
      deterministic: {
        status: 'completed',
        value: {
          passed: true,
          failures: [],
          repliesForJudge: [
            replyInputFor(scenario.id, 0, 0, true),
            replyInputFor(scenario.id, 0, 1, true),
          ],
        },
      },
      judge: {
        status: 'completed',
        value: {
          ok: false,
          code: 'MINIMAX_JUDGE_TIMEOUT',
          failedReply: { scenarioId: scenario.id, turnIndex: 0, replyIndex: 1 },
          completedVerdicts: [judgeVerdictFor(scenario.id, 0, 0, true)],
          usage,
        },
      },
    },
    cleanup: { status: 'passed', deleted: 1, total: 1 },
    effectiveKind: 'infrastructure_failure',
    exitCode: 2,
  };
}

function identityFor(scenario: IntexEvalScenario): SyntheticRunIdentity {
  return {
    runId: `${scenario.id}-123e4567-e89b-12d3-a456-426614174000`,
    userId: `test-intex-agent-${scenario.id}-123e4567-e89b-12d3-a456-426614174000`,
  };
}

function endpointResponseFor(
  scenario: IntexEvalScenario,
  replyCount = 1
): EndpointConversationResponse {
  const identity = identityFor(scenario);
  const sessionId = 'session-private-id-sentinel';
  const assistantReplies = Array.from({ length: replyCount }, (_, replyIndex) => ({
    userId: identity.userId,
    message: `private-assistant-text-sentinel-${String(replyIndex)}`,
    replyToMessageId: `private-reply-id-sentinel-${String(replyIndex)}`,
    correlationId: `private-correlation-id-sentinel-${String(replyIndex)}`,
  }));
  const toolCall = {
    toolName: 'create_note' as const,
    status: 'completed' as const,
    argsSummary: { privateArgument: 'private-argument-sentinel' },
    resultSummary: { safeCount: 1 },
  };
  const timelineEvent = {
    sessionId,
    id: 'timeline-private-id-sentinel',
    type: 'session_started' as const,
    createdAt: '2026-07-16T10:00:00.000Z',
    payload: { privatePayload: 'private-id-sentinel' },
  };
  return {
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    agentModel: 'or:deepseek/deepseek-v4-flash',
    runId: identity.runId,
    scenarioId: scenario.id,
    userId: identity.userId,
    finalSessionId: sessionId,
    turns: [
      {
        turnIndex: 0,
        kind: 'message',
        messageId: 'message-private-id-sentinel',
        sessionId,
        submittedTextPreview: 'private-user-text-sentinel',
        assistantReplies,
        toolCalls: [toolCall],
        sessionAfterTurn: {
          id: sessionId,
          status: 'waiting_for_user',
          startReason: 'no_active_session',
          activeTool: 'create_note',
        },
        timelineEvents: [timelineEvent],
      },
    ],
    toolCalls: [toolCall],
    sessions: [
      {
        id: sessionId,
        userId: identity.userId,
        channel: 'whatsapp',
        status: 'waiting_for_user',
        startedAt: '2026-07-16T10:00:00.000Z',
        lastUserMessageAt: '2026-07-16T10:00:00.000Z',
        lastAssistantMessageAt: '2026-07-16T10:00:01.000Z',
        startReason: 'no_active_session',
        activeTool: 'create_note',
      },
    ],
    sessionTransitions: [{ turnIndex: 0, action: 'started', sessionId }],
    eventsBySessionId: {
      [sessionId]: [
        {
          id: timelineEvent.id,
          type: timelineEvent.type,
          createdAt: timelineEvent.createdAt,
          payload: timelineEvent.payload,
        },
      ],
    },
    behavioralTranscript: {
      turns: [
        {
          turnIndex: 0,
          submittedTextPreview: 'private-user-text-sentinel',
          assistantReplyPreviews: assistantReplies.map((reply) => reply.message),
          sessionAction: 'started',
          toolOutcome: { toolName: 'create_note', status: 'completed' },
        },
      ],
    },
    sideEffectBoundary: 'mocked_tools_no_downstream_writes',
    warnings: [],
  };
}

function replyInputFor(
  scenarioId: string,
  turnIndex: number,
  replyIndex: number,
  passed: boolean
): ReplyEvaluationInput {
  return {
    scenarioId,
    turnIndex,
    replyIndex,
    assistantText: 'private-assistant-text-sentinel',
    semanticCriteria: ['Synthetic criterion'],
    technicalFacts: {
      turnPassed: passed,
      failureCodes: passed ? [] : ['forbidden_tool_called'],
      tools: [
        {
          toolName: 'create_note' as const,
          expectation: 'required' as const,
          expectedCount: 1,
          actualCount: 1,
          actualStatuses: ['completed' as const],
          argumentAssertions: 'passed' as const,
          syntheticMarkerEvidence: 'passed' as const,
        },
      ],
      transition: {
        expectedAction: 'started' as const,
        actualAction: 'started' as const,
        outcome: 'passed' as const,
      },
      session: {
        allowedStatuses: ['waiting_for_user' as const],
        actualStatus: 'waiting_for_user' as const,
        outcome: 'passed' as const,
      },
      timeline: {
        required: [{ eventType: 'session_started' as const, outcome: 'passed' as const }],
        forbidden: [],
        payloadGroups: [],
      },
      confirmationAction: 'none' as const,
      toolOutcome: { toolName: 'create_note' as const, status: 'completed' as const },
    },
  };
}

function judgeVerdictFor(
  scenarioId: string,
  turnIndex: number,
  replyIndex: number,
  pass: boolean
): JudgeReplyVerdict {
  return {
    scenarioId,
    turnIndex,
    replyIndex,
    pass,
    score: pass ? 5 : 2,
    criteria: pass ? PASS_CRITERIA : FAIL_CRITERIA,
    failures: pass ? [] : ['unhelpful'],
    rationale: 'private-rationale-sentinel',
  };
}

function judgeUsage(): JudgeUsageSummary {
  return {
    logicalCalls: 1,
    repairCount: 0,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    providerReportedUsd: 0.001,
    providerReportedUsdComplete: true,
  };
}

function setLifecycleJudgeUsage(
  lifecycle: ScenarioLifecycleResult,
  usage: JudgeUsageSummary
): void {
  if (lifecycle.primary.judge.status !== 'completed') {
    throw new Error('Expected completed lifecycle judge fixture');
  }
  lifecycle.primary.judge.value.usage = usage;
}

function setMatrixJudgeUsage(result: MatrixSmokeResult, usage: JudgeUsageSummary): void {
  if (result.judge.status !== 'completed') {
    throw new Error('Expected completed Matrix judge fixture');
  }
  result.judge.usage = usage;
}

function matrixResultFor(kind: MatrixSmokeResult['effectiveKind']): MatrixSmokeResult {
  if (kind === 'infrastructure_failure') {
    return {
      effectiveKind: kind,
      exitCode: 2,
      failureCodes: ['MATRIX_REPLY_TIMEOUT'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: false,
        hiddenToolAudit: 'not_available',
      },
      judge: { status: 'not_run' },
      durationMs: 80,
    };
  }
  const pass = kind === 'passed';
  return {
    effectiveKind: kind,
    exitCode: pass ? 0 : 1,
    failureCodes: [],
    transportFacts: {
      cursorCaptured: true,
      outboundSent: true,
      eligiblePuppetTextObserved: true,
      hiddenToolAudit: 'not_available',
    },
    judge: {
      status: 'completed',
      verdict: {
        pass,
        score: pass ? 5 : 2,
        criteria: pass ? PASS_CRITERIA : FAIL_CRITERIA,
        failures: pass ? [] : ['unhelpful'],
      },
      usage: judgeUsage(),
    },
    durationMs: 80,
  };
}

function timedCorpus(
  scenarios: ScenarioLifecycleResult[],
  scenarioDurationMs: Readonly<Record<string, number>>
): TimedEndpointCorpusResult {
  const effectiveKind = scenarios.some(
    (scenario) => scenario.effectiveKind === 'infrastructure_failure'
  )
    ? 'infrastructure_failure'
    : scenarios.some((scenario) => scenario.effectiveKind === 'behavioral_failure')
      ? 'behavioral_failure'
      : 'passed';
  const exitCode = effectiveKind === 'passed' ? 0 : effectiveKind === 'behavioral_failure' ? 1 : 2;
  return {
    result: { scenarios, effectiveKind, exitCode },
    scenarioDurationMs,
  };
}

function sequenceClock(...dates: Date[]): ClockPort {
  let index = 0;
  return {
    now: vi.fn(() => {
      const date = dates[index];
      index += 1;
      if (date === undefined) throw new Error('Unexpected clock read');
      return date;
    }),
  };
}

function reportSuccess(runId: string): Extract<ReportWriteResult, { ok: true }> {
  return {
    ok: true as const,
    relativeDirectory: `.artifacts/intex-agent-evals/${runId}`,
  };
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Expected fixture item');
  return item;
}

class FakeTtyInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  readonly rawModes: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.rawModes.push(mode);
    this.isRaw = mode;
    return this;
  }
}

class CapturingTtyOutput extends Writable {
  isTTY = true;
  readonly columns = 80;
  private readonly chunks: string[] = [];

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(String(chunk));
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

interface TestSetupInputPort extends SetupInputPort {
  isInteractive: ReturnType<typeof vi.fn<SetupInputPort['isInteractive']>>;
  readVisible: ReturnType<typeof vi.fn<SetupInputPort['readVisible']>>;
  readHidden: ReturnType<typeof vi.fn<SetupInputPort['readHidden']>>;
  close: ReturnType<typeof vi.fn<SetupInputPort['close']>>;
}

function createSetupInput(
  options: {
    interactive?: boolean;
    visible?: string;
    hidden?: Partial<
      Record<Exclude<Parameters<SetupInputPort['readHidden']>[0], 'account_alias'>, string>
    >;
  } = {}
): TestSetupInputPort {
  const hidden = {
    canonical_user_id: 'canonical-user',
    matrix_user_id: '@matrix:example.test',
    matrix_access_token_file: '/private/token',
    matrix_targets_file: '/private/targets',
    ...options.hidden,
  };
  return {
    isInteractive: vi.fn(() => options.interactive ?? true),
    readVisible: vi.fn(async () => options.visible ?? 'safe-account'),
    readHidden: vi.fn(async (prompt: Parameters<SetupInputPort['readHidden']>[0]) => {
      if (prompt === 'account_alias') throw new Error('Unexpected hidden prompt');
      return hidden[prompt];
    }),
    close: vi.fn(async () => undefined),
  } satisfies SetupInputPort;
}

interface CliHarness {
  dependencies: CliDependencies;
  stdout: ReturnType<typeof vi.fn<(line: string) => void>>;
  stderr: ReturnType<typeof vi.fn<(line: string) => void>>;
  setupInput: SetupInputPort;
  createReportRunId: CliDependencies['createReportRunId'];
  loadScenarios: CliDependencies['loadScenarios'];
  setup: CliDependencies['setup'];
  preflight: CliDependencies['preflight'];
  runEndpoint: CliDependencies['runEndpoint'];
  runMatrixSmoke: CliDependencies['runMatrixSmoke'];
  matrixCorpusPreflight: CliDependencies['matrixCorpusPreflight'];
  runMatrixCorpus: CliDependencies['runMatrixCorpus'];
  writeReport: CliDependencies['writeReport'];
  outputText(): string;
}

function createHarness(overrides: Partial<CliDependencies> = {}): CliHarness {
  const stdout = vi.fn<(line: string) => void>();
  const stderr = vi.fn<(line: string) => void>();
  const setupInput = overrides.setupInput ?? createSetupInput();
  const createReportRunId = vi.fn(() => 'eval-123e4567-e89b-12d3-a456-426614174000');
  const loadScenarios = vi.fn(async (): Promise<readonly IntexEvalScenario[]> => SCENARIOS);
  const setup = vi.fn(async (_candidate: unknown): Promise<SetupResult> => passingSetup());
  const preflight = vi.fn(async (): Promise<PreflightResult> => passingPreflight());
  const runEndpoint = vi.fn(async (_scenarios: readonly IntexEvalScenario[]) =>
    passingEndpointCorpus()
  );
  const runMatrixSmoke = vi.fn(async (): Promise<MatrixSmokeResult> => passingMatrixSmoke());
  const matrixCorpusPreflight = vi.fn(
    async (): Promise<MatrixCorpusPreflightResult> => ({
      ok: false,
      exitCode: 2,
      code: 'PREFLIGHT_UNEXPECTED_FAILURE',
    })
  );
  const runMatrixCorpus = vi.fn(
    async (): Promise<{ run: MatrixCorpusRunResult; reportReady: boolean }> => ({
      run: {
        runId: 'eval-123e4567-e89b-12d3-a456-426614174000',
        effectiveKind: 'infrastructure_failure',
        exitCode: 2,
        failureCodes: ['not_configured'],
        scenarios: [],
        totals: {
          completedTurns: 0,
          judgedReplies: 0,
          agentCostNanoUsd: 0,
          evaluatorCostNanoUsd: 0,
        },
        terminalAcknowledged: false,
        cleanupCompleted: false,
      },
      reportReady: false,
    })
  );
  const writeReport = vi.fn(async () => ({
    ok: true as const,
    relativeDirectory: '.artifacts/intex-agent-evals/eval-123e4567-e89b-12d3-a456-426614174000',
  }));
  const dependencies: CliDependencies = {
    output: { stdout, stderr },
    setupInput,
    clock: { now: vi.fn(() => new Date('2026-07-16T10:00:00.000Z')) },
    createReportRunId,
    loadScenarios,
    setup,
    preflight,
    runEndpoint,
    runMatrixSmoke,
    matrixCorpusPreflight,
    runMatrixCorpus,
    writeReport,
    ...overrides,
  };
  return {
    dependencies,
    stdout,
    stderr,
    setupInput,
    createReportRunId: dependencies.createReportRunId,
    loadScenarios: dependencies.loadScenarios,
    setup: dependencies.setup,
    preflight: dependencies.preflight,
    runEndpoint: dependencies.runEndpoint,
    runMatrixSmoke: dependencies.runMatrixSmoke,
    matrixCorpusPreflight: dependencies.matrixCorpusPreflight,
    runMatrixCorpus: dependencies.runMatrixCorpus,
    writeReport: dependencies.writeReport,
    outputText: (): string =>
      JSON.stringify({ stdout: stdout.mock.calls, stderr: stderr.mock.calls }),
  };
}

function passingSetup(): SetupResult {
  return {
    ok: true,
    exitCode: 0,
    state: 'created',
    accountAlias: 'safe-account',
    checks: [{ check: 'runtime', status: 'passed' }],
  };
}

function passingPreflight(): Extract<PreflightResult, { ok: true }> {
  return {
    ok: true,
    exitCode: 0,
    summary: {
      hostname: 'home-dev',
      ports: { intexAgent: 8134, whatsappService: 8113, matrixAdapter: 8099 },
      judgeModel: 'or:minimax/minimax-m3',
      scenarioCount: 2,
      accountAlias: 'safe-account',
    },
    checks: CANONICAL_PREFLIGHT_CHECK_IDS.map((check) => ({
      check,
      status: 'passed' as const,
    })),
  };
}

function passingEndpointCorpus(): TimedEndpointCorpusResult {
  return {
    result: { scenarios: [], effectiveKind: 'passed', exitCode: 0 },
    scenarioDurationMs: {},
  };
}

function passingMatrixSmoke(): MatrixSmokeResult {
  return {
    effectiveKind: 'passed',
    exitCode: 0,
    failureCodes: [],
    transportFacts: {
      cursorCaptured: true,
      outboundSent: true,
      eligiblePuppetTextObserved: true,
      hiddenToolAudit: 'not_available',
    },
    judge: { status: 'not_run' },
    durationMs: 10,
  };
}
