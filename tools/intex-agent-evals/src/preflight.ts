import {
  createWhatsAppServiceClient,
  type InternalHttpClientLogger,
  type WhatsAppServiceClientConfig,
} from '@intexuraos/internal-clients';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FirebaseAuthError, getAuth } from 'firebase-admin/auth';
import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
  link as nodeLink,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  unlink as nodeUnlink,
} from 'node:fs/promises';
import { homedir, hostname as nodeHostname } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadScenarioCatalog } from './scenarioCatalog.js';

export const MatrixUserIdSchema = z
  .string()
  .min(4)
  .max(255)
  .regex(/^@[^\s:]+:[^\s]+$/u);

export const MatrixRoomIdSchema = z
  .string()
  .min(4)
  .max(255)
  .regex(/^![^\s:]+:[^\s]+$/u);

const AbsolutePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => isAbsolute(value));

export const EvaluatorConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    accountAlias: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u)
      .refine((value) => value === value.trim())
      .refine((value) => /[A-Za-z]/u.test(value)),
    userId: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => value === value.trim()),
    matrixUserId: MatrixUserIdSchema,
    matrixAccessTokenFile: AbsolutePathSchema,
    matrixTargetsFile: AbsolutePathSchema,
  })
  .strict();

export type EvaluatorConfig = z.infer<typeof EvaluatorConfigSchema>;

const MatrixTargetEntrySchema = z
  .object({
    intex_agent: MatrixRoomIdSchema,
  })
  .strict();

export const MatrixTargetsSchema = z.record(z.string().min(1).max(512), MatrixTargetEntrySchema);
export type MatrixTargets = z.infer<typeof MatrixTargetsSchema>;

type ParseResult<T> = { ok: true; value: T } | { ok: false };

function parseJsonWithSchema<T>(contents: string, schema: z.ZodType<T>): ParseResult<T> {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    return { ok: false };
  }

  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export function parseEvaluatorConfigContents(contents: string): ParseResult<EvaluatorConfig> {
  return parseJsonWithSchema(contents, EvaluatorConfigSchema);
}

export function parseMatrixTargetsContents(contents: string): ParseResult<MatrixTargets> {
  return parseJsonWithSchema(contents, MatrixTargetsSchema);
}

export function canonicalizeEvaluatorConfig(config: EvaluatorConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export const CONFIG_MAX_BYTES = 64 * 1024;
export const MATRIX_TOKEN_MAX_BYTES = 16 * 1024;
export const MATRIX_TARGETS_MAX_BYTES = 256 * 1024;

export const INTEX_AGENT_HEALTH_URL = 'http://127.0.0.1:8134/health';
export const WHATSAPP_HEALTH_URL = 'http://127.0.0.1:8113/health';
export const MATRIX_ADAPTER_HEALTH_URL = 'http://127.0.0.1:8099/health';
export const WHATSAPP_SERVICE_BASE_URL = 'http://127.0.0.1:8113';
export const JUDGE_MODEL = 'or:minimax/minimax-m3' as const;

export interface ProtectedFilePolicy {
  mode: 0o600;
  maxBytes: number;
}

export type ProtectedFileReadResult =
  | { ok: true; contents: string }
  | { ok: false; reason: 'missing' | 'unsafe' | 'unreadable' | 'too_large' };

export type PrivateDirectoryResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'unsafe' | 'create_failed' };

export type ExclusiveCreateResult =
  | { state: 'created' }
  | { state: 'exists' }
  | { state: 'failed' };

export interface ProtectedFilePort {
  read(path: string, policy: ProtectedFilePolicy): Promise<ProtectedFileReadResult>;
  validatePrivateDirectory(path: string): Promise<PrivateDirectoryResult>;
  ensurePrivateDirectory(path: string): Promise<PrivateDirectoryResult>;
  createExclusive(path: string, contents: string): Promise<ExclusiveCreateResult>;
}

interface FileStats {
  dev: number;
  ino: number;
  mode: number;
  uid: number;
  size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface NodeProtectedFileSystem {
  lstat(path: string): Promise<FileStats>;
  link(sourcePath: string, destinationPath: string): Promise<void>;
  mkdir(path: string, options: { mode: number; recursive: true }): Promise<string | undefined>;
  open(path: string, flags: number, mode?: number): Promise<FileHandle>;
  unlink(path: string): Promise<void>;
}

export interface NodeProtectedFilePortOptions {
  expectedUid: number;
  fileSystem?: Partial<NodeProtectedFileSystem>;
  nonce?: () => string;
}

const NODE_FILE_SYSTEM: NodeProtectedFileSystem = {
  lstat: nodeLstat,
  link: nodeLink,
  mkdir: nodeMkdir,
  open: nodeOpen,
  unlink: nodeUnlink,
};

const STAGING_NONCE_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/u;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

function mapReadError(error: unknown): ProtectedFileReadResult {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    return { ok: false, reason: 'missing' };
  }
  if (code === 'ELOOP') {
    return { ok: false, reason: 'unsafe' };
  }
  return { ok: false, reason: 'unreadable' };
}

