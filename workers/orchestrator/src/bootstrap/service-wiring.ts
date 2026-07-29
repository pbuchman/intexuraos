/**
 * Service instantiation and wiring for the orchestrator.
 *
 * `buildOrchestratorServices` assembles every long-lived singleton
 * (persistence, token service, worktree manager, isolation stack, auth
 * registries, validators, dispatcher, heartbeat) and returns them to
 * `start.ts`, which hands the result to `main()`.
 *
 * Splitting this out keeps `start.ts` a thin sequential bootstrap.
 */

import { join } from 'node:path';
import type { Logger } from 'pino';
import Docker from 'dockerode';
import { IntexuraOSError } from '@intexuraos/common-core';

import { StatePersistence } from '../services/state-persistence.js';
import { TaskDispatcher } from '../services/task-dispatcher.js';
import { GitHubTokenService } from '../github/token-service.js';
import { WebhookClient } from '../services/webhook-client.js';
import { StatusUpdateClient } from '../services/status-update-client.js';
import { WorktreeManager } from '../services/worktree-manager.js';
import { LogForwarder } from '../services/log-forwarder.js';
import { createHeartbeatManager, type HeartbeatManager } from '../heartbeat.js';
import {
  createIsolationProvider,
  TokenRefresher,
  type IsolationProvider,
  type WorkerSecrets,
} from '../services/isolation/index.js';
import { CredentialMonitor } from '../services/isolation/credential-monitor.js';
import { CredentialRefresher } from '../services/isolation/credential-refresher.js';
import {
  ClaudeAuthManager,
  CodexAuthManager,
  CodexAuthRefresher,
  WorkerAuthRegistry,
} from '../services/worker-auth/index.js';
import { ApiKeyValidator } from '../services/api-key-validator.js';
import type { OrchestratorConfig } from '../types/config.js';
import type { CompletionControlConfig, IsolationConfig } from '../services/task-dispatcher.js';
import { ResumeSummaryExtractor, getVerifierTaskId } from '../services/completion-verifier.js';
import { TurnMetricsCollector } from '../services/turn-metrics-collector.js';
import {
  OrchestratorAgentComplianceValidator,
  getValidatorTaskId,
} from '../services/agent-compliance-validator.js';
import {
  parseValidationModels,
  buildValidationClients,
} from '../services/validation-model-clients.js';
import { createMetricsClient, type MetricsClient } from '../metrics.js';
import type { BootstrapEnvConfig } from './env-config.js';
import { logWorkerAuthStartupStatus } from './api-key-validator.js';
import { reconcileRepoGitIdentity } from './git-identity.js';
import { ensureDirectoryExists } from './fs-utils.js';
import type { ProviderApiKeyHealth } from '../types/api.js';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';

const DOCKER_NETWORK_NAME = 'code-worker-net';
const TOKEN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CREDENTIAL_RELOAD_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

export interface WiringInputs {
  env: BootstrapEnvConfig;
  config: OrchestratorConfig;
  logger: Logger;
  orchestratorDir: string;
  repoPath: string;
  /** Resolved git user name for worker containers (env override ∥ host git). */
  gitUserName: string | undefined; // @allow-undefined-type -- pre-existing tri-state: undefined means "no override and no host config", which the wiring branches on explicitly
  /** Resolved git user email for worker containers. */
  gitUserEmail: string | undefined; // @allow-undefined-type -- pre-existing tri-state: undefined means "no override and no host config", which the wiring branches on explicitly
}

export interface WiredServices {
  statePersistence: StatePersistence;
  tokenService: GitHubTokenService;
  webhookClient: WebhookClient;
  dispatcher: TaskDispatcher;
  heartbeatManager: HeartbeatManager;
  workerAuthRegistry: WorkerAuthRegistry;
  isolationProvider: IsolationProvider;
  providerApiKeys: Record<string, ProviderApiKeyHealth>;
}

export function resolveSettingsLocalTemplatePath(repoPath: string): string {
  return join(repoPath, 'docker', 'code-worker', 'config-defaults', 'settings.local.json');
}

