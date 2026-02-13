#!/usr/bin/env node
/**
 * Orchestrator entry point.
 *
 * Reads configuration from environment variables and starts the orchestrator.
 * For development: uses INTEXURAOS_* env vars loaded via direnv (.envrc)
 * For production: can fetch secrets from GCP Secret Manager
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import pino from 'pino';
import { serializeError } from '@intexuraos/common-core';

const errorSerializers = { error: serializeError, err: serializeError };

import { main } from './main.js';
import { StatePersistence } from './services/state-persistence.js';
import { TaskDispatcher } from './services/task-dispatcher.js';
import { GitHubTokenService } from './github/token-service.js';
import { WebhookClient } from './services/webhook-client.js';
import { WorktreeManager } from './services/worktree-manager.js';
import { LogForwarder } from './services/log-forwarder.js';
import { createHeartbeatManager } from './heartbeat.js';
import { createIsolationProvider, TokenRefresher } from './services/isolation/index.js';
import { ApiKeyValidator } from './services/api-key-validator.js';
import { ensureRepository } from './services/repo-manager.js';
import type { OrchestratorConfig } from './types/config.js';
import type { CompletionControlConfig, IsolationConfig } from './services/task-dispatcher.js';
import { LlmModels } from '@intexuraos/llm-contract';
import { OrchestratorCompletionVerifier } from './services/completion-verifier.js';

const DEFAULT_PORT = 8199;
const DEFAULT_CAPACITY = 2;
const DEFAULT_TASK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const EXEC_TIMEOUT_MS = 30 * 1000; // 30 seconds for external commands
const DEFAULT_COMPLETION_MAX_ATTEMPTS = 3;
const DEFAULT_WORKER_IMAGE =
  'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  /* v8 ignore start -- test-infra: process.exit() terminates the process, cannot test in unit tests @preserve */
  if (value === undefined || value === '') {
    process.stderr.write(
      `\n❌ PRECONDITION FAILED: Required environment variable '${name}' is not set\n`
    );
    process.stderr.write(`   Add to .envrc: export ${name}=<value>\n\n`);
    process.exit(1);
  }
  /* v8 ignore stop @preserve */
  return value;
}

/* v8 ignore start -- ts-type: nullish coalescing creates type narrowing branch @preserve */
function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}
/* v8 ignore stop @preserve */

/**
 * Validate GCP credentials are properly configured
 */
/* v8 ignore start -- test-infra: process.exit() in validation function @preserve */
function validateGcpCredentials(gcpSaKeyPath: string, projectId: string): void {
  // Check if credentials file exists
  if (!existsSync(gcpSaKeyPath)) {
    process.stderr.write(`\n❌ PRECONDITION FAILED: GCP service account key not found\n`);
    process.stderr.write(`   Expected path: ${gcpSaKeyPath}\n`);
    process.stderr.write(
      `   Add to .envrc: export GOOGLE_APPLICATION_CREDENTIALS=<path-to-key.json>\n\n`
    );
    process.exit(1);
  }

  // Try to authenticate with timeout
  try {
    execSync(
      `gcloud auth activate-service-account --key-file="${gcpSaKeyPath}" --project="${projectId}"`,
      { timeout: EXEC_TIMEOUT_MS, stdio: 'pipe' }
    );
  } catch (_error) {
    process.stderr.write(`\n❌ PRECONDITION FAILED: GCP authentication failed\n`);
    process.stderr.write(`   Credentials file: ${gcpSaKeyPath}\n`);
    process.stderr.write(`   Verify the file exists, is readable, and has correct permissions\n`);
    process.stderr.write(
      `   Test with: gcloud auth activate-service-account --key-file="${gcpSaKeyPath}"\n\n`
    );
    process.exit(1);
  }
}
/* v8 ignore stop @preserve */

/**
 * Check if a port is available (synchronous check using lsof)
 */
/* v8 ignore start -- test-infra: process.exit() in validation function @preserve */
function validatePortAvailable(port: number): void {
  try {
    // Use lsof to check if port is in use
    execSync(`lsof -i :${String(port)} -P -n`, { stdio: 'pipe', timeout: 5000 });
    // If lsof succeeded, port is in use
    process.stderr.write(`\n❌ PRECONDITION FAILED: Port ${String(port)} is already in use\n`);
    process.stderr.write(`   Another process is listening on this port\n`);
    process.stderr.write(`   Find the process: lsof -i :${String(port)}\n`);
    process.stderr.write(`   Or use a different port: export PORT=${String(port + 1)}\n\n`);
    process.exit(1);
  } catch (error) {
    // lsof failed (exit code 1) means port is available - this is good
    const err = error as { status: number | null };
    if (err.status === null || err.status === 1) {
      // Port is available
      return;
    }
    // Other error (timeout, etc.) - continue and let runtime catch it
  }
}
/* v8 ignore stop @preserve */

