import { exit } from 'node:process';
import type { OrchestratorConfig } from './types/config.js';
import type { OrchestratorStatus } from './types/state.js';
import type { StatePersistence } from './services/state-persistence.js';
import type { TaskDispatcher } from './services/task-dispatcher.js';
import type { GitHubTokenService } from './github/token-service.js';
import type { WebhookClient } from './services/webhook-client.js';
import type { HeartbeatManager } from './heartbeat.js';
import type { DiscoveredContainer, IsolationProvider } from './services/isolation/types.js';
import type { WorkerAuthRegistry } from './services/worker-auth/index.js';
import { registerRoutes } from './routes.js';
import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from '@intexuraos/common-core';

const TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WEBHOOK_RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * INT-1551 §E.8: graceful-shutdown drain budget. Replaces the legacy 10-min
 * polling loop. The orchestrator currently runs under systemd (Linux home-dev)
 * or a macOS LaunchAgent; both grant the process at least 32 s before SIGKILL,
 * which leaves a 2 s safety margin on top of this budget. See
 * `workers/orchestrator/DEPLOYMENT.md` "Shutdown Behavior" for the contract.
 *
 * If the orchestrator is ever moved into PM2 (`ecosystem.config.cjs`), the
 * matching `kill_timeout` MUST be raised to 32_000+ ms — the default 5_000 ms
 * is too short for in-flight worker drain to complete.
 */
const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds

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
  workerAuthRegistry?: WorkerAuthRegistry,
  isolationProvider?: IsolationProvider,
  /**
   * Flush callback returned by `initWorker()` (INT-1565 §S5). Awaited in the
   * SIGTERM handler to drain Pino + Sentry buffers before `process.exit(0)`.
   * Optional so tests that build `main()` without bootstrapping the logger
   * can omit it.
   */
  flush?: () => Promise<void>
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
      workerAuthRegistry,
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

    // INT-1551 §E.7: top-level AbortController threaded down to TaskTimers
    // and TaskRunner so the shutdown handler can cancel pending timers and
    // bail out of new attempts. The signal MUST NOT short-circuit normal
    // operation: if it never aborts, behavior is unchanged.
    const shutdownController = new AbortController();
    dispatcher.setShutdownSignal(shutdownController.signal);

    // Handle shutdown signals
    setupShutdownHandlers({
      tokenRefreshInterval,
      webhookRetryInterval,
      app,
      dispatcher,
      statePersistence,
      heartbeatManager,
      logger,
      isolationProvider,
      shutdownController,
      ...(flush !== undefined ? { flush } : {}),
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
        logger.info(
          { taskId },
          'Found stateless orphan container; periodic cleanup will remove it if stale'
        );
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
            logger.info(
              { taskId: task.taskId },
              'Handled pending accepted resume during startup recovery'
            );
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
        // Non-running states are left in place for periodic cleanup if they become stale.
        logger.info(
          { taskId: task.taskId, state: container.state },
          'Found non-running container during startup recovery; periodic cleanup will remove it if stale'
        );
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

      // Update task status. Set `completedAt` so the duration metric
      // emitted below has a meaningful wall-clock window (computed from
      // `startedAt` -> `completedAt`); without it `computeTaskDurationMs`
      // would clamp to 0 even when the task ran for hours before restart.
      task.status = 'interrupted';
      task.completedAt = new Date().toISOString();
      await statePersistence.save(state);

      // INT-1565 §S5: emit `code_tasks_*` metrics for restart-induced
      // interruptions so the counter/duration series cover EVERY terminal
      // transition, not just `finalizeTask()`-driven ones. Wrap in
      // try/catch identical to the dispatcher's own emit — a metrics
      // outage must never break startup recovery.
      try {
        dispatcher.emitTerminalMetrics(task, 'interrupted');
      } catch (metricsError) {
        logger.warn(
          { taskId: task.taskId, error: metricsError },
          'metrics emission failed during startup recovery; continuing'
        );
      }

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
  isolationProvider: IsolationProvider | undefined; // @allow-undefined-type -- pre-existing tri-state: shutdown handler differentiates "no provider configured" from "provider with cleanup hooks"
  /**
   * INT-1551 §E.7: top-level controller fired before draining in-flight
   * handlers so `TaskTimers` and `TaskRunner` can cancel pending work.
   */
  shutdownController: AbortController;
  /**
   * Flush callback from `initWorker()` (INT-1565 §S5). Awaited last so log
   * lines emitted during shutdown make it to the unified Sentry/OTel sinks.
   * `undefined` when called by tests that bypass the bootstrap logger.
   */
  flush?: () => Promise<void>;
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
    handlers.isolationProvider?.stopPeriodicCleanup?.();
    handlers.isolationProvider?.stopHealthMonitor?.();
    handlers.heartbeatManager.stop();

    // INT-1551 §E.7: fire the abort signal BEFORE awaiting drain so
    // dispatcher sub-modules see the signal and start cleaning up pending
    // timers / refusing new worker startups while we await in-flight work.
    handlers.shutdownController.abort();

    // INT-1551 §E.7: replace the legacy `getRunningCount()` polling loop
    // with a Promise.race. `Promise.allSettled` settles only when every
    // tracked fire-and-forget handler has resolved or rejected; the timeout
    // arm guarantees we never block longer than `SHUTDOWN_TIMEOUT_MS`.
    const inFlight = handlers.dispatcher.getInFlightPromises();
    // The Promise constructor synchronously invokes the executor, so
    // `setTimeout` runs and assigns `timeoutHandle` before this expression
    // returns — no `undefined` window exists. The `as` cast tells TypeScript
    // we have a definite value (avoiding an unreachable narrowing branch).
    let timeoutHandle!: NodeJS.Timeout;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve('timeout');
      }, SHUTDOWN_TIMEOUT_MS);
    });
    const winner = await Promise.race([
      Promise.allSettled(inFlight).then(() => 'drained' as const),
      timeoutPromise,
    ]);
    // Always clear the timer so the process can exit cleanly even if the
    // drain arm won the race.
    clearTimeout(timeoutHandle);
    if (winner === 'timeout') {
      handlers.logger.warn(
        { inFlightCount: inFlight.length },
        'Shutdown timeout reached; forcing exit with in-flight handlers still pending'
      );
    } else {
      handlers.logger.info({ drainedCount: inFlight.length }, 'In-flight handlers drained');
    }

    handlers.logger.info({ message: 'Orchestrator shutdown complete' });

    // INT-1565 §S5: drain Pino + Sentry buffers before exit so the final
    // shutdown log lines + any inflight error reports make it to the unified
    // sinks. `flush()` is contracted to never throw, but we still wrap it so
    // a buggy implementation cannot leave the process hanging on shutdown.
    if (handlers.flush !== undefined) {
      try {
        await handlers.flush();
      } catch (flushError) {
        handlers.logger.warn(
          { err: flushError },
          'flush() raised during shutdown; continuing exit'
        );
      }
    }
    exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

export function getServiceStatus(): OrchestratorStatus {
  return serviceState?.status ?? 'initializing';
}