export function buildTaskDispatcherWorkerSecrets(
  env: BootstrapEnvConfig,
  anthropicApiKey: string
): WorkerSecrets {
  return {
    ANTHROPIC_API_KEY: anthropicApiKey,
    LINEAR_API_KEY: env.linearApiKey,
    SENTRY_AUTH_TOKEN: env.sentryAuthToken,
    ...(env.errorHubHost !== undefined ? { ERROR_HUB_HOST: env.errorHubHost } : {}),
    MINIMAX_API_KEY: env.minimaxApiKey,
    MIMO_API_KEY: env.mimoApiKey,
    DASHSCOPE_API_KEY: env.dashscopeApiKey,
    KIMI_API_KEY: env.kimiApiKey,
    OPENROUTER_API_KEY: env.openRouterApiKey,
  };
}

/**
 * Builds every long-lived service the orchestrator needs and wires them
 * together. Does NOT start listeners — the caller invokes `main()` and
 * any interval loops after the returned struct is received.
 */
/* v8 ignore start -- module-init: bootstrap-only service graph wiring cannot be unit-tested without real Docker, worker-auth subsystem, and LLM clients; exercised indirectly by the orchestrator runtime @preserve */
export async function buildOrchestratorServices(inputs: WiringInputs): Promise<WiredServices> {
  const { env, config, logger, orchestratorDir, repoPath, gitUserName, gitUserEmail } = inputs;

  const statePersistence = new StatePersistence(config.stateFilePath, logger);

  const tokenService = new GitHubTokenService(
    config.githubAppId,
    config.githubAppPrivateKeyPath,
    config.githubInstallationId,
    join(orchestratorDir, 'github-token')
  );

  const webhookClient = new WebhookClient(statePersistence, logger, config.internalAuthToken);

  const statusUpdateClient = new StatusUpdateClient({
    codeAgentUrl: config.codeAgentUrl,
    orchestratorSecret: config.orchestratorSecret,
    internalAuthToken: config.internalAuthToken,
    logger,
  });

  const worktreeManager = new WorktreeManager(
    {
      repositoryPath: repoPath,
      worktreeBasePath: config.worktreeBasePath,
      settingsLocalTemplatePath: resolveSettingsLocalTemplatePath(repoPath),
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

  logger.info({ gitUserName, gitUserEmail }, 'Git identity for worker containers');

  const repoIdentity = reconcileRepoGitIdentity(repoPath, { gitUserName, gitUserEmail });
  if (
    (repoIdentity.repoUserName !== undefined || repoIdentity.repoUserEmail !== undefined) &&
    !repoIdentity.appliedName &&
    !repoIdentity.appliedEmail
  ) {
    logger.warn(
      {
        repoUserName: repoIdentity.repoUserName,
        repoUserEmail: repoIdentity.repoUserEmail,
        [SKIP_SENTRY_KEY]: true,
      },
      'Repository has local git user config — this OVERRIDES the identity passed to containers. ' +
        'No resolved worker identity was available to reconcile it automatically.'
    );
  } else if (repoIdentity.appliedName || repoIdentity.appliedEmail) {
    logger.info(
      {
        previousRepoUserName: repoIdentity.repoUserName,
        previousRepoUserEmail: repoIdentity.repoUserEmail,
        appliedName: repoIdentity.appliedName,
        appliedEmail: repoIdentity.appliedEmail,
      },
      'Repository git identity reconciled to worker identity'
    );
  }
  const effectiveName = repoIdentity.effectiveName ?? 'NOT SET';
  const effectiveEmail = repoIdentity.effectiveEmail ?? 'NOT SET';
  logger.info({ effectiveName, effectiveEmail }, 'Effective git identity for commits');

  const { secretsBasePath } = config;
  if (env.keepContainersAlive) {
    logger.info({}, 'Debug mode: containers will be kept alive after task completion');
  }
  const workerForensicsBasePath = env.workerForensicsBasePath ?? join(orchestratorDir, 'forensics');
  if (env.workerForensicsMode) {
    ensureDirectoryExists(workerForensicsBasePath);
    logger.warn(
      { workerForensicsBasePath },
      'Code worker forensics mode enabled (core dumps, exec stream persistence, crash snapshots)'
    );
  }
  const sharedCredsPath = join(orchestratorDir, 'claude-creds');
  const sharedCodexAuthPath = join(orchestratorDir, 'codex-auth');
  ensureDirectoryExists(sharedCredsPath);
  ensureDirectoryExists(sharedCodexAuthPath);

  const isolationProvider = await createIsolationProvider(
    {
      secretsBasePath,
      gcpSaKeyPath: env.gcpSaKeyPath,
      keepContainersAlive: env.keepContainersAlive,
      imageName: env.workerImage,
      sharedCredsPath,
      sharedCodexAuthPath,
      forensicsMode: env.workerForensicsMode,
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
      refreshIntervalMs: TOKEN_REFRESH_INTERVAL_MS,
    },
    logger
  );

  const credentialsPath = join(sharedCredsPath, '.credentials.json');
  const codexAuthPath = join(sharedCodexAuthPath, 'auth.json');
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });

  const credentialMonitor = new CredentialMonitor(
    { credentialsPath, reloadIntervalMs: CREDENTIAL_RELOAD_INTERVAL_MS },
    logger
  );

  const credentialRefresher = new CredentialRefresher(
    { sharedCredsPath, imageName: env.workerImage, networkName: DOCKER_NETWORK_NAME },
    docker,
    logger
  );

  const codexAuthRefresher = new CodexAuthRefresher(
    {
      sharedAuthPath: sharedCodexAuthPath,
      imageName: env.workerImage,
      networkName: DOCKER_NETWORK_NAME,
    },
    docker,
    logger
  );

  const workerAuthRegistry = new WorkerAuthRegistry([
    new ClaudeAuthManager(credentialMonitor, credentialRefresher),
    new CodexAuthManager(
      {
        authPath: codexAuthPath,
        reloadIntervalMs: CREDENTIAL_RELOAD_INTERVAL_MS,
        refresher: codexAuthRefresher,
      },
      logger
    ),
  ]);

  workerAuthRegistry.loadCredentials();
  workerAuthRegistry.startMonitoring();
  logWorkerAuthStartupStatus(workerAuthRegistry, logger);

  const apiKeySecrets = buildTaskDispatcherWorkerSecrets(
    env,
    workerAuthRegistry.getCurrentAccessToken('claude') ?? ''
  );

  const providerApiKeys: Record<string, ProviderApiKeyHealth> = {
    MINIMAX_API_KEY: { configured: env.minimaxApiKey.trim() !== '' },
    MIMO_API_KEY: { configured: env.mimoApiKey.trim() !== '' },
    DASHSCOPE_API_KEY: { configured: env.dashscopeApiKey.trim() !== '' },
    KIMI_API_KEY: { configured: env.kimiApiKey.trim() !== '' },
    OPENROUTER_API_KEY: { configured: env.openRouterApiKey.trim() !== '' },
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
    gcpSaKeyPath: env.gcpSaKeyPath,
    githubAppKeyPath: config.githubAppPrivateKeyPath,
  };

  const validationModels = parseValidationModels(env.validationModels);

  const sharedValidationConfig = {
    models: validationModels,
    openRouterApiKey: env.openRouterApiKey,
    geminiApiKey: env.geminiApiKey,
    usageWebhookUrl: env.usageWebhookUrl,
    orchestratorSecret: config.orchestratorSecret,
    internalAuthToken: config.internalAuthToken,
    logger,
  };

  const validationClients = buildValidationClients({
    ...sharedValidationConfig,
    getCorrelationTaskId: getVerifierTaskId,
  });
  const validatorClients = buildValidationClients({
    ...sharedValidationConfig,
    getCorrelationTaskId: getValidatorTaskId,
  });

  const primaryEntry = validationClients[0];
  if (primaryEntry === undefined) {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS produced no clients'
    );
  }

  const primaryModelName = primaryEntry.modelName;
  // [INT-1470] The completion verifier is a pure sync function; only the
  // resume-summary helper is LLM-backed and injected here.
  const resumeSummaryExtractor = new ResumeSummaryExtractor(logger, {
    primaryClient: primaryEntry.client,
    fallbackClients: validationClients.slice(1).map((e) => e.client),
    primaryModelName,
    fallbackModelNames: validationClients.slice(1).map((e) => e.modelName),
  });

  const completionControl: CompletionControlConfig = {
    maxAttempts: env.completionMaxAttempts,
    resumeSummaryExtractor,
    preserveWorkerContainers: env.preserveWorkerContainers,
  };

  logger.info(
    {
      completionMaxAttempts: completionControl.maxAttempts,
      preserveWorkerContainers: env.preserveWorkerContainers,
      workerImage: env.workerImage,
      resumeSummaryExtractor: resumeSummaryExtractor.describe(),
      validationModels: validationModels.map((m) => m.modelId),
    },
    'Completion verification configuration (deterministic parser + resume-summary LLM)'
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

  logger.info(
    {
      validationModels: validationModels.map((m) => m.modelId),
      hasOpenRouterApiKey: env.openRouterApiKey.length > 0,
    },
    'Agent compliance validator configuration'
  );

  const agentComplianceValidator = new OrchestratorAgentComplianceValidator(logger, {
    clients: validatorClients.map((e) => e.client),
    primaryModelName,
    modelNames: validatorClients.map((e) => e.modelName),
    codeAgentUrl: config.codeAgentUrl,
    usageWebhookUrl: env.usageWebhookUrl,
    orchestratorSecret: config.orchestratorSecret,
    internalAuthToken: config.internalAuthToken,
  });

  const metricsClient: MetricsClient = createMetricsClient({
    projectId: env.projectId,
    serviceName: 'orchestrator',
    logger,
  });

  const dispatcher = new TaskDispatcher(
    config,
    statePersistence,
    worktreeManager,
    logForwarder,
    webhookClient,
    statusUpdateClient,
    tokenService,
    logger,
    isolationConfig,
    completionControl,
    turnMetricsCollector,
    agentComplianceValidator,
    metricsClient
  );

  const heartbeatManager = createHeartbeatManager(
    {
      codeAgentUrl: config.codeAgentUrl,
      orchestratorSecret: config.orchestratorSecret,
      intervalMs: HEARTBEAT_INTERVAL_MS,
      getRunningTasks: () => dispatcher.getRunningTaskIds(),
    },
    logger
  );

  return {
    statePersistence,
    tokenService,
    webhookClient,
    dispatcher,
    heartbeatManager,
    workerAuthRegistry,
    isolationProvider,
    providerApiKeys,
  };
}
/* v8 ignore stop @preserve */

