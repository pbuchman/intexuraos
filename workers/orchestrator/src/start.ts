#!/usr/bin/env node
/**
 * Orchestrator entry point.
 *
 * Sequential bootstrap: delegates each concern to a focused module under
 * `./bootstrap/` and forwards fatal errors to the top-level `.catch`,
 * which prints and calls `process.exit(1)`. Extracted modules throw
 * `Error`s rather than calling `process.exit()` themselves, keeping
 * them testable in unit tests.
 */

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { initWorker } from '@intexuraos/infra-sentry';

import { main } from './main.js';
import { ensureRepository } from './services/repo-manager.js';
import type { OrchestratorConfig } from './types/config.js';
import { DEFAULT_TASK_TIMEOUT_MS } from './types/constants.js';
import { loadEnvConfig, type BootstrapEnvConfig } from './bootstrap/env-config.js';
import { validateGcpCredentials } from './bootstrap/gcp-validator.js';
import { ensurePortAvailable } from './bootstrap/port-checker.js';
import { fetchGitHubKeys } from './bootstrap/secret-manager.js';
import { validateWorkerApiKeys } from './bootstrap/api-key-validator.js';
import { readHostGitConfig } from './bootstrap/git-identity.js';
import {
  buildOrchestratorServices,
  startCredentialRefreshLoop,
} from './bootstrap/service-wiring.js';
import { ensureDirectoryExists } from './bootstrap/fs-utils.js';
import { defaultNodeEnv } from './bootstrap/node-env.js';

function buildOrchestratorConfig(
  env: BootstrapEnvConfig,
  orchestratorDir: string,
  worktreeDir: string,
  logsDir: string,
  privateKeyPath: string
): OrchestratorConfig {
  return {
    port: env.port,
    capacity: env.capacity,
    taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
    stateFilePath: join(orchestratorDir, 'state.json'),
    worktreeBasePath: worktreeDir,
    logBasePath: logsDir,
    codeAgentUrl: env.codeAgentUrl,
    githubAppId: env.githubAppId,
    githubAppPrivateKeyPath: privateKeyPath,
    githubInstallationId: env.githubInstallationId,
    orchestratorSecret: env.orchestratorSecret,
    secretsBasePath: join(orchestratorDir, 'secrets'),
    internalAuthToken: env.internalAuthToken,
  };
}

/* v8 ignore start -- module-init: startup execSync call cannot be unit-tested without real git; fallback is exercised indirectly @preserve */
function readCodeVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
/* v8 ignore stop @preserve */

/**
 * Sequential bootstrap. Throws on any fatal error; the top-level
 * `.catch` reports and exits.
 *
 * The body itself is unit-tested in `start.test.ts`, which mocks every
 * bootstrap module plus `node:fs`, `@intexuraos/infra-sentry`, and
 * `node:child_process`. Only `readCodeVersion` is excluded from coverage
 * because it wraps `execSync` directly.
 *
 * Logger bootstrap is delegated to `initWorker()` (INT-1565 §S5): it returns
 * `{ logger, flush }` wired with the unified Sentry + OTel + dev streams.
 * The `flush` callback is forwarded into `main()` so the SIGTERM handler can
 * `await flush()` before exit.
 */
export async function start(): Promise<void> {
  // Mirror `pnpm --filter orchestrator dev` (which inlines
  // NODE_ENV=development) for hosts that launch us via `node dist/index.js`
  // — the home-dev systemd unit and the macOS LaunchAgent. Required before
  // initWorker() so createAppLogger() takes the pino-pretty branch instead
  // of raw JSON stdout (which is unreadable in journalctl).
  defaultNodeEnv();

  const home = homedir();
  const orchestratorDir = join(home, '.code-orchestrator');
  const worktreeDir = join(home, 'code-workers', 'worktrees');
  const logsDir = join(orchestratorDir, 'logs');
  const defaultRepoPath = join(orchestratorDir, 'repo');

  ensureDirectoryExists(orchestratorDir);
  ensureDirectoryExists(worktreeDir);
  ensureDirectoryExists(logsDir);

  const env = loadEnvConfig();
  const repoPath = env.repoPath ?? defaultRepoPath;

  validateGcpCredentials(env.gcpSaKeyPath, env.projectId);

  const privateKeyPath = join(orchestratorDir, 'github-app.pem');
  const githubPrivateKey = fetchGitHubKeys({
    projectId: env.projectId,
    cachePath: privateKeyPath,
    ...(env.githubPrivateKeyOverride !== undefined
      ? { override: env.githubPrivateKeyOverride }
      : {}),
  });
  writeFileSync(privateKeyPath, githubPrivateKey, { mode: 0o600 });

  await ensurePortAvailable(env.port);

  const config = buildOrchestratorConfig(
    env,
    orchestratorDir,
    worktreeDir,
    logsDir,
    privateKeyPath
  );
  const { logger, flush } = initWorker({
    serviceName: 'orchestrator',
    environment: env.environment,
    ...(env.sentryDsn !== undefined ? { sentryDsn: env.sentryDsn } : {}),
    ...(env.release !== undefined ? { release: env.release } : {}),
  });

  logger.info({ port: config.port, capacity: config.capacity }, 'Starting orchestrator');
  logger.info(
    { codeVersion: readCodeVersion(), nodeVersion: process.version },
    'Orchestrator code version'
  );

  await ensureRepository(env.repoUrl, repoPath, logger);

  const gitUserName = env.gitUserNameOverride ?? readHostGitConfig('user.name');
  const gitUserEmail = env.gitUserEmailOverride ?? readHostGitConfig('user.email');

  const services = await buildOrchestratorServices({
    env,
    config,
    logger,
    orchestratorDir,
    repoPath,
    gitUserName,
    gitUserEmail,
  });

  // Validate worker API keys asynchronously (non-blocking; warns on failure).
  void validateWorkerApiKeys(
    services.workerAuthRegistry,
    {
      minimaxKey: env.minimaxApiKey,
      mimoKey: env.mimoApiKey,
      dashscopeKey: env.dashscopeApiKey,
      kimiKey: env.kimiApiKey,
      openRouterKey: env.openRouterApiKey,
    },
    logger
  );

  startCredentialRefreshLoop(
    services.workerAuthRegistry,
    () => services.dispatcher.getRunningTaskIds(),
    logger
  );

  await main(
    config,
    services.statePersistence,
    services.dispatcher,
    services.tokenService,
    services.webhookClient,
    services.heartbeatManager,
    logger,
    services.workerAuthRegistry,
    services.isolationProvider,
    flush,
    services.providerApiKeys
  );
}

// Top-level invocation is handled by `index.ts` so that unit tests can import
// `start()` without the module performing side effects at load time.