function hasExactMode(stats: FileStats, expectedMode: number): boolean {
  return (stats.mode & 0o7777) === expectedMode;
}

function hasSameIdentity(before: FileStats, after: FileStats): boolean {
  return before.dev === after.dev && before.ino === after.ino;
}

function isSafeFile(stats: FileStats, expectedUid: number, expectedMode: number): boolean {
  return (
    !stats.isSymbolicLink() &&
    stats.isFile() &&
    stats.uid === expectedUid &&
    hasExactMode(stats, expectedMode)
  );
}

function isSafeDirectory(stats: FileStats, expectedUid: number): boolean {
  return (
    !stats.isSymbolicLink() &&
    stats.isDirectory() &&
    stats.uid === expectedUid &&
    hasExactMode(stats, 0o700)
  );
}

async function readBounded(handle: FileHandle, maxBytes: number): Promise<Buffer | undefined> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (totalBytes <= maxBytes) {
    const remainingCapacity = maxBytes + 1 - totalBytes;
    const buffer = Buffer.alloc(Math.min(8 * 1024, remainingCapacity));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, totalBytes);
    if (bytesRead === 0) {
      return Buffer.concat(chunks, totalBytes);
    }
    chunks.push(buffer.subarray(0, bytesRead));
    totalBytes += bytesRead;
  }
  return undefined;
}

export function createNodeProtectedFilePort(
  options: NodeProtectedFilePortOptions
): ProtectedFilePort {
  const fileSystem: NodeProtectedFileSystem = {
    ...NODE_FILE_SYSTEM,
    ...options.fileSystem,
  };

  async function validatePrivateDirectory(path: string): Promise<PrivateDirectoryResult> {
    let before: FileStats;
    try {
      before = await fileSystem.lstat(path);
    } catch (error) {
      return errorCode(error) === 'ENOENT'
        ? { ok: false, reason: 'missing' }
        : { ok: false, reason: 'unsafe' };
    }

    if (!isSafeDirectory(before, options.expectedUid)) {
      return { ok: false, reason: 'unsafe' };
    }

    let handle: FileHandle | undefined;
    try {
      handle = await fileSystem.open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      const after = await handle.stat();
      if (!isSafeDirectory(after, options.expectedUid) || !hasSameIdentity(before, after)) {
        return { ok: false, reason: 'unsafe' };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unsafe' };
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  return {
    async read(path, policy): Promise<ProtectedFileReadResult> {
      let before: FileStats;
      try {
        before = await fileSystem.lstat(path);
      } catch (error) {
        return mapReadError(error);
      }

      if (!isSafeFile(before, options.expectedUid, policy.mode)) {
        return { ok: false, reason: 'unsafe' };
      }

      let handle: FileHandle | undefined;
      try {
        handle = await fileSystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const after = await handle.stat();
        if (
          !isSafeFile(after, options.expectedUid, policy.mode) ||
          !hasSameIdentity(before, after)
        ) {
          return { ok: false, reason: 'unsafe' };
        }
        if (after.size > policy.maxBytes) {
          return { ok: false, reason: 'too_large' };
        }

        const bytes = await readBounded(handle, policy.maxBytes);
        if (bytes === undefined) {
          return { ok: false, reason: 'too_large' };
        }
        return { ok: true, contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
      } catch (error) {
        return mapReadError(error);
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },

    validatePrivateDirectory,

    async ensurePrivateDirectory(path): Promise<PrivateDirectoryResult> {
      const existing = await validatePrivateDirectory(path);
      if (existing.ok || existing.reason !== 'missing') {
        return existing;
      }

      try {
        await fileSystem.mkdir(path, { mode: 0o700, recursive: true });
      } catch {
        return { ok: false, reason: 'create_failed' };
      }
      return await validatePrivateDirectory(path);
    },

    async createExclusive(path, contents): Promise<ExclusiveCreateResult> {
      let nonce: string;
      try {
        nonce = (options.nonce ?? nodeRandomUUID)();
      } catch {
        return { state: 'failed' };
      }
      if (!STAGING_NONCE_PATTERN.test(nonce)) {
        return { state: 'failed' };
      }

      const temporaryPath = join(dirname(path), `.intex-agent-evals-${nonce}.tmp`);
      let handle: FileHandle | undefined;
      let temporaryCreated = false;
      let publishAttempted = false;
      try {
        handle = await fileSystem.open(
          temporaryPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600
        );
        temporaryCreated = true;
        await handle.chmod(0o600);
        const identity = await handle.stat();
        if (!isSafeFile(identity, options.expectedUid, 0o600)) {
          throw new Error('unsafe-created-file');
        }
        await handle.writeFile(contents, { encoding: 'utf8' });
        await handle.sync();
        await handle.close();
        handle = undefined;
        publishAttempted = true;
        await fileSystem.link(temporaryPath, path);
        return { state: 'created' };
      } catch (error) {
        return publishAttempted && errorCode(error) === 'EEXIST'
          ? { state: 'exists' }
          : { state: 'failed' };
      } finally {
        await handle?.close().catch(() => undefined);
        if (temporaryCreated) {
          await fileSystem.unlink(temporaryPath).catch(() => undefined);
        }
      }
    },
  };
}

const HealthCheckSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(['ok', 'degraded', 'down']),
    latencyMs: z.number().finite().nonnegative(),
    details: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

const ServiceHealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'down']),
    serviceName: z.string().min(1),
    version: z.string().min(1),
    timestamp: z.string().datetime({ offset: true }),
    checks: z.array(HealthCheckSchema),
  })
  .strict();

const MatrixAdapterHealthSchema = z
  .object({
    ok: z.boolean(),
    state: z.enum([
      'starting',
      'initializing',
      'running',
      'error',
      'waiting_for_matrix_access_token',
      'waiting_for_intexuraos_oidc_credentials',
    ]),
    homeserverUrl: z.string().url(),
    matrixUserId: MatrixUserIdSchema,
    ingestUrl: z.string().url(),
    sourceAccountId: z.string().min(1).max(512),
    counters: z.record(z.string(), z.number().finite().int().nonnegative()),
    lastError: z.string().min(1).optional(),
  })
  .strict();

const DeliveryStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), deliverable: z.literal(true) }).strict(),
  z
    .object({
      status: z.literal('setup_required'),
      deliverable: z.literal(false),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal('error'),
      deliverable: z.literal(false),
      message: z.string().min(1),
    })
    .strict(),
]);

