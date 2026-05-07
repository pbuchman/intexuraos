/**
 * Environment variable reading + type-safe configuration construction.
 *
 * Pure, side-effect-free functions: they throw `Error` on invalid input rather
 * than calling `process.exit()`, so they are testable in unit tests without
 * terminating the test runner. The `start.ts` entry point wraps the top-level
 * call in a catch handler that prints and exits.
 */

import { IntexuraOSError } from '@intexuraos/common-core';
import {
  DEFAULT_CAPACITY,
  DEFAULT_COMPLETION_MAX_ATTEMPTS,
  DEFAULT_PORT,
  DEFAULT_VALIDATION_MODELS,
  DEFAULT_WORKER_IMAGE,
} from '../types/constants.js';

/** Dictionary shape read from `process.env` (or a test double). */
export type EnvReader = Record<string, string | undefined>;

/**
 * Typed configuration object produced from the host environment.
 *
 * `start.ts` consumes this directly; no other module reads `process.env`
 * for the values listed here.
 */
export interface BootstrapEnvConfig {
  repoUrl: string;
  repoPath?: string;
  codeAgentUrl: string;
  internalAuthToken: string;
  orchestratorSecret: string;
  usageWebhookUrl: string;
  githubAppId: string;
  githubInstallationId: string;
  projectId: string;
  gcpSaKeyPath: string;
  port: number;
  capacity: number;
  completionMaxAttempts: number;
  validationModels: string;
  workerImage: string;
  keepContainersAlive: boolean;
  workerForensicsMode: boolean;
  workerForensicsBasePath?: string;
  preserveWorkerContainers: boolean;
  githubPrivateKeyOverride?: string;
  linearApiKey: string;
  sentryAuthToken: string;
  minimaxApiKey: string;
  mimoApiKey: string;
  dashscopeApiKey: string;
  kimiApiKey: string;
  openRouterApiKey: string;
  geminiApiKey: string;
  gitUserNameOverride?: string;
  gitUserEmailOverride?: string;
  logLevel: string;
  /**
   * Logical environment name forwarded to `initWorker()` (INT-1565 §S5).
   * Used as Sentry `environment` and on log-stream tags.
   */
  environment: string;
  /**
   * Sentry DSN read from `INTEXURAOS_SENTRY_DSN`. When unset, `initWorker()`
   * skips Sentry initialization (per `initWorker.ts`).
   */
  sentryDsn?: string;
  /**
   * Release identifier read from `K_REVISION` (Cloud Run) or
   * `INTEXURAOS_RELEASE`. Forwarded to `initWorker()` so Sentry events tag
   * the deployed revision.
   */
  release?: string;
}

/**
 * Reads a required environment variable, throwing a descriptive `Error`
 * if it is missing or empty.
 */
export function getRequiredEnv(name: string, env: EnvReader = process.env): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `Required environment variable '${name}' is not set. ` +
        `Add to .envrc: export ${name}=<value>`
    );
  }
  return value;
}

/**
 * Reads an optional environment variable, returning `defaultValue` if
 * the variable is unset or empty.
 */
export function getOptionalEnv(
  name: string,
  defaultValue: string,
  env: EnvReader = process.env
): string {
  const raw = env[name];
  return raw === undefined || raw === '' ? defaultValue : raw;
}

function parsePositiveInt(
  raw: string,
  name: string,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new IntexuraOSError('MISCONFIGURED', `Invalid ${name}: ${raw}`);
  }
  return parsed;
}

function readOptionalString(env: EnvReader, name: string): string | undefined {
  const raw = env[name];
  return raw !== undefined && raw !== '' ? raw : undefined;
}

function normalizeWorkerImageRef(image: string): string {
  const digestIndex = image.indexOf('@sha256:');
  if (digestIndex < 0) {
    return image;
  }
  return `${image.slice(0, digestIndex)}:latest`;
}

/**
 * Loads the full bootstrap configuration from the environment.
 *
 * Throws an `Error` naming the first missing required variable or invalid
 * value. Does not read any files or call out to GCP — use
 * `validateGcpCredentials`, `fetchGitHubKeys`, etc. for those concerns.
 */