/**
 * Validate worker API keys by calling the Anthropic /v1/models endpoint.
 * Warns (does not exit) so GLM tasks can still run with an invalid Anthropic key.
 */
/* v8 ignore start -- test-infra: startup validation with network call @preserve */
async function validateWorkerApiKeys(
  anthropicKey: string,
  zaiKey: string,
  logger: pino.Logger
): Promise<void> {
  const suffix = (key: string): string => (key.length > 4 ? '...' + key.slice(-4) : '****');

  if (anthropicKey !== '') {
    const keySuffix = suffix(anthropicKey);
    try {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        logger.info({ apiKey: keySuffix }, 'ANTHROPIC_API_KEY validated successfully');
      } else {
        logger.error(
          { status: resp.status, apiKey: keySuffix },
          'ANTHROPIC_API_KEY validation failed — opus/auto tasks will fail'
        );
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), apiKey: keySuffix },
        'ANTHROPIC_API_KEY validation request failed (network issue) — key may still be valid'
      );
    }
  }

  if (zaiKey !== '') {
    const keySuffix = suffix(zaiKey);
    try {
      const resp = await fetch('https://api.z.ai/api/anthropic/v1/models', {
        method: 'GET',
        headers: { 'x-api-key': zaiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        logger.info({ apiKey: keySuffix }, 'ZAI_API_KEY validated successfully');
      } else {
        logger.error(
          { status: resp.status, apiKey: keySuffix },
          'ZAI_API_KEY validation failed — glm tasks will fail'
        );
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), apiKey: keySuffix },
        'ZAI_API_KEY validation request failed (network issue) — key may still be valid'
      );
    }
  }
}
/* v8 ignore stop @preserve */

/* v8 ignore start -- module-init: directory setup function called during bootstrap @preserve */
function ensureDirectoryExists(path: string): void {
  mkdirSync(path, { recursive: true });
}
/* v8 ignore stop @preserve */

/**
 * Get GitHub private key from Secret Manager or cached file.
 * The key is multiline (PEM format) so it can't be in .envrc.
 */
/* v8 ignore start -- test-infra: process.exit() in catch block terminates the process @preserve */
function getGitHubPrivateKey(projectId: string, cachePath: string, gcpSaKeyPath: string): string {
  // Check env var first (for testing or manual override)
  const envKey = process.env['INTEXURAOS_GITHUB_APP_PRIVATE_KEY'];
  if (envKey) {
    return envKey;
  }

  // Check if cached file exists and is recent (< 1 hour old)
  if (existsSync(cachePath)) {
    /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
    const stats = statSync(cachePath);
    /* v8 ignore stop @preserve */
    const ageMs = Date.now() - stats.mtimeMs;
    /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
    if (ageMs < 60 * 60 * 1000) {
      return readFileSync(cachePath, 'utf-8');
    }
    /* v8 ignore stop @preserve */
  }

  // Fetch from Secret Manager with timeout
  process.stderr.write('Fetching GitHub private key from Secret Manager...\n');
  try {
    const key = execSync(
      `gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_PRIVATE_KEY --project=${projectId}`,
      { encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS }
    ).trim();
    return key;
  } catch (_error) {
    process.stderr.write(
      `\n❌ PRECONDITION FAILED: Failed to fetch GitHub private key from Secret Manager\n`
    );
    process.stderr.write(`   GCP credentials: ${gcpSaKeyPath}\n`);
    process.stderr.write(`   Project: ${projectId}\n`);
    process.stderr.write(`   Ensure:\n`);
    process.stderr.write(
      `     1. GOOGLE_APPLICATION_CREDENTIALS points to valid service account key\n`
    );
    process.stderr.write(`     2. Service account has 'roles/secretmanager.secretAccessor' role\n`);
    process.stderr.write(
      `     3. Secret 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY' exists in the project\n`
    );
    process.stderr.write(
      `     4. Network connectivity allows access to secretmanager.googleapis.com\n\n`
    );
    process.stderr.write(`   Test manually:\n`);
    process.stderr.write(`     gcloud secrets versions access latest \\\n`);
    process.stderr.write(`       --secret=INTEXURAOS_GITHUB_APP_PRIVATE_KEY \\\n`);
    process.stderr.write(`       --project=${projectId}\n\n`);
    process.exit(1);
  }
}
/* v8 ignore stop @preserve */

