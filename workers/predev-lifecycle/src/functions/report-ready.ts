import type { HttpFunction } from '@google-cloud/functions-framework';
import * as functions from '@google-cloud/functions-framework';
import { createLogger } from '../lib/logger.js';
import { StateManager } from '../lib/state.js';

const logger = createLogger('report-ready');
const state = new StateManager();

interface ReadyPayload {
  ip: string;
  branch: string;
}

export const reportReady: HttpFunction = async (
  req: { method?: string; body?: unknown },
  res: { status(code: number): { send(message: string): void } },
) => {
  logger.info({ method: req.method }, 'Report-ready request');

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const { ip, branch } = req.body as ReadyPayload;

  if (!ip || !branch) {
    logger.warn({ body: req.body }, 'Missing ip or branch in payload');
    res.status(400).send('Missing ip or branch');
    return;
  }

  logger.info({ ip, branch }, 'VM reported ready');

  await state.setRunning(ip, branch);

  res.status(200).send('OK');
};

functions.http('reportReady', reportReady);
