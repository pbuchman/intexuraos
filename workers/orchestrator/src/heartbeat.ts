import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

export interface HeartbeatConfig {
  codeAgentUrl: string;
  webhookSecret: string;
  intervalMs: number;
}

export interface HeartbeatManager {
  start(): void;
  stop(): void;
  registerTask(taskId: string): void;
  unregisterTask(taskId: string): void;
}

/**
 * Creates a heartbeat manager that periodically sends task IDs to code-agent.
 * This keeps the updatedAt field fresh for running tasks, enabling accurate zombie detection.
 *
 * Design reference: INT-372
 */
export function createHeartbeatManager(config: HeartbeatConfig, logger: Logger): HeartbeatManager {
  const runningTasks = new Set<string>();
  let intervalId: NodeJS.Timeout | null = null;

  async function sendHeartbeats(): Promise<void> {
    if (runningTasks.size === 0) {
      logger.debug('No running tasks, skipping heartbeat');
      return;
    }

    const taskIds = Array.from(runningTasks);
    logger.info({ taskCount: taskIds.length }, 'Sending heartbeats');

    try {
      const payload = { taskIds };
      const signature = generateSignature(taskIds, config.webhookSecret);

      const response = await fetch(`${config.codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Heartbeat request failed');
      } else {
        logger.debug({ taskCount: taskIds.length }, 'Heartbeats sent successfully');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to send heartbeats');
    }
  }

  return {
    start(): void {
      if (intervalId !== null) {
        logger.debug('Heartbeat manager already started');
        return;
      }
      logger.info({ intervalMs: config.intervalMs }, 'Starting heartbeat manager');
      intervalId = setInterval(() => {
        void sendHeartbeats();
      }, config.intervalMs);
    },

    stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info('Heartbeat manager stopped');
      }
    },

    registerTask(taskId: string): void {
      runningTasks.add(taskId);
      logger.debug({ taskId, count: runningTasks.size }, 'Task registered for heartbeat');
    },

    unregisterTask(taskId: string): void {
      runningTasks.delete(taskId);
      logger.debug({ taskId, count: runningTasks.size }, 'Task unregistered from heartbeat');
    },
  };
}

/**
 * Generates HMAC-SHA256 signature for heartbeat payload.
 */
function generateSignature(taskIds: string[], secret: string): string {
  const payload = JSON.stringify({ taskIds });
  return createHash('sha256').update(payload).update(secret).digest('hex');
}