export type PreflightCheckId =
  | 'runtime'
  | 'environment'
  | 'config'
  | 'matrix_files'
  | 'intex_agent_health'
  | 'whatsapp_health'
  | 'matrix_health'
  | 'firebase_identity'
  | 'matrix_identity'
  | 'whatsapp_delivery'
  | 'scenario_catalog'
  | 'minimax_probe';

export type PreflightFailureCode =
  | 'HOME_DEV_REQUIRED'
  | 'REQUIRED_ENV_MISSING'
  | 'SETUP_TTY_REQUIRED'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'CONFIG_PARENT_UNSAFE'
  | 'CONFIG_FILE_UNSAFE'
  | 'CONFIG_CONFLICT'
  | 'CONFIG_WRITE_FAILED'
  | 'MATRIX_TOKEN_FILE_UNSAFE'
  | 'MATRIX_TOKEN_INVALID'
  | 'MATRIX_TARGETS_FILE_UNSAFE'
  | 'MATRIX_TARGETS_INVALID'
  | 'INTEX_AGENT_HEALTH_FAILED'
  | 'WHATSAPP_HEALTH_FAILED'
  | 'MATRIX_HEALTH_FAILED'
  | 'FIREBASE_IDENTITY_MISSING'
  | 'FIREBASE_IDENTITY_DISABLED'
  | 'FIREBASE_CHECK_FAILED'
  | 'MATRIX_IDENTITY_MISMATCH'
  | 'MATRIX_WHOAMI_UNAUTHORIZED'
  | 'MATRIX_WHOAMI_FAILED'
  | 'WHATSAPP_DELIVERY_NOT_READY'
  | 'WHATSAPP_DELIVERY_FAILED'
  | 'SCENARIO_CATALOG_FAILED'
  | 'MINIMAX_KEY_MISSING'
  | 'MINIMAX_PROBE_TIMEOUT'
  | 'MINIMAX_PROBE_INVALID'
  | 'MINIMAX_PROBE_FAILED'
  | 'UNEXPECTED_FAILURE';

export type SafeCheckResult =
  | { check: PreflightCheckId; status: 'passed' }
  | { check: PreflightCheckId; status: 'failed'; code: PreflightFailureCode };

export type SetupResult =
  | {
      ok: true;
      exitCode: 0;
      state: 'created' | 'already_configured';
      accountAlias: string;
      checks: SafeCheckResult[];
    }
  | {
      ok: false;
      exitCode: 2;
      code: PreflightFailureCode;
      checks: SafeCheckResult[];
    };

export interface RuntimeIdentityPort {
  platform(): NodeJS.Platform;
  hostname(): string;
  uid(): number | undefined;
  env(name: string): string | undefined;
}

export type SafeHttpResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; reason: 'timeout' | 'network' | 'invalid_json' | 'too_large' };

export interface HealthHttpPort {
  get(url: string): Promise<SafeHttpResult>;
}

