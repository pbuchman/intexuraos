/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import type { HttpFunction } from '@google-cloud/functions-framework';
import * as functions from '@google-cloud/functions-framework';
import { PubSub } from '@google-cloud/pubsub';
import * as crypto from 'crypto';
import { createLogger } from '../lib/logger.js';
import { StateManager } from '../lib/state.js';

const logger = createLogger('webhook');
const state = new StateManager();
const pubsub = new PubSub();

interface GitHubPushPayload {
  ref?: string;
  after?: string;
  repository?: {
    full_name?: string;
  };
}

interface CodeUpdateMessage {
  branch: string;
  commitSha: string;
  timestamp: string;
}

async function publishCodeUpdate(branch: string, commitSha: string): Promise<void> {
  const topicName = process.env['INTEXURAOS_PREDEV_CODE_UPDATE_TOPIC'];
  if (!topicName) {
    logger.warn('INTEXURAOS_PREDEV_CODE_UPDATE_TOPIC not configured, skipping publish');
    return;
  }

  const message: CodeUpdateMessage = {
    branch,
    commitSha,
    timestamp: new Date().toISOString(),
  };

  try {
    const topic = pubsub.topic(topicName);
    await topic.publishMessage({ json: message });
    logger.info({ branch, commitSha, topic: topicName }, 'Published code update message');
  } catch (error) {
    logger.error({ error, branch, commitSha }, 'Failed to publish code update message');
  }
}


export const webhook: HttpFunction = async (req, res) => {
  logger.info({ method: req.method }, 'Webhook request');

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // Verify GitHub webhook signature
  const signature = (req.headers as Record<string, string | string[]>)['x-hub-signature-256'];
  const secret = process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'];

  if (!secret || secret.length === 0) {
    logger.error('INTEXURAOS_GITHUB_WEBHOOK_SECRET not configured');
    res.status(500).send('Server configuration error');
    return;
  }

  if (!signature || typeof signature !== 'string') {
    logger.warn('Missing signature header');
    res.status(401).send('Missing signature');
    return;
  }

  // Get raw body for signature verification
  /* v8 ignore start -- ts-type: rawBody availability depends on Cloud Functions runtime @preserve */
  const rawBody = req.rawBody ? Buffer.from(req.rawBody) : Buffer.from(JSON.stringify(req.body));
  /* v8 ignore stop @preserve */

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;

  // Use timing-safe comparison for security
  try {
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      logger.warn('Invalid webhook signature');
      res.status(401).send('Invalid signature');
      return;
    }
  } catch {
    logger.warn('Signature comparison failed');
    res.status(401).send('Invalid signature');
    return;
  }

  const event = (req.headers as Record<string, string | string[]>)['x-github-event'];
  logger.info({ event }, 'GitHub event received');

  if (event !== 'push') {
    res.status(200).send('Ignored event');
    return;
  }

  const payload = req.body as GitHubPushPayload;
  const { ref, after: commitSha } = payload;

  if (!ref || ref.length === 0) {
    logger.warn('Missing ref in payload');
    res.status(400).send('Missing ref');
    return;
  }

  const branch = ref.replace('refs/heads/', '');

  logger.info({ branch, commitSha }, 'Push event for branch');

  const currentState = await state.getState();

  // Check if branch is locked and trying to switch
  if (currentState?.branchLocked === true && currentState.branch !== branch) {
    logger.info(
      { lockedBranch: currentState.branch, attemptedBranch: branch },
      'Branch locked - ignoring push from different branch'
    );
    res.status(200).send('Branch locked - ignoring different branch');
    return;
  }

  // If VM is running on the same branch, notify it to pull latest code
  /* v8 ignore start -- test-infra: VM notification requires specific running state @preserve */
  if (currentState?.status === 'running' && currentState.branch === branch) {
    logger.info({ branch, commitSha }, 'VM running on same branch - notifying for code update');
    await publishCodeUpdate(branch, commitSha ?? 'unknown');
  }
  /* v8 ignore stop @preserve */

  // If VM is running on different branch (and not locked), log but don't switch
  /* v8 ignore start -- test-infra: branch switch detection requires specific VM state @preserve */
  if (currentState?.status === 'running' && currentState.branch !== branch) {
    logger.info(
      { from: currentState.branch, to: branch },
      'Branch change detected - VM will switch on next restart'
    );
  }
  /* v8 ignore stop @preserve */

  // Update state with new branch
  await state.setState({ branch });

  res.status(200).send('OK');
};

functions.http('webhook', webhook);
