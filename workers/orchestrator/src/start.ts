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
import { CredentialMonitor } from './services/isolation/credential-monitor.js';
import { CredentialRefresher } from './services/isolation/credential-refresher.js';
import {
  ClaudeAuthManager,
  CodexAuthManager,
  CodexAuthRefresher,
  WorkerAuthRegistry,
} from './services/worker-auth/index.js';
import Docker from 'dockerode';
import { ApiKeyValidator } from './services/api-key-validator.js';
import { WORKER_TYPES } from './services/isolation/types.js';
import { ensureRepository } from './services/repo-manager.js';
import type { OrchestratorConfig } from './types/config.js';
import type { CompletionControlConfig, IsolationConfig } from './services/task-dispatcher.js';
import { LlmModels } from '@intexuraos/llm-contract';
import { OrchestratorCompletionVerifier } from './services/completion-verifier.js';
import { TurnMetricsCollector } from './services/turn-metrics-collector.js';
import { OrchestratorAgentComplianceValidator } from './services/agent-compliance-validator.js';

const DEFAULT_PORT = 8199;
const DEFAULT_CAPACITY = 2;
const DEFAULT_TASK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const EXEC_TIMEOUT_MS = 60 * 1000; // 60 seconds for external commands (gcloud is slow under systemd sandboxing)
const DEFAULT_COMPLETION_MAX_ATTEMPTS = 3;
const DEFAULT_WORKER_IMAGE =
  'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest';

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

/* v8 ignore start -- module-init: reads host git config at startup, requires git CLI @preserve */
function readHostGitConfig(key: string): string | undefined {
  try {
    const value = execSync(`git config ${key}`, { encoding: 'utf-8', timeout: 5000 }).trim();
    return value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

function readRepoGitConfig(repoPath: string, key: string): string | undefined {
  try {
    const value = execSync(`git -C ${repoPath} config --local ${key}`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}
/* v8 ignore stop @preserve */

/**
 * Validate GCP credentials are properly configured
 */
/* v8 ignore start -- test-infra: cannot test startup validation that calls process.exit() @preserve */
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
/* v8 ignore start -- test-infra: cannot test startup validation that calls process.exit() @preserve */
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
 * Validate worker API keys at startup.
 * Validates Anthropic OAuth credentials and third-party API keys.
 * Warns (does not exit) so tasks of one type can still run if the other fails.
 */
/* v8 ignore start -- test-infra: cannot test startup bootstrap that makes live network calls @preserve */
async function fetchWithRetry(
  input: string,
  init: RequestInit & { signal?: AbortSignal },
  retries = 3,
  delayMs = 2000
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) });
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw new Error('fetchWithRetry: unreachable');
}

async function validateThirdPartyApiKey(
  workerTypeName: string,
  apiKey: string,
  suffix: (key: string) => string,
  logger: pino.Logger
): Promise<void> {
  const config = WORKER_TYPES[workerTypeName as keyof typeof WORKER_TYPES];
  const keyName = config.apiKeyEnvVar;
  const keySuffix = suffix(apiKey);

  if (keyName === undefined) {
    logger.info(
      { workerTypeName },
      'Skipping API-key validation for runtime without direct API-key authentication'
    );
    return;
  }

  const url =
    config.model !== undefined
      ? `${config.apiBaseUrl}/v1/messages`
      : `${config.apiBaseUrl}/v1/models`;

  const fetchOptions =
    config.model !== undefined
      ? {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        }
      : {
          method: 'GET',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        };

  try {
    const resp = await fetchWithRetry(url, fetchOptions);
    if (resp.ok) {
      logger.info({ apiKey: keySuffix }, `${keyName} validated successfully`);
    } else {
      logger.error(
        { status: resp.status, apiKey: keySuffix },
        `${keyName} validation failed — ${workerTypeName} tasks will fail`
      );
    }
  } catch (error) {
    const errorDetail = extractErrorChain(error);
    logger.warn(
      { error: errorDetail, url, apiKey: keySuffix },
      `${keyName} validation request failed (network issue) — key may still be valid`
    );
  }
}

function extractErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current !== null && current !== undefined) {
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      parts.push(code !== undefined ? `${current.message} [${code}]` : current.message);
      current = current.cause;
    } else if (typeof current === 'string') {
      parts.push(current);
      break;
    } else {
      parts.push(JSON.stringify(current));
      break;
    }
  }
  return parts.join(' → ');
}

