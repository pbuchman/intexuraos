import { InstancesClient } from '@google-cloud/compute';
import { logger } from './logger.js';
import { VM_CONFIG } from './config.js';

export interface StopVmResult {
  success: boolean;
  message: string;
  runningTasksAtShutdown?: number;
}

export async function stopVm(): Promise<StopVmResult> {
  const instancesClient = new InstancesClient();

  logger.info(
    {
      instance: VM_CONFIG.INSTANCE_NAME,
      zone: VM_CONFIG.ZONE,
    },
    'Initiating VM shutdown'
  );

  try {
    const [instance] = await instancesClient.get({
      project: VM_CONFIG.PROJECT_ID,
      zone: VM_CONFIG.ZONE,
      instance: VM_CONFIG.INSTANCE_NAME,
    });

    if (instance.status !== 'RUNNING') {
      return {
        success: true,
        message: `VM already in ${String(instance.status)} state`,
      };
    }

    let runningTasks = 0;
    try {
      const shutdownResponse = await fetch(VM_CONFIG.SHUTDOWN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(VM_CONFIG.ORCHESTRATOR_UNRESPONSIVE_TIMEOUT_MS),
      });

      if (shutdownResponse.ok) {
        const data = (await shutdownResponse.json()) as {
          status: string;
          runningTasks: number;
        };
        runningTasks = data.runningTasks;
        logger.info({ runningTasks }, 'Orchestrator acknowledged shutdown');

        if (runningTasks > 0) {
          logger.info({ runningTasks }, 'Waiting for running tasks to complete');
          await waitForTasksToComplete();
        }
      }
    } catch {
      logger.warn('Orchestrator unresponsive, proceeding with forced shutdown');
    }

    const [operation] = await instancesClient.stop({
      project: VM_CONFIG.PROJECT_ID,
      zone: VM_CONFIG.ZONE,
      instance: VM_CONFIG.INSTANCE_NAME,
    });

    logger.info({ operationId: operation.name }, 'Stop operation initiated');

    return {
      success: true,
      message: 'VM shutdown initiated',
      runningTasksAtShutdown: runningTasks,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Failed to stop VM');
    return {
      success: false,
      message: `Failed to stop VM: ${message}`,
    };
  }
}

async function waitForTasksToComplete(): Promise<void> {
  const deadline = Date.now() + VM_CONFIG.SHUTDOWN_GRACE_PERIOD_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(VM_CONFIG.HEALTH_ENDPOINT, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = (await response.json()) as { running: number; status: string };

        if (data.running === 0 || data.status === 'shutting_down') {
          logger.info('All tasks completed or orchestrator shutting down');
          return;
        }

        logger.info({ running: data.running }, 'Tasks still running, waiting...');
      }
    } catch {
      logger.info('Orchestrator no longer responding, proceeding');
      return;
    }

    await sleep(VM_CONFIG.SHUTDOWN_POLL_INTERVAL_MS);
  }

  logger.warn('Grace period expired, proceeding with shutdown despite running tasks');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
