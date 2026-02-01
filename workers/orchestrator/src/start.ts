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

import { main } from './main.js';
import { StatePersistence } from './services/state-persistence.js';
import { TaskDispatcher } from './services/task-dispatcher.js';
import { GitHubTokenService } from './github/token-service.js';
import { WebhookClient } from './services/webhook-client.js';
import { WorktreeManager } from './services/worktree-manager.js';
import { TmuxManager } from './services/tmux-manager.js';
import { LogForwarder } from './services/log-forwarder.js';
import { createHeartbeatManager } from './heartbeat.js';
import type { OrchestratorConfig } from './types/config.js';

const DEFAULT_PORT = 8199;
const DEFAULT_CAPACITY = 1;
const DEFAULT_TASK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  /* v8 ignore start -- test-infra: process.exit() terminates the process, cannot test in unit tests @preserve */
  if (value === undefined || value === '') {
    process.stderr.write(`ERROR: Required environment variable ${name} is not set\n`);
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
function getGitHubPrivateKey(projectId: string, cachePath: string): string {
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

  // Fetch from Secret Manager
  process.stderr.write('Fetching GitHub private key from Secret Manager...\n');
  try {
    const key = execSync(
      `gcloud secrets versions access latest --secret=INTEXURAOS_GITHUB_APP_PRIVATE_KEY --project=${projectId}`,
      { encoding: 'utf-8' }
    ).trim();
    return key;
  } catch (_error) {
    process.stderr.write('Failed to fetch GitHub private key from Secret Manager\n');
    process.stderr.write(
      'Make sure GOOGLE_APPLICATION_CREDENTIALS is set and has secretAccessor role\n'
    );
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
  const repoPath = getOptionalEnv('REPOSITORY_PATH', join(home, 'personal', 'intexuraos-3'));

  // Ensure directories exist
  ensureDirectoryExists(orchestratorDir);
  ensureDirectoryExists(worktreeDir);
  ensureDirectoryExists(logsDir);

  // Load required env vars
  const codeAgentUrl = getRequiredEnv('INTEXURAOS_CODE_AGENT_URL');
  const orchestratorSecret = getRequiredEnv('INTEXURAOS_ORCHESTRATOR_SECRET');
  const githubAppId = getRequiredEnv('INTEXURAOS_GITHUB_APP_ID');
  const githubInstallationId = getRequiredEnv('INTEXURAOS_GITHUB_INSTALLATION_ID');
  const projectId = getRequiredEnv('PROJECT_ID');

  // GitHub private key: fetch from Secret Manager (multiline, not in .envrc)
  const privateKeyPath = join(orchestratorDir, 'github-app.pem');
  const githubPrivateKey = getGitHubPrivateKey(projectId, privateKeyPath);
  writeFileSync(privateKeyPath, githubPrivateKey, { mode: 0o600 });

  // Load optional env vars
  const port = parseInt(getOptionalEnv('PORT', String(DEFAULT_PORT)), 10);
  const capacity = parseInt(getOptionalEnv('WORKER_CAPACITY', String(DEFAULT_CAPACITY)), 10);

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

  // Create logger
  const logger = pino(
    process.env['NODE_ENV'] !== 'production'
      ? {
          level: process.env['LOG_LEVEL'] ?? 'info',
          transport: { target: 'pino-pretty', options: { colorize: true } },
        }
      : { level: process.env['LOG_LEVEL'] ?? 'info' }
  );

  logger.info({ port: config.port, capacity: config.capacity }, 'Starting orchestrator');

  // Create services
  const statePersistence = new StatePersistence(config.stateFilePath, logger);

  const tokenService = new GitHubTokenService(
    config.githubAppId,
    config.githubAppPrivateKeyPath,
    config.githubInstallationId,
    join(orchestratorDir, 'github-token')
  );

  const webhookClient = new WebhookClient(statePersistence, logger);

  const worktreeManager = new WorktreeManager(
    {
      repositoryPath: repoPath,
      worktreeBasePath: config.worktreeBasePath,
      mcpConfigTemplatePath: join(repoPath, '.mcp.json'),
    },
    logger
  );

  const tmuxManager = new TmuxManager({ logBasePath: config.logBasePath }, logger);

  const logForwarder = new LogForwarder(
    {
      logBasePath: config.logBasePath,
      codeAgentUrl: config.codeAgentUrl,
      orchestratorSecret: config.orchestratorSecret,
    },
    logger
  );

  const dispatcher = new TaskDispatcher(
    config,
    statePersistence,
    worktreeManager,
    tmuxManager,
    logForwarder,
    webhookClient,
    tokenService,
    logger
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
    logger
  );
}
/* v8 ignore stop @preserve */

/* v8 ignore start -- module-init: bootstrap invocation and fatal error handler @preserve */
bootstrap().catch((error: unknown) => {
  process.stderr.write(`Failed to start orchestrator: ${String(error)}\n`);
  process.exit(1);
});
/* v8 ignore stop @preserve */
