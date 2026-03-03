/**
 * E2E Container Tests
 *
 * These tests run real Docker containers with the Claude stub
 * to verify the complete isolation infrastructure works correctly.
 *
 * Prerequisites:
 * - Docker daemon running
 * - Test worker image built: docker build -t claude-worker:test -f Dockerfile.test .
 * - Worker network created: docker network create claude-worker-net
 *
 * To run locally:
 *   pnpm --filter orchestrator test:e2e
 *
 * In CI, these are run by the e2e-isolation workflow job.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { DockerProvider } from '../docker-provider.js';
import type { WorkerConfig } from '../types.js';

const TEST_IMAGE = process.env['WORKER_IMAGE'] ?? 'claude-worker:test';
const TEST_NETWORK = process.env['WORKER_NETWORK'] ?? 'claude-worker-net';
const TEST_TIMEOUT = 60_000;

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function doesNetworkExist(): boolean {
  try {
    execSync(`docker network inspect ${TEST_NETWORK}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function doesImageExist(): boolean {
  try {
    execSync(`docker image inspect ${TEST_IMAGE}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface MockLogger {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
  child: () => MockLogger;
}

function createMockLogger(): MockLogger {
  const noop = (): void => {
    /* no-op for test logger */
  };
  const logger: MockLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: (): MockLogger => logger,
  };
  return logger;
}

const skipIfNoDocker = !isDockerAvailable();
const skipIfNoNetwork = skipIfNoDocker || !doesNetworkExist();
const skipIfNoImage = skipIfNoNetwork || !doesImageExist();