export interface FirebaseIdentityPort {
  getUserState(
    userId: string
  ): Promise<{ ok: true; state: 'enabled' | 'disabled' | 'missing' } | { ok: false }>;
}

export interface MatrixPreflightPort {
  whoAmI(input: { homeserverUrl: string; accessToken: string }): Promise<
    | { ok: true; userId: string }
    | {
        ok: false;
        reason: 'unauthorized' | 'timeout' | 'unavailable' | 'invalid_response';
      }
  >;
}

export interface WhatsAppReadinessPort {
  getDeliveryStatus(
    userId: string
  ): Promise<
    { ok: true; value: unknown } | { ok: false; reason: 'unavailable' | 'invalid_envelope' }
  >;
}

interface AccountReadinessPorts {
  protectedFiles: ProtectedFilePort;
  healthHttp: HealthHttpPort;
  firebaseIdentity: FirebaseIdentityPort;
  matrix: MatrixPreflightPort;
  whatsapp: WhatsAppReadinessPort;
}

export interface SetupPorts extends AccountReadinessPorts {
  configPath: string;
  runtime: RuntimeIdentityPort;
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function failedCheck(check: PreflightCheckId, code: PreflightFailureCode): SafeCheckResult {
  return { check, status: 'failed', code };
}

function setupFailure(
  checks: SafeCheckResult[],
  check: PreflightCheckId,
  code: PreflightFailureCode
): SetupResult {
  return {
    ok: false,
    exitCode: 2,
    code,
    checks: [...checks, failedCheck(check, code)],
  };
}

function validateRuntime(
  runtime: RuntimeIdentityPort,
  includeMiniMaxKey: boolean
):
  | { ok: true; checks: SafeCheckResult[] }
  | { ok: false; check: PreflightCheckId; code: PreflightFailureCode; checks: SafeCheckResult[] } {
  const checks: SafeCheckResult[] = [];
  const uid = runtime.uid();
  if (
    runtime.platform() !== 'linux' ||
    runtime.hostname() !== 'home-dev' ||
    uid === undefined ||
    !Number.isSafeInteger(uid) ||
    uid < 0
  ) {
    return { ok: false, check: 'runtime', code: 'HOME_DEV_REQUIRED', checks };
  }
  checks.push({ check: 'runtime', status: 'passed' });

  if (
    runtime.env('INTEXURAOS_ENVIRONMENT') !== 'dev' ||
    !isNonEmpty(runtime.env('INTEXURAOS_INTERNAL_AUTH_TOKEN')) ||
    !isNonEmpty(runtime.env('INTEXURAOS_GCP_PROJECT_ID')) ||
    !isNonEmpty(runtime.env('GOOGLE_APPLICATION_CREDENTIALS'))
  ) {
    return { ok: false, check: 'environment', code: 'REQUIRED_ENV_MISSING', checks };
  }
  if (includeMiniMaxKey && !isNonEmpty(runtime.env('INTEXURAOS_OPENROUTER_APP_API_KEY'))) {
    return { ok: false, check: 'environment', code: 'MINIMAX_KEY_MISSING', checks };
  }
  checks.push({ check: 'environment', status: 'passed' });
  return { ok: true, checks };
}

type ReadinessResult =
  | { ok: true; checks: SafeCheckResult[] }
  | {
      ok: false;
      check: PreflightCheckId;
      code: PreflightFailureCode;
      checks: SafeCheckResult[];
    };

function readinessFailure(
  checks: SafeCheckResult[],
  check: PreflightCheckId,
  code: PreflightFailureCode
): ReadinessResult {
  return { ok: false, check, code, checks };
}

function isHealthyService(result: SafeHttpResult, serviceName: string): boolean {
  if (!result.ok || result.status !== 200) {
    return false;
  }
  const parsed = ServiceHealthSchema.safeParse(result.body);
  return parsed.success && parsed.data.serviceName === serviceName && parsed.data.status === 'ok';
}

async function validateAccountReadiness(
  config: EvaluatorConfig,
  ports: AccountReadinessPorts
): Promise<ReadinessResult> {
  const checks: SafeCheckResult[] = [];
  const tokenRead = await ports.protectedFiles.read(config.matrixAccessTokenFile, {
    mode: 0o600,
    maxBytes: MATRIX_TOKEN_MAX_BYTES,
  });
  if (!tokenRead.ok) {
    return readinessFailure(checks, 'matrix_files', 'MATRIX_TOKEN_FILE_UNSAFE');
  }
  const accessToken = tokenRead.contents.trim();
  if (accessToken === '') {
    return readinessFailure(checks, 'matrix_files', 'MATRIX_TOKEN_INVALID');
  }

  const targetsRead = await ports.protectedFiles.read(config.matrixTargetsFile, {
    mode: 0o600,
    maxBytes: MATRIX_TARGETS_MAX_BYTES,
  });
  if (!targetsRead.ok) {
    return readinessFailure(checks, 'matrix_files', 'MATRIX_TARGETS_FILE_UNSAFE');
  }
  const targets = parseMatrixTargetsContents(targetsRead.contents);
  if (!targets.ok) {
    return readinessFailure(checks, 'matrix_files', 'MATRIX_TARGETS_INVALID');
  }
  checks.push({ check: 'matrix_files', status: 'passed' });

  const intexHealth = await ports.healthHttp.get(INTEX_AGENT_HEALTH_URL);
  if (!isHealthyService(intexHealth, 'intex-agent')) {
    return readinessFailure(checks, 'intex_agent_health', 'INTEX_AGENT_HEALTH_FAILED');
  }
  checks.push({ check: 'intex_agent_health', status: 'passed' });

  const whatsappHealth = await ports.healthHttp.get(WHATSAPP_HEALTH_URL);
  if (!isHealthyService(whatsappHealth, 'whatsapp-service')) {
    return readinessFailure(checks, 'whatsapp_health', 'WHATSAPP_HEALTH_FAILED');
  }
  checks.push({ check: 'whatsapp_health', status: 'passed' });

  const matrixHealthResult = await ports.healthHttp.get(MATRIX_ADAPTER_HEALTH_URL);
  if (!matrixHealthResult.ok || matrixHealthResult.status !== 200) {
    return readinessFailure(checks, 'matrix_health', 'MATRIX_HEALTH_FAILED');
  }
  const matrixHealth = MatrixAdapterHealthSchema.safeParse(matrixHealthResult.body);
  if (
    !matrixHealth.success ||
    !matrixHealth.data.ok ||
    matrixHealth.data.state !== 'running' ||
    matrixHealth.data.lastError !== undefined
  ) {
    return readinessFailure(checks, 'matrix_health', 'MATRIX_HEALTH_FAILED');
  }
  if (matrixHealth.data.matrixUserId !== config.matrixUserId) {
    return readinessFailure(checks, 'matrix_health', 'MATRIX_IDENTITY_MISMATCH');
  }
  if (!Object.hasOwn(targets.value, matrixHealth.data.sourceAccountId)) {
    return readinessFailure(checks, 'matrix_health', 'MATRIX_TARGETS_INVALID');
  }
  checks.push({ check: 'matrix_health', status: 'passed' });

  const firebaseState = await ports.firebaseIdentity.getUserState(config.userId);
  if (!firebaseState.ok) {
    return readinessFailure(checks, 'firebase_identity', 'FIREBASE_CHECK_FAILED');
  }
  if (firebaseState.state === 'missing') {
    return readinessFailure(checks, 'firebase_identity', 'FIREBASE_IDENTITY_MISSING');
  }
  if (firebaseState.state === 'disabled') {
    return readinessFailure(checks, 'firebase_identity', 'FIREBASE_IDENTITY_DISABLED');
  }
  checks.push({ check: 'firebase_identity', status: 'passed' });

  const whoAmI = await ports.matrix.whoAmI({
    homeserverUrl: matrixHealth.data.homeserverUrl,
    accessToken,
  });
  if (!whoAmI.ok) {
    return readinessFailure(
      checks,
      'matrix_identity',
      whoAmI.reason === 'unauthorized' ? 'MATRIX_WHOAMI_UNAUTHORIZED' : 'MATRIX_WHOAMI_FAILED'
    );
  }
  if (whoAmI.userId !== config.matrixUserId || whoAmI.userId !== matrixHealth.data.matrixUserId) {
    return readinessFailure(checks, 'matrix_identity', 'MATRIX_IDENTITY_MISMATCH');
  }
  checks.push({ check: 'matrix_identity', status: 'passed' });

  const deliveryStatus = await ports.whatsapp.getDeliveryStatus(config.userId);
  if (!deliveryStatus.ok) {
    return readinessFailure(checks, 'whatsapp_delivery', 'WHATSAPP_DELIVERY_FAILED');
  }
  const delivery = DeliveryStatusSchema.safeParse(deliveryStatus.value);
  if (!delivery.success) {
    return readinessFailure(checks, 'whatsapp_delivery', 'WHATSAPP_DELIVERY_FAILED');
  }
  if (delivery.data.status !== 'ready') {
    return readinessFailure(checks, 'whatsapp_delivery', 'WHATSAPP_DELIVERY_NOT_READY');
  }
  checks.push({ check: 'whatsapp_delivery', status: 'passed' });
  return { ok: true, checks };
}

function configsEqual(left: EvaluatorConfig, right: EvaluatorConfig): boolean {
  return canonicalizeEvaluatorConfig(left) === canonicalizeEvaluatorConfig(right);
}

export async function setupEvaluatorConfig(
  candidate: unknown,
  ports: SetupPorts
): Promise<SetupResult> {
  let checks: SafeCheckResult[] = [];
  try {
    const runtime = validateRuntime(ports.runtime, false);
    checks = runtime.checks;
    if (!runtime.ok) {
      return setupFailure(checks, runtime.check, runtime.code);
    }

    const parsedCandidate = EvaluatorConfigSchema.safeParse(candidate);
    if (!parsedCandidate.success) {
      return setupFailure(checks, 'config', 'CONFIG_INVALID');
    }
    const config = parsedCandidate.data;
    checks.push({ check: 'config', status: 'passed' });

    const readiness = await validateAccountReadiness(config, ports);
    checks.push(...readiness.checks);
    if (!readiness.ok) {
      return setupFailure(checks, readiness.check, readiness.code);
    }

    const parentResult = await ports.protectedFiles.ensurePrivateDirectory(
      dirname(ports.configPath)
    );
    if (!parentResult.ok) {
      return setupFailure(
        checks,
        'config',
        parentResult.reason === 'unsafe' ? 'CONFIG_PARENT_UNSAFE' : 'CONFIG_WRITE_FAILED'
      );
    }

    const created = await ports.protectedFiles.createExclusive(
      ports.configPath,
      canonicalizeEvaluatorConfig(config)
    );
    if (created.state === 'failed') {
      return setupFailure(checks, 'config', 'CONFIG_WRITE_FAILED');
    }

    const configRead = await ports.protectedFiles.read(ports.configPath, {
      mode: 0o600,
      maxBytes: CONFIG_MAX_BYTES,
    });
    if (!configRead.ok) {
      if (created.state === 'created') {
        return setupFailure(checks, 'config', 'CONFIG_WRITE_FAILED');
      }
      return setupFailure(checks, 'config', 'CONFIG_FILE_UNSAFE');
    }
    const loaded = parseEvaluatorConfigContents(configRead.contents);
    if (!loaded.ok || !configsEqual(loaded.value, config)) {
      if (created.state === 'created') {
        return setupFailure(checks, 'config', 'CONFIG_WRITE_FAILED');
      }
      return setupFailure(checks, 'config', 'CONFIG_CONFLICT');
    }

    return {
      ok: true,
      exitCode: 0,
      state: created.state === 'created' ? 'created' : 'already_configured',
      accountAlias: config.accountAlias,
      checks,
    };
  } catch {
    return setupFailure(checks, 'config', 'UNEXPECTED_FAILURE');
  }
}

export interface MiniMaxProbePort {
  probe(): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: 'missing_key' | 'timeout' | 'invalid_json' | 'invalid_schema' | 'provider';
      }
  >;
}