export const CREDENTIAL_REFRESH_BUFFER_MS = 5 * 60 * 1000;
export const CREDENTIAL_REFRESH_TICK_MS = 60_000;

/**
 * Single tick of the credential-refresh loop. Extracted from
 * {@link startCredentialRefreshLoop} so it can be unit-tested without
 * real timers.
 *
 * Behavior:
 *   - If any worker is currently running, refresh is deferred (logs a
 *     debug line when auth is near expiry so operators can correlate).
 *   - Otherwise, for each provider that is expiring soon, trigger an
 *     async refresh and log any failure.
 */
export function runCredentialRefreshTick(
  workerAuthRegistry: WorkerAuthRegistry,
  getRunningTaskIds: () => readonly string[],
  logger: Logger
): void {
  const runningTasks = getRunningTaskIds();
  if (runningTasks.length > 0) {
    if (
      workerAuthRegistry.isExpiringSoon('claude', CREDENTIAL_REFRESH_BUFFER_MS) ||
      workerAuthRegistry.isExpiringSoon('codex', CREDENTIAL_REFRESH_BUFFER_MS)
    ) {
      logger.debug(
        { runningCount: runningTasks.length },
        'Worker auth expiring soon but workers running — refresh deferred'
      );
    }
    return;
  }

  for (const provider of ['claude', 'codex'] as const) {
    if (!workerAuthRegistry.isExpiringSoon(provider, CREDENTIAL_REFRESH_BUFFER_MS)) {
      continue;
    }

    logger.info({ provider }, 'Worker auth expiring soon, no active workers — triggering refresh');
    void workerAuthRegistry.refresh(provider).catch((err: unknown) => {
      logger.error({ provider, error: err }, 'Worker auth refresh failed');
    });
  }
}

/**
 * Starts a 60-second credential-refresh watchdog. The tick behavior is
 * delegated to {@link runCredentialRefreshTick} (unit-tested separately).
 *
 * Returns the interval handle so callers can `clearInterval` in tests.
 */
/* v8 ignore start -- module-init: bootstrap setInterval wrapper cannot be unit-tested without running real timers; tick behavior is unit-tested via runCredentialRefreshTick @preserve */
export function startCredentialRefreshLoop(
  workerAuthRegistry: WorkerAuthRegistry,
  getRunningTaskIds: () => readonly string[],
  logger: Logger
): NodeJS.Timeout {
  return setInterval(() => {
    runCredentialRefreshTick(workerAuthRegistry, getRunningTaskIds, logger);
  }, CREDENTIAL_REFRESH_TICK_MS);
}
/* v8 ignore stop @preserve */
