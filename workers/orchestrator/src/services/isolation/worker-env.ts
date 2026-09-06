import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntexuraOSError, type Logger } from '@intexuraos/common-core';
import type { WorkerRuntime } from '../runtime/types.js';
import type { WorkerConfig, WorkerType } from './types.js';
import { WORKER_TYPES } from './types.js';
import type { LifecycleProviderConfig } from './worker-entry-types.js';

export const LIFECYCLE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const FORENSICS_SECCOMP_PROFILE_FILENAME = 'code-worker-forensics-seccomp.json';

export interface BuildWorkerEnvInput {
  taskId: string;
  runtime: WorkerRuntime;
  workerType: WorkerType;
  config: WorkerConfig;
  providerConfig: LifecycleProviderConfig;
}

export interface BuildWorkerEnvResult {
  env: string[];
  useSharedCreds: boolean;
  useSharedCodexAuth: boolean;
  keySuffix: string;
}

export function buildWorkerEnv(input: BuildWorkerEnvInput): BuildWorkerEnvResult {
  const { taskId, runtime, workerType, config, providerConfig } = input;
  const workerTypeConfig = WORKER_TYPES[workerType];
  const apiKey =
    workerTypeConfig.apiKeyEnvVar === undefined
      ? ''
      : config.secrets[workerTypeConfig.apiKeyEnvVar];

  const useSharedCreds =
    runtime === 'claude' &&
    providerConfig.sharedCredsPath !== undefined &&
    workerTypeConfig.apiKeyEnvVar === 'ANTHROPIC_API_KEY';
  const useSharedCodexAuth =
    runtime === 'codex' && providerConfig.sharedCodexAuthPath !== undefined;
  const requiredApiKeyEnvVar = workerTypeConfig.apiKeyEnvVar;

  if (runtime === 'claude') {
    if (requiredApiKeyEnvVar === undefined) {
      throw new IntexuraOSError(
        'MISCONFIGURED',
        `Worker type '${workerType}' is missing API key configuration`
      );
    }
    if (apiKey === '') {
      throw new IntexuraOSError(
        'MISCONFIGURED',
        `Worker type '${workerType}' requires ${requiredApiKeyEnvVar} but it is not configured`
      );
    }
  }

  if (runtime === 'codex' && !useSharedCodexAuth) {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      'Codex runtime requires sharedCodexAuthPath but it is not configured'
    );
  }

  const env = [
    `TASK_ID=${taskId}`,
    `LINEAR_API_KEY=${config.secrets.LINEAR_API_KEY}`,
    `ERROR_HUB_HOST=${config.secrets.ERROR_HUB_HOST}`,
    `WORKER_RUNTIME=${runtime}`,
    'CODE_WORKER_MODE=1',
    `WORKER_MANAGED_MODE=${providerConfig.managedAttemptsMode ? '1' : '0'}`,
    `WORKER_CONTINUE=${config.continueSession === true ? '1' : '0'}`,
    // Defense-in-depth supply-chain protection (INT-1524). Pnpm/npm honor these
    // — redundant with /etc/npmrc and ~/.npmrc but survives the LLM deleting
    // either file at runtime.
    'NPM_CONFIG_IGNORE_SCRIPTS=true',
    'npm_config_ignore_scripts=true',
  ];

  if (runtime === 'claude') {
    env.push('CLAUDE_PROJECT_DIR=/repo');
    if (!useSharedCreds) {
      env.push(`ANTHROPIC_API_KEY=${apiKey}`, `ANTHROPIC_BASE_URL=${workerTypeConfig.apiBaseUrl}`);
    }
    if (workerTypeConfig.model !== undefined) {
      env.push(`ANTHROPIC_MODEL=${workerTypeConfig.model}`);
    }
    if (workerTypeConfig.effort !== undefined) {
      env.push(`CLAUDE_CODE_EFFORT_LEVEL=${workerTypeConfig.effort}`);
    }
    if (workerTypeConfig.disableExperimentalBetas === true) {
      env.push('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1');
    }
  } else {
    env.push('CODEX_HOME=/home/claude/.codex');
    env.push('CODEX_SQLITE_HOME=/home/claude/.codex');
    if (workerTypeConfig.effort !== undefined) {
      env.push(`CODEX_REASONING_EFFORT=${workerTypeConfig.effort}`);
    }
  }

  if (providerConfig.gitUserName !== undefined) {
    env.push(`GIT_USER_NAME=${providerConfig.gitUserName}`);
  }
  if (providerConfig.gitUserEmail !== undefined) {
    env.push(`GIT_USER_EMAIL=${providerConfig.gitUserEmail}`);
  }
  if (providerConfig.forensicsMode) {
    env.push('WORKER_FORENSICS=1');
    env.push('WORKER_FORENSICS_DIR=/var/crash');
  }

  const keySuffix =
    runtime === 'codex'
      ? 'shared-auth (auth.json)'
      : useSharedCreds
        ? 'shared-creds (.credentials.json)'
        : apiKey.length > 4
          ? '...' + apiKey.slice(-4)
          : '****';

  return { env, useSharedCreds, useSharedCodexAuth, keySuffix };
}

export function resolveForensicsSeccompProfilePath(logger: Logger): string | null {
  const candidates = [
    path.resolve(LIFECYCLE_DIR, '../../../seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
    path.resolve(process.cwd(), 'workers/orchestrator/seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
    path.resolve(process.cwd(), 'seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  logger.warn(
    { candidates },
    'Forensics seccomp profile not found; ptrace tools may fail under default seccomp'
  );
  return null;
}

export function resolveForensicsSeccompSecurityOpt(logger: Logger): string | null {
  const profilePath = resolveForensicsSeccompProfilePath(logger);
  if (profilePath === null) {
    return null;
  }
  try {
    const profileJson: unknown = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    return `seccomp=${JSON.stringify(profileJson)}`;
  } catch (error) {
    logger.warn(
      { profilePath, error },
      'Forensics seccomp profile is invalid; using Docker default seccomp'
    );
    return null;
  }
}
