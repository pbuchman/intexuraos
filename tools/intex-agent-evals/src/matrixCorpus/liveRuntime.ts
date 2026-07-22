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
import { applicationDefault } from 'firebase-admin/app';

import {
  CONFIG_MAX_BYTES,
  createProductionSetupPorts,
  parseEvaluatorConfigContents,
  withValidatedAccountContext,
  type ValidatedAccountContext,
} from '../preflight.js';
import type { MatrixClient } from '../live/matrixClient.js';
import { loadCanonicalMatrixCorpus } from './catalog.js';
import {
  runMatrixCorpusPreflight,
  type MatrixCorpusPreflightResult,
  type MatrixCorpusPreflightSnapshot,
} from './preflight.js';
import type { MatrixCorpusRunResult } from './runMatrixCorpus.js';
import type { CanonicalMatrixCorpus } from './types.js';
import { createProductionControlAuthorizationHeaderProvider } from './productionControlTransport.js';

const PRODUCTION_ORIGIN = 'https://intexuraos.cloud';
const INTEX_AGENT_EDGE_PREFIX = '/internal/evals/intex-agent';
const WHATSAPP_EDGE_PREFIX = '/internal/evals/whatsapp';
const MIN_ARTIFACT_FREE_BYTES = 128 * 1024 * 1024;
const FIRESTORE_INDEX_LIST_MAX_BYTES = 5 * 1024 * 1024;
const FIRESTORE_INDEX_LIST_TIMEOUT_MS = 10_000;
// The Firestore wildcard collection-group listing accepts only zero and returns all indexes.
const FIRESTORE_INDEX_LIST_PAGE_SIZE = 0;
const FIRESTORE_INDEX_LIST_MAX_COUNT = 10_000;
const FIRESTORE_INDEX_LIST_MAX_PAGES = 100;
const FIRESTORE_ADMIN_BASE_URL = 'https://firestore.googleapis.com/v1';
const execFileAsync = promisify(execFile);
export const MATRIX_CORPUS_RUNTIME_CRITICAL_PATHS = [
  'apps/intex-agent/src/',
  'apps/whatsapp-service/src/',
  'apps/user-service/src/',
  'packages/',
  'tools/intex-agent-evals/',
  'scripts/run-intex-agent-evals-home-dev.sh',
  'scripts/run-intex-agent-evals-prod.sh',
  'package.json',
] as const;
const NO_OP_LOGGER: InternalHttpClientLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const MATRIX_CORPUS_REQUIRED_FIRESTORE_INDEXES = [
  [
    'matrix_corpus_ingest_outbox',
    ['status:ASCENDING', 'createdAt:ASCENDING', '__name__:ASCENDING'],
  ],
  [
    'matrix_corpus_ingest_outbox',
    ['status:ASCENDING', 'claim.expiresAt:ASCENDING', '__name__:ASCENDING'],
  ],
  [
    'matrix_corpus_terminal_control_outbox',
    ['status:ASCENDING', 'createdAt:ASCENDING', '__name__:ASCENDING'],
  ],
  [
    'matrix_corpus_terminal_control_outbox',
    ['status:ASCENDING', 'claim.expiresAt:ASCENDING', '__name__:ASCENDING'],
  ],
  ['matrix_corpus_run_leases', ['phase:ASCENDING', 'expiresAt:ASCENDING', '__name__:ASCENDING']],
  [
    'intex_agent_session_events',
    ['sessionId:ASCENDING', 'eventSequence:ASCENDING', '__name__:ASCENDING'],
  ],
  [
    'intex_agent_test_runs',
    [
      'userId:ASCENDING',
      'runtimeAudience:ASCENDING',
      'startedAt:DESCENDING',
      '__name__:DESCENDING',
    ],
  ],
  [
    'intex_agent_test_runs',
    ['artifactDelivery.status:ASCENDING', 'finishedAt:ASCENDING', '__name__:ASCENDING'],
  ],
] as const;
const MATRIX_CORPUS_REQUIRED_FIRESTORE_INDEX_SIGNATURES = new Set(
  MATRIX_CORPUS_REQUIRED_FIRESTORE_INDEXES.map(([collectionGroup, fields]) =>
    firestoreIndexSignature(collectionGroup, fields)
  )
);

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

