import { exit } from 'node:process';
import { createServer } from 'node:http';
import type { OrchestratorConfig } from './types/config.js';
import type { StatePersistence } from './services/state-persistence.js';
import type { TaskDispatcher } from './services/task-dispatcher.js';
import type { GitHubTokenService } from './github/token-service.js';
import type { WebhookClient } from './services/webhook-client.js';
import { registerRoutes } from './routes.js';
import fastify from 'fastify';
import { cors } from '@fastify/cors';
import type { Logger } from '@intexuraos/common-core';

const TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WEBHOOK_RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TASK_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

const SHUTDOWN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

type OrchestratorStatus =
  | 'initializing'
  | 'recovering'
  | 'ready'
  | 'degraded'
  | 'auth_degraded'
  | 'shutting_down';

interface ServiceState {
  status: OrchestratorStatus;
  server: ReturnType<typeof createServer>;
}

let serviceState: ServiceState | null = null;

export async function main(
  config: OrchestratorConfig,
  statePersistence: StatePersistence,
  dispatcher: TaskDispatcher,
  tokenService: GitHubTokenService,
  webhookClient: WebhookClient,
  logger: Logger
): Promise<void> {
  serviceState = {
    status: 'initializing',
    server: createServer(),
  };

  try {
    // Start HTTP server
    const app = fastify();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
    app.register(cors());

    registerRoutes(app, dispatcher, tokenService, config, logger);

    await app.listen({ port: config.port, host: '0.0.0.0' });

    logger.info({ port: config.port }, 'Orchestrator HTTP server started');

    // Run startup recovery
    await runStartupRecovery(statePersistence, dispatcher, webhookClient, logger);

    // Schedule background jobs
    const tokenRefreshInterval = scheduleTokenRefresh(tokenService, logger);
    const webhookRetryInterval = scheduleWebhookRetry(webhookClient, logger);
    const taskPollInterval = scheduleTaskPolling(dispatcher, logger);

    // Set ready status
    serviceState.status = 'ready';

    // Handle shutdown signals
    setupShutdownHandlers({
      tokenRefreshInterval,
      webhookRetryInterval,
      taskPollInterval,
      dispatcher,
      statePersistence,
      logger,
    });

    logger.info({ message: 'Orchestrator ready' });
  } catch (error) {
    logger.error({ error }, 'Failed to start orchestrator');
    exit(1);
  }
}

async function runStartupRecovery(
  statePersistence: StatePersistence,
  dispatcher: TaskDispatcher,
  webhookClient: WebhookClient,
  logger: Logger
): Promise<void> {
  logger.info({ message: 'Running startup recovery' });

  const state = await statePersistence.load();
  const interruptedTasks = Object.values(state.tasks).filter((t) => t.status === 'running');

  if (interruptedTasks.length === 0) {
    logger.info({ message: 'No interrupted tasks to recover' });
    return;
  }

  logger.info({ count: interruptedTasks.length }, 'Found interrupted tasks');

  // Notify code-agent about interrupted tasks
  for (const task of interruptedTasks) {
    try {
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
          logger.error({ error: result.error }, 'Token refresh failed');
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

function scheduleTaskPolling(dispatcher: TaskDispatcher, logger: Logger): NodeJS.Timeout {
  return setInterval(() => {
    // Task polling is handled by completion monitoring in dispatcher
    logger.debug({ message: 'Task polling check' });
  }, TASK_POLL_INTERVAL_MS);
}

interface ShutdownHandlers {
  tokenRefreshInterval: NodeJS.Timeout;
  webhookRetryInterval: NodeJS.Timeout;
  taskPollInterval: NodeJS.Timeout;
  dispatcher: TaskDispatcher;
  statePersistence: StatePersistence;
  logger: Logger;
}

function setupShutdownHandlers(handlers: ShutdownHandlers): void {
  const shutdown = async (signal: string): Promise<void> => {
    if (!serviceState || serviceState.status === 'shutting_down') {
      return;
    }

    serviceState.status = 'shutting_down';
    handlers.logger.info({ signal }, 'Shutdown requested');

    // Clear intervals
    clearInterval(handlers.tokenRefreshInterval);
    clearInterval(handlers.webhookRetryInterval);
    clearInterval(handlers.taskPollInterval);

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

    // Close server
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
    if (serviceState?.server) {
      serviceState.server.close();
    }

    handlers.logger.info({ message: 'Orchestrator shutdown complete' });
    exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

export function getServiceStatus(): OrchestratorStatus {
  return serviceState?.status ?? 'initializing';
}
