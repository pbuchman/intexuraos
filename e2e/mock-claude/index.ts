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
import express from 'express';
import { pino } from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
});

const app = express();

// Log ALL incoming requests for debugging
app.use((req, _res, next) => {
  logger.info(
    {
      method: req.method,
      url: req.url,
      path: req.path,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      hasBody: req.body !== undefined,
    },
    'Incoming request'
  );
  next();
});

app.use(express.json());

// Log body after parsing
app.use((req, _res, next) => {
  if (req.method === 'POST') {
    logger.info(
      {
        method: req.method,
        url: req.url,
        bodyType: typeof req.body,
        bodyKeys: req.body !== undefined && req.body !== null ? Object.keys(req.body) : [],
        hasTaskId: req.body?.taskId !== undefined,
        hasPrompt: req.body?.prompt !== undefined,
      },
      'Request body after parsing'
    );
  }
  next();
});

// Configuration
const PORT = Number.parseInt(process.env['PORT'] ?? '8090', 10);
const INTERNAL_AUTH_TOKEN = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-secret';

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
  taskId?: string;
  status: 'completed' | 'failed' | 'interrupted';
  result?: {
    prUrl?: string;
    branch: string;
    commits: number;
    summary: string;
    ciFailed?: boolean;
  };
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
      'X-Internal-Auth': INTERNAL_AUTH_TOKEN,
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
 * Scenario: Success - Simulates branch, commit, and PR creation.
 *
 * NOTE: In E2E mode, we skip actual git operations to avoid:
 * 1. Modifying the working directory (which would break package.json)
 * 2. Creating real PRs that need cleanup
 *
 * This mock simply returns a successful result without doing real git work.
 */
async function scenarioSuccess(): Promise<MockResult> {
  const timestamp = Date.now();
  const branchName = `test/e2e-success-${String(timestamp)}`;

  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 500));

  logger.info({ branchName }, 'Simulated successful PR creation (no actual git operations)');

  return {
    status: 'completed',
    result: {
      prUrl: `https://github.com/mock/repo/pull/${String(timestamp)}`,
      branch: branchName,
      commits: 1,
      summary: 'E2E mock: Successfully simulated PR creation',
    },
    duration: 1,
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
    result: {
      prUrl: '',
      branch: '',
      commits: 0,
      summary: 'Task completed after timeout',
    },
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

  logger.info({ branchName }, 'Simulated slow PR creation (no actual git operations)');

  return {
    status: 'completed',
    result: {
      prUrl: `https://github.com/mock/repo/pull/${String(timestamp)}`,
      branch: branchName,
      commits: 1,
      summary: 'E2E mock: Successfully completed slow task',
    },
    duration: 10,
  };
}

/**
 * Scenario: CI Failure - Simulates PR with broken code.
 */
async function scenarioCIFailure(): Promise<MockResult> {
  const timestamp = Date.now();
  const branchName = `test/e2e-ci-fail-${String(timestamp)}`;

  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 500));

  logger.info({ branchName }, 'Simulated CI failure PR (no actual git operations)');

  return {
    status: 'completed',
    result: {
      prUrl: `https://github.com/mock/repo/pull/${String(timestamp)}`,
      branch: branchName,
      commits: 1,
      summary: 'E2E mock: Simulated PR with CI failure',
      ciFailed: true,
    },
    duration: 1,
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
app.post(['/tasks', '/execute'], (req, res): void => {
  logger.info({ body: typeof req.body, hasBody: req.body !== undefined }, 'Received task request');

  // Validate request body - return 200 with 'rejected' status for dispatcher compatibility
  if (req.body === undefined || req.body === null) {
    logger.error('Request body is undefined or null');
    res.json({ status: 'rejected', reason: 'Missing request body' });
    return;
  }

  const request = req.body as MockClaudeRequest;
  const { taskId, prompt, webhookUrl, webhookSecret } = request;

  // Validate required fields - return 200 with 'rejected' status for dispatcher compatibility
  if (taskId === undefined || prompt === undefined) {
    logger.error({ taskId, prompt: typeof prompt }, 'Missing required fields');
    res.json({ status: 'rejected', reason: 'Missing required fields: taskId or prompt' });
    return;
  }

  logger.info({ taskId, prompt: prompt.substring(0, 100) }, 'Mock Claude received request');

  // Determine scenario from prompt
  const scenario = extractScenario(prompt);
  logger.info({ taskId, scenario }, 'Executing scenario');

  // Store task for potential cancellation
  const taskTimer = setTimeout(() => {
    void (async (): Promise<void> => {
      try {
        const handler = SCENARIOS[scenario];
        if (handler === undefined) {
          throw new Error(`Unknown scenario: ${scenario}`);
        }

        const result = await handler();

        // Send webhook callback
        await sendWebhook(webhookUrl, webhookSecret, { taskId, ...result });

        runningTasks.delete(taskId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error({ taskId, errorMessage, errorStack }, 'Scenario execution failed');

        // Send failure webhook
        await sendWebhook(webhookUrl, webhookSecret, {
          taskId,
          status: 'failed',
          error: {
            code: 'execution_error',
            message: 'Mock execution failed',
          },
          duration: 0,
        }).catch((webhookErr) => {
          const webhookErrMsg =
            webhookErr instanceof Error ? webhookErr.message : String(webhookErr);
          const webhookErrStack = webhookErr instanceof Error ? webhookErr.stack : undefined;
          logger.error(
            { taskId, webhookErrMsg, webhookErrStack },
            'Failed to send failure webhook'
          );
        });

        runningTasks.delete(taskId);
      }
    })();
  }, 100); // Small delay before starting

  runningTasks.set(taskId, taskTimer);

  res.json({ status: 'accepted', taskId, scenario });
});

// DELETE /tasks/:id - Cancel a running task
app.delete('/tasks/:id', (req, res): void => {
  const { id } = req.params;
  logger.info({ taskId: id }, 'Cancel request received');

  const timer = runningTasks.get(id);
  if (timer === undefined) {
    res.status(404).json({ error: 'Task not found or already completed' });
    return;
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
