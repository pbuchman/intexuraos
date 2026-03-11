import { exit } from 'node:process';
import type { OrchestratorConfig } from './types/config.js';
import type { OrchestratorStatus } from './types/state.js';
import type { StatePersistence } from './services/state-persistence.js';
import type { TaskDispatcher } from './services/task-dispatcher.js';
import type { GitHubTokenService } from './github/token-service.js';
import type { WebhookClient } from './services/webhook-client.js';
import type { HeartbeatManager } from './heartbeat.js';
import type { CredentialMonitor } from './services/isolation/credential-monitor.js';
import type { DiscoveredContainer, IsolationProvider } from './services/isolation/types.js';
import { registerRoutes } from './routes.js';
import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from '@intexuraos/common-core';

const TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WEBHOOK_RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const SHUTDOWN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface ServiceState {
  status: OrchestratorStatus;
  app: FastifyInstance;
}

let serviceState: ServiceState | null = null;

export async function main(
  config: OrchestratorConfig,
  statePersistence: StatePersistence,
  dispatcher: TaskDispatcher,
  tokenService: GitHubTokenService,
  webhookClient: WebhookClient,
  heartbeatManager: HeartbeatManager,
  logger: Logger,
  credentialMonitor?: CredentialMonitor,
  isolationProvider?: IsolationProvider
): Promise<void> {
  const app = fastify({
    logger: false,
    disableRequestLogging: true,
  });

  serviceState = {
    status: 'initializing',
    app,
  };

  try {
    void app.register(cors);

    registerRoutes(
      app as Parameters<typeof registerRoutes>[0],
      dispatcher,
      tokenService,
      config,
      logger,
      () => getServiceStatus(),
      credentialMonitor,
      isolationProvider
    );

    await app.listen({ port: config.port, host: '0.0.0.0' });

    logger.info({ port: config.port }, 'Orchestrator HTTP server started');

    // Run startup recovery
    await runStartupRecovery(
      statePersistence,
      dispatcher,
      webhookClient,
      logger,
      isolationProvider
    );

    // Schedule background jobs
    const tokenRefreshInterval = scheduleTokenRefresh(tokenService, logger);
    const webhookRetryInterval = scheduleWebhookRetry(webhookClient, logger);

    // Start heartbeat manager
    heartbeatManager.start();

    // Set ready status
    serviceState.status = 'ready';

    // Handle shutdown signals
    setupShutdownHandlers({
      tokenRefreshInterval,
      webhookRetryInterval,
      app,
      dispatcher,
      statePersistence,
      heartbeatManager,
      logger,
    });

    logger.info({ message: 'Orchestrator ready' });
  } catch (error) {
    logger.error({ error }, 'Failed to start orchestrator');
    exit(1);
  }
}

const ADOPTION_TIMEOUT_MS = 60_000; // 60 seconds

