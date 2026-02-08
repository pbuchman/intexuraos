import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { DockerProvider, type DockerProviderConfig } from '../docker-provider.js';
import type { WorkerConfig } from '../types.js';

interface MockVolume {
  inspect: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface MockDocker {
  createContainer: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  listContainers: ReturnType<typeof vi.fn>;
  getVolume: ReturnType<typeof vi.fn>;
  createVolume: ReturnType<typeof vi.fn>;
}

interface MockContainer {
  id: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  wait: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  logs: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
}

interface MockAttachStream {
  write: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

interface MockDockerResult {
  mockDocker: MockDocker;
  mockContainer: MockContainer;
  mockAttachStream: MockAttachStream;
  mockVolume: MockVolume;
  resolveContainerWait: (value: { StatusCode: number }) => void;
}

// Create mock Docker instance factory
function createMockDocker(): MockDockerResult {
  const mockAttachStream = {
    write: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  };

  // Create a deferred promise for container.wait() that won't resolve until explicitly triggered
  let resolveContainerWait: (value: { StatusCode: number }) => void;
  const containerWaitPromise = new Promise<{ StatusCode: number }>((resolve) => {
    resolveContainerWait = resolve;
  });

  const mockContainer = {
    id: 'test-container-id',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockReturnValue(containerWaitPromise),
    attach: vi.fn().mockResolvedValue(mockAttachStream),
    logs: vi.fn().mockResolvedValue(Buffer.from('test logs')),
    inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
    stats: vi.fn().mockResolvedValue({
      cpu_stats: {
        cpu_usage: { total_usage: 1000 },
        system_cpu_usage: 10000,
        online_cpus: 4,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 500 },
        system_cpu_usage: 9000,
      },
      memory_stats: {
        usage: 1024 * 1024 * 512,
        limit: 1024 * 1024 * 1024 * 8,
      },
    }),
    exec: vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue(mockAttachStream),
    }),
  };

  const mockVolume: MockVolume = {
    inspect: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const mockDocker = {
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getContainer: vi.fn().mockReturnValue(mockContainer),
    listContainers: vi.fn().mockResolvedValue([]),
    getVolume: vi.fn().mockReturnValue(mockVolume),
    createVolume: vi.fn().mockResolvedValue(mockVolume),
  };

  return {
    mockDocker,
    mockContainer,
    mockAttachStream,
    mockVolume,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- resolveContainerWait is set in Promise constructor
    resolveContainerWait: resolveContainerWait!,
  };
}

// Mock fs at module level
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ isFile: () => false, isDirectory: () => true }),
    readFileSync: vi.fn().mockReturnValue(''),
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import type { Logger } from '@intexuraos/common-core';

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

const createTestConfig = (overrides: Partial<WorkerConfig> = {}): WorkerConfig => ({
  taskId: 'test-task-123',
  worktreePath: '/test/worktree',
  prompt: 'Test prompt',
  systemPrompt: 'Test system prompt',
  workerType: 'auto',
  secrets: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    LINEAR_API_KEY: 'test-linear-key',
    SENTRY_AUTH_TOKEN: 'test-sentry-token',
    ZAI_API_KEY: 'test-zai-key',
  },
  gcpSaKeyPath: '/test/gcp-sa.json',
  githubAppKeyPath: '/test/github-key.pem',
  ...overrides,
});

// Extended DockerProvider for testing with mock injection
class TestableDockerProvider extends DockerProvider {
  constructor(
    config: Partial<DockerProviderConfig>,
    logger: Logger,
    mockDocker: ReturnType<typeof createMockDocker>['mockDocker']
  ) {
    super(config, logger);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).docker = mockDocker;
  }

  protected override async waitForContainerReady(): Promise<void> {
    return Promise.resolve();
  }

  protected override async writePromptToTTY(
    attachStream: NodeJS.ReadWriteStream,
    prompt: string,
    _taskId: string
  ): Promise<void> {
    attachStream.write(prompt + '\n');
    attachStream.write('\r');
  }

  protected override monitorForResponseCompletion(
    _attachStream: NodeJS.ReadWriteStream,
    _taskId: string,
    _containerId: string
  ): void {
    // No-op in tests
  }
}