/* v8 ignore start -- module-init: orchestrator bootstrap function: env vars, service wiring @preserve */
async function bootstrap(): Promise<void> {
  const home = homedir();
  const orchestratorDir = join(home, '.claude-orchestrator');
  const worktreeDir = join(home, 'claude-workers', 'worktrees');
  const logsDir = join(orchestratorDir, 'logs');
  const defaultRepoPath = join(orchestratorDir, 'repo');

  // Repository configuration
  const repoUrl = getRequiredEnv('INTEXURAOS_REPOSITORY_URL');
  const repoPath = getOptionalEnv('INTEXURAOS_REPOSITORY_PATH', defaultRepoPath);

  // Ensure directories exist
  ensureDirectoryExists(orchestratorDir);
  ensureDirectoryExists(worktreeDir);
  ensureDirectoryExists(logsDir);

  // Load required env vars
  const codeAgentUrl = getRequiredEnv('INTEXURAOS_CODE_AGENT_URL');
  const orchestratorSecret = getRequiredEnv('INTEXURAOS_ORCHESTRATOR_SECRET');
  const githubAppId = getRequiredEnv('INTEXURAOS_GITHUB_APP_ID');
  const githubInstallationId = getRequiredEnv('INTEXURAOS_GITHUB_INSTALLATION_ID');
  const projectId = getRequiredEnv('INTEXURAOS_PROJECT_ID');

  // Validate GCP credentials early (before any gcloud commands)
  const gcpSaKeyPath = getRequiredEnv('GOOGLE_APPLICATION_CREDENTIALS');
  validateGcpCredentials(gcpSaKeyPath, projectId);

  // GitHub private key: fetch from Secret Manager (multiline, not in .envrc)
  const privateKeyPath = join(orchestratorDir, 'github-app.pem');
  const githubPrivateKey = getGitHubPrivateKey(projectId, privateKeyPath, gcpSaKeyPath);
  writeFileSync(privateKeyPath, githubPrivateKey, { mode: 0o600 });

  // Load optional env vars
  const port = parseInt(getOptionalEnv('PORT', String(DEFAULT_PORT)), 10);
  const capacity = parseInt(
    getOptionalEnv('INTEXURAOS_WORKER_CAPACITY', String(DEFAULT_CAPACITY)),
    10
  );

  // Validate port is available before starting
  validatePortAvailable(port);

  // Build config
  const config: OrchestratorConfig = {
    port,
    capacity,
    taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
    stateFilePath: join(orchestratorDir, 'state.json'),
    worktreeBasePath: worktreeDir,
    logBasePath: logsDir,
    codeAgentUrl,
    githubAppId,
    githubAppPrivateKeyPath: privateKeyPath,
    githubInstallationId,
    orchestratorSecret,
  };

  const logFilePath = join(logsDir, 'orchestrator.log');
  const llmAuditLogPath = join(logsDir, 'llm-audit.log');
  const logLevel = process.env['LOG_LEVEL'] ?? 'info';

  // Create logger — pretty stdout + JSON file for debugging
  const logger = pino({
    level: logLevel,
    serializers: errorSerializers,
    transport: {
      targets: [
        {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
          level: logLevel,
        },
        { target: 'pino/file', options: { destination: logFilePath }, level: logLevel },
      ],
    },
  });

  logger.info({ port: config.port, capacity: config.capacity }, 'Starting orchestrator');

  // Ensure repository is cloned and up-to-date
  await ensureRepository(repoUrl, repoPath, logger);

  // Create services
  const statePersistence = new StatePersistence(config.stateFilePath, logger);

  const tokenService = new GitHubTokenService(
    config.githubAppId,
    config.githubAppPrivateKeyPath,
    config.githubInstallationId,
    join(orchestratorDir, 'github-token')
  );

  const internalAuthToken = getRequiredEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN');
  const webhookClient = new WebhookClient(statePersistence, logger, internalAuthToken);

  const worktreeManager = new WorktreeManager(
    {
      repositoryPath: repoPath,
      worktreeBasePath: config.worktreeBasePath,
      mcpConfigTemplatePath: join(repoPath, '.mcp.json'),
    },
    logger
  );

  const logForwarder = new LogForwarder(
    {
      logBasePath: config.logBasePath,
      codeAgentUrl: config.codeAgentUrl,
      orchestratorSecret: config.orchestratorSecret,
      internalAuthToken,
    },
    logger
  );

  // Create Docker isolation provider
  const secretsBasePath = join(orchestratorDir, 'secrets');
  const workerImage = getOptionalEnv('INTEXURAOS_CLAUDE_WORKER_IMAGE', DEFAULT_WORKER_IMAGE);
  const keepContainersAlive = process.env['KEEP_CONTAINERS_ALIVE'] === '1';
  if (keepContainersAlive) {
    logger.info({}, 'Debug mode: containers will be kept alive after task completion');
  }
  const preserveFailedContainers =
    getOptionalEnv('INTEXURAOS_PRESERVE_FAILED_WORKER_CONTAINERS', '1') !== '0';
  const isolationProvider = await createIsolationProvider(
    {
      secretsBasePath,
      gcpSaKeyPath,
      keepContainersAlive,
      imageName: workerImage,
    },
    logger
  );
  const tokenRefresher = new TokenRefresher(
    {
      secretsBasePath,
      githubAppId: config.githubAppId,
      githubAppPrivateKeyPath: config.githubAppPrivateKeyPath,
      githubInstallationId: config.githubInstallationId,
      refreshIntervalMs: 30 * 60 * 1000, // 30 minutes
    },
    logger
  );

  // Get API keys for workers
  const apiKeySecrets = {
    // Fail-fast: orchestrator requires both worker API keys at startup.
    ANTHROPIC_API_KEY: getRequiredEnv('INTEXURAOS_ANTHROPIC_API_KEY'),
    LINEAR_API_KEY: getRequiredEnv('INTEXURAOS_LINEAR_API_KEY'),
    SENTRY_AUTH_TOKEN: getRequiredEnv('INTEXURAOS_SENTRY_AUTH_TOKEN'),
    ZAI_API_KEY: getRequiredEnv('INTEXURAOS_ZAI_API_KEY'),
  };

  const apiKeyValidator = new ApiKeyValidator(apiKeySecrets, logger);

  const isolationConfig: IsolationConfig = {
    provider: isolationProvider,
    tokenRefresher,
    apiKeyValidator,
    secrets: apiKeySecrets,
    gcpSaKeyPath,
    githubAppKeyPath: config.githubAppPrivateKeyPath,
  };

  // Validate API keys asynchronously (non-blocking, warns on failure)
  void validateWorkerApiKeys(
    isolationConfig.secrets.ANTHROPIC_API_KEY,
    isolationConfig.secrets.ZAI_API_KEY,
    logger
  );

  const completionMaxAttemptsRaw = parseInt(
    getOptionalEnv('INTEXURAOS_COMPLETION_MAX_ATTEMPTS', String(DEFAULT_COMPLETION_MAX_ATTEMPTS)),
    10
  );
  if (!Number.isInteger(completionMaxAttemptsRaw) || completionMaxAttemptsRaw < 1) {
    process.stderr.write(
      `\n❌ PRECONDITION FAILED: INTEXURAOS_COMPLETION_MAX_ATTEMPTS must be >= 1\n\n`
    );
    process.exit(1);
  }

  // Hard gate: completion verification is always enabled and Gemini-only.
  const geminiVerifierKey = getRequiredEnv('INTEXURAOS_GEMINI_APP_API_KEY');
  const completionVerifier = new OrchestratorCompletionVerifier(logger, {
    model: LlmModels.Gemini25Flash,
    geminiApiKey: geminiVerifierKey,
    auditLogPath: llmAuditLogPath,
  });

  const logDrainTimeoutMs = parseInt(
    getOptionalEnv('INTEXURAOS_LOG_DRAIN_TIMEOUT_MS', '30000'),
    10
  );

  const completionControl: CompletionControlConfig = {
    maxAttempts: completionMaxAttemptsRaw,
    verifier: completionVerifier,
    preserveFailedContainers,
    logDrainTimeoutMs,
  };

  logger.info(
    {
      completionMaxAttempts: completionControl.maxAttempts,
      preserveFailedContainers,
      workerImage,
      verifier: completionVerifier.describe(),
    },
    'Completion verification configuration'
  );

  const dispatcher = new TaskDispatcher(
    config,
    statePersistence,
    worktreeManager,
    logForwarder,
    webhookClient,
    tokenService,
    logger,
    isolationConfig,
    completionControl
  );

  // Create heartbeat manager
  const heartbeatManager = createHeartbeatManager(
    {
      codeAgentUrl: config.codeAgentUrl,
      orchestratorSecret: config.orchestratorSecret,
      intervalMs: 10 * 60 * 1000, // 10 minutes
      getRunningTasks: () => dispatcher.getRunningTaskIds(),
    },
    logger
  );

  // Start orchestrator
  await main(
    config,
    statePersistence,
    dispatcher,
    tokenService,
    webhookClient,
    heartbeatManager,
    logger,
    isolationProvider
  );
}
/* v8 ignore stop @preserve */

/* v8 ignore start -- module-init: bootstrap invocation and fatal error handler @preserve */
bootstrap().catch((error: unknown) => {
  process.stderr.write(`Failed to start orchestrator: ${String(error)}\n`);
  process.exit(1);
});
/* v8 ignore stop @preserve */
