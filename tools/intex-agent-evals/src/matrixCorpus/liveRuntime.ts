import { execFile } from 'node:child_process';
import { lstat, realpath, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir, hostname, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { intexAgentToolNameV1Schema } from '@intexuraos/http-contracts';
import {
  createIntexAgentServiceClient,
  createWhatsAppServiceClient,
  type IntexAgentServiceClient,
  type InternalHttpClientLogger,
  type WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import {
  createOpenRouterCatalogClient,
  type OpenRouterCatalogClient,
} from '@intexuraos/infra-openrouter';

import {
  CONFIG_MAX_BYTES,
  createProductionSetupPorts,
  parseEvaluatorConfigContents,
  withValidatedAccountContext,
  type ValidatedAccountContext,
} from '../preflight.js';
import { isWhatsAppPuppetSender, type MatrixClient } from '../live/matrixClient.js';
import { loadCanonicalMatrixCorpus } from './catalog.js';
import {
  runMatrixCorpusPreflight,
  type MatrixCorpusPreflightResult,
  type MatrixCorpusPreflightSnapshot,
} from './preflight.js';
import type { MatrixCorpusRunResult } from './runMatrixCorpus.js';
import type { CanonicalMatrixCorpus } from './types.js';

const INTEX_AGENT_BASE_URL = 'http://127.0.0.1:8134';
const WHATSAPP_BASE_URL = 'http://127.0.0.1:8113';
const MIN_ARTIFACT_FREE_BYTES = 128 * 1024 * 1024;
const execFileAsync = promisify(execFile);
export const MATRIX_CORPUS_RUNTIME_CRITICAL_PATHS = [
  'apps/intex-agent/src/',
  'apps/whatsapp-service/src/',
  'apps/user-service/src/',
  'packages/',
  'tools/intex-agent-evals/',
  'scripts/run-intex-agent-evals-home-dev.sh',
  'package.json',
] as const;
const NO_OP_LOGGER: InternalHttpClientLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

export interface MatrixCorpusPreparedContext {
  readonly account: ValidatedAccountContext;
  readonly accountAlias: string;
  readonly expectedPuppetSender: string;
}

export interface MatrixCorpusLiveReadPort {
  read(catalog: CanonicalMatrixCorpus): Promise<{
    readonly snapshot: MatrixCorpusPreflightSnapshot;
    readonly prepared: MatrixCorpusPreparedContext;
  }>;
}

export interface MatrixCorpusLiveRuntime {
  preflight(): Promise<MatrixCorpusPreflightResult>;
  execute(input: {
    readonly runId: string;
    readonly preflight: Extract<MatrixCorpusPreflightResult, { ok: true }>;
  }): Promise<{
    readonly run: MatrixCorpusRunResult;
    readonly reportReady: boolean;
    readonly relativeReportDirectory?: string;
  }>;
}

export function createMatrixCorpusLiveRuntime(input: {
  readonly loadCatalog: () => Promise<CanonicalMatrixCorpus>;
  readonly read: MatrixCorpusLiveReadPort;
  readonly executePrepared: (input: {
    readonly runId: string;
    readonly preflight: Extract<MatrixCorpusPreflightResult, { ok: true }>;
    readonly prepared: MatrixCorpusPreparedContext;
  }) => Promise<{
    readonly run: MatrixCorpusRunResult;
    readonly reportReady: boolean;
    readonly relativeReportDirectory?: string;
  }>;
}): MatrixCorpusLiveRuntime {
  let prepared:
    | {
        readonly result: Extract<MatrixCorpusPreflightResult, { ok: true }>;
        readonly context: MatrixCorpusPreparedContext;
      }
    | undefined;

  return {
    async preflight(): Promise<MatrixCorpusPreflightResult> {
      prepared = undefined;
      let privateContext: MatrixCorpusPreparedContext | undefined;
      const catalogPromise = input.loadCatalog();
      const result = await runMatrixCorpusPreflight({
        loadCatalog: async () => await catalogPromise,
        read: {
          async readSnapshot(): Promise<unknown> {
            const catalog = await catalogPromise;
            const read = await input.read.read(catalog);
            privateContext = read.prepared;
            return read.snapshot;
          },
        },
      });
      if (result.ok && privateContext !== undefined) {
        prepared = { result, context: privateContext };
      }
      return result;
    },

    async execute(command): ReturnType<MatrixCorpusLiveRuntime['execute']> {
      const admitted = prepared;
      prepared = undefined;
      if (
        admitted?.result !== command.preflight ||
        admitted.result.catalog.catalogDigest !== command.preflight.catalog.catalogDigest
      ) {
        return {
          run: infrastructureFailure(command.runId, 'preflight_handoff_invalid'),
          reportReady: false,
        };
      }
      return await input.executePrepared({
        runId: command.runId,
        preflight: command.preflight,
        prepared: admitted.context,
      });
    },
  };
}

export function createProductionMatrixCorpusLiveReadPort(options: {
  readonly matrix: MatrixClient;
  readonly repositoryRoot: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly intex?: IntexAgentServiceClient;
  readonly whatsapp?: WhatsAppServiceClient;
  readonly catalog?: OpenRouterCatalogClient;
  readonly inspectRuntime?: () => Promise<{
    readonly ready: boolean;
    readonly deployedRevision: string;
    readonly criticalPathsClean: boolean;
  }>;
}): MatrixCorpusLiveReadPort {
  const env = options.env ?? process.env;
  const setup = createProductionSetupPorts({ matrix: options.matrix });
  const intex =
    options.intex ??
    createIntexAgentServiceClient({
      baseUrl: INTEX_AGENT_BASE_URL,
      internalAuthToken: env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
      defaultTimeoutMs: 10_000,
      logger: NO_OP_LOGGER,
    });
  const modelCatalog =
    options.catalog ??
    createOpenRouterCatalogClient({
      apiKey: env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '',
      logger: NO_OP_LOGGER,
    });
  const whatsapp =
    options.whatsapp ??
    createWhatsAppServiceClient({
      baseUrl: WHATSAPP_BASE_URL,
      internalAuthToken: env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
      defaultTimeoutMs: 10_000,
      logger: NO_OP_LOGGER,
    });

  return {
    async read(catalog): Promise<{
      snapshot: MatrixCorpusPreflightSnapshot;
      prepared: MatrixCorpusPreparedContext;
    }> {
      let account: ValidatedAccountContext | undefined;
      const accountResult = await withValidatedAccountContext(setup, (value): void => {
        account = value;
      });
      if (!accountResult.ok || account === undefined) throw new Error('account_not_ready');

      const configRead = await setup.protectedFiles.read(setup.configPath, {
        mode: 0o600,
        maxBytes: CONFIG_MAX_BYTES,
      });
      if (!configRead.ok) throw new Error('config_not_ready');
      const config = parseEvaluatorConfigContents(configRead.contents);
      if (!config.ok) throw new Error('config_not_ready');

      const cursorController = new AbortController();
      const cursorTimeout = setTimeout((): void => {
        cursorController.abort();
      }, 10_000);
      const [acceptance, liveCatalog, artifact, whatsappReadiness, runtime] = await Promise.all([
        intex.getMatrixCorpusCurrentAcceptance(account.userId),
        modelCatalog.getIntexAgentCatalogEvidence(),
        inspectArtifactRoot(join(options.repositoryRoot, '.artifacts', 'intex-agent-evals')),
        whatsapp.getMatrixCorpusReadiness(),
        (
          options.inspectRuntime ??
          ((): ReturnType<typeof inspectHomeDevRuntime> =>
            inspectHomeDevRuntime(options.repositoryRoot))
        )(),
      ]);
      let sync: Awaited<ReturnType<MatrixClient['syncTargetRoom']>>;
      try {
        sync = await options.matrix.syncTargetRoom({
          homeserverUrl: account.homeserverUrl,
          accessToken: account.accessToken,
          targetRoomId: account.targetRoomId,
          timeoutMs: 0,
          signal: cursorController.signal,
        });
      } finally {
        clearTimeout(cursorTimeout);
      }
      if (!sync.ok || sync.limited) throw new Error('matrix_not_ready');
      const puppetSenders = [
        ...new Set(sync.events.map((event) => event.sender).filter(isWhatsAppPuppetSender)),
      ];
      const expectedPuppetSender = puppetSenders[0];
      const evaluatorUserId = env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];
      const accountTupleCount =
        evaluatorUserId === account.userId && puppetSenders.length === 1 ? 1 : puppetSenders.length;
      const modelBoundaryReady =
        liveCatalog !== null &&
        liveCatalog.models.some((model) => model.id === catalog.agentModel) &&
        liveCatalog.models.some((model) => model.id === catalog.evaluatorModel);
      const catalogFetchedAt =
        liveCatalog === null ? Number.NaN : Date.parse(liveCatalog.fetchedAt);
      const clocksReady =
        Number.isFinite(catalogFetchedAt) && Math.abs(Date.now() - catalogFetchedAt) <= 10 * 60_000;

      return {
        snapshot: {
          requestedRevision: env['INTEXURAOS_EVAL_REQUESTED_REVISION'] ?? '',
          deployedRevision: runtime.deployedRevision,
          localCriticalPathsClean:
            env['INTEXURAOS_EVAL_WRAPPER_ATTESTED'] === 'true' &&
            env['INTEXURAOS_EVAL_LOCAL_CRITICAL_PATHS_CLEAN'] === 'true',
          remoteCriticalPathsClean: runtime.criticalPathsClean,
          runtimeAudience: runtime.ready
            ? (env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] ?? 'invalid')
            : 'invalid',
          environmentAlias: env['INTEXURAOS_ENVIRONMENT'] ?? 'invalid',
          protectedConfigReady: true,
          servicesReady: true,
          clocksReady,
          userReady: evaluatorUserId === account.userId,
          accountTupleCount,
          matrixReady: expectedPuppetSender !== undefined,
          whatsappReady: whatsappReadiness.ok,
          capabilityBoundaryReady: hasCapabilityBoundary(env),
          strictMockToolCount: intexAgentToolNameV1Schema.options.length,
          catalogDigest: catalog.catalogDigest,
          scenarioCount: catalog.scenarioCount,
          turnCount: catalog.turnCount,
          catalogMatchesTracked: true,
          agentModel: catalog.agentModel,
          evaluatorModel: catalog.evaluatorModel,
          modelBoundaryReady,
          runAdmission: mapAdmission(acceptance),
          artifactRootReady: artifact.ready,
          artifactCapacityReady: artifact.capacity,
          accountAlias: config.value.accountAlias,
        },
        prepared: {
          account,
          accountAlias: config.value.accountAlias,
          expectedPuppetSender: expectedPuppetSender ?? 'invalid',
        },
      };
    },
  };
}