export function resolveMatrixCorpusPuppetBinding(
  sync: Awaited<ReturnType<MatrixClient['syncTargetRoom']>>,
  evaluatorUserMatches: boolean,
  configuredPuppetSender: string | undefined
):
  | {
      readonly expectedPuppetSender: string | undefined;
      readonly accountTupleCount: number;
    }
  | undefined {
  if (!sync.ok) return undefined;
  // A limited initial timeline is normal once the room has more than 100 events.
  // We only use this tail to resolve the current puppet; later incremental reads
  // continue to reject limited results before correlating any test evidence.
  const expectedPuppetSender =
    configuredPuppetSender !== undefined &&
    /^@whatsapp_(?:[0-9]+|lid-[A-Za-z0-9_-]+):[^\s]+$/u.test(configuredPuppetSender)
      ? configuredPuppetSender
      : undefined;
  const bindingObserved =
    expectedPuppetSender !== undefined &&
    sync.events.some((event) => event.sender === expectedPuppetSender);
  const accountReady = evaluatorUserMatches && bindingObserved;
  return {
    expectedPuppetSender: accountReady ? expectedPuppetSender : undefined,
    accountTupleCount: accountReady ? 1 : 0,
  };
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
  readonly inspectFirestoreIndexes?: () => Promise<boolean>;
  readonly inspectRuntime?: () => Promise<{
    readonly ready: boolean;
    readonly deployedRevision: string;
    readonly criticalPathsClean: boolean;
  }>;
}): MatrixCorpusLiveReadPort {
  const env = options.env ?? process.env;
  const setup = createProductionSetupPorts({ matrix: options.matrix });
  const authorizationHeaderProvider = createProductionControlAuthorizationHeaderProvider();
  const intex =
    options.intex ??
    createIntexAgentServiceClient({
      baseUrl: PRODUCTION_ORIGIN,
      internalAuthToken: env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
      defaultTimeoutMs: 10_000,
      logger: NO_OP_LOGGER,
      pathPrefix: INTEX_AGENT_EDGE_PREFIX,
      authorizationHeaderProvider,
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
      baseUrl: PRODUCTION_ORIGIN,
      internalAuthToken: env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
      defaultTimeoutMs: 10_000,
      logger: NO_OP_LOGGER,
      pathPrefix: WHATSAPP_EDGE_PREFIX,
      authorizationHeaderProvider,
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
      const [acceptance, liveCatalog, artifact, whatsappReadiness, runtime, firestoreIndexesReady] =
        await Promise.all([
          intex.getMatrixCorpusCurrentAcceptance(account.userId),
          modelCatalog.getIntexAgentCatalogEvidence(),
          inspectArtifactRoot(join(options.repositoryRoot, '.artifacts', 'intex-agent-evals')),
          whatsapp.getMatrixCorpusReadiness(),
          (
            options.inspectRuntime ??
            ((): ReturnType<typeof inspectHomeDevRuntime> =>
              inspectHomeDevRuntime(options.repositoryRoot))
          )(),
          (
            options.inspectFirestoreIndexes ??
            ((): ReturnType<typeof inspectHomeDevFirestoreIndexes> =>
              inspectHomeDevFirestoreIndexes(env['INTEXURAOS_GCP_PROJECT_ID'] ?? ''))
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
      const evaluatorUserId = env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];
      const puppetBinding = resolveMatrixCorpusPuppetBinding(
        sync,
        evaluatorUserId === account.userId,
        env['INTEXURAOS_MATRIX_CORPUS_MATRIX_PUPPET_USER_ID']
      );
      if (puppetBinding === undefined) throw new Error('matrix_not_ready');
      const { expectedPuppetSender, accountTupleCount } = puppetBinding;
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
          servicesReady: firestoreIndexesReady,
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

export interface HomeDevFirestoreIndexInspectionDeps {
  listCompositeIndexes(projectId: string): Promise<string>;
}

const PRODUCTION_FIRESTORE_INDEX_INSPECTION_DEPS: HomeDevFirestoreIndexInspectionDeps = {
  async listCompositeIndexes(projectId): Promise<string> {
    const credential = applicationDefault();
    return await listHomeDevFirestoreCompositeIndexes(projectId, {
      async getAccessToken(): Promise<string> {
        return (await credential.getAccessToken()).access_token;
      },
      fetch: async (input, init) => await fetch(input, init),
    });
  },
};

export interface FirestoreAdminIndexListDeps {
  getAccessToken(): Promise<string>;
  fetch(input: string, init: RequestInit): Promise<Response>;
}

/** List composite indexes through the read-only Firestore Admin REST API. */
export async function listHomeDevFirestoreCompositeIndexes(
  projectId: string,
  deps: FirestoreAdminIndexListDeps
): Promise<string> {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(projectId)) {
    throw new Error('firestore_index_project_invalid');
  }
  const accessToken = await deps.getAccessToken();
  if (accessToken.length === 0 || accessToken.length > 16_384) {
    throw new Error('firestore_index_access_token_invalid');
  }

  const signal = AbortSignal.timeout(FIRESTORE_INDEX_LIST_TIMEOUT_MS);
  const indexes: unknown[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  let totalBytes = 0;

  for (let pageNumber = 0; pageNumber < FIRESTORE_INDEX_LIST_MAX_PAGES; pageNumber += 1) {
    const url = new URL(
      `${FIRESTORE_ADMIN_BASE_URL}/projects/${projectId}/databases/(default)/collectionGroups/-/indexes`
    );
    url.searchParams.set('pageSize', String(FIRESTORE_INDEX_LIST_PAGE_SIZE));
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
    const response = await deps.fetch(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!response.ok) throw new Error('firestore_index_list_failed');

    const body = await readBoundedResponseBody(
      response,
      FIRESTORE_INDEX_LIST_MAX_BYTES - totalBytes
    );
    totalBytes += body.byteLength;
    const page = JSON.parse(body.text) as unknown;
    if (!isRecord(page)) throw new Error('firestore_index_list_invalid');
    const rawPageIndexes = page['indexes'];
    if (rawPageIndexes !== undefined && !Array.isArray(rawPageIndexes)) {
      throw new Error('firestore_index_list_invalid');
    }
    const pageIndexes: unknown[] =
      rawPageIndexes === undefined ? [] : (rawPageIndexes as unknown[]);
    indexes.push(...pageIndexes);
    if (indexes.length > FIRESTORE_INDEX_LIST_MAX_COUNT) {
      throw new Error('firestore_index_list_too_large');
    }

    const nextPageToken = page['nextPageToken'];
    if (nextPageToken === undefined || nextPageToken === '') return JSON.stringify(indexes);
    if (
      typeof nextPageToken !== 'string' ||
      nextPageToken.length > 4096 ||
      seenPageTokens.has(nextPageToken)
    ) {
      throw new Error('firestore_index_page_token_invalid');
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  throw new Error('firestore_index_page_limit_exceeded');
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number
): Promise<{ readonly text: string; readonly byteLength: number }> {
  if (maxBytes < 1 || response.body === null) {
    throw new Error('firestore_index_list_too_large');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const advertisedBytes = Number(contentLength);
    if (
      !Number.isSafeInteger(advertisedBytes) ||
      advertisedBytes < 0 ||
      advertisedBytes > maxBytes
    ) {
      throw new Error('firestore_index_list_too_large');
    }
  }

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new Error('firestore_index_list_too_large');
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), byteLength };
}

/** Read the live index control plane without creating a Firestore probe document. */
export async function inspectHomeDevFirestoreIndexes(
  projectId: string,
  deps: HomeDevFirestoreIndexInspectionDeps = PRODUCTION_FIRESTORE_INDEX_INSPECTION_DEPS
): Promise<boolean> {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(projectId)) return false;
  try {
    const output = await deps.listCompositeIndexes(projectId);
    if (output.length > FIRESTORE_INDEX_LIST_MAX_BYTES) return false;
    const parsed = JSON.parse(output) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 10_000) return false;
    const readySignatures = new Set<string>();
    for (const value of parsed) {
      const signature = readyFirestoreIndexSignature(value);
      if (signature !== undefined) readySignatures.add(signature);
    }
    return [...MATRIX_CORPUS_REQUIRED_FIRESTORE_INDEX_SIGNATURES].every((signature) =>
      readySignatures.has(signature)
    );
  } catch {
    return false;
  }
}

function readyFirestoreIndexSignature(value: unknown): string | undefined {
  if (
    !isRecord(value) ||
    value['state'] !== 'READY' ||
    value['queryScope'] !== 'COLLECTION' ||
    (value['apiScope'] !== undefined && value['apiScope'] !== 'ANY_API')
  ) {
    return undefined;
  }
  const name = value['name'];
  const fields = value['fields'];
  if (typeof name !== 'string' || !Array.isArray(fields) || fields.length > 64) return undefined;
  const collectionMatch = /\/collectionGroups\/([^/]+)\/indexes\//u.exec(name);
  const collectionGroup = collectionMatch?.[1];
  if (collectionGroup === undefined) return undefined;
  const normalizedFields: string[] = [];
  for (const field of fields) {
    if (!isRecord(field) || typeof field['fieldPath'] !== 'string') return undefined;
    if (field['order'] !== 'ASCENDING' && field['order'] !== 'DESCENDING') return undefined;
    normalizedFields.push(`${field['fieldPath']}:${field['order']}`);
  }
  return firestoreIndexSignature(collectionGroup, normalizedFields);
}

function firestoreIndexSignature(collectionGroup: string, fields: readonly string[]): string {
  return `${collectionGroup}|${fields.join('|')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface HomeDevRuntimeInspectionDeps {
  hostname(): string;
  platform(): NodeJS.Platform;
  homedir(): string;
  realpath(path: string): Promise<string>;
  git(cwd: string, args: readonly string[]): Promise<{ stdout: string }>;
  fetchDeploymentDocument(): Promise<unknown>;
}

const PRODUCTION_RUNTIME_INSPECTION_DEPS: HomeDevRuntimeInspectionDeps = {
  hostname,
  platform,
  homedir,
  realpath,
  async git(cwd, args): Promise<{ stdout: string }> {
    return await execFileAsync('git', [...args], { cwd, encoding: 'utf8' });
  },
  async fetchDeploymentDocument(): Promise<unknown> {
    const response = await fetch(`${PRODUCTION_ORIGIN}/deployment.json`, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('production_deployment_document_unavailable');
    return await response.json();
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
    const [actualRoot, expectedRoot, revision, status, deploymentDocument] = await Promise.all([
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
      deps.fetchDeploymentDocument(),
    ]);
    const runnerRevision = revision.stdout.trim();
    const deployedRevision =
      isRecord(deploymentDocument) &&
      Object.keys(deploymentDocument).length === 3 &&
      typeof deploymentDocument['commitSha'] === 'string' &&
      typeof deploymentDocument['workflowRunId'] === 'string' &&
      typeof deploymentDocument['deployedAt'] === 'string' &&
      /^[0-9a-f]{40}$/u.test(deploymentDocument['commitSha']) &&
      deploymentDocument['workflowRunId'].length > 0 &&
      Number.isFinite(Date.parse(deploymentDocument['deployedAt']))
        ? deploymentDocument['commitSha']
        : '';
    return {
      ready:
        deps.hostname() === 'home-dev' &&
        deps.platform() === 'linux' &&
        actualRoot === expectedRoot &&
        /^[0-9a-f]{40}$/u.test(runnerRevision) &&
        runnerRevision === deployedRevision,
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
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_MATRIX_CORPUS_MATRIX_PUPPET_USER_ID',
  ] as const;
  return (
    env['INTEXURAOS_MATRIX_CORPUS_ENABLED'] === 'true' &&
    env['INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME'] === 'hetzner-prod' &&
    env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] === 'hetzner-prod' &&
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
