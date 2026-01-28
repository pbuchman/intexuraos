/**
 * Mock Claude server for E2E testing.
 *
 * Simulates Claude Code behavior without actual LLM calls.
 * Uses scenario markers in prompts ([test:xxx]) to control behavior.
 *
 * Scenarios:
 * - success: Creates a branch, commit, and PR
 * - failure: Returns a failed status with error
 * - timeout: Simulates a long-running task (for cancellation testing)
 * - slow-success: Takes time but completes successfully
 * - ci-failure: Creates PR with broken code to simulate CI failure
 */

import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { pino } from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

const app = express();
app.use(express.json());

// Configuration
const PORT = Number.parseInt(process.env['PORT'] ?? '8090', 10);
const REPO_PATH = process.env['REPO_PATH'] ?? '/workspace';
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] ?? '';

// Track running tasks for cancellation
const runningTasks = new Map<string, NodeJS.Timeout>();

interface MockClaudeRequest {
  taskId: string;
  workerType: 'opus' | 'auto' | 'glm';
  prompt: string;
  repository?: string;
  baseBranch?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  slug?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
}

interface MockResult {
  status: 'completed' | 'failed' | 'cancelled';
  prUrl?: string;
  branch?: string;
  commits?: number;
  summary?: string;
  ciFailed?: boolean;
  error?: { code: string; message: string };
  duration?: number;
}

/**
 * Extract scenario from prompt.
 * Looks for [test:scenario-name] markers.
 */
function extractScenario(prompt: string): string {
  const match = prompt.toLowerCase().match(/\[test:(\w+)\]/);
  return match?.[1] ?? 'success';
}

/**
 * Send webhook callback to code-agent.
 */
async function sendWebhook(url: string, secret: string, payload: MockResult): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${String(timestamp)}.${body}`;
  const signature = createHmac('sha256', secret).update(message).digest('hex');

  logger.info({ url, status: payload.status }, 'Sending webhook callback');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Timestamp': String(timestamp),
      'X-Request-Signature': signature,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Webhook failed: ${String(response.status)} ${response.statusText} - ${errorText}`
    );
  }

  logger.info({ url, status: response.status }, 'Webhook callback sent successfully');
}

/**
 * Create a git branch.
 */
function createBranch(branchName: string, baseBranch: string): void {
  logger.info({ branchName, baseBranch }, 'Creating git branch');

  try {
    execSync(`git fetch origin ${baseBranch}`, { cwd: REPO_PATH, stdio: 'pipe' });
    execSync(`git checkout -b ${branchName} origin/${baseBranch}`, {
      cwd: REPO_PATH,
      stdio: 'pipe',
    });
  } catch {
    logger.error({ branchName, baseBranch }, 'Failed to create branch');
    throw new Error(`Failed to create branch ${branchName}`);
  }
}

/**
 * Make a commit with a test file.
 */
async function makeCommit(
  branchName: string,
  fileName: string,
  content: string,
  message: string
): Promise<void> {
  logger.info({ branchName, fileName }, 'Making commit');

  // Ensure we're on the branch
  execSync(`git checkout ${branchName}`, { cwd: REPO_PATH, stdio: 'pipe' });

  // Create temp directory for test files
  const tempDir = path.join(REPO_PATH, 'e2e-test-files');
  await fs.mkdir(tempDir, { recursive: true });

  // Write test file
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, content);

  // Commit
  execSync(`git add ${filePath}`, { cwd: REPO_PATH, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: REPO_PATH, stdio: 'pipe' });
  execSync(`git push -u origin ${branchName}`, { cwd: REPO_PATH, stdio: 'pipe' });

  logger.info({ branchName, fileName }, 'Commit created and pushed');
}

/**
 * Create a pull request using gh CLI.
 */
function createPR(branchName: string, baseBranch: string, title: string, body?: string): string {
  logger.info({ branchName, baseBranch, title }, 'Creating pull request');

  const bodyArg = body ? `--body "${body}"` : '--body "Mock PR for E2E testing"';

  try {
    const result = execSync(
      `gh pr create --base ${baseBranch} --head ${branchName} --title "${title}" ${bodyArg}`,
      {
        cwd: REPO_PATH,
        stdio: 'pipe',
        env: { ...process.env, GITHUB_TOKEN },
      }
    );

    const prUrl = result.toString().trim();
    logger.info({ prUrl }, 'Pull request created');

    return prUrl;
  } catch {
    logger.error({ branchName, baseBranch, title }, 'Failed to create PR');
    throw new Error(`Failed to create PR for ${branchName}`);
  }
}

/**
 * Scenario: Success - Creates branch, commit, and PR.
 */
async function scenarioSuccess(): Promise<MockResult> {
  const timestamp = Date.now();
  const branchName = `test/e2e-success-${String(timestamp)}`;
  const baseBranch = 'development';

  createBranch(branchName, baseBranch);
  await makeCommit(branchName, 'test-change.txt', 'E2E test change', 'E2E: Mock success commit');
  const prUrl = createPR(branchName, baseBranch, '[E2E] Mock Success PR');

  return {
    status: 'completed',
    prUrl,
    branch: branchName,
    commits: 1,
    summary: 'E2E mock: Successfully created test change',
    duration: 5,
  };
}

/**
 * Scenario: Failure - Returns error without creating PR.
 */