describe('DockerProvider', () => {
  let provider: TestableDockerProvider;
  let mockLogger: Logger;
  let mocks: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    mocks = createMockDocker();
    provider = new TestableDockerProvider({}, mockLogger, mocks.mockDocker);
  });

  describe('createWorker', () => {
    it('starts container with correct config', async () => {
      const config = createTestConfig();
      const handle = await provider.createWorker(config);

      expect(handle.taskId).toBe('test-task-123');
      expect(handle.containerId).toBe('test-container-id');
      expect(handle.status).toBe('running');
      expect(handle.startedAt).toBeInstanceOf(Date);
      expect(mocks.mockDocker.createContainer).toHaveBeenCalled();
      expect(mocks.mockContainer.start).toHaveBeenCalled();
    });

    it('enforces concurrency limit', async () => {
      const providerWithLimit = new TestableDockerProvider(
        { maxConcurrent: 1 },
        mockLogger,
        mocks.mockDocker
      );

      await providerWithLimit.createWorker(createTestConfig({ taskId: 'task-1' }));

      await expect(
        providerWithLimit.createWorker(createTestConfig({ taskId: 'task-2' }))
      ).rejects.toThrow('Max concurrent workers (1) reached');
    });

    it('validates worktree exists', async () => {
      const fs = await import('node:fs');
      (fs.existsSync as Mock).mockReturnValueOnce(false);

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow('Invalid worktree');
    });

    it('calls onLog callback when provided', async () => {
      const onLog = vi.fn();
      const config = createTestConfig({ onLog });

      await provider.createWorker(config);

      const dataCallback = (mocks.mockAttachStream.on as Mock).mock.calls.find(
        (call: unknown[]) => call[0] === 'data'
      )?.[1] as ((chunk: Buffer) => void) | undefined;

      expect(dataCallback).toBeDefined();
      if (dataCallback !== undefined) {
        dataCallback(Buffer.from('test output'));
        expect(onLog).toHaveBeenCalledWith('test output');
      }
    });

    it('mounts pnpm store volume and node_modules tmpfs', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual('claude-pnpm-store:/home/claude/pnpm-store:rw');
      const tmpfs = createCall?.HostConfig?.Tmpfs as Record<string, string>;
      expect(tmpfs['/repo/node_modules']).toContain('uid=1001');
    });

    it('sets PNPM_STORE_DIR env var', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('PNPM_STORE_DIR=/home/claude/pnpm-store');
    });

    it('sends system prompt to container stdin', async () => {
      const config = createTestConfig({
        prompt: 'Hello Claude', // User prompt is now embedded in systemPrompt by buildSystemPrompt
        systemPrompt: 'You are a helpful assistant',
      });
      await provider.createWorker(config);

      expect(mocks.mockAttachStream.write).toHaveBeenCalledWith('You are a helpful assistant\n');
      expect(mocks.mockAttachStream.write).toHaveBeenCalledWith('\r');
    });
  });

  describe('destroyWorker', () => {
    it('stops container without removing it', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      await provider.destroyWorker('test-task-123');

      expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });

    it('handles already stopped container', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      mocks.mockContainer.stop.mockRejectedValueOnce(new Error('already stopped'));

      await expect(provider.destroyWorker('test-task-123')).resolves.not.toThrow();
    });

    it('cleans up secrets directory', async () => {
      const fs = await import('node:fs');
      const config = createTestConfig();
      await provider.createWorker(config);

      await provider.destroyWorker('test-task-123');

      expect(fs.promises.rm).toHaveBeenCalledWith(expect.stringContaining('test-task-123'), {
        recursive: true,
        force: true,
      });
    });

    it('handles non-existent worker gracefully', async () => {
      await expect(provider.destroyWorker('non-existent')).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { taskId: 'non-existent' },
        'Worker not found for destroy'
      );
    });
  });

  describe('isWorkerRunning', () => {
    it('returns true when container is running', async () => {
      await provider.createWorker(createTestConfig());

      const isRunning = await provider.isWorkerRunning('test-task-123');

      expect(isRunning).toBe(true);
    });

    it('returns false when container is stopped', async () => {
      await provider.createWorker(createTestConfig());

      mocks.mockContainer.inspect.mockResolvedValueOnce({ State: { Running: false } });

      const isRunning = await provider.isWorkerRunning('test-task-123');

      expect(isRunning).toBe(false);
    });

    it('returns false when worker not found', async () => {
      const isRunning = await provider.isWorkerRunning('non-existent');

      expect(isRunning).toBe(false);
    });
  });

  describe('sendInput', () => {
    it('writes prompt then submits with carriage return', async () => {
      await provider.createWorker(createTestConfig());

      await provider.sendInput('test-task-123', 'test input');

      expect(mocks.mockAttachStream.write).toHaveBeenCalledWith('test input\n');
      expect(mocks.mockAttachStream.write).toHaveBeenCalledWith('\r');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { taskId: 'test-task-123', inputLength: 10 },
        'Sending input to worker'
      );
    });

    it('throws if worker not found', async () => {
      await expect(provider.sendInput('non-existent', 'test')).rejects.toThrow(
        'Worker non-existent not found'
      );
    });
  });

  describe('waitForCompletion', () => {
    it('returns exit code on completion', async () => {
      await provider.createWorker(createTestConfig());

      // Schedule container completion after a short delay
      setTimeout(() => {
        mocks.resolveContainerWait({ StatusCode: 0 });
      }, 10);

      const exitCode = await provider.waitForCompletion('test-task-123', 60000);

      expect(exitCode).toBe(0);
    });

    it('returns -1 on timeout', async () => {
      await provider.createWorker(createTestConfig());

      mocks.mockContainer.wait.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentionally never-resolving promise
        () => new Promise(() => {})
      );

      const exitCode = await provider.waitForCompletion('test-task-123', 100);

      expect(exitCode).toBe(-1);
    }, 10000);

    it('returns -1 for non-existent worker', async () => {
      const exitCode = await provider.waitForCompletion('non-existent', 1000);

      expect(exitCode).toBe(-1);
    });
  });

  describe('getWorkerLogs', () => {
    it('returns container logs', async () => {
      await provider.createWorker(createTestConfig());

      const logs = await provider.getWorkerLogs('test-task-123');

      expect(logs).toBe('test logs');
    });

    it('returns empty string for non-existent worker', async () => {
      const logs = await provider.getWorkerLogs('non-existent');

      expect(logs).toBe('');
    });
  });

  describe('listWorkers', () => {
    it('returns all active worker handles', async () => {
      await provider.createWorker(createTestConfig({ taskId: 'task-1' }));
      await provider.createWorker(createTestConfig({ taskId: 'task-2' }));

      const workers = await provider.listWorkers();

      expect(workers).toHaveLength(2);
      expect(workers.map((w) => w.taskId)).toContain('task-1');
      expect(workers.map((w) => w.taskId)).toContain('task-2');
    });
  });

  describe('getResourceUsage', () => {
    it('returns resource usage stats', async () => {
      await provider.createWorker(createTestConfig());

      const usage = await provider.getResourceUsage('test-task-123');

      expect(usage.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(usage.memoryUsedMB).toBe(512);
      expect(usage.memoryLimitMB).toBe(8192);
    });

    it('throws for non-existent worker', async () => {
      await expect(provider.getResourceUsage('non-existent')).rejects.toThrow(
        'Worker non-existent not found'
      );
    });
  });

  describe('streamLogs', () => {
    it('calls onChunk with log data', async () => {
      await provider.createWorker(createTestConfig());

      const onChunk = vi.fn();
      const mockLogStream = {
        on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') {
            cb(Buffer.from('log chunk'));
          }
        }),
      };
      mocks.mockContainer.logs.mockResolvedValueOnce(mockLogStream);

      await provider.streamLogs('test-task-123', onChunk);

      expect(onChunk).toHaveBeenCalledWith('log chunk');
    });

    it('throws for non-existent worker', async () => {
      await expect(provider.streamLogs('non-existent', vi.fn())).rejects.toThrow(
        'Worker non-existent not found'
      );
    });
  });

  describe('attachTTY', () => {
    it('returns streams for interactive use', async () => {
      await provider.createWorker(createTestConfig());

      const tty = await provider.attachTTY('test-task-123');

      expect(tty.stdin).toBeDefined();
      expect(tty.stdout).toBeDefined();
      expect(tty.stderr).toBeDefined();
      expect(typeof tty.detach).toBe('function');
    });

    it('throws for non-existent worker', async () => {
      await expect(provider.attachTTY('non-existent')).rejects.toThrow(
        'Worker non-existent not found'
      );
    });
  });

  describe('cleanupOrphanedContainers', () => {
    it('removes containers older than 24 hours', async () => {
      const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
      const orphanContainer = {
        Id: 'orphan-container-id',
        Names: ['/claude-worker-orphan-task'],
        State: 'running',
        Created: twoDaysAgo,
      };

      mocks.mockDocker.listContainers.mockResolvedValueOnce([orphanContainer]);

      await provider.cleanupOrphanedContainers();

      expect(mocks.mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { name: ['claude-worker-'] },
      });
      expect(mocks.mockDocker.getContainer).toHaveBeenCalledWith('orphan-container-id');
      expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 5 });
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('handles stopped old containers', async () => {
      const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
      const orphanContainer = {
        Id: 'orphan-container-id',
        Names: ['/claude-worker-orphan-task'],
        State: 'exited',
        Created: twoDaysAgo,
      };

      mocks.mockDocker.listContainers.mockResolvedValueOnce([orphanContainer]);

      await provider.cleanupOrphanedContainers();

      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('skips containers younger than 24 hours', async () => {
      const oneHourAgo = Math.floor(Date.now() / 1000) - 60 * 60;
      const recentContainer = {
        Id: 'recent-container-id',
        Names: ['/claude-worker-recent-task'],
        State: 'exited',
        Created: oneHourAgo,
      };

      mocks.mockDocker.listContainers.mockResolvedValueOnce([recentContainer]);

      await provider.cleanupOrphanedContainers();

      expect(mocks.mockDocker.getContainer).not.toHaveBeenCalled();
      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });

    it('handles empty container list gracefully', async () => {
      mocks.mockDocker.listContainers.mockResolvedValueOnce([]);

      await expect(provider.cleanupOrphanedContainers()).resolves.not.toThrow();
    });

    it('handles list error gracefully', async () => {
      mocks.mockDocker.listContainers.mockRejectedValueOnce(new Error('Docker not available'));

      await expect(provider.cleanupOrphanedContainers()).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