function logWorkerAuthStartupStatus(
  workerAuthRegistry: WorkerAuthRegistry,
  logger: pino.Logger
): void {
  const states = workerAuthRegistry.getStates();
  const claudeState = states.claude;
  const codexState = states.codex;

  if (claudeState.status === 'active') {
    logger.info(
      {
        expiresAt: claudeState.expiresAt,
        expiresInMinutes: claudeState.expiresInMinutes,
        subscriptionType: claudeState.subscriptionType,
      },
      'Code worker auth active'
    );
  } else {
    logger.warn({ state: claudeState }, 'Code worker auth not ready');
  }

  if (codexState.status === 'active') {
    logger.info(
      {
        authMode: codexState.authMode,
        expiresAt: codexState.expiresAt,
        expiresInMinutes: codexState.expiresInMinutes,
        lastRefreshAt: codexState.lastRefreshAt,
      },
      'Codex worker auth active'
    );
  } else {
    logger.warn({ state: codexState }, 'Codex worker auth not ready');
  }
}

async function validateWorkerApiKeys(
  workerAuthRegistry: WorkerAuthRegistry,
  minimaxKey: string,
  dashscopeKey: string,
  openRouterKey: string,
  logger: pino.Logger
): Promise<void> {
  const suffix = (key: string): string => (key.length > 4 ? '...' + key.slice(-4) : '****');

  const claudeState = workerAuthRegistry.getState('claude');
  if (claudeState.status === 'active') {
    logger.info(
      {
        expiresInMinutes: claudeState.expiresInMinutes,
        subscriptionType: claudeState.subscriptionType,
      },
      'Code worker auth validated — Claude-backed tasks ready'
    );
  } else {
    logger.warn({ state: claudeState }, 'Code worker auth not ready at startup');
  }

  const codexState = workerAuthRegistry.getState('codex');
  if (codexState.status === 'active') {
    logger.info(
      {
        authMode: codexState.authMode,
        expiresInMinutes: codexState.expiresInMinutes,
        lastRefreshAt: codexState.lastRefreshAt,
      },
      'Codex worker auth validated — Codex tasks ready'
    );
  } else {
    logger.warn({ state: codexState }, 'Codex worker auth not ready at startup');
  }

  // Validate all third-party API keys in parallel.
  // GLM, Qwen, and Kimi all use the same DashScope API key.
  await Promise.all([
    minimaxKey !== ''
      ? validateThirdPartyApiKey('minimax', minimaxKey, suffix, logger)
      : Promise.resolve(),
    dashscopeKey !== ''
      ? Promise.all([
          validateThirdPartyApiKey('qwen', dashscopeKey, suffix, logger),
          validateThirdPartyApiKey('kimi', dashscopeKey, suffix, logger),
        ])
      : Promise.resolve(),
    openRouterKey !== ''
      ? validateThirdPartyApiKey('openrouter-free', openRouterKey, suffix, logger)
      : Promise.resolve(),
  ]);
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
/* v8 ignore start -- test-infra: cannot test bootstrap function that calls process.exit() on failure @preserve */
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
  const orchestratorDir = join(home, '.code-orchestrator');
  const worktreeDir = join(home, 'code-workers', 'worktrees');
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
  const internalAuthToken = getRequiredEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN');
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

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${getOptionalEnv('PORT', String(DEFAULT_PORT))}`);
  }
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new Error(
      `Invalid INTEXURAOS_WORKER_CAPACITY: ${getOptionalEnv('INTEXURAOS_WORKER_CAPACITY', String(DEFAULT_CAPACITY))}`
    );
  }

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
    secretsBasePath: join(orchestratorDir, 'secrets'),
    internalAuthToken,
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
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
          level: logLevel,
        },
        { target: 'pino/file', options: { destination: logFilePath }, level: logLevel },
      ],
    },
  });

  logger.info({ port: config.port, capacity: config.capacity }, 'Starting orchestrator');

  let codeVersion = 'unknown';
  try {
    codeVersion = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // git may not be available in all environments
  }
  logger.info({ codeVersion, nodeVersion: process.version }, 'Orchestrator code version');

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

  const webhookClient = new WebhookClient(statePersistence, logger, config.internalAuthToken);

  const worktreeManager = new WorktreeManager(
    {
      repositoryPath: repoPath,
      worktreeBasePath: config.worktreeBasePath,
      mcpConfigTemplatePath: join(repoPath, '.mcp.json'),
      settingsLocalTemplatePath: join(
        repoPath,
        'workers',
        'code-worker',
        'config-defaults',
        'settings.local.json'
      ),
    },
    logger
  );

  const logForwarder = new LogForwarder(
    {
      logBasePath: config.logBasePath,
      codeAgentUrl: config.codeAgentUrl,
      orchestratorSecret: config.orchestratorSecret,
      internalAuthToken: config.internalAuthToken,
    },
    logger
  );

  // Resolve git identity for worker containers (env var → host git config → undefined)
  const gitUserName = process.env['INTEXURAOS_GIT_USER_NAME'] ?? readHostGitConfig('user.name');
  const gitUserEmail = process.env['INTEXURAOS_GIT_USER_EMAIL'] ?? readHostGitConfig('user.email');
  logger.info({ gitUserName, gitUserEmail }, 'Git identity for worker containers');

  // Log repo-level git config — this overrides global config in worktrees
  const repoUserName = readRepoGitConfig(repoPath, 'user.name');
  const repoUserEmail = readRepoGitConfig(repoPath, 'user.email');
  if (repoUserName !== undefined || repoUserEmail !== undefined) {
    logger.warn(
      { repoUserName, repoUserEmail },
      'Repository has local git user config — this OVERRIDES the identity passed to containers. ' +
        'Run: git -C <repo> config --unset user.name && git -C <repo> config --unset user.email'
    );
  }
  const effectiveName = repoUserName ?? gitUserName ?? 'NOT SET';
  const effectiveEmail = repoUserEmail ?? gitUserEmail ?? 'NOT SET';
  logger.info(
    { effectiveName, effectiveEmail },
    'Effective git identity for commits (repo-level > global > env var)'
  );

  // Create Docker isolation provider
  const { secretsBasePath } = config;
  const workerImage = getOptionalEnv('INTEXURAOS_CODE_WORKER_IMAGE', DEFAULT_WORKER_IMAGE);
  const keepContainersAlive = process.env['KEEP_CONTAINERS_ALIVE'] === '1';
  if (keepContainersAlive) {
    logger.info({}, 'Debug mode: containers will be kept alive after task completion');
  }
  const workerForensicsMode = getOptionalEnv('INTEXURAOS_CODE_WORKER_FORENSICS', '0') === '1';
  const workerForensicsBasePath = getOptionalEnv(
    'INTEXURAOS_CODE_WORKER_FORENSICS_PATH',
    join(orchestratorDir, 'forensics')
  );
  if (workerForensicsMode) {
    ensureDirectoryExists(workerForensicsBasePath);
    logger.warn(
      { workerForensicsBasePath },
      'Code worker forensics mode enabled (core dumps, exec stream persistence, crash snapshots)'
    );
  }
  const preserveWorkerContainers =
    getOptionalEnv('INTEXURAOS_PRESERVE_WORKER_CONTAINERS', '1') !== '0';
  const sharedCredsPath = join(orchestratorDir, 'claude-creds');
  const sharedCodexAuthPath = join(orchestratorDir, 'codex-auth');
  ensureDirectoryExists(sharedCredsPath);
  ensureDirectoryExists(sharedCodexAuthPath);

  const isolationProvider = await createIsolationProvider(
    {
      secretsBasePath,
      gcpSaKeyPath,
      keepContainersAlive,
      imageName: workerImage,
      sharedCredsPath,
      sharedCodexAuthPath,
      forensicsMode: workerForensicsMode,
      forensicsBasePath: workerForensicsBasePath,
      ...(gitUserName !== undefined ? { gitUserName } : {}),
      ...(gitUserEmail !== undefined ? { gitUserEmail } : {}),
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

  const credentialsPath = join(sharedCredsPath, '.credentials.json');
  const codexAuthPath = join(sharedCodexAuthPath, 'auth.json');
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });

  // Credential monitor (read-only watcher)
  const credentialMonitor = new CredentialMonitor(
    { credentialsPath, reloadIntervalMs: 60_000 },
    logger
  );

  // Credential refresher (Docker-based, for when no workers running)
  const credentialRefresher = new CredentialRefresher(
    { sharedCredsPath, imageName: workerImage, networkName: 'code-worker-net' },
    docker,
    logger
  );

  const codexAuthRefresher = new CodexAuthRefresher(
    { sharedAuthPath: sharedCodexAuthPath, imageName: workerImage, networkName: 'code-worker-net' },
    docker,
    logger
  );

  const workerAuthRegistry = new WorkerAuthRegistry([
    new ClaudeAuthManager(credentialMonitor, credentialRefresher),
    new CodexAuthManager(
      { authPath: codexAuthPath, reloadIntervalMs: 60_000, refresher: codexAuthRefresher },
      logger
    ),
  ]);

  workerAuthRegistry.loadCredentials();
  workerAuthRegistry.startMonitoring();
  logWorkerAuthStartupStatus(workerAuthRegistry, logger);

  // Get API keys for workers
  const apiKeySecrets = {
    ANTHROPIC_API_KEY: workerAuthRegistry.getCurrentAccessToken('claude') ?? '',
    LINEAR_API_KEY: getRequiredEnv('INTEXURAOS_LINEAR_API_KEY'),
    SENTRY_AUTH_TOKEN: getRequiredEnv('INTEXURAOS_SENTRY_AUTH_TOKEN'),
    MINIMAX_API_KEY: getRequiredEnv('INTEXURAOS_MINIMAX_APP_API_KEY'),
    DASHSCOPE_API_KEY: getRequiredEnv('INTEXURAOS_DASHSCOPE_APP_API_KEY'),
    OPENROUTER_API_KEY: process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '',
  };

  const apiKeyValidator = new ApiKeyValidator(apiKeySecrets, logger);

  const isolationConfig: IsolationConfig = {
    provider: isolationProvider,
    tokenRefresher,
    apiKeyValidator,
    workerAuthRegistry,
    getSecrets: () => ({
      ...apiKeySecrets,
      ANTHROPIC_API_KEY:
        workerAuthRegistry.getCurrentAccessToken('claude') ?? apiKeySecrets.ANTHROPIC_API_KEY,
    }),
    gcpSaKeyPath,
    githubAppKeyPath: config.githubAppPrivateKeyPath,
  };

  // Validate API keys asynchronously (non-blocking, warns on failure)
  const secrets = isolationConfig.getSecrets();
  void validateWorkerApiKeys(
    workerAuthRegistry,
    secrets.MINIMAX_API_KEY,
    secrets.DASHSCOPE_API_KEY,
    secrets.OPENROUTER_API_KEY,
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

  const completionControl: CompletionControlConfig = {
    maxAttempts: completionMaxAttemptsRaw,
    verifier: completionVerifier,
    preserveWorkerContainers,
  };

  logger.info(
    {
      completionMaxAttempts: completionControl.maxAttempts,
      preserveWorkerContainers,
      workerImage,
      verifier: completionVerifier.describe(),
    },
    'Completion verification configuration'
  );

  const turnMetricsCollector = new TurnMetricsCollector(
    {
      codeAgentUrl: config.codeAgentUrl,
      orchestratorSecret: config.orchestratorSecret,
      internalAuthToken: config.internalAuthToken,
      secretsBasePath,
      sharedCredsPath,
    },
    logger
  );

  const openRouterApiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '';
  const complianceValidatorModel =
    process.env['INTEXURAOS_COMPLIANCE_MODEL'] ?? 'xiaomi/mimo-v2-pro';

  logger.info(
    {
      complianceValidatorModel,
      hasOpenRouterApiKey: openRouterApiKey.length > 0,
    },
    'Agent compliance validator configuration'
  );

  const agentComplianceValidator =
    openRouterApiKey !== ''
      ? new OrchestratorAgentComplianceValidator(logger, {
          openRouterApiKey,
          model: complianceValidatorModel,
          pricing: {
            inputPricePerMillion: 1.0,
            outputPricePerMillion: 3.0,
          },
          auditLogPath: llmAuditLogPath,
        })
      : undefined;

  const dispatcher = new TaskDispatcher(
    config,
    statePersistence,
    worktreeManager,
    logForwarder,
    webhookClient,
    tokenService,
    logger,
    isolationConfig,
    completionControl,
    turnMetricsCollector,
    agentComplianceValidator
  );

  // Credential monitoring loop — trigger Docker-based refresh when near expiry
  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  setInterval(() => {
    const runningTasks = dispatcher.getRunningTaskIds();
    if (runningTasks.length > 0) {
      if (
        workerAuthRegistry.isExpiringSoon('claude', REFRESH_BUFFER_MS) ||
        workerAuthRegistry.isExpiringSoon('codex', REFRESH_BUFFER_MS)
      ) {
        logger.debug(
          { runningCount: runningTasks.length },
          'Worker auth expiring soon but workers running — refresh deferred'
        );
      }
      return;
    }

    for (const provider of ['claude', 'codex'] as const) {
      if (!workerAuthRegistry.isExpiringSoon(provider, REFRESH_BUFFER_MS)) {
        continue;
      }

      logger.info(
        { provider },
        'Worker auth expiring soon, no active workers — triggering refresh'
      );
      void workerAuthRegistry.refresh(provider).catch((err: unknown) => {
        logger.error({ provider, error: err }, 'Worker auth refresh failed');
      });
    }
  }, 60_000);

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
    workerAuthRegistry,
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