describe.skipIf(skipIfNoDocker)('E2E Container Tests', () => {
  let provider: DockerProvider;
  let testWorktreePath: string;
  let testSecretsPath: string;
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    if (skipIfNoImage) {
      return;
    }

    testWorktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-worktree-'));
    testSecretsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-secrets-'));

    execSync(`git init ${testWorktreePath}`, { stdio: 'ignore' });
    execSync(`git -C ${testWorktreePath} config user.email "test@test.com"`, { stdio: 'ignore' });
    execSync(`git -C ${testWorktreePath} config user.name "Test"`, { stdio: 'ignore' });
    fs.writeFileSync(path.join(testWorktreePath, 'README.md'), '# Test Repo');
    execSync(`git -C ${testWorktreePath} add . && git -C ${testWorktreePath} commit -m "init"`, {
      stdio: 'ignore',
    });

    fs.writeFileSync(path.join(testSecretsPath, 'gcp-sa.json'), '{"type": "service_account"}');

    provider = new DockerProvider(
      {
        imageName: TEST_IMAGE,
        imagePullPolicy: 'if-not-present',
        networkName: TEST_NETWORK,
        maxConcurrent: 2,
        timeoutMs: TEST_TIMEOUT,
        secretsBasePath: testSecretsPath,
      },
      createMockLogger() as never
    );
  });

  afterEach(async () => {
    for (const taskId of createdTaskIds) {
      try {
        await provider.destroyWorker(taskId);
      } catch {
        /* ignore cleanup errors */
      }
    }
    createdTaskIds.length = 0;
  });

  afterAll(async () => {
    if (testWorktreePath && fs.existsSync(testWorktreePath)) {
      fs.rmSync(testWorktreePath, { recursive: true, force: true });
    }
    if (testSecretsPath && fs.existsSync(testSecretsPath)) {
      fs.rmSync(testSecretsPath, { recursive: true, force: true });
    }
  });

  function createTestConfig(taskId: string, prompt: string): WorkerConfig {
    createdTaskIds.push(taskId);
    return {
      taskId,
      worktreePath: testWorktreePath,
      prompt,
      systemPrompt: `You are a test assistant.\n\n${prompt}`,
      workerType: 'auto',
      secrets: {
        ANTHROPIC_API_KEY: 'test-key',
        LINEAR_API_KEY: 'test-linear',
        SENTRY_AUTH_TOKEN: 'test-sentry',
        ZAI_API_KEY: 'test-zai',
        MINIMAX_API_KEY: 'test-minimax',
        DASHSCOPE_API_KEY: 'test-dashscope',
      },
      gcpSaKeyPath: path.join(testSecretsPath, 'gcp-sa.json'),
      githubAppKeyPath: '',
    };
  }

  function waitForAttemptCompletion(config: WorkerConfig, timeoutMs = 10_000): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for onComplete callback after ${String(timeoutMs)}ms`));
      }, timeoutMs);

      config.onComplete = (exitCode: number): void => {
        clearTimeout(timeout);
        resolve(exitCode);
      };
    });
  }

  describe.skipIf(skipIfNoImage)('Container Lifecycle', () => {
    it(
      'starts container and runs Claude stub',
      async () => {
        const taskId = `e2e-lifecycle-${Date.now()}`;
        const config = createTestConfig(taskId, 'Hello from E2E test');

        const logs: string[] = [];
        config.onLog = (chunk: string): void => {
          logs.push(chunk);
        };

        const handle = await provider.createWorker(config);

        expect(handle.taskId).toBe(taskId);
        expect(handle.status).toBe('running');
        expect(handle.containerId).toBeDefined();

        const isRunning = await provider.isWorkerRunning(taskId);
        expect(isRunning).toBe(true);

        await new Promise((r) => setTimeout(r, 2000));

        const allLogs = await provider.getWorkerLogs(taskId);
        expect(allLogs).toContain('[entrypoint]');
        expect(allLogs).toContain('[claude-stub]');
      },
      TEST_TIMEOUT
    );

    it(
      'destroys container gracefully',
      async () => {
        const taskId = `e2e-destroy-${Date.now()}`;
        const config = createTestConfig(taskId, 'Test destroy');

        await provider.createWorker(config);
        const beforeDestroy = await provider.isWorkerRunning(taskId);
        expect(beforeDestroy).toBe(true);

        await provider.destroyWorker(taskId);

        const afterDestroy = await provider.isWorkerRunning(taskId);
        expect(afterDestroy).toBe(false);
      },
      TEST_TIMEOUT
    );
  });

  describe.skipIf(skipIfNoImage)('Mount Verification', () => {
    it(
      'mounts worktree at /repo with read-write access',
      async () => {
        const taskId = `e2e-mount-repo-${Date.now()}`;
        const config = createTestConfig(taskId, 'file-test');

        await provider.createWorker(config);
        await new Promise((r) => setTimeout(r, 3000));

        const logs = await provider.getWorkerLogs(taskId);
        expect(logs).toContain('[claude-stub] /repo: WRITABLE');
      },
      TEST_TIMEOUT
    );

    it(
      'mounts secrets at /secrets with read-only access',
      async () => {
        const taskId = `e2e-mount-secrets-${Date.now()}`;
        const config = createTestConfig(taskId, 'file-test');

        await provider.createWorker(config);
        await new Promise((r) => setTimeout(r, 3000));

        const logs = await provider.getWorkerLogs(taskId);
        expect(logs).toContain('[claude-stub] /secrets: READ-ONLY (good)');
      },
      TEST_TIMEOUT
    );

    it(
      'verifies git repository is present',
      async () => {
        const taskId = `e2e-git-${Date.now()}`;
        const config = createTestConfig(taskId, 'Hello');

        await provider.createWorker(config);
        await new Promise((r) => setTimeout(r, 2000));

        const logs = await provider.getWorkerLogs(taskId);
        expect(logs).toContain('[claude-stub] /repo mount verified');
      },
      TEST_TIMEOUT
    );
  });

  describe.skipIf(skipIfNoImage)('Input/Output', () => {
    it(
      'exit command completes attempt successfully',
      async () => {
        const taskId = `e2e-exit-${Date.now()}`;
        const config = createTestConfig(taskId, 'exit');
        const completion = waitForAttemptCompletion(config);

        await provider.createWorker(config);

        const exitCode = await completion;
        expect(exitCode).toBe(0);

        const isRunning = await provider.isWorkerRunning(taskId);
        expect(isRunning).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      'error command causes failed attempt exit',
      async () => {
        const taskId = `e2e-error-${Date.now()}`;
        const config = createTestConfig(taskId, 'error');
        const completion = waitForAttemptCompletion(config);

        await provider.createWorker(config);

        const exitCode = await completion;
        expect(exitCode).toBe(1);
      },
      TEST_TIMEOUT
    );
  });

  describe.skipIf(skipIfNoImage)('Resource Limits', () => {
    it(
      'reports resource usage',
      async () => {
        const taskId = `e2e-resources-${Date.now()}`;
        const config = createTestConfig(taskId, 'resource-test');

        await provider.createWorker(config);
        await new Promise((r) => setTimeout(r, 2000));

        const usage = await provider.getResourceUsage(taskId);

        expect(usage.memoryLimitMB).toBeGreaterThan(0);
        expect(usage.memoryUsedMB).toBeGreaterThanOrEqual(0);
        expect(usage.cpuPercent).toBeGreaterThanOrEqual(0);
      },
      TEST_TIMEOUT
    );

    it(
      'enforces memory limit in container',
      async () => {
        const taskId = `e2e-memlimit-${Date.now()}`;
        const config = createTestConfig(taskId, 'resource-test');

        await provider.createWorker(config);
        await new Promise((r) => setTimeout(r, 3000));

        const logs = await provider.getWorkerLogs(taskId);
        expect(logs).toContain('Memory limit:');
      },
      TEST_TIMEOUT
    );
  });

  describe.skipIf(skipIfNoImage)('Timeout Handling', () => {
    it(
      'kills container after timeout',
      async () => {
        const taskId = `e2e-timeout-${Date.now()}`;

        const shortTimeoutProvider = new DockerProvider(
          {
            imageName: TEST_IMAGE,
            imagePullPolicy: 'if-not-present',
            networkName: TEST_NETWORK,
            maxConcurrent: 1,
            timeoutMs: 3000,
            secretsBasePath: testSecretsPath,
            managedAttemptsMode: false,
          },
          createMockLogger() as never
        );

        const config: WorkerConfig = {
          taskId,
          worktreePath: testWorktreePath,
          prompt: 'timeout',
          systemPrompt: 'timeout',
          workerType: 'auto',
          secrets: {
            ANTHROPIC_API_KEY: 'test-key',
            LINEAR_API_KEY: 'test-linear',
            SENTRY_AUTH_TOKEN: 'test-sentry',
            ZAI_API_KEY: 'test-zai',
            MINIMAX_API_KEY: 'test-minimax',
            DASHSCOPE_API_KEY: 'test-dashscope',
          },
          gcpSaKeyPath: '',
          githubAppKeyPath: '',
        };

        createdTaskIds.push(taskId);
        await shortTimeoutProvider.createWorker(config);

        const exitCode = await shortTimeoutProvider.waitForCompletion(taskId, 3000);
        expect([137, -1]).toContain(exitCode);
      },
      TEST_TIMEOUT
    );
  });

  describe.skipIf(skipIfNoImage)('Concurrency', () => {
    it(
      'enforces max concurrent workers limit',
      async () => {
        const taskId1 = `e2e-concurrent-1-${Date.now()}`;
        const taskId2 = `e2e-concurrent-2-${Date.now()}`;
        const taskId3 = `e2e-concurrent-3-${Date.now()}`;

        const config1 = createTestConfig(taskId1, 'Worker 1');
        const config2 = createTestConfig(taskId2, 'Worker 2');
        const config3 = createTestConfig(taskId3, 'Worker 3');

        await provider.createWorker(config1);
        await provider.createWorker(config2);

        await expect(provider.createWorker(config3)).rejects.toThrow(/Max concurrent workers/);

        const workers = await provider.listWorkers();
        expect(workers.length).toBe(2);
      },
      TEST_TIMEOUT
    );
  });
});
