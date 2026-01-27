import { InstancesClient } from '@google-cloud/compute';
import { logger } from './logger.js';
import { VM_CONFIG } from './config.js';

export interface StartVmResult {
  success: boolean;
  message: string;
  startupDurationMs?: number;
}

export async function startVm(): Promise<StartVmResult> {
  const instancesClient = new InstancesClient();
  const startTime = Date.now();

  logger.info(
    {
      instance: VM_CONFIG.INSTANCE_NAME,
      zone: VM_CONFIG.ZONE,
    },
    'Starting VM instance'
  );

  try {
    const [instance] = await instancesClient.get({
      project: VM_CONFIG.PROJECT_ID,
      zone: VM_CONFIG.ZONE,
      instance: VM_CONFIG.INSTANCE_NAME,
    });

    const currentStatus = instance.status;
    logger.info({ currentStatus }, 'Current VM status');

    if (currentStatus === 'RUNNING') {
      const healthy = await pollHealth();
      if (healthy) {
        return {
          success: true,
          message: 'VM already running and healthy',
          startupDurationMs: Date.now() - startTime,
        };
      }
      logger.warn({}, 'VM running but unhealthy, restarting');
      await instancesClient.stop({
        project: VM_CONFIG.PROJECT_ID,
        zone: VM_CONFIG.ZONE,
        instance: VM_CONFIG.INSTANCE_NAME,
      });
      await waitForState(instancesClient, 'TERMINATED');
    }

    const [operation] = await instancesClient.start({
      project: VM_CONFIG.PROJECT_ID,
      zone: VM_CONFIG.ZONE,
      instance: VM_CONFIG.INSTANCE_NAME,
    });

    logger.info({ operationId: operation.name }, 'Start operation initiated');

    await waitForState(instancesClient, 'RUNNING');
    logger.info({}, 'VM reached RUNNING state');

    const healthy = await pollHealth();

    if (!healthy) {
      return {
        success: false,
        message: 'VM started but health check timed out after 3 minutes',
        startupDurationMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      message: 'VM started and healthy',
      startupDurationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Failed to start VM');
    return {
      success: false,
      message: `Failed to start VM: ${message}`,
    };
  }
}

async function waitForState(
  client: InstancesClient,
  targetState: 'RUNNING' | 'TERMINATED'
): Promise<void> {
  const deadline = Date.now() + VM_CONFIG.HEALTH_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const [instance] = await client.get({
      project: VM_CONFIG.PROJECT_ID,
      zone: VM_CONFIG.ZONE,
      instance: VM_CONFIG.INSTANCE_NAME,
    });

    if (instance.status === targetState) {
      return;
    }

    await sleep(5000);
  }

  throw new Error(`Timeout waiting for VM to reach ${targetState} state`);
}

async function pollHealth(): Promise<boolean> {
  const deadline = Date.now() + VM_CONFIG.HEALTH_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(VM_CONFIG.HEALTH_ENDPOINT, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = (await response.json()) as { status: string };
        if (data.status === 'ready') {
          logger.info({}, 'VM health check passed');
          return true;
        }
      }
    } catch {
      // Expected during startup - VM not yet responding
    }

    logger.debug({}, 'Health check failed, retrying...');
    await sleep(VM_CONFIG.HEALTH_POLL_INTERVAL_MS);
  }

  logger.error({}, 'Health check timed out');
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
