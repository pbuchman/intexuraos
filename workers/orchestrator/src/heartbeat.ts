import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';

export interface HeartbeatConfig {
  codeAgentUrl: string;
  orchestratorSecret: string;
  intervalMs: number;
  getRunningTasks: () => string[];
}

export interface HeartbeatManager {
  start(): void;
  stop(): void;
}

/**
 * Creates a heartbeat manager that periodically sends task IDs to code-agent.
 * This keeps the updatedAt field fresh for running tasks, enabling accurate zombie detection.
 *
 * Design reference: INT-372
 */
export function createHeartbeatManager(config: HeartbeatConfig, logger: Logger): HeartbeatManager {
  let intervalId: NodeJS.Timeout | null = null;

  function signPayload(payload: string, timestamp: number): string {
    const message = `${String(timestamp)}.${payload}`;
    return createHmac('sha256', config.orchestratorSecret).update(message).digest('hex');
  }

  async function sendHeartbeats(): Promise<void> {
    const taskIds = config.getRunningTasks();
    if (taskIds.length === 0) {
      logger.debug('No running tasks, skipping heartbeat');
      return;
    }

    logger.info({ taskCount: taskIds.length }, 'Sending heartbeats');

    const payload = { taskIds };
    const jsonBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(jsonBody, timestamp);

    try {
      const response = await fetch(`${config.codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': String(timestamp),
          'X-Request-Signature': signature,
        },
        body: jsonBody,
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
  };
}