export interface ScenarioCatalogPort {
  count(): Promise<{ ok: true; count: number } | { ok: false }>;
}

export interface PreflightPorts extends SetupPorts {
  scenarioCatalog: ScenarioCatalogPort;
  miniMaxProbe: MiniMaxProbePort;
}

export type PreflightResult =
  | {
      ok: true;
      exitCode: 0;
      summary: {
        hostname: 'home-dev';
        ports: { intexAgent: 8134; whatsappService: 8113; matrixAdapter: 8099 };
        judgeModel: typeof JUDGE_MODEL;
        scenarioCount: number;
        accountAlias: string;
      };
      checks: SafeCheckResult[];
    }
  | {
      ok: false;
      exitCode: 2;
      code: PreflightFailureCode;
      checks: SafeCheckResult[];
    };

function preflightFailure(
  checks: SafeCheckResult[],
  check: PreflightCheckId,
  code: PreflightFailureCode
): PreflightResult {
  return {
    ok: false,
    exitCode: 2,
    code,
    checks: [...checks, failedCheck(check, code)],
  };
}

function mapMiniMaxFailure(
  reason: Exclude<Awaited<ReturnType<MiniMaxProbePort['probe']>>, { ok: true }>['reason']
): PreflightFailureCode {
  switch (reason) {
    case 'missing_key':
      return 'MINIMAX_KEY_MISSING';
    case 'timeout':
      return 'MINIMAX_PROBE_TIMEOUT';
    case 'invalid_json':
    case 'invalid_schema':
      return 'MINIMAX_PROBE_INVALID';
    case 'provider':
      return 'MINIMAX_PROBE_FAILED';
  }
}

