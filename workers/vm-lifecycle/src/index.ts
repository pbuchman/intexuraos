import type { HttpFunction } from '@google-cloud/functions-framework';
import { http } from '@google-cloud/functions-framework';
import { startVm } from './start-vm.js';
import { stopVm } from './stop-vm.js';
import { logger } from './logger.js';

function validateAuth(authHeader: string | undefined): boolean {
  const expectedToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  if (expectedToken === undefined || expectedToken === '') {
    logger.error('INTEXURAOS_INTERNAL_AUTH_TOKEN not configured');
    return false;
  }
  return authHeader === `Bearer ${expectedToken}`;
}

export const startVmFunction: HttpFunction = async (req, res) => {
  logger.info({ method: req.method }, 'start-vm function invoked');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!validateAuth(req.headers['x-internal-auth'] as string | undefined)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const result = await startVm();

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(503).json(result);
  }
};

export const stopVmFunction: HttpFunction = async (req, res) => {
  logger.info({ method: req.method }, 'stop-vm function invoked');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!validateAuth(req.headers['x-internal-auth'] as string | undefined)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const result = await stopVm();

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(503).json(result);
  }
};

http('startVm', startVmFunction);
http('stopVm', stopVmFunction);
