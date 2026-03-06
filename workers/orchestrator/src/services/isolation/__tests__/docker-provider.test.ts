import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { DockerProvider, type DockerProviderConfig } from '../docker-provider.js';
import type { WorkerConfig } from '../types.js';

function createMockExecStream(): NodeJS.ReadableStream & { resume: () => void } {
  const stream = new EventEmitter() as unknown as NodeJS.ReadableStream & { resume: () => void };
  stream.resume = vi.fn();
  return stream;
}

interface MockDocker {
  createContainer: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  listContainers: ReturnType<typeof vi.fn>;
  pull: ReturnType<typeof vi.fn>;
  getImage: ReturnType<typeof vi.fn>;
  modem: { followProgress: ReturnType<typeof vi.fn> };
}

interface MockContainer {
  id: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  wait: ReturnType<typeof vi.fn>;
  logs: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

interface MockDockerResult {
  mockDocker: MockDocker;
  mockContainer: MockContainer;
  resolveContainerWait: (value: { StatusCode: number }) => void;
}

function createMockDocker(): MockDockerResult {
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
    exec: vi.fn().mockImplementation(async () => {
      const stream = createMockExecStream();
      const start = vi.fn().mockImplementation(async () => {
        setTimeout(() => {
          stream.emit('data', Buffer.from('attempt logs'));
          stream.emit('end');
        }, 0);
        return stream;
      });
      const inspect = vi.fn().mockResolvedValue({ ExitCode: 0 });
      return { start, inspect };
    }),
    kill: vi.fn().mockResolvedValue(undefined),
  };

  const mockDocker = {
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getContainer: vi.fn().mockReturnValue(mockContainer),
    listContainers: vi.fn().mockResolvedValue([]),
    pull: vi.fn().mockResolvedValue({}),
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        RepoDigests: [
          'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker@sha256:testdigest',
        ],
      }),
    }),
    modem: {
      followProgress: vi.fn((_stream: unknown, onFinished: (err: Error | null) => void) => {
        onFinished(null);
      }),
    },
  };

  return {
    mockDocker,
    mockContainer,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- resolveContainerWait is set in Promise constructor
    resolveContainerWait: resolveContainerWait!,
  };
}

// Mock os.userInfo() to prevent crashing in Docker environments without /etc/passwd.
// Use process.getuid/getgid so UIDs match what tests assert via process.getuid?.() ?? 1000.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return {
    ...actual,
    userInfo: vi.fn().mockReturnValue({
      uid,
      gid,
      username: 'testuser',
      homedir: `/home/testuser`,
      shell: '/bin/bash',
    }),
  };
});