export interface HomeDevRuntimeInspectionDeps {
  hostname(): string;
  platform(): NodeJS.Platform;
  homedir(): string;
  realpath(path: string): Promise<string>;
  git(cwd: string, args: readonly string[]): Promise<{ stdout: string }>;
}

const PRODUCTION_RUNTIME_INSPECTION_DEPS: HomeDevRuntimeInspectionDeps = {
  hostname,
  platform,
  homedir,
  realpath,
  async git(cwd, args): Promise<{ stdout: string }> {
    return await execFileAsync('git', [...args], { cwd, encoding: 'utf8' });
  },
};

export async function inspectHomeDevRuntime(
  repositoryRoot: string,
  deps: HomeDevRuntimeInspectionDeps = PRODUCTION_RUNTIME_INSPECTION_DEPS
): Promise<{
  ready: boolean;
  deployedRevision: string;
  criticalPathsClean: boolean;
}> {
  try {
    const [actualRoot, expectedRoot, revision, status] = await Promise.all([
      deps.realpath(repositoryRoot),
      deps.realpath(join(deps.homedir(), 'deploy', 'intexuraos')),
      deps.git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']),
      deps.git(repositoryRoot, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--',
        ...MATRIX_CORPUS_RUNTIME_CRITICAL_PATHS,
      ]),
    ]);
    const deployedRevision = revision.stdout.trim();
    return {
      ready:
        deps.hostname() === 'home-dev' &&
        deps.platform() === 'linux' &&
        actualRoot === expectedRoot &&
        /^[0-9a-f]{40}$/u.test(deployedRevision),
      deployedRevision,
      criticalPathsClean: status.stdout.trim() === '',
    };
  } catch {
    return { ready: false, deployedRevision: '', criticalPathsClean: false };
  }
}