export async function runPreflight(ports: PreflightPorts): Promise<PreflightResult> {
  let checks: SafeCheckResult[] = [];
  let currentCheck: PreflightCheckId = 'runtime';
  try {
    const runtime = validateRuntime(ports.runtime, true);
    checks = runtime.checks;
    if (!runtime.ok) {
      return preflightFailure(checks, runtime.check, runtime.code);
    }

    currentCheck = 'config';
    const parent = await ports.protectedFiles.validatePrivateDirectory(dirname(ports.configPath));
    if (!parent.ok) {
      return preflightFailure(
        checks,
        'config',
        parent.reason === 'missing' ? 'CONFIG_NOT_FOUND' : 'CONFIG_PARENT_UNSAFE'
      );
    }

    const configRead = await ports.protectedFiles.read(ports.configPath, {
      mode: 0o600,
      maxBytes: CONFIG_MAX_BYTES,
    });
    if (!configRead.ok) {
      return preflightFailure(
        checks,
        'config',
        configRead.reason === 'missing' ? 'CONFIG_NOT_FOUND' : 'CONFIG_FILE_UNSAFE'
      );
    }
    const loadedConfig = parseEvaluatorConfigContents(configRead.contents);
    if (!loadedConfig.ok) {
      return preflightFailure(checks, 'config', 'CONFIG_INVALID');
    }
    checks.push({ check: 'config', status: 'passed' });

    currentCheck = 'matrix_files';
    const readiness = await validateAccountReadiness(loadedConfig.value, ports);
    checks.push(...readiness.checks);
    if (!readiness.ok) {
      return preflightFailure(checks, readiness.check, readiness.code);
    }

    currentCheck = 'scenario_catalog';
    const catalog = await ports.scenarioCatalog.count();
    if (!catalog.ok || !Number.isSafeInteger(catalog.count) || catalog.count < 0) {
      return preflightFailure(checks, 'scenario_catalog', 'SCENARIO_CATALOG_FAILED');
    }
    checks.push({ check: 'scenario_catalog', status: 'passed' });

    currentCheck = 'minimax_probe';
    const probe = await ports.miniMaxProbe.probe();
    if (!probe.ok) {
      return preflightFailure(checks, 'minimax_probe', mapMiniMaxFailure(probe.reason));
    }
    checks.push({ check: 'minimax_probe', status: 'passed' });

    return {
      ok: true,
      exitCode: 0,
      summary: {
        hostname: 'home-dev',
        ports: { intexAgent: 8134, whatsappService: 8113, matrixAdapter: 8099 },
        judgeModel: JUDGE_MODEL,
        scenarioCount: catalog.count,
        accountAlias: loadedConfig.value.accountAlias,
      },
      checks,
    };
  } catch {
    return preflightFailure(checks, currentCheck, 'UNEXPECTED_FAILURE');
  }
}

