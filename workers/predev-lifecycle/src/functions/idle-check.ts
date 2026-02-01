import type { CloudEventFunction } from '@google-cloud/functions-framework';
import * as functions from '@google-cloud/functions-framework';
import { createLogger } from '../lib/logger.js';
import { StateManager } from '../lib/state.js';
import { VmControl } from '../lib/vm-control.js';
import { CONFIG } from '../lib/config.js';

const logger = createLogger('idle-check');
const state = new StateManager();
const vm = new VmControl();

export const idleCheck: CloudEventFunction = async () => {
  logger.info('Idle check triggered');

  const currentState = await state.getState();

  if (currentState?.status !== 'running') {
    logger.info('VM not running, skipping idle check');
    return;
  }

  const lastActivity = new Date(currentState.lastActivity);
  const idleMinutes = (Date.now() - lastActivity.getTime()) / 1000 / 60;

  logger.info({ idleMinutes, threshold: CONFIG.IDLE_TIMEOUT_MINUTES }, 'Checking idle status');

  if (idleMinutes >= CONFIG.IDLE_TIMEOUT_MINUTES) {
    logger.info('VM idle, stopping...');
    await state.setStopping();

    const result = await vm.stopVm();

    if (result.success) {
      await state.setStopped();
      logger.info('VM stopped successfully');
    } else {
      logger.error({ error: result.message }, 'Failed to stop VM');
    }
  } else {
    logger.debug(
      { remainingMinutes: Math.round(CONFIG.IDLE_TIMEOUT_MINUTES - idleMinutes) },
      'VM still active'
    );
  }
};

functions.cloudEvent('idleCheck', idleCheck);