export function createProductionMatrixCorpusCatalogLoader(): () => Promise<CanonicalMatrixCorpus> {
  const directory = new URL('../../scenarios/', import.meta.url);
  return async () => await loadCanonicalMatrixCorpus(fileURLToPath(directory));
}

function hasCapabilityBoundary(env: NodeJS.ProcessEnv): boolean {
  const required = [
    'INTEXURAOS_OPENROUTER_APP_API_KEY',
    'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
  ] as const;
  return (
    env['INTEXURAOS_MATRIX_CORPUS_ENABLED'] === 'true' &&
    env['INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME'] === 'home-dev' &&
    env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] === 'home-dev' &&
    required.every((name) => (env[name]?.trim().length ?? 0) > 0)
  );
}

function mapAdmission(
  result: Awaited<ReturnType<IntexAgentServiceClient['getMatrixCorpusCurrentAcceptance']>>
): MatrixCorpusPreflightSnapshot['runAdmission'] {
  if (!result.ok) return 'not_ready';
  if (result.value.kind === 'not_ready') return 'not_ready';
  if (result.value.kind === 'admission_blocked') return 'blocked';
  return result.value.current;
}

export async function inspectArtifactRoot(
  path: string
): Promise<{ ready: boolean; capacity: boolean }> {
  try {
    const [metadata, fileSystem] = await Promise.all([lstat(path), statfs(path)]);
    const freeBytes = fileSystem.bavail * fileSystem.bsize;
    return {
      ready:
        metadata.isDirectory() &&
        !metadata.isSymbolicLink() &&
        (metadata.mode & 0o7777) === 0o700 &&
        metadata.uid === process.getuid?.(),
      capacity: Number.isSafeInteger(freeBytes) && freeBytes >= MIN_ARTIFACT_FREE_BYTES,
    };
  } catch {
    return { ready: false, capacity: false };
  }
}

function infrastructureFailure(runId: string, code: string): MatrixCorpusRunResult {
  return {
    runId,
    effectiveKind: 'infrastructure_failure',
    exitCode: 2,
    failureCodes: [code],
    scenarios: [],
    totals: {
      completedTurns: 0,
      judgedReplies: 0,
      agentCostNanoUsd: 0,
      evaluatorCostNanoUsd: 0,
    },
    terminalAcknowledged: false,
    cleanupCompleted: false,
  };
}
