#!/usr/bin/env node

/**
 * Predev Update Listener
 *
 * Listens for code update notifications via Pub/Sub pull subscription.
 * When a message is received, pulls latest code and restarts PM2 services.
 *
 * Environment variables:
 *   INTEXURAOS_GCP_PROJECT_ID - GCP project ID
 *   INTEXURAOS_ENVIRONMENT - Environment (dev, prod)
 */

import { PubSub } from '@google-cloud/pubsub';
import { execSync, spawn } from 'child_process';

const PROJECT_ID = process.env.INTEXURAOS_GCP_PROJECT_ID || 'intexuraos-dev-pbuchman';
const ENVIRONMENT = process.env.INTEXURAOS_ENVIRONMENT || 'dev';
const SUBSCRIPTION_NAME = `predev-code-update-vm-${ENVIRONMENT}`;
const REPO_DIR = '/opt/intexuraos';

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, msg: message, ...data }));
}

function execCommand(command, options = {}) {
  log(`Executing: ${command}`);
  try {
    const output = execSync(command, {
      cwd: REPO_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, error: error.message, stderr: error.stderr?.toString() };
  }
}

async function handleCodeUpdate(message) {
  const data = JSON.parse(message.data.toString());
  const { branch, commitSha, timestamp } = data;

  log('Received code update notification', { branch, commitSha, timestamp });

  // Acknowledge message immediately to prevent redelivery during long update
  message.ack();

  try {
    // Step 1: Fetch latest changes
    log('Fetching latest changes...');
    const fetchResult = execCommand('git fetch --all');
    if (!fetchResult.success) {
      log('Git fetch failed', { error: fetchResult.error });
      return;
    }

    // Step 2: Get current branch
    const currentBranchResult = execCommand('git rev-parse --abbrev-ref HEAD');
    const currentBranch = currentBranchResult.output;
    log('Current branch', { currentBranch, targetBranch: branch });

    // Step 3: Pull if on same branch, or checkout if different
    if (currentBranch === branch) {
      log('Pulling latest changes...');
      const pullResult = execCommand(`git pull origin ${branch}`);
      if (!pullResult.success) {
        log('Git pull failed', { error: pullResult.error });
        return;
      }
      log('Git pull successful', { output: pullResult.output });
    } else {
      log('Switching branch and pulling...', { from: currentBranch, to: branch });
      const checkoutResult = execCommand(`git checkout ${branch} && git pull origin ${branch}`);
      if (!checkoutResult.success) {
        log('Git checkout/pull failed', { error: checkoutResult.error });
        return;
      }
    }

    // Step 4: Install dependencies (in case package.json changed)
    log('Installing dependencies...');
    const installResult = execCommand('pnpm install --frozen-lockfile');
    if (!installResult.success) {
      log('pnpm install failed, continuing anyway', { error: installResult.error });
    }

    // Step 5: Build packages
    log('Building packages...');
    const buildResult = execCommand('pnpm build');
    if (!buildResult.success) {
      log('pnpm build failed', { error: buildResult.error });
      return;
    }

    // Step 6: Restart PM2 services
    log('Restarting PM2 services...');
    const restartResult = execCommand('pm2 restart all');
    if (!restartResult.success) {
      log('PM2 restart failed', { error: restartResult.error });
      return;
    }

    log('Code update completed successfully', { branch, commitSha });
  } catch (error) {
    log('Code update failed', { error: error.message, stack: error.stack });
  }
}

async function main() {
  log('Starting predev update listener', { projectId: PROJECT_ID, subscription: SUBSCRIPTION_NAME });

  const pubsub = new PubSub({ projectId: PROJECT_ID });
  const subscription = pubsub.subscription(SUBSCRIPTION_NAME);

  // Check if subscription exists
  try {
    const [exists] = await subscription.exists();
    if (!exists) {
      log('Subscription does not exist, waiting for it to be created...', { subscription: SUBSCRIPTION_NAME });
      // Wait and retry
      await new Promise((resolve) => setTimeout(resolve, 30000));
      return main();
    }
  } catch (error) {
    log('Error checking subscription', { error: error.message });
    await new Promise((resolve) => setTimeout(resolve, 30000));
    return main();
  }

  log('Listening for code update messages...');

  subscription.on('message', handleCodeUpdate);

  subscription.on('error', (error) => {
    log('Subscription error', { error: error.message });
  });

  // Keep process alive
  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down...');
    subscription.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down...');
    subscription.close();
    process.exit(0);
  });
}

main().catch((error) => {
  log('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