// Mock fs at module level
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ isFile: () => false, isDirectory: () => true }),
    readFileSync: vi.fn().mockImplementation((filePath: unknown) => {
      if (
        typeof filePath === 'string' &&
        filePath.includes('claude-worker-forensics-seccomp.json')
      ) {
        return '{"defaultAction":"SCMP_ACT_ERRNO","syscalls":[]}';
      }
      return '';
    }),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue(['system-prompt.txt', 'user-prompt.txt', 'github-token']),
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
    MINIMAX_API_KEY: 'test-minimax-key',
    DASHSCOPE_API_KEY: 'test-dashscope-key',
  },
  gcpSaKeyPath: '/test/gcp-sa.json',
  githubAppKeyPath: '/test/github-key.pem',
  ...overrides,
});

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

    it('fails fast when worker image pull fails', async () => {
      mocks.mockDocker.pull.mockRejectedValueOnce(new Error('registry unavailable'));

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow(
        'Failed to pull worker image'
      );
      expect(mocks.mockDocker.createContainer).not.toHaveBeenCalled();
    });

    it('fails when image does not support managed run-attempt mode', async () => {
      mocks.mockContainer.exec.mockImplementationOnce(async () => {
        const stream = createMockExecStream();
        const start = vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            stream.emit('end');
          }, 0);
          return stream;
        });
        const inspect = vi.fn().mockResolvedValue({ ExitCode: 1 });
        return { start, inspect };
      });

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow(
        'missing managed-attempt run-attempt entrypoint support'
      );
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('skips managed-entrypoint compatibility check when managedAttemptsMode is disabled', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );

      await nonManagedProvider.createWorker(createTestConfig());

      expect(mocks.mockContainer.exec).not.toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ['sh', '-lc', 'grep -q "run-attempt" /entrypoint.sh'],
        })
      );
    });

    it('creates container with Tty: false (non-interactive --print mode)', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      expect(createCall?.Tty).toBe(false);
      expect(createCall?.OpenStdin).toBeUndefined();
      expect(createCall?.AttachStdin).toBeUndefined();
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

    it('writes system prompt and user prompt files to secrets dir', async () => {
      const fs = await import('node:fs');
      const config = createTestConfig({
        systemPrompt: 'You are a helpful assistant',
        prompt: 'Fix the login bug',
      });
      await provider.createWorker(config);

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('system-prompt.txt'),
        'You are a helpful assistant',
        'utf-8'
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user-prompt.txt'),
        'Fix the login bug',
        'utf-8'
      );
    });

    it('does not write json-schema.json', async () => {
      const fs = await import('node:fs');
      const config = createTestConfig();
      await provider.createWorker(config);

      const writeFileCalls = (fs.promises.writeFile as Mock).mock.calls;
      const jsonSchemaCalls = writeFileCalls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && (call[0] as string).includes('json-schema.json')
      );
      expect(jsonSchemaCalls).toHaveLength(0);
    });

    it('mounts persistent Claude session directory', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('claude-session-test-task-123:/home/claude/.claude:rw')
      );
    });

    it('mounts pnpm store volume and node_modules tmpfs', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('pnpm-store:/home/claude/pnpm-store:rw')
      );
      const tmpfs = createCall?.HostConfig?.Tmpfs as Record<string, string>;
      expect(tmpfs['/repo/node_modules']).toContain(`uid=${String(process.getuid?.() ?? 1000)}`);
    });

    it('enables crash forensics settings when forensicsMode is configured', async () => {
      const forensicsProvider = new TestableDockerProvider(
        {
          forensicsMode: true,
          forensicsBasePath: '/tmp/worker-forensics',
        },
        mockLogger,
        mocks.mockDocker
      );

      await forensicsProvider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const binds = createCall?.HostConfig?.Binds as string[];
      const capAdd = createCall?.HostConfig?.CapAdd as string[];
      const securityOpt = createCall?.HostConfig?.SecurityOpt as string[];
      const ulimits = createCall?.HostConfig?.Ulimits as {
        Name: string;
        Soft: number;
        Hard: number;
      }[];

      expect(envArr).toContain('CLAUDE_FORENSICS=1');
      expect(envArr).toContain('CLAUDE_FORENSICS_DIR=/var/crash');
      expect(binds).toContain('/tmp/worker-forensics/test-task-123:/var/crash:rw');
      expect(capAdd).toContain('SYS_PTRACE');
      expect(securityOpt.some((opt: string) => opt.startsWith('seccomp='))).toBe(true);
      expect(securityOpt).not.toContain('seccomp=unconfined');
      expect(ulimits).toContainEqual({ Name: 'core', Soft: -1, Hard: -1 });
    });

    it('sets CLAUDE_WORKER_MODE env var', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('CLAUDE_WORKER_MODE=1');
    });

    it('sets CLAUDE_CONTINUE for resumed attempts', async () => {
      // No orphan container exists — force creation path
      mocks.mockContainer.inspect.mockRejectedValueOnce(new Error('No such container'));
      const config = createTestConfig({ continueSession: true });
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('CLAUDE_CONTINUE=1');
    });

    it('reuses existing container for continued attempts', async () => {
      const initialConfig = createTestConfig({ continueSession: false });
      await provider.createWorker(initialConfig);
      await new Promise((resolve) => setTimeout(resolve, 0));

      await provider.createWorker(
        createTestConfig({
          continueSession: true,
          prompt: 'Second attempt prompt',
          systemPrompt: 'Second attempt system prompt',
        })
      );

      expect(mocks.mockDocker.createContainer).toHaveBeenCalledTimes(1);
      expect(mocks.mockContainer.exec).toHaveBeenCalledTimes(4);
    });

    it('does not set CLAUDE_CODE_EXIT_AFTER_STOP_DELAY env var', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const hasExitDelay = envArr.some((e: string) =>
        e.startsWith('CLAUDE_CODE_EXIT_AFTER_STOP_DELAY')
      );
      expect(hasExitDelay).toBe(false);
    });
  });

  describe('destroyWorker', () => {
    it('stops and removes container', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      await provider.destroyWorker('test-task-123');

      expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('does not remove container when keepContainersAlive is enabled', async () => {
      const keepProvider = new TestableDockerProvider(
        { keepContainersAlive: true },
        mockLogger,
        mocks.mockDocker
      );

      const config = createTestConfig();
      await keepProvider.createWorker(config);
      await keepProvider.destroyWorker('test-task-123');

      expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });

    it('handles already stopped container', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      mocks.mockContainer.stop.mockRejectedValueOnce(new Error('already stopped'));

      await expect(provider.destroyWorker('test-task-123')).resolves.not.toThrow();
    });

    it('logs unexpected stop errors without throwing', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      mocks.mockContainer.stop.mockRejectedValueOnce(new Error('Docker daemon crashed'));

      await expect(provider.destroyWorker('test-task-123')).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Failed to stop/kill container'
      );
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

  describe('waitForCompletion', () => {
    it('returns exit code on completion', async () => {
      await provider.createWorker(createTestConfig());

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

  describe('preserveWorker', () => {
    it('moves worker from active to preserved map', async () => {
      await provider.createWorker(createTestConfig({ taskId: 'task-1' }));

      await provider.preserveWorker('task-1');

      const workers = await provider.listWorkers();
      expect(workers).toHaveLength(0);

      const preserved = await provider.listPreservedWorkers();
      expect(preserved).toHaveLength(1);
      expect(preserved[0]?.taskId).toBe('task-1');
      expect(preserved[0]?.containerId).toBe('test-container-id');
      expect(preserved[0]?.preservedAt).toBeDefined();
    });

    it('frees concurrency slot so new workers can be created', async () => {
      const limitedProvider = new TestableDockerProvider(
        { maxConcurrent: 1 },
        mockLogger,
        mocks.mockDocker
      );

      await limitedProvider.createWorker(createTestConfig({ taskId: 'task-1' }));
      await expect(
        limitedProvider.createWorker(createTestConfig({ taskId: 'task-2' }))
      ).rejects.toThrow('Max concurrent workers (1) reached');

      await limitedProvider.preserveWorker('task-1');

      const handle = await limitedProvider.createWorker(createTestConfig({ taskId: 'task-3' }));
      expect(handle.taskId).toBe('task-3');
    });

    it('clears files inside secrets directory but keeps the directory itself', async () => {
      const fs = await import('node:fs');
      await provider.createWorker(createTestConfig({ taskId: 'task-1' }));

      await provider.preserveWorker('task-1');

      // Reads directory entries, then removes each file individually
      expect(fs.promises.readdir).toHaveBeenCalledWith(expect.stringContaining('task-1'));
      const rmCalls = (fs.promises.rm as ReturnType<typeof vi.fn>).mock.calls;
      // Each file entry is removed, but not the directory itself
      expect(rmCalls.length).toBeGreaterThanOrEqual(3);
      for (const call of rmCalls) {
        expect(call[0]).toContain('task-1');
      }
    });

    it('does not stop or remove the container', async () => {
      await provider.createWorker(createTestConfig({ taskId: 'task-1' }));

      await provider.preserveWorker('task-1');

      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });

    it('returns early for non-existent worker', async () => {
      await provider.preserveWorker('non-existent');

      const preserved = await provider.listPreservedWorkers();
      expect(preserved).toHaveLength(0);
    });

    it('logs secrets cleanup failure without throwing', async () => {
      const fs = await import('node:fs');
      (fs.promises.readdir as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('permission denied')
      );

      await provider.createWorker(createTestConfig({ taskId: 'task-1' }));
      await expect(provider.preserveWorker('task-1')).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1' }),
        'Failed to clear task secrets during preservation'
      );
    });
  });

  describe('resume preserved worker', () => {
    it('restores preserved container on continueSession instead of creating new one', async () => {
      const config = createTestConfig({ taskId: 'preserved-task' });
      await provider.createWorker(config);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Preserve the worker (simulates task completion with preserve)
      await provider.preserveWorker('preserved-task');

      // Verify worker is preserved, not active
      expect(await provider.listWorkers()).toHaveLength(0);
      expect(await provider.listPreservedWorkers()).toHaveLength(1);

      // Resume with continueSession — should reuse preserved container, not create new
      const fs = await import('node:fs');
      (fs.promises.rm as ReturnType<typeof vi.fn>).mockClear();
      mocks.mockDocker.createContainer.mockClear();

      const handle = await provider.createWorker(
        createTestConfig({
          taskId: 'preserved-task',
          continueSession: true,
          prompt: 'Resume prompt',
          systemPrompt: 'Resume system prompt',
        })
      );

      expect(handle.containerId).toBe('test-container-id');
      expect(mocks.mockDocker.createContainer).not.toHaveBeenCalled();

      // Worker should be back in active map, removed from preserved
      expect(await provider.listWorkers()).toHaveLength(1);
      expect(await provider.listPreservedWorkers()).toHaveLength(0);
    });

    it('recreates secrets directory and writes prompt files when restoring preserved worker', async () => {
      const fs = await import('node:fs');
      const config = createTestConfig({ taskId: 'preserved-task-2' });
      await provider.createWorker(config);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await provider.preserveWorker('preserved-task-2');

      (fs.promises.mkdir as ReturnType<typeof vi.fn>).mockClear();
      (fs.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();
      (fs.promises.copyFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          taskId: 'preserved-task-2',
          continueSession: true,
          prompt: 'New prompt',
          systemPrompt: 'New system prompt',
        })
      );

      // Should recreate secrets dir
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('preserved-task-2'),
        expect.objectContaining({ recursive: true })
      );

      // Should write new prompt files
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('system-prompt.txt'),
        'New system prompt',
        'utf-8'
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user-prompt.txt'),
        'New prompt',
        'utf-8'
      );

      // Should copy GCP credentials
      expect(fs.promises.copyFile).toHaveBeenCalled();
    });
  });

  describe('orphaned container recovery after restart', () => {
    it('reuses orphaned running container on continueSession after orchestrator restart', async () => {
      // Simulate: orchestrator restarted, workers/preservedWorkers Maps empty,
      // but Docker container still alive from previous run
      mocks.mockContainer.inspect.mockResolvedValueOnce({
        State: { Running: true },
        Id: 'orphan-container-id',
      });
      mocks.mockDocker.createContainer.mockClear();

      const handle = await provider.createWorker(
        createTestConfig({
          continueSession: true,
          prompt: 'Resume after restart',
          systemPrompt: 'Resume system prompt',
        })
      );

      expect(handle.containerId).toBe('orphan-container-id');
      expect(handle.status).toBe('running');
      expect(mocks.mockDocker.createContainer).not.toHaveBeenCalled();
      expect(await provider.listWorkers()).toHaveLength(1);
    });

    it('writes prompt files and creates secrets dir when reusing orphaned container', async () => {
      const fs = await import('node:fs');
      mocks.mockContainer.inspect.mockResolvedValueOnce({
        State: { Running: true },
        Id: 'orphan-container-id',
      });
      (fs.promises.mkdir as ReturnType<typeof vi.fn>).mockClear();
      (fs.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          continueSession: true,
          prompt: 'Resume prompt',
          systemPrompt: 'Resume system prompt',
        })
      );

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('test-task-123'),
        expect.objectContaining({ recursive: true })
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('system-prompt.txt'),
        'Resume system prompt',
        'utf-8'
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user-prompt.txt'),
        'Resume prompt',
        'utf-8'
      );
    });

    it('removes stopped orphan container before creating fresh one', async () => {
      // First inspect: stopped orphan; subsequent: default (running)
      mocks.mockContainer.inspect.mockResolvedValueOnce({
        State: { Running: false },
        Id: 'stopped-orphan-id',
      });

      const handle = await provider.createWorker(createTestConfig({ continueSession: true }));

      // Should have removed the stopped container
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
      // Should have created a new container (fell through to normal creation)
      expect(mocks.mockDocker.createContainer).toHaveBeenCalled();
      expect(handle.status).toBe('running');
    });

    it('falls through to normal creation when orphan container does not exist', async () => {
      // Docker throws when container doesn't exist
      mocks.mockContainer.inspect.mockRejectedValueOnce(new Error('No such container'));

      const handle = await provider.createWorker(createTestConfig({ continueSession: true }));

      expect(mocks.mockDocker.createContainer).toHaveBeenCalled();
      expect(handle.status).toBe('running');
    });
  });

  describe('listPreservedWorkers', () => {
    it('returns empty array when no workers preserved', async () => {
      const preserved = await provider.listPreservedWorkers();
      expect(preserved).toHaveLength(0);
    });
  });

  describe('startup failure cleanup', () => {
    it('cleans up secrets and session dirs on image pull failure', async () => {
      const fs = await import('node:fs');
      mocks.mockDocker.pull.mockRejectedValueOnce(new Error('registry unavailable'));

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow(
        'Failed to pull worker image'
      );

      const rmCalls = (fs.promises.rm as ReturnType<typeof vi.fn>).mock.calls;
      expect(rmCalls).toHaveLength(2);
      expect(rmCalls[0]?.[0]).toContain('test-task-123');
      expect(rmCalls[0]?.[0]).not.toContain('claude-session');
      expect(rmCalls[1]?.[0]).toContain('claude-session-test-task-123');
    });

    it('cleans up secrets, session dirs, and container on readiness failure', async () => {
      const fs = await import('node:fs');
      const originalExecImpl = mocks.mockContainer.exec.getMockImplementation() as
        | ((...args: unknown[]) => unknown)
        | undefined;
      mocks.mockContainer.exec = vi.fn().mockImplementation((opts: { Cmd?: string[] }) => {
        const cmd = opts?.Cmd?.join?.(' ') ?? '';
        if (cmd.includes('worker-ready')) {
          const readyStream = createMockExecStream();
          return Promise.resolve({
            start: vi.fn().mockImplementation(async () => {
              setTimeout(() => readyStream.emit('end'), 0);
              return readyStream;
            }),
            inspect: vi.fn().mockResolvedValue({ ExitCode: 1 }),
          });
        }
        return originalExecImpl?.(opts);
      });

      provider = new TestableDockerProvider(
        { managedAttemptsMode: true, workerReadyTimeoutMs: 200 },
        mockLogger,
        mocks.mockDocker
      );

      await expect(
        provider.createWorker(createTestConfig({ taskId: 'cleanup-task' }))
      ).rejects.toThrow(/readiness.*timeout/i);

      const rmCalls = (fs.promises.rm as ReturnType<typeof vi.fn>).mock.calls;
      expect(rmCalls).toHaveLength(2);
      expect(rmCalls[0]?.[0]).toContain('cleanup-task');
      expect(rmCalls[0]?.[0]).not.toContain('claude-session');
      expect(rmCalls[1]?.[0]).toContain('claude-session-cleanup-task');
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('cleans up secrets and session dirs on container creation failure', async () => {
      const fs = await import('node:fs');
      mocks.mockDocker.createContainer.mockRejectedValueOnce(new Error('docker daemon error'));

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow(
        'docker daemon error'
      );

      const rmCalls = (fs.promises.rm as ReturnType<typeof vi.fn>).mock.calls;
      expect(rmCalls).toHaveLength(2);
      expect(rmCalls[0]?.[0]).toContain('test-task-123');
      expect(rmCalls[1]?.[0]).toContain('claude-session-test-task-123');
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });
  });

  describe('readiness gate', () => {
    it('checks for readiness marker after container start in managed mode', async () => {
      provider = new TestableDockerProvider(
        { managedAttemptsMode: true },
        mockLogger,
        mocks.mockDocker
      );
      await provider.createWorker(createTestConfig());

      const execCalls = mocks.mockContainer.exec.mock.calls;
      const readinessCall = execCalls.find((call: unknown[]) =>
        JSON.stringify((call[0] as { Cmd?: string[] })?.Cmd).includes('worker-ready')
      );
      expect(readinessCall).toBeDefined();
    });

    it('skips readiness check when managedAttemptsMode is disabled', async () => {
      provider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );
      await provider.createWorker(createTestConfig());

      const execCalls = mocks.mockContainer.exec.mock.calls;
      const readinessCall = execCalls.find((call: unknown[]) =>
        JSON.stringify((call[0] as { Cmd?: string[] })?.Cmd).includes('worker-ready')
      );
      expect(readinessCall).toBeUndefined();
    });

    it('throws readiness timeout when marker never appears', async () => {
      const originalExecImpl = mocks.mockContainer.exec.getMockImplementation() as
        | ((...args: unknown[]) => unknown)
        | undefined;
      mocks.mockContainer.exec = vi.fn().mockImplementation((opts: { Cmd?: string[] }) => {
        const cmd = opts?.Cmd?.join?.(' ') ?? '';
        if (cmd.includes('worker-ready')) {
          const readyStream = createMockExecStream();
          return Promise.resolve({
            start: vi.fn().mockImplementation(async () => {
              setTimeout(() => readyStream.emit('end'), 0);
              return readyStream;
            }),
            inspect: vi.fn().mockResolvedValue({ ExitCode: 1 }),
          });
        }
        return originalExecImpl?.(opts);
      });

      provider = new TestableDockerProvider(
        { managedAttemptsMode: true, workerReadyTimeoutMs: 200 },
        mockLogger,
        mocks.mockDocker
      );

      await expect(
        provider.createWorker(createTestConfig({ taskId: 'timeout-task' }))
      ).rejects.toThrow(/readiness.*timeout/i);
    });
  });

  describe('Shared credentials passthrough', () => {
    let sharedCredsProvider: TestableDockerProvider;

    beforeEach(() => {
      sharedCredsProvider = new TestableDockerProvider(
        { sharedCredsPath: '/shared/claude-creds' },
        mockLogger,
        mocks.mockDocker
      );
    });

    it('does not set ANTHROPIC_API_KEY env var when sharedCredsPath is configured for auto worker', async () => {
      const config = createTestConfig({ workerType: 'auto' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const anthropicKeyEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_API_KEY='));
      expect(anthropicKeyEntry).toBeUndefined();
    });

    it('does not set ANTHROPIC_API_KEY env var when sharedCredsPath is configured for opus worker', async () => {
      const config = createTestConfig({ workerType: 'opus' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const anthropicKeyEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_API_KEY='));
      expect(anthropicKeyEntry).toBeUndefined();
    });

    it('sets ANTHROPIC_API_KEY env var for glm worker even with sharedCredsPath configured', async () => {
      const config = createTestConfig({ workerType: 'glm' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const anthropicKeyEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_API_KEY='));
      expect(anthropicKeyEntry).toBe('ANTHROPIC_API_KEY=test-zai-key');
    });

    it('does not set ANTHROPIC_API_KEY env var when sharedCredsPath is configured for sonnet worker', async () => {
      const config = createTestConfig({ workerType: 'sonnet' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const anthropicKeyEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_API_KEY='));
      expect(anthropicKeyEntry).toBeUndefined();
    });

    it('sets ANTHROPIC_API_KEY env var for minimax worker even with sharedCredsPath configured', async () => {
      const config = createTestConfig({ workerType: 'minimax' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const anthropicKeyEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_API_KEY='));
      expect(anthropicKeyEntry).toBe('ANTHROPIC_API_KEY=test-minimax-key');
    });

    it('sets ANTHROPIC_BASE_URL for minimax worker even with sharedCredsPath configured', async () => {
      const config = createTestConfig({ workerType: 'minimax' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const baseUrlEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_BASE_URL='));
      expect(baseUrlEntry).toBe('ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic');
    });

    it('sets ANTHROPIC_MODEL for sonnet worker', async () => {
      const config = createTestConfig({ workerType: 'sonnet' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const modelEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_MODEL='));
      expect(modelEntry).toBe('ANTHROPIC_MODEL=sonnet');
    });

    it('sets ANTHROPIC_MODEL for minimax worker', async () => {
      const config = createTestConfig({ workerType: 'minimax' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const modelEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_MODEL='));
      expect(modelEntry).toBe('ANTHROPIC_MODEL=MiniMax-M2.5');
    });

    it('uses per-task session path with credential file overlay for sonnet workers', async () => {
      const config = createTestConfig({ workerType: 'sonnet' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('claude-session-test-task-123:/home/claude/.claude:rw')
      );
      expect(binds).toContainEqual(
        '/shared/claude-creds/.credentials.json:/home/claude/.claude/.credentials.json:rw'
      );
      expect(binds).not.toContainEqual('/shared/claude-creds:/home/claude/.claude:rw');
    });

    it('mounts per-task session for minimax workers even with sharedCredsPath', async () => {
      const config = createTestConfig({ workerType: 'minimax' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('claude-session-test-task-123:/home/claude/.claude:rw')
      );
    });

    it('does not set ANTHROPIC_BASE_URL env var when sharedCredsPath is configured for auto worker', async () => {
      const config = createTestConfig({ workerType: 'auto' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const baseUrlEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_BASE_URL='));
      expect(baseUrlEntry).toBeUndefined();
    });

    it('sets ANTHROPIC_BASE_URL env var for glm worker even with sharedCredsPath configured', async () => {
      const config = createTestConfig({ workerType: 'glm' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const baseUrlEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_BASE_URL='));
      expect(baseUrlEntry).toBe('ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic');
    });

    it('sets ANTHROPIC_API_KEY env var when sharedCredsPath is NOT configured', async () => {
      const config = createTestConfig({ workerType: 'auto' });
      await provider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const anthropicKeyEntry = envArr.find((e: string) => e.startsWith('ANTHROPIC_API_KEY='));
      expect(anthropicKeyEntry).toBe('ANTHROPIC_API_KEY=test-anthropic-key');
    });

    it('uses per-task session path with credential file overlay for auto workers', async () => {
      const config = createTestConfig({ workerType: 'auto' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('claude-session-test-task-123:/home/claude/.claude:rw')
      );
      expect(binds).toContainEqual(
        '/shared/claude-creds/.credentials.json:/home/claude/.claude/.credentials.json:rw'
      );
      expect(binds).not.toContainEqual('/shared/claude-creds:/home/claude/.claude:rw');
    });

    it('mounts per-task session for glm workers even with sharedCredsPath', async () => {
      const config = createTestConfig({ workerType: 'glm' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('claude-session-test-task-123:/home/claude/.claude:rw')
      );
    });
  });

  describe('git identity passthrough', () => {
    it('passes GIT_USER_NAME and GIT_USER_EMAIL to container env when configured', async () => {
      const gitProvider = new TestableDockerProvider(
        { gitUserName: 'Test User', gitUserEmail: 'test@example.com' },
        mockLogger,
        mocks.mockDocker
      );
      await gitProvider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('GIT_USER_NAME=Test User');
      expect(envArr).toContainEqual('GIT_USER_EMAIL=test@example.com');
    });

    it('does not set GIT_USER_NAME or GIT_USER_EMAIL when not configured', async () => {
      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const hasGitName = envArr.some((e: string) => e.startsWith('GIT_USER_NAME='));
      const hasGitEmail = envArr.some((e: string) => e.startsWith('GIT_USER_EMAIL='));
      expect(hasGitName).toBe(false);
      expect(hasGitEmail).toBe(false);
    });

    it('passes only GIT_USER_NAME when only name is configured', async () => {
      const gitProvider = new TestableDockerProvider(
        { gitUserName: 'Test User' },
        mockLogger,
        mocks.mockDocker
      );
      await gitProvider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('GIT_USER_NAME=Test User');
      const hasGitEmail = envArr.some((e: string) => e.startsWith('GIT_USER_EMAIL='));
      expect(hasGitEmail).toBe(false);
    });
  });

  describe('getImageInfo', () => {
    it('returns configured image info with null digest before any pull', () => {
      const info = provider.getImageInfo();
      expect(info.configuredRef).toBe(
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest'
      );
      expect(info.lastResolvedDigest).toBeNull();
      expect(info.pullPolicy).toBe('always');
      expect(info.managedAttemptsMode).toBe(true);
    });

    it('stores resolved digest after successful image pull', async () => {
      await provider.createWorker(createTestConfig());

      const info = provider.getImageInfo();
      expect(info.lastResolvedDigest).toBe(
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker@sha256:testdigest'
      );
    });

    it('reflects custom config values', () => {
      const customProvider = new TestableDockerProvider(
        {
          imageName: 'custom-image:v1',
          imagePullPolicy: 'if-not-present',
          managedAttemptsMode: false,
        },
        mockLogger,
        mocks.mockDocker
      );

      const info = customProvider.getImageInfo();
      expect(info.configuredRef).toBe('custom-image:v1');
      expect(info.pullPolicy).toBe('if-not-present');
      expect(info.managedAttemptsMode).toBe(false);
    });
  });

  describe('mutable tag warning', () => {
    it('logs warning when image uses :latest tag', async () => {
      await provider.createWorker(createTestConfig());

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ imageName: expect.stringContaining(':latest') }),
        expect.stringContaining('mutable tag')
      );
    });

    it('does not log warning when image does not use :latest tag', async () => {
      const pinnedProvider = new TestableDockerProvider(
        { imageName: 'registry/image:v1.2.3' },
        mockLogger,
        mocks.mockDocker
      );

      mocks.mockDocker.getImage.mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          RepoDigests: ['registry/image@sha256:abc123'],
        }),
      });

      await pinnedProvider.createWorker(createTestConfig());

      const warnCalls = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const mutableTagWarns = warnCalls.filter(
        (call: unknown[]) =>
          typeof call[1] === 'string' && (call[1] as string).includes('mutable tag')
      );
      expect(mutableTagWarns).toHaveLength(0);
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

  describe('listWorkerContainers', () => {
    it('returns discovered containers with taskId extracted from name', async () => {
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        { Id: 'container-1', Names: ['/claude-worker-task-abc'], State: 'running' },
        { Id: 'container-2', Names: ['/claude-worker-task-def'], State: 'exited' },
      ]);

      const result = await provider.listWorkerContainers();

      expect(result).toEqual([
        { containerId: 'container-1', taskId: 'task-abc', state: 'running' },
        { containerId: 'container-2', taskId: 'task-def', state: 'exited' },
      ]);
      expect(mocks.mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { name: ['claude-worker-'] },
      });
    });

    it('returns empty array when no containers exist', async () => {
      mocks.mockDocker.listContainers.mockResolvedValueOnce([]);

      const result = await provider.listWorkerContainers();

      expect(result).toEqual([]);
    });

    it('returns empty array and logs warning when Docker is unreachable', async () => {
      mocks.mockDocker.listContainers.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const result = await provider.listWorkerContainers();

      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('handles container names with complex taskIds', async () => {
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'container-uuid',
          Names: ['/claude-worker-550e8400-e29b-41d4-a716-446655440000'],
          State: 'running',
        },
      ]);

      const result = await provider.listWorkerContainers();

      expect(result).toEqual([
        {
          containerId: 'container-uuid',
          taskId: '550e8400-e29b-41d4-a716-446655440000',
          state: 'running',
        },
      ]);
    });

    it('skips containers with empty Names array', async () => {
      mocks.mockDocker.listContainers.mockResolvedValue([
        {
          Id: 'container-good',
          Names: ['/claude-worker-task_abc'],
          State: 'running',
          Created: Math.floor(Date.now() / 1000),
        },
        {
          Id: 'container-bad',
          Names: [],
          State: 'running',
          Created: Math.floor(Date.now() / 1000),
        },
      ]);

      const result = await provider.listWorkerContainers();

      expect(result).toHaveLength(1);
      const firstResult = result[0];
      expect(firstResult).toBeDefined();
      expect(firstResult?.taskId).toBe('task_abc');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { containerId: 'container-bad' },
        expect.stringContaining('no recognizable name')
      );
    });
  });
});