export function loadEnvConfig(env: EnvReader = process.env): BootstrapEnvConfig {
  const repoUrl = getRequiredEnv('INTEXURAOS_REPOSITORY_URL', env);
  const codeAgentUrl = getRequiredEnv('INTEXURAOS_CODE_AGENT_URL', env);
  const internalAuthToken = getRequiredEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN', env);
  const orchestratorSecret = getRequiredEnv('INTEXURAOS_ORCHESTRATOR_SECRET', env);
  const usageWebhookUrl = getRequiredEnv('INTEXURAOS_USAGE_WEBHOOK_URL', env);
  const githubAppId = getRequiredEnv('INTEXURAOS_GITHUB_APP_ID', env);
  const githubInstallationId = getRequiredEnv('INTEXURAOS_GITHUB_INSTALLATION_ID', env);
  const projectId = getRequiredEnv('INTEXURAOS_PROJECT_ID', env);
  const gcpSaKeyPath = getRequiredEnv('GOOGLE_APPLICATION_CREDENTIALS', env);

  const portRaw = getOptionalEnv('PORT', String(DEFAULT_PORT), env);
  const port = parsePositiveInt(portRaw, 'PORT', 1, 65535);

  const capacityRaw = getOptionalEnv('INTEXURAOS_WORKER_CAPACITY', String(DEFAULT_CAPACITY), env);
  const capacity = parsePositiveInt(capacityRaw, 'INTEXURAOS_WORKER_CAPACITY');

  const completionMaxAttemptsRaw = getOptionalEnv(
    'INTEXURAOS_COMPLETION_MAX_ATTEMPTS',
    String(DEFAULT_COMPLETION_MAX_ATTEMPTS),
    env
  );
  const completionMaxAttempts = parsePositiveInt(
    completionMaxAttemptsRaw,
    'INTEXURAOS_COMPLETION_MAX_ATTEMPTS'
  );

  const validationModels = getOptionalEnv(
    'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS',
    DEFAULT_VALIDATION_MODELS,
    env
  );
  const workerImage = normalizeWorkerImageRef(
    getOptionalEnv('INTEXURAOS_CODE_WORKER_IMAGE', DEFAULT_WORKER_IMAGE, env)
  );

  const keepContainersAlive = env['KEEP_CONTAINERS_ALIVE'] === '1';
  const workerForensicsMode = getOptionalEnv('INTEXURAOS_CODE_WORKER_FORENSICS', '0', env) === '1';
  const preserveWorkerContainers =
    getOptionalEnv('INTEXURAOS_PRESERVE_WORKER_CONTAINERS', '1', env) !== '0';

  const linearApiKey = getRequiredEnv('INTEXURAOS_LINEAR_API_KEY', env);
  const sentryAuthToken = getRequiredEnv('INTEXURAOS_SENTRY_AUTH_TOKEN', env);
  const minimaxApiKey = getRequiredEnv('INTEXURAOS_MINIMAX_APP_API_KEY', env);
  const mimoApiKey = getRequiredEnv('INTEXURAOS_MIMO_APP_API_KEY', env);
  const dashscopeApiKey = getRequiredEnv('INTEXURAOS_DASHSCOPE_APP_API_KEY', env);
  const kimiApiKey = getRequiredEnv('INTEXURAOS_KIMI_APP_API_KEY', env);
  const geminiApiKey = getRequiredEnv('INTEXURAOS_GEMINI_APP_API_KEY', env);
  const openRouterApiKey = env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '';

  const logLevel = getOptionalEnv('LOG_LEVEL', 'info', env);
  // Environment name for the unified worker bootstrap (INT-1565 §S5). The
  // INTEXURAOS_ENVIRONMENT var is the canonical source; NODE_ENV is consulted
  // as a fallback for dev shells that don't export it. Defaults to
  // `development` so a missing value never crashes initWorker().
  const environment = getOptionalEnv(
    'INTEXURAOS_ENVIRONMENT',
    getOptionalEnv('NODE_ENV', 'development', env),
    env
  );

  const repoPath = readOptionalString(env, 'INTEXURAOS_REPOSITORY_PATH');
  const workerForensicsBasePath = readOptionalString(env, 'INTEXURAOS_CODE_WORKER_FORENSICS_PATH');
  const githubPrivateKeyOverride = readOptionalString(env, 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY');
  const gitUserNameOverride = readOptionalString(env, 'INTEXURAOS_GIT_USER_NAME');
  const gitUserEmailOverride = readOptionalString(env, 'INTEXURAOS_GIT_USER_EMAIL');
  const sentryDsn = readOptionalString(env, 'INTEXURAOS_SENTRY_DSN');
  // Release identifier: prefer Cloud Run's K_REVISION (auto-injected on every
  // deploy) and fall back to an explicit override for non-Cloud-Run hosts.
  const release =
    readOptionalString(env, 'K_REVISION') ?? readOptionalString(env, 'INTEXURAOS_RELEASE');

  return {
    repoUrl,
    ...(repoPath !== undefined ? { repoPath } : {}),
    codeAgentUrl,
    internalAuthToken,
    orchestratorSecret,
    usageWebhookUrl,
    githubAppId,
    githubInstallationId,
    projectId,
    gcpSaKeyPath,
    port,
    capacity,
    completionMaxAttempts,
    validationModels,
    workerImage,
    keepContainersAlive,
    workerForensicsMode,
    ...(workerForensicsBasePath !== undefined ? { workerForensicsBasePath } : {}),
    preserveWorkerContainers,
    ...(githubPrivateKeyOverride !== undefined ? { githubPrivateKeyOverride } : {}),
    linearApiKey,
    sentryAuthToken,
    minimaxApiKey,
    mimoApiKey,
    dashscopeApiKey,
    kimiApiKey,
    openRouterApiKey,
    geminiApiKey,
    ...(gitUserNameOverride !== undefined ? { gitUserNameOverride } : {}),
    ...(gitUserEmailOverride !== undefined ? { gitUserEmailOverride } : {}),
    logLevel,
    environment,
    ...(sentryDsn !== undefined ? { sentryDsn } : {}),
    ...(release !== undefined ? { release } : {}),
  };
}
