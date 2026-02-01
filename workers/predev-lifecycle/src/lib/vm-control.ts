import { InstanceGroupManagersClient } from '@google-cloud/compute';
import { logger } from './logger.js';
import { CONFIG } from './config.js';
import { serializeError } from './serializeError.js';

export class VmControl {
  private client: InstanceGroupManagersClient;

  constructor() {
    this.client = new InstanceGroupManagersClient();
  }

  async startVm(): Promise<{ success: boolean; message: string }> {
    try {
      logger.info({ mig: CONFIG.MIG_NAME, zone: CONFIG.ZONE }, 'Starting VM');

      await this.client.resize({
        project: CONFIG.PROJECT_ID,
        zone: CONFIG.ZONE,
        instanceGroupManager: CONFIG.MIG_NAME,
        size: 1,
      });

      return { success: true, message: 'VM start initiated' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to start VM');
      return { success: false, message: `Failed to start VM: ${message}` };
    }
  }

  async stopVm(): Promise<{ success: boolean; message: string }> {
    try {
      logger.info({ mig: CONFIG.MIG_NAME, zone: CONFIG.ZONE }, 'Stopping VM');

      await this.client.resize({
        project: CONFIG.PROJECT_ID,
        zone: CONFIG.ZONE,
        instanceGroupManager: CONFIG.MIG_NAME,
        size: 0,
      });

      return { success: true, message: 'VM stop initiated' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to stop VM');
      return { success: false, message: `Failed to stop VM: ${message}` };
    }
  }

  async getVmCount(): Promise<number> {
    try {
      const [response] = await this.client.get({
        project: CONFIG.PROJECT_ID,
        zone: CONFIG.ZONE,
        instanceGroupManager: CONFIG.MIG_NAME,
      });
      return (response as { targetSize?: number }).targetSize ?? 0;
    } catch (error) {
      logger.error({ error: serializeError(error) }, 'Failed to get VM count');
      return 0;
    }
  }
}
