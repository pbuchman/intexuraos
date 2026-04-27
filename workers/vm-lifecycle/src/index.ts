import type { HttpFunction } from '@google-cloud/functions-framework';
import * as functions from '@google-cloud/functions-framework';
import { startVm } from './start-vm.js';
import { stopVm } from './stop-vm.js';
import { logger, flush } from './logger.js';
import { verifyInternalAuth } from './__shims__/common-worker.js';

// Captured once at module load — Cloud Functions instance scope. Tests use
// vi.hoisted() to set the env var before this module is imported.
const INTERNAL_AUTH_TOKEN = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

export const startVmFunction: HttpFunction = async (req, res): Promise<void> => {
  try {
    logger.info({ method: req.method }, 'start-vm function invoked');

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!verifyInternalAuth(req.headers['x-internal-auth'], INTERNAL_AUTH_TOKEN)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await startVm();

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(503).json(result);
    }
  } finally {
    await flush();
  }
};

export const stopVmFunction: HttpFunction = async (req, res): Promise<void> => {
  try {
    logger.info({ method: req.method }, 'stop-vm function invoked');

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!verifyInternalAuth(req.headers['x-internal-auth'], INTERNAL_AUTH_TOKEN)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await stopVm();

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(503).json(result);
    }
  } finally {
    await flush();
  }
};

functions.http('startVm', startVmFunction);
functions.http('stopVm', stopVmFunction);