async function runStartupRecovery(
  statePersistence: StatePersistence,
  dispatcher: TaskDispatcher,
  webhookClient: WebhookClient,
  logger: Logger,
  isolationProvider?: IsolationProvider
): Promise<void> {
  logger.info({ message: 'Running startup recovery' });

  const state = await statePersistence.load();
  const runningTasks = Object.values(state.tasks).filter((t) => t.status === 'running');

  // Discover containers (if isolation provider available)
  let containerMap: Map<string, DiscoveredContainer> | null = null;

  if (isolationProvider?.listWorkerContainers !== undefined) {
    let timeoutHandle: NodeJS.Timeout | undefined = undefined;
    try {
      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve(null);
        }, ADOPTION_TIMEOUT_MS);
      });

      const discoveryResult = await Promise.race([
        isolationProvider.listWorkerContainers().then((containers) => {
          const map = new Map<string, DiscoveredContainer>();
          for (const c of containers) {
            map.set(c.taskId, c);
          }
          return map;
        }),
        timeoutPromise,
      ]);

      clearTimeout(timeoutHandle);
      containerMap = discoveryResult;

      if (containerMap !== null) {
        logger.info({ containerCount: containerMap.size }, 'Container discovery completed');
      } else {
        logger.warn(
          { timeout: ADOPTION_TIMEOUT_MS },
          'Container discovery timed out, falling back to state-only recovery'
        );
      }
    } catch (error) {
      clearTimeout(timeoutHandle);
      logger.warn({ error }, 'Container discovery failed, falling back to state-only recovery');
    }
  }

  // Handle stateless orphan containers (container exists but NOT in state)
  if (containerMap !== null && isolationProvider !== undefined) {
    const taskIdsInState = new Set(Object.keys(state.tasks));
    for (const [taskId] of containerMap) {
      if (!taskIdsInState.has(taskId)) {
        try {
          await isolationProvider.destroyWorker(taskId);
          logger.info({ taskId }, 'Removed stateless orphan container');
        } catch (error) {
          logger.error({ taskId, error }, 'Failed to remove orphan container');
        }
      }
    }
  }

  if (runningTasks.length === 0) {
    logger.info({ message: 'No interrupted tasks to recover' });
    return;
  }

  logger.info({ count: runningTasks.length }, 'Found interrupted tasks');

  // Process each running task
  for (const task of runningTasks) {
    try {
      if (task.pendingResumeStart !== undefined) {
        try {
          const result = await dispatcher.recoverPendingResumeTask(task);
          if (result.ok) {
            logger.info({ taskId: task.taskId }, 'Handled pending accepted resume during startup recovery');
            continue;
          }

          logger.warn(
            { taskId: task.taskId, error: result.error },
            'Pending accepted resume recovery failed, marking as interrupted'
          );
        } catch (error) {
          logger.error(
            { taskId: task.taskId, error },
            'Pending accepted resume recovery threw, marking as interrupted'
          );
        }
      }

      const container = containerMap?.get(task.taskId);

      if (container?.state === 'running') {
        // Container is running — attempt adoption
        try {
          const result = await dispatcher.adoptTask(task);
          if (result.ok) {
            logger.info({ taskId: task.taskId }, 'Adopted running container');
            continue; // Skip interrupted webhook
          }
          // Adoption returned error — fall through to interrupted
          logger.warn(
            { taskId: task.taskId, error: result.error },
            'Adoption failed, marking as interrupted'
          );
        } catch (error) {
          logger.error({ taskId: task.taskId, error }, 'Adoption threw, marking as interrupted');
        }
      } else if (container !== undefined && isolationProvider !== undefined) {
        // Non-running states (exited, paused, created, dead, restarting) are treated as terminated.
        // Container is destroyed and task is marked interrupted.
        try {
          await isolationProvider.destroyWorker(task.taskId);
          logger.info({ taskId: task.taskId }, 'Removed exited container');
        } catch (error) {
          logger.error({ taskId: task.taskId, error }, 'Failed to remove exited container');
        }
      }

      // Send interrupted webhook (no container, exited container, or failed adoption)
      await webhookClient.send({
        url: task.webhookUrl,
        secret: task.webhookSecret,
        payload: {
          taskId: task.taskId,
          status: 'interrupted',
          duration: 0,
        },
        taskId: task.taskId,
      });

      // Update task status
      task.status = 'interrupted';
      await statePersistence.save(state);

      logger.info({ taskId: task.taskId }, 'Notified code-agent of interrupted task');
    } catch (error) {
      logger.error(
        { taskId: task.taskId, error },
        'Failed to notify code-agent of interrupted task'
      );
    }
  }
}

function scheduleTokenRefresh(tokenService: GitHubTokenService, logger: Logger): NodeJS.Timeout {
  return setInterval((): void => {
    void (async (): Promise<void> => {
      try {
        const result = await tokenService.refreshToken();
        if (!result.ok) {
          logger.error(
            { code: result.error.code, message: result.error.message },
            'Token refresh failed'
          );
        } else {
          logger.debug({ message: 'Token refreshed successfully' });
        }
      } catch (error) {
        logger.error({ error }, 'Token refresh error');
      }
    })();
  }, TOKEN_REFRESH_INTERVAL_MS);
}

function scheduleWebhookRetry(webhookClient: WebhookClient, logger: Logger): NodeJS.Timeout {
  return setInterval((): void => {
    void (async (): Promise<void> => {
      try {
        await webhookClient.retryPending();
      } catch (error) {
        logger.error({ error }, 'Webhook retry failed');
      }
    })();
  }, WEBHOOK_RETRY_INTERVAL_MS);
}

interface ShutdownHandlers {
  tokenRefreshInterval: NodeJS.Timeout;
  webhookRetryInterval: NodeJS.Timeout;
  app: FastifyInstance;
  dispatcher: TaskDispatcher;
  statePersistence: StatePersistence;
  heartbeatManager: HeartbeatManager;
  logger: Logger;
}

function setupShutdownHandlers(handlers: ShutdownHandlers): void {
  const shutdown = async (signal: string): Promise<void> => {
    if (!serviceState || serviceState.status === 'shutting_down') {
      return;
    }

    serviceState.status = 'shutting_down';
    handlers.logger.info({ signal }, 'Shutdown requested');

    // Close HTTP server first to stop accepting new requests
    await handlers.app.close();

    // Clear intervals
    clearInterval(handlers.tokenRefreshInterval);
    clearInterval(handlers.webhookRetryInterval);
    handlers.heartbeatManager.stop();

    // Wait for running tasks (up to timeout)
    const startTime = Date.now();
    while (Date.now() - startTime < SHUTDOWN_TIMEOUT_MS) {
      const running = handlers.dispatcher.getRunningCount();
      if (running === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Save state
    await handlers.statePersistence.save(await handlers.statePersistence.load());

    handlers.logger.info({ message: 'Orchestrator shutdown complete' });
    exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

export function getServiceStatus(): OrchestratorStatus {
  return serviceState?.status ?? 'initializing';
}