export function createNodeRuntimeIdentityPort(): RuntimeIdentityPort {
  return {
    platform: () => process.platform,
    hostname: () => nodeHostname(),
    uid: () => process.getuid?.(),
    env: (name) => process.env[name],
  };
}

interface BoundedBodyResult {
  ok: boolean;
  bytes?: Uint8Array;
}

async function readResponseBodyBounded(
  response: Response,
  maxBytes: number
): Promise<BoundedBodyResult> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      return { ok: false };
    }
  }

  if (response.body === null) {
    return { ok: true, bytes: new Uint8Array() };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        return { ok: true, bytes };
      }
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        return { ok: false };
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType !== null && /^application\/json(?:\s*;|$)/iu.test(contentType.trim());
}

export interface HealthHttpPortOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const LOCAL_HEALTH_TIMEOUT_MS = 5_000;
const HTTP_JSON_MAX_BYTES = 64 * 1024;

export function createHealthHttpPort(options: HealthHttpPortOptions = {}): HealthHttpPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? LOCAL_HEALTH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? HTTP_JSON_MAX_BYTES;

  return {
    async get(url): Promise<SafeHttpResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        });
        if (!hasJsonContentType(response)) {
          return { ok: false, reason: 'invalid_json' };
        }
        const body = await readResponseBodyBounded(response, maxBytes);
        if (!body.ok || body.bytes === undefined) {
          return { ok: false, reason: 'too_large' };
        }

        let parsed: unknown;
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(body.bytes);
          parsed = JSON.parse(text) as unknown;
        } catch {
          return { ok: false, reason: 'invalid_json' };
        }
        return { ok: true, status: response.status, body: parsed };
      } catch {
        return {
          ok: false,
          reason: controller.signal.aborted ? 'timeout' : 'network',
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

interface FirebaseAppLike {
  name: string;
}

interface FirebaseUserLike {
  disabled?: boolean;
}

interface FirebaseAuthLike {
  getUser(userId: string): Promise<FirebaseUserLike>;
}

export interface FirebaseAdminDependencies {
  getApps(): readonly FirebaseAppLike[];
  getApp(name: string): unknown;
  initializeApp(options: { projectId: string }, name: string): unknown;
  getAuth(app: unknown): FirebaseAuthLike;
  isUserNotFound(error: unknown): boolean;
}

const FIREBASE_APP_NAME = 'intex-agent-evals-preflight';

const FIREBASE_ADMIN_DEPENDENCIES: FirebaseAdminDependencies = {
  getApps,
  getApp,
  initializeApp,
  getAuth: (app) => getAuth(app as App),
  isUserNotFound: (error) =>
    error instanceof FirebaseAuthError && error.code === 'auth/user-not-found',
};

export function createFirebaseIdentityPort(
  projectId: string,
  dependencies: FirebaseAdminDependencies = FIREBASE_ADMIN_DEPENDENCIES
): FirebaseIdentityPort {
  let app: unknown;

  function getNamedApp(): unknown {
    if (app !== undefined) {
      return app;
    }
    app = dependencies.getApps().some((candidate) => candidate.name === FIREBASE_APP_NAME)
      ? dependencies.getApp(FIREBASE_APP_NAME)
      : dependencies.initializeApp({ projectId }, FIREBASE_APP_NAME);
    return app;
  }

  return {
    async getUserState(userId): ReturnType<FirebaseIdentityPort['getUserState']> {
      try {
        const record = await dependencies.getAuth(getNamedApp()).getUser(userId);
        return {
          ok: true,
          state: record.disabled === true ? 'disabled' : 'enabled',
        };
      } catch (error) {
        return dependencies.isUserNotFound(error) ? { ok: true, state: 'missing' } : { ok: false };
      }
    },
  };
}

type WhatsAppClientResult = { ok: true; value: unknown } | { ok: false; error: unknown };

interface WhatsAppReadinessClient {
  getPrivateMatrixDeliveryStatus(userId: string): Promise<WhatsAppClientResult>;
}

export type WhatsAppClientFactory = (
  config: WhatsAppServiceClientConfig
) => WhatsAppReadinessClient;

const NO_OP_LOGGER: InternalHttpClientLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

export interface WhatsAppReadinessPortOptions {
  internalAuthToken: string;
  clientFactory?: WhatsAppClientFactory;
}

export function createWhatsAppReadinessPort(
  options: WhatsAppReadinessPortOptions
): WhatsAppReadinessPort {
  const clientFactory = options.clientFactory ?? createWhatsAppServiceClient;
  const client = clientFactory({
    baseUrl: WHATSAPP_SERVICE_BASE_URL,
    internalAuthToken: options.internalAuthToken,
    defaultTimeoutMs: 10_000,
    logger: NO_OP_LOGGER,
  });

  return {
    async getDeliveryStatus(userId): ReturnType<WhatsAppReadinessPort['getDeliveryStatus']> {
      try {
        const result = await client.getPrivateMatrixDeliveryStatus(userId);
        return result.ok ? { ok: true, value: result.value } : { ok: false, reason: 'unavailable' };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
  };
}

type ScenarioCatalogLoader = (directoryPath: string) => Promise<readonly unknown[]>;

export interface ScenarioCatalogPortOptions {
  directoryPath: string;
  loadCatalog?: ScenarioCatalogLoader;
}

export function createScenarioCatalogPort(
  options: ScenarioCatalogPortOptions
): ScenarioCatalogPort {
  const loader = options.loadCatalog ?? loadScenarioCatalog;
  return {
    async count(): ReturnType<ScenarioCatalogPort['count']> {
      try {
        const scenarios = await loader(options.directoryPath);
        return { ok: true, count: scenarios.length };
      } catch {
        return { ok: false };
      }
    },
  };
}

interface ProductionSetupOptions {
  matrix: MatrixPreflightPort;
}

interface ProductionPreflightOptions extends ProductionSetupOptions {
  miniMaxProbe: MiniMaxProbePort;
}

function productionConfigPath(): string {
  return join(homedir(), '.config', 'intexuraos', 'intex-agent-evals.json');
}

export function createProductionSetupPorts(options: ProductionSetupOptions): SetupPorts {
  const runtime = createNodeRuntimeIdentityPort();
  const uid = runtime.uid();
  return {
    configPath: productionConfigPath(),
    runtime,
    protectedFiles: createNodeProtectedFilePort({
      expectedUid: uid !== undefined && Number.isSafeInteger(uid) && uid >= 0 ? uid : -1,
    }),
    healthHttp: createHealthHttpPort(),
    firebaseIdentity: createFirebaseIdentityPort(runtime.env('INTEXURAOS_GCP_PROJECT_ID') ?? ''),
    matrix: options.matrix,
    whatsapp: createWhatsAppReadinessPort({
      internalAuthToken: runtime.env('INTEXURAOS_INTERNAL_AUTH_TOKEN') ?? '',
    }),
  };
}

export function createProductionPreflightPorts(
  options: ProductionPreflightOptions
): PreflightPorts {
  return {
    ...createProductionSetupPorts(options),
    scenarioCatalog: createScenarioCatalogPort({
      directoryPath: fileURLToPath(new URL('../scenarios/', import.meta.url)),
    }),
    miniMaxProbe: options.miniMaxProbe,
  };
}