async function scenarioFailure(): Promise<MockResult> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    status: 'failed',
    error: {
      code: 'test_failure',
      message: 'Intentional test failure for E2E testing',
    },
    duration: 1,
  };
}

/**
 * Scenario: Timeout - Sleeps for configured duration.
 * For actual testing, use a shorter delay with override.
 */
async function scenarioTimeout(): Promise<MockResult> {
  const timeoutMinutes = Number.parseInt(process.env['E2E_TIMEOUT_MINUTES'] ?? '130', 10);
  const sleepMs = timeoutMinutes * 60 * 1000;

  logger.info({ timeoutMinutes, sleepMs }, 'Starting timeout scenario');

  // Sleep for the configured duration
  await new Promise((resolve) => setTimeout(resolve, sleepMs));

  return {
    status: 'completed',
    prUrl: '',
    branch: '',
    commits: 0,
    summary: 'Task completed after timeout',
    duration: timeoutMinutes,
  };
}

/**
 * Scenario: Slow Success - Takes 10 seconds but completes.
 */
async function scenarioSlowSuccess(): Promise<MockResult> {
  logger.info('Starting slow-success scenario (10 seconds)');

  // Sleep for 10 seconds
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const timestamp = Date.now();
  const branchName = `test/e2e-slow-${String(timestamp)}`;
  const baseBranch = 'development';

  createBranch(branchName, baseBranch);
  await makeCommit(branchName, 'slow-change.txt', 'Slow E2E test change', 'E2E: Mock slow commit');
  const prUrl = createPR(branchName, baseBranch, '[E2E] Mock Slow PR');

  return {
    status: 'completed',
    prUrl,
    branch: branchName,
    commits: 1,
    summary: 'E2E mock: Successfully completed slow task',
    duration: 10,
  };
}

/**
 * Scenario: CI Failure - Creates PR with broken code.
 */
async function scenarioCIFailure(): Promise<MockResult> {
  const timestamp = Date.now();
  const branchName = `test/e2e-ci-fail-${String(timestamp)}`;
  const baseBranch = 'development';

  createBranch(branchName, baseBranch);
  // Create a file with a type error that will fail CI
  await makeCommit(
    branchName,
    'broken.ts',
    '// This file has a type error to simulate CI failure\nconst x: number = "string";\n',
    'E2E: Mock CI failure commit'
  );
  const prUrl = createPR(branchName, baseBranch, '[E2E] Mock CI Failure PR');

  return {
    status: 'completed',
    prUrl,
    branch: branchName,
    commits: 1,
    summary: 'E2E mock: PR created with CI failure',
    ciFailed: true,
    duration: 5,
  };
}

/**
 * Scenario handlers map.
 */
const SCENARIOS: Record<string, () => Promise<MockResult>> = {
  success: scenarioSuccess,
  failure: scenarioFailure,
  timeout: scenarioTimeout,
  'slow-success': scenarioSlowSuccess,
  'ci-failure': scenarioCIFailure,
};

// POST /tasks - Main entry point (matches code-agent taskDispatcher expectations)
// Also handles /execute for backwards compatibility
app.post(['/tasks', '/execute'], async (req, res) => {
  const request = req.body as MockClaudeRequest;
  const { taskId, prompt, webhookUrl, webhookSecret } = request;

  logger.info({ taskId, prompt: prompt.substring(0, 100) }, 'Mock Claude received request');

  // Determine scenario from prompt
  const scenario = extractScenario(prompt);
  logger.info({ taskId, scenario }, 'Executing scenario');

  // Store task for potential cancellation
  const taskTimer = setTimeout(async () => {
    try {
      const handler = SCENARIOS[scenario];
      if (handler === undefined) {
        throw new Error(`Unknown scenario: ${scenario}`);
      }

      const result = await handler();

      // Send webhook callback
      await sendWebhook(webhookUrl, webhookSecret, { taskId, ...result });

      runningTasks.delete(taskId);
    } catch {
      logger.error({ taskId }, 'Scenario execution failed');

      // Send failure webhook
      await sendWebhook(webhookUrl, webhookSecret, {
        status: 'failed',
        error: {
          code: 'execution_error',
          message: 'Mock execution failed',
        },
        duration: 0,
      }).catch((webhookError) => {
        logger.error({ taskId, webhookError }, 'Failed to send failure webhook');
      });

      runningTasks.delete(taskId);
    }
  }, 100); // Small delay before starting

  runningTasks.set(taskId, taskTimer);

  res.json({ status: 'accepted', taskId, scenario });
});

// DELETE /tasks/:id - Cancel a running task
app.delete('/tasks/:id', (req, res) => {
  const { id } = req.params;
  logger.info({ taskId: id }, 'Cancel request received');

  const timer = runningTasks.get(id);
  if (timer === undefined) {
    return res.status(404).json({ error: 'Task not found or already completed' });
  }

  clearTimeout(timer);
  runningTasks.delete(id);

  res.json({ taskId: id, status: 'cancelled' });
});

// GET /health - Health check endpoint
app.get('/health', (_req, res) => {
  const capacity = 3;
  const running = runningTasks.size;

  res.json({
    status: 'ready',
    capacity,
    running,
    available: capacity - running,
  });
});

// POST /admin/shutdown - For graceful shutdown testing
app.post('/admin/shutdown', (_req, res) => {
  logger.info('Shutdown requested');
  res.json({ status: 'shutting_down' });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Mock Claude server listening');
});
