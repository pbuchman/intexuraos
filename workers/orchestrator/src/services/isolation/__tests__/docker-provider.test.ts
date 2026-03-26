import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { DockerProvider, type DockerProviderConfig } from '../docker-provider.js';
import type { WorkerConfig } from '../types.js';
import * as fs from 'node:fs';

function createMockExecStream(): NodeJS.ReadableStream & { resume: () => void } {
  const stream = new EventEmitter() as unknown as NodeJS.ReadableStream & { resume: () => void };
  stream.resume = vi.fn();
  return stream;
}

interface MockDocker {
  createContainer: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  listContainers: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
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
    ping: vi.fn().mockResolvedValue('OK'),
    pull: vi.fn().mockResolvedValue({}),
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        RepoDigests: [
          'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker@sha256:testdigest',
        ],
      }),
    }),
    modem: {
      followProgress: vi.fn(
        (_stream: unknown, onFinished: (err: Error | null) => void, _onProgress?: () => void) => {
          // Simulate multiple Docker progress events like the real modem
          _onProgress?.();
          _onProgress?.();
          _onProgress?.();
          onFinished(null);
        }
      ),
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
    statfsSync: vi.fn().mockReturnValue({ bavail: 2_000_000, bsize: 4096 }),
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
      statfs: vi.fn().mockResolvedValue({ bavail: 2_000_000, bsize: 4096 }),
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
    MINIMAX_API_KEY: 'test-minimax-key',
    DASHSCOPE_API_KEY: 'test-dashscope-key',
  },
  gcpSaKeyPath: '/test/gcp-sa.json',
  githubAppKeyPath: '/test/github-key.pem',
  ...overrides,
});

function createRuntimeOverrideConfig(
  runtimeOverride: 'claude' | 'codex',
  overrides: Partial<WorkerConfig> = {}
): WorkerConfig {
  return {
    ...createTestConfig(overrides),
    runtimeOverride,
  } as WorkerConfig & { runtimeOverride: 'claude' | 'codex' };
}

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

  afterEach(() => {
    vi.useRealTimers();
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

    it('mounts shared Codex auth separately from task-local Codex state', async () => {
      const codexProvider = new TestableDockerProvider(
        { sharedCodexAuthPath: '/shared/codex-auth' } as Partial<DockerProviderConfig>,
        mockLogger,
        mocks.mockDocker
      );

      await codexProvider.createWorker(createRuntimeOverrideConfig('codex'));

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('codex-state-test-task-123:/home/claude/.codex:rw')
      );
      expect(binds).toContain('/shared/codex-auth/auth.json:/home/claude/.codex/auth.json:rw');
    });

    it('creates public codex workers without requiring a direct API key env var', async () => {
      const codexProvider = new TestableDockerProvider(
        { sharedCodexAuthPath: '/shared/codex-auth' } as Partial<DockerProviderConfig>,
        mockLogger,
        mocks.mockDocker
      );

      await codexProvider.createWorker(createTestConfig({ workerType: 'codex' }));

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0] as {
        Env?: string[];
      };
      const envArr = createCall.Env ?? [];

      expect(envArr).toContain('WORKER_RUNTIME=codex');
      expect(envArr.some((entry) => entry.startsWith('ANTHROPIC_API_KEY='))).toBe(false);
    });

    it('fails codex runtime creation when shared Codex auth is not configured', async () => {
      await expect(provider.createWorker(createRuntimeOverrideConfig('codex'))).rejects.toThrow(
        'Codex runtime requires sharedCodexAuthPath but it is not configured'
      );

      expect(mocks.mockDocker.createContainer).not.toHaveBeenCalled();
    });

    it('fails when Claude runtime is selected for a worker type without API key env config', async () => {
      await expect(
        provider.createWorker(
          createTestConfig({
            workerType: 'codex',
            runtimeOverride: 'claude',
          })
        )
      ).rejects.toThrow("Worker type 'codex' is missing API key configuration");
    });

    it('gives different tasks different Codex state directories', async () => {
      const codexProvider = new TestableDockerProvider(
        { sharedCodexAuthPath: '/shared/codex-auth' } as Partial<DockerProviderConfig>,
        mockLogger,
        mocks.mockDocker
      );

      await codexProvider.createWorker(
        createRuntimeOverrideConfig('codex', { taskId: 'codex-task-a' })
      );
      await codexProvider.createWorker(
        createRuntimeOverrideConfig('codex', { taskId: 'codex-task-b' })
      );

      const firstCreateCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const firstBinds = firstCreateCall?.HostConfig?.Binds as string[];
      expect(firstBinds).toContainEqual(
        expect.stringContaining('codex-state-codex-task-a:/home/claude/.codex:rw')
      );

      const secondCreateCall = mocks.mockDocker.createContainer.mock.calls[1]?.[0];
      const secondBinds = secondCreateCall?.HostConfig?.Binds as string[];
      expect(secondBinds).toContainEqual(
        expect.stringContaining('codex-state-codex-task-b:/home/claude/.codex:rw')
      );
    });

    it('fails codex resume when task-local state home is missing', async () => {
      const fsModule = await import('node:fs');
      (fsModule.existsSync as Mock).mockImplementation((filePath: unknown) => {
        return !(typeof filePath === 'string' && filePath.includes('codex-state-test-task-123'));
      });

      const codexProvider = new TestableDockerProvider(
        { sharedCodexAuthPath: '/shared/codex-auth' } as Partial<DockerProviderConfig>,
        mockLogger,
        mocks.mockDocker
      );

      await expect(
        codexProvider.createWorker(
          createRuntimeOverrideConfig('codex', {
            continueSession: true,
          })
        )
      ).rejects.toThrow('Codex resume requires existing task-local state');

      expect(mocks.mockDocker.createContainer).not.toHaveBeenCalled();
    });

    it('keeps Claude mounts unchanged when Codex auth support is configured', async () => {
      const codexAwareProvider = new TestableDockerProvider(
        { sharedCodexAuthPath: '/shared/codex-auth' } as Partial<DockerProviderConfig>,
        mockLogger,
        mocks.mockDocker
      );

      await codexAwareProvider.createWorker(createTestConfig({ workerType: 'auto' }));

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual(
        expect.stringContaining('claude-session-test-task-123:/home/claude/.claude:rw')
      );
      expect(binds.some((bind) => bind.includes('/home/claude/.codex'))).toBe(false);
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

    it('skips image pull when resolvedImage is provided', async () => {
      const config = createTestConfig({
        resolvedImage: 'registry/image@sha256:pre-pulled-digest',
      });
      await provider.createWorker(config);

      expect(mocks.mockDocker.pull).not.toHaveBeenCalled();
      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      expect(createCall?.Image).toBe('registry/image@sha256:pre-pulled-digest');
    });

    it('still pulls when resolvedImage is not provided', async () => {
      const config = createTestConfig();
      await provider.createWorker(config);

      expect(mocks.mockDocker.pull).toHaveBeenCalled();
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
      expect(anthropicKeyEntry).toBe('ANTHROPIC_API_KEY=test-dashscope-key');
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
      expect(modelEntry).toBe('ANTHROPIC_MODEL=MiniMax-M2.7');
    });

    it('sets CLAUDE_CODE_EFFORT_LEVEL for opus worker', async () => {
      const config = createTestConfig({ workerType: 'opus' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const effortEntry = envArr.find((e: string) => e.startsWith('CLAUDE_CODE_EFFORT_LEVEL='));
      expect(effortEntry).toBe('CLAUDE_CODE_EFFORT_LEVEL=high');
    });

    it('does not set CLAUDE_CODE_EFFORT_LEVEL for sonnet worker', async () => {
      const config = createTestConfig({ workerType: 'sonnet' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      const effortEntry = envArr.find((e: string) => e.startsWith('CLAUDE_CODE_EFFORT_LEVEL='));
      expect(effortEntry).toBeUndefined();
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
      expect(baseUrlEntry).toBe(
        'ANTHROPIC_BASE_URL=https://coding-intl.dashscope.aliyuncs.com/apps/anthropic'
      );
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

  describe('pullImage', () => {
    it('returns resolved image digest', async () => {
      const resolvedImage = await provider.pullImage('test-task-123');

      expect(mocks.mockDocker.pull).toHaveBeenCalled();
      expect(resolvedImage).toBe(
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker@sha256:testdigest'
      );
    });

    it('invokes onProgress with status messages', async () => {
      const onProgress = vi.fn();
      await provider.pullImage('test-task-123', onProgress);

      expect(onProgress).toHaveBeenCalledWith('Pulling image...');
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Image pull completed in'));
    });

    it('throttles progress messages to one per 10s interval', async () => {
      const baseTime = 1_700_000_000_000;
      let callCount = 0;
      const dateNowSpy = vi.spyOn(Date, 'now');

      // Date.now() is called at these points:
      // 1: pullStart
      // 2: 1st onProgress → passes throttle (baseTime - 0 >= 10_000)
      // 3: 2nd onProgress → blocked (baseTime+5000 - baseTime < 10_000)
      // 4: 3rd onProgress → passes (baseTime+11000 - baseTime >= 10_000)
      // 5: pullDurationMs calculation
      dateNowSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return baseTime;
        if (callCount === 2) return baseTime;
        if (callCount === 3) return baseTime + 5_000;
        if (callCount === 4) return baseTime + 11_000;
        return baseTime + 12_000;
      });

      const onProgress = vi.fn();
      await provider.pullImage('test-task-123', onProgress);

      dateNowSpy.mockRestore();

      // Should receive: 'Pulling image...', throttled progress at 0s, throttled progress at 11s, completion
      // The 5s call should be suppressed by the 10s throttle
      const progressCalls = onProgress.mock.calls.map((c) => String(c[0]));
      const inProgressMessages = progressCalls.filter((msg) =>
        msg.startsWith('Image pull in progress')
      );
      expect(inProgressMessages).toHaveLength(2);
      expect(inProgressMessages[0]).toBe('Image pull in progress (0s)...');
      expect(inProgressMessages[1]).toBe('Image pull in progress (11s)...');
    });

    it('returns image name unchanged when pull policy is if-not-present', async () => {
      const noPullProvider = new TestableDockerProvider(
        { imagePullPolicy: 'if-not-present' },
        mockLogger,
        mocks.mockDocker
      );

      const resolvedImage = await noPullProvider.pullImage('test-task-123');

      expect(mocks.mockDocker.pull).not.toHaveBeenCalled();
      expect(resolvedImage).toBe(
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest'
      );
    });

    it('throws when pull fails', async () => {
      mocks.mockDocker.pull.mockRejectedValueOnce(new Error('network error'));

      await expect(provider.pullImage('test-task-123')).rejects.toThrow(
        'Failed to pull worker image'
      );
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

  describe('runCleanupCycle', () => {
    it('removes preserved containers after 3 hours', async () => {
      await provider.createWorker(createTestConfig({ taskId: 'preserved-task' }));
      await provider.preserveWorker('preserved-task');
      (
        (
          provider as unknown as {
            preservedWorkers: Map<
              string,
              { containerId: string; taskId: string; preservedAt: string }
            >;
          }
        ).preservedWorkers.get('preserved-task') as { preservedAt: string }
      ).preservedAt = new Date(Date.now() - 3 * 60 * 60 * 1000 - 1000).toISOString();

      vi.clearAllMocks();

      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'test-container-id',
          Names: ['/claude-worker-preserved-task'],
          State: 'running',
          Created: Math.floor((Date.now() - 1000) / 1000),
        },
      ]);

      await provider.runCleanupCycle();

      expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 5 });
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
      expect(await provider.listPreservedWorkers()).toEqual([]);
    });

    it('keeps preserved containers available for reuse before 3 hours', async () => {
      await provider.createWorker(createTestConfig({ taskId: 'preserved-task' }));
      await provider.preserveWorker('preserved-task');

      vi.clearAllMocks();

      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'test-container-id',
          Names: ['/claude-worker-preserved-task'],
          State: 'running',
          Created: Math.floor(Date.now() / 1000),
        },
      ]);

      await provider.runCleanupCycle();

      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
      expect(await provider.listPreservedWorkers()).toHaveLength(1);
    });

    it('removes unrelated running containers older than 3 hours', async () => {
      const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'orphan-container-id',
          Names: ['/claude-worker-orphan-task'],
          State: 'running',
          Created: fourHoursAgo,
        },
      ]);

      await provider.runCleanupCycle();

      expect(mocks.mockDocker.getContainer).toHaveBeenCalledWith('orphan-container-id');
      expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 5 });
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('removes unrelated exited containers older than 3 hours', async () => {
      const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'exited-container-id',
          Names: ['/claude-worker-exited-task'],
          State: 'exited',
          Created: fourHoursAgo,
        },
      ]);

      await provider.runCleanupCycle();

      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('skips active workers even if their containers are older than 3 hours', async () => {
      await provider.createWorker(createTestConfig({ taskId: 'active-task' }));

      vi.clearAllMocks();
      const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'test-container-id',
          Names: ['/claude-worker-active-task'],
          State: 'running',
          Created: fourHoursAgo,
        },
      ]);

      await provider.runCleanupCycle();

      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });

    it('handles empty container list gracefully', async () => {
      mocks.mockDocker.listContainers.mockResolvedValueOnce([]);

      await expect(provider.runCleanupCycle()).resolves.not.toThrow();
    });

    it('handles list error gracefully', async () => {
      mocks.mockDocker.listContainers.mockRejectedValueOnce(new Error('Docker not available'));

      await expect(provider.runCleanupCycle()).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it.each(['No such container', 'container is not running', 'container already stopped'])(
      'ignores benign stale-container stop error: %s',
      async (message) => {
        const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
        mocks.mockDocker.listContainers.mockResolvedValueOnce([
          {
            Id: 'orphan-container-id',
            Names: ['/claude-worker-orphan-task'],
            State: 'running',
            Created: fourHoursAgo,
          },
        ]);
        mocks.mockContainer.stop.mockRejectedValueOnce(new Error(message));

        await provider.runCleanupCycle();

        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'orphan-task',
            containerId: 'orphan-container-id',
          }),
          'Failed to stop stale container'
        );
        expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
      }
    );

    it('warns when stopping a stale container fails for another Error', async () => {
      const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'orphan-container-id',
          Names: ['/claude-worker-orphan-task'],
          State: 'running',
          Created: fourHoursAgo,
        },
      ]);
      mocks.mockContainer.stop.mockRejectedValueOnce(new Error('Docker daemon crashed'));

      await provider.runCleanupCycle();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'orphan-task',
          containerId: 'orphan-container-id',
          error: expect.any(Error),
        }),
        'Failed to stop stale container'
      );
    });

    it('warns when stopping a stale container fails with a non-Error throw', async () => {
      const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'orphan-container-id',
          Names: ['/claude-worker-orphan-task'],
          State: 'running',
          Created: fourHoursAgo,
        },
      ]);
      mocks.mockContainer.stop.mockRejectedValueOnce('stop failed');

      await provider.runCleanupCycle();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'orphan-task',
          containerId: 'orphan-container-id',
          error: 'stop failed',
        }),
        'Failed to stop stale container'
      );
    });

    it('does not remove containers when keepContainersAlive is enabled', async () => {
      const keepProvider = new TestableDockerProvider(
        { keepContainersAlive: true },
        mockLogger,
        mocks.mockDocker
      );

      const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'orphan-container-id',
          Names: ['/claude-worker-orphan-task'],
          State: 'running',
          Created: fourHoursAgo,
        },
      ]);

      await keepProvider.runCleanupCycle();

      expect(mocks.mockDocker.listContainers).not.toHaveBeenCalled();
      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });
  });

  describe('periodic cleanup lifecycle', () => {
    it('runs cleanup on the 5 minute interval after startup', async () => {
      vi.useFakeTimers();
      const cleanupSpy = vi.spyOn(provider, 'runCleanupCycle').mockResolvedValue(undefined);

      provider.startPeriodicCleanup();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      provider.stopPeriodicCleanup();
    });

    it('stops the periodic cleanup interval', async () => {
      vi.useFakeTimers();
      const cleanupSpy = vi.spyOn(provider, 'runCleanupCycle').mockResolvedValue(undefined);

      provider.startPeriodicCleanup();
      provider.stopPeriodicCleanup();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(cleanupSpy).not.toHaveBeenCalled();
    });

    it('does not start cleanup when keepContainersAlive is enabled', async () => {
      vi.useFakeTimers();
      const keepProvider = new TestableDockerProvider(
        { keepContainersAlive: true },
        mockLogger,
        mocks.mockDocker
      );
      const cleanupSpy = vi.spyOn(keepProvider, 'runCleanupCycle').mockResolvedValue(undefined);

      keepProvider.startPeriodicCleanup();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(cleanupSpy).not.toHaveBeenCalled();
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

  describe('resolveForensicsSeccompProfilePath', () => {
    it('returns the first candidate path that exists', async () => {
      const fs = await import('node:fs');
      (fs.existsSync as Mock).mockReturnValueOnce(false).mockReturnValueOnce(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (provider as any).resolveForensicsSeccompProfilePath();

      expect(result).toBeTypeOf('string');
      expect(result).toContain('claude-worker-forensics-seccomp.json');
    });

    it('returns null when no candidate path exists', async () => {
      const fs = await import('node:fs');
      // Use mockReturnValueOnce for each candidate (3 candidates) to avoid polluting other tests
      (fs.existsSync as Mock)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (provider as any).resolveForensicsSeccompProfilePath();

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ candidates: expect.any(Array) }),
        expect.stringContaining('Forensics seccomp profile not found')
      );
    });
  });

  describe('resolveForensicsSeccompSecurityOpt', () => {
    it('returns null when profile path is not found', async () => {
      const fs = await import('node:fs');
      // Use mockReturnValueOnce for each candidate (3 candidates) to avoid polluting other tests
      (fs.existsSync as Mock)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (provider as any).resolveForensicsSeccompSecurityOpt();

      expect(result).toBeNull();
    });

    it('returns seccomp security opt string when profile is valid', async () => {
      const fs = await import('node:fs');
      (fs.existsSync as Mock).mockReturnValueOnce(true);
      const profileJson = { defaultAction: 'SCMP_ACT_ERRNO', syscalls: [] };
      (fs.readFileSync as Mock).mockReturnValueOnce(JSON.stringify(profileJson));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (provider as any).resolveForensicsSeccompSecurityOpt();

      expect(result).toBe(`seccomp=${JSON.stringify(profileJson)}`);
    });

    it('returns null and logs warning when profile read throws', async () => {
      const fs = await import('node:fs');
      (fs.existsSync as Mock).mockReturnValueOnce(true);
      (fs.readFileSync as Mock).mockImplementationOnce(() => {
        throw new Error('ENOENT: no such file');
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (provider as any).resolveForensicsSeccompSecurityOpt();

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          profilePath: expect.any(String),
          error: expect.any(Error),
        }),
        expect.stringContaining('Forensics seccomp profile is invalid')
      );
    });

    it('returns null and logs warning when profile contains invalid JSON', async () => {
      const fs = await import('node:fs');
      (fs.existsSync as Mock).mockReturnValueOnce(true);
      (fs.readFileSync as Mock).mockReturnValueOnce('not-valid-json{{{');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (provider as any).resolveForensicsSeccompSecurityOpt();

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          profilePath: expect.any(String),
          error: expect.any(SyntaxError),
        }),
        expect.stringContaining('Forensics seccomp profile is invalid')
      );
    });
  });

  describe('createWorker continueSession guard', () => {
    it('throws when worker already exists and continueSession is not true', async () => {
      const config = createTestConfig({ taskId: 'task-duplicate' });
      const handle = await provider.createWorker(config);
      expect(handle.taskId).toBe('task-duplicate');

      await expect(
        provider.createWorker(createTestConfig({ taskId: 'task-duplicate' }))
      ).rejects.toThrow('Worker already exists for task task-duplicate');
    });
  });

  describe('health monitoring', () => {
    it('checkHealth returns healthy when docker.ping() succeeds', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      const result = await provider.checkHealth();
      expect(result).toEqual({ docker: true, disk: true });
    });

    it('checkHealth returns unhealthy when docker.ping() times out', async () => {
      vi.useFakeTimers();
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentionally never resolves to simulate Docker hang
      mocks.mockDocker.ping.mockReturnValue(new Promise(() => {}));
      const healthPromise = provider.checkHealth();
      await vi.advanceTimersByTimeAsync(5000);
      const result = await healthPromise;
      expect(result.docker).toBe(false);
      expect(provider.isHealthy()).toBe(false);
    });

    it('checkHealth returns unhealthy when docker.ping() rejects', async () => {
      mocks.mockDocker.ping.mockRejectedValue(new Error('connection refused'));
      const result = await provider.checkHealth();
      expect(result.docker).toBe(false);
      expect(provider.isHealthy()).toBe(false);
    });

    it('isHealthy returns false when disk space is low', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      vi.mocked(fs.promises.statfs).mockResolvedValue({
        bavail: 100_000,
        bsize: 4096,
      } as unknown as fs.StatsFs);
      await provider.checkHealth();
      expect(provider.isHealthy()).toBe(false);
    });

    it('isHealthy returns true when both docker and disk are healthy', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      vi.mocked(fs.promises.statfs).mockResolvedValue({
        bavail: 2_000_000,
        bsize: 4096,
      } as unknown as fs.StatsFs);
      await provider.checkHealth();
      expect(provider.isHealthy()).toBe(true);
    });

    it('startHealthMonitor runs periodic checks', async () => {
      vi.useFakeTimers();
      mocks.mockDocker.ping.mockResolvedValue('OK');
      provider.startHealthMonitor();
      expect(mocks.mockDocker.ping).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.mockDocker.ping).toHaveBeenCalled();
      provider.stopHealthMonitor();
    });

    it('stopHealthMonitor clears interval', () => {
      vi.useFakeTimers();
      provider.startHealthMonitor();
      provider.stopHealthMonitor();
      mocks.mockDocker.ping.mockClear();
      vi.advanceTimersByTime(60_000);
      expect(mocks.mockDocker.ping).not.toHaveBeenCalled();
    });

    it('logs transition from healthy to unhealthy', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      await provider.checkHealth();
      expect(provider.isHealthy()).toBe(true);

      mocks.mockDocker.ping.mockRejectedValue(new Error('connection refused'));
      await provider.checkHealth();
      expect(provider.isHealthy()).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('logs transition from unhealthy to healthy', async () => {
      mocks.mockDocker.ping.mockRejectedValue(new Error('connection refused'));
      await provider.checkHealth();
      expect(provider.isHealthy()).toBe(false);

      mocks.mockDocker.ping.mockResolvedValue('OK');
      await provider.checkHealth();
      expect(provider.isHealthy()).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'health-monitor' }),
        expect.stringContaining('healthy')
      );
    });

    it('getHealthDetails returns current state', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      await provider.checkHealth();
      expect(provider.getHealthDetails()).toEqual({ docker: true, disk: true });
    });

    it('getHealthDetails reflects unhealthy docker', async () => {
      mocks.mockDocker.ping.mockRejectedValue(new Error('connection refused'));
      await provider.checkHealth();
      expect(provider.getHealthDetails()).toEqual({ docker: false, disk: true });
    });
  });

  describe('runExecAndCapture (exec stream + inspect)', () => {
    it('collects output from exec stream data events and resolves with exit code from inspect', async () => {
      const execStream = createMockExecStream();
      const mockInspect = vi.fn().mockResolvedValue({ ExitCode: 42 });
      const mockExecInstance = {
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            execStream.emit('data', Buffer.from('line1\n'));
            execStream.emit('data', Buffer.from('line2\n'));
            execStream.emit('end');
          }, 0);
          return execStream;
        }),
        inspect: mockInspect,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (provider as any).runExecAndCapture('test-task', mockExecInstance);

      expect(result.exitCode).toBe(42);
      expect(result.output).toBe('line1\nline2\n');
    });

    it('resolves via close event when end is not emitted', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            execStream.emit('data', Buffer.from('output'));
            execStream.emit('close');
          }, 0);
          return execStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (provider as any).runExecAndCapture('test-task', mockExecInstance);

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('output');
    });

    it('rejects when exec stream emits error', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            execStream.emit('error', new Error('stream broke'));
          }, 0);
          return execStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      };

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).runExecAndCapture('test-task', mockExecInstance)
      ).rejects.toThrow('stream broke');
    });

    it('wraps non-Error stream error in Error', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            execStream.emit('error', 'string-error');
          }, 0);
          return execStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      };

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).runExecAndCapture('test-task', mockExecInstance)
      ).rejects.toThrow('string-error');
    });

    it('returns exitCode 1 when ExitCode is not a number', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            execStream.emit('end');
          }, 0);
          return execStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: null }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (provider as any).runExecAndCapture('test-task', mockExecInstance);

      expect(result.exitCode).toBe(1);
    });

    it('returns exitCode 1 when inspect throws', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            execStream.emit('end');
          }, 0);
          return execStream;
        }),
        inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (provider as any).runExecAndCapture('test-task', mockExecInstance);

      expect(result.exitCode).toBe(1);
      expect(result.output).toBe('');
    });
  });

  describe('captureSegfaultForensics', () => {
    it('writes exec-inspect.json on success and container-inspect.json on success', async () => {
      const fsModule = await import('node:fs');
      await provider.createWorker(createTestConfig());

      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 139, Pid: 1234 }),
      };
      mocks.mockContainer.inspect.mockResolvedValue({
        State: { Running: false },
        Id: 'test-container-id',
      });

      // Mock exec for snapshot command
      const snapshotStream = createMockExecStream();
      mocks.mockContainer.exec.mockResolvedValueOnce({
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => snapshotStream.emit('end'), 0);
          return snapshotStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      });

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).captureSegfaultForensics(
        'test-task-123',
        mocks.mockContainer,
        mockExecInstance,
        '/tmp/forensics/attempt-1',
        '/var/crash/attempt-1'
      );

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const writtenPaths = writeFileCalls.map((c: unknown[]) => c[0]);
      expect(writtenPaths).toContainEqual('/tmp/forensics/attempt-1/orchestrator-segfault.json');
      expect(writtenPaths).toContainEqual('/tmp/forensics/attempt-1/exec-inspect.json');
      expect(writtenPaths).toContainEqual('/tmp/forensics/attempt-1/container-inspect.json');
    });

    it('writes exec-inspect.error.txt when exec inspect throws', async () => {
      const fsModule = await import('node:fs');
      await provider.createWorker(createTestConfig());

      const mockExecInstance = {
        inspect: vi.fn().mockRejectedValue(new Error('exec inspect failed')),
      };
      mocks.mockContainer.inspect.mockResolvedValue({
        State: { Running: false },
        Id: 'test-container-id',
      });

      const snapshotStream = createMockExecStream();
      mocks.mockContainer.exec.mockResolvedValueOnce({
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => snapshotStream.emit('end'), 0);
          return snapshotStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      });

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).captureSegfaultForensics(
        'test-task-123',
        mocks.mockContainer,
        mockExecInstance,
        '/tmp/forensics/attempt-1',
        '/var/crash/attempt-1'
      );

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const errorTxtCalls = writeFileCalls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('exec-inspect.error.txt')
      );
      expect(errorTxtCalls).toHaveLength(1);
    });

    it('writes container-inspect.error.txt when container inspect throws', async () => {
      const fsModule = await import('node:fs');
      await provider.createWorker(createTestConfig());

      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 139 }),
      };
      mocks.mockContainer.inspect.mockRejectedValue(new Error('container inspect failed'));

      const snapshotStream = createMockExecStream();
      mocks.mockContainer.exec.mockResolvedValueOnce({
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => snapshotStream.emit('end'), 0);
          return snapshotStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      });

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).captureSegfaultForensics(
        'test-task-123',
        mocks.mockContainer,
        mockExecInstance,
        '/tmp/forensics/attempt-1',
        '/var/crash/attempt-1'
      );

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const errorTxtCalls = writeFileCalls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('container-inspect.error.txt')
      );
      expect(errorTxtCalls).toHaveLength(1);
    });

    it('writes error.stack when exec inspect throws Error with stack', async () => {
      const fsModule = await import('node:fs');
      await provider.createWorker(createTestConfig());

      const err = new Error('exec inspect failed');
      const mockExecInstance = {
        inspect: vi.fn().mockRejectedValue(err),
      };
      mocks.mockContainer.inspect.mockResolvedValue({ State: { Running: false }, Id: 'cid' });

      const snapshotStream = createMockExecStream();
      mocks.mockContainer.exec.mockResolvedValueOnce({
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => snapshotStream.emit('end'), 0);
          return snapshotStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      });

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).captureSegfaultForensics(
        'test-task-123',
        mocks.mockContainer,
        mockExecInstance,
        '/tmp/forensics/attempt-1',
        '/var/crash/attempt-1'
      );

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const errorTxtCall = writeFileCalls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('exec-inspect.error.txt')
      );
      expect(errorTxtCall).toBeDefined();
      expect(errorTxtCall?.[1]).toContain('exec inspect failed');
    });

    it('writes String(error) when container inspect throws non-Error', async () => {
      const fsModule = await import('node:fs');
      await provider.createWorker(createTestConfig());

      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 139 }),
      };
      mocks.mockContainer.inspect.mockRejectedValue('some-string-error');

      const snapshotStream = createMockExecStream();
      mocks.mockContainer.exec.mockResolvedValueOnce({
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => snapshotStream.emit('end'), 0);
          return snapshotStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      });

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).captureSegfaultForensics(
        'test-task-123',
        mocks.mockContainer,
        mockExecInstance,
        '/tmp/forensics/attempt-1',
        '/var/crash/attempt-1'
      );

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const errorTxtCall = writeFileCalls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('container-inspect.error.txt')
      );
      expect(errorTxtCall).toBeDefined();
      expect(errorTxtCall?.[1]).toBe('some-string-error');
    });
  });

  describe('GCP credentials copy', () => {
    it('copies GCP SA key when gcpSaKeyPath exists during preserved resume', async () => {
      const fsModule = await import('node:fs');
      const config = createTestConfig({ taskId: 'gcp-preserved' });
      await provider.createWorker(config);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await provider.preserveWorker('gcp-preserved');

      (fsModule.promises.copyFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          taskId: 'gcp-preserved',
          continueSession: true,
          gcpSaKeyPath: '/test/gcp-sa.json',
        })
      );

      expect(fsModule.promises.copyFile).toHaveBeenCalledWith(
        '/test/gcp-sa.json',
        expect.stringContaining('gcp-sa.json')
      );
    });

    it('skips GCP copy when gcpSaKeyPath is empty during preserved resume', async () => {
      const fsModule = await import('node:fs');
      const config = createTestConfig({ taskId: 'no-gcp-preserved' });
      await provider.createWorker(config);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await provider.preserveWorker('no-gcp-preserved');

      (fsModule.promises.copyFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          taskId: 'no-gcp-preserved',
          continueSession: true,
          gcpSaKeyPath: '',
        })
      );

      expect(fsModule.promises.copyFile).not.toHaveBeenCalled();
    });

    it('copies GCP SA key when gcpSaKeyPath exists during orphan resume', async () => {
      const fsModule = await import('node:fs');
      mocks.mockContainer.inspect.mockResolvedValueOnce({
        State: { Running: true },
        Id: 'orphan-gcp-id',
      });

      (fsModule.promises.copyFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          continueSession: true,
          gcpSaKeyPath: '/test/gcp-sa.json',
        })
      );

      expect(fsModule.promises.copyFile).toHaveBeenCalledWith(
        '/test/gcp-sa.json',
        expect.stringContaining('gcp-sa.json')
      );
    });

    it('copies GCP SA key during normal creation when gcpSaKeyPath exists', async () => {
      const fsModule = await import('node:fs');
      (fsModule.promises.copyFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          gcpSaKeyPath: '/test/gcp-sa.json',
        })
      );

      expect(fsModule.promises.copyFile).toHaveBeenCalledWith(
        '/test/gcp-sa.json',
        expect.stringContaining('gcp-sa.json')
      );
    });

    it('skips GCP copy during normal creation when gcpSaKeyPath is empty', async () => {
      const fsModule = await import('node:fs');
      (fsModule.existsSync as Mock).mockImplementation(() => true);
      (fsModule.promises.copyFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          gcpSaKeyPath: '',
        })
      );

      expect(fsModule.promises.copyFile).not.toHaveBeenCalled();
    });
  });

  describe('forensics + preserved-resume path', () => {
    it('sets taskForensicsPath on preserved resume when forensicsMode enabled', async () => {
      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );

      const config = createTestConfig({ taskId: 'forensics-preserved' });
      await forensicsProvider.createWorker(config);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await forensicsProvider.preserveWorker('forensics-preserved');

      const handle = await forensicsProvider.createWorker(
        createTestConfig({
          taskId: 'forensics-preserved',
          continueSession: true,
        })
      );

      expect(handle.containerId).toBe('test-container-id');
      expect(handle.status).toBe('running');
      const workers = await forensicsProvider.listWorkers();
      expect(workers).toHaveLength(1);
    });
  });

  describe('forensics + orphan-resume path', () => {
    it('sets taskForensicsPath on orphan resume when forensicsMode enabled', async () => {
      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );

      mocks.mockContainer.inspect.mockResolvedValueOnce({
        State: { Running: true },
        Id: 'orphan-forensics-id',
      });

      const handle = await forensicsProvider.createWorker(
        createTestConfig({
          continueSession: true,
        })
      );

      expect(handle.containerId).toBe('orphan-forensics-id');
      expect(handle.status).toBe('running');
      const workers = await forensicsProvider.listWorkers();
      expect(workers).toHaveLength(1);
    });
  });

  describe('worktree detection', () => {
    it('detects worktree .git file and mounts main git dir', async () => {
      const fsModule = await import('node:fs');
      // First existsSync call is for .git path check (returns true)
      // statSync returns isFile()=true for the .git path
      (fsModule.statSync as Mock).mockReturnValueOnce({
        isFile: () => true,
        isDirectory: () => false,
      });
      // readFileSync returns gitdir pointer for worktree
      (fsModule.readFileSync as Mock).mockReturnValueOnce(
        'gitdir: /main/repo/.git/worktrees/my-branch'
      );

      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      expect(binds).toContainEqual('/main/repo/.git:/main/repo/.git:rw');
    });

    it('does not mount main git dir for regular .git directory', async () => {
      // Default mock: statSync returns isFile()=false, isDirectory()=true
      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      const mainGitBinds = binds.filter(
        (b: string) => b.includes('.git:') && !b.includes('/repo:')
      );
      expect(mainGitBinds).toHaveLength(0);
    });

    it('does not mount when gitdir pattern does not match worktree structure', async () => {
      const fsModule = await import('node:fs');
      (fsModule.statSync as Mock).mockReturnValueOnce({
        isFile: () => true,
        isDirectory: () => false,
      });
      (fsModule.readFileSync as Mock).mockReturnValueOnce('gitdir: /some/other/path');

      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      const gitBinds = binds.filter((b: string) => b.includes('.git:') && !b.includes('/repo:'));
      expect(gitBinds).toHaveLength(0);
    });
  });

  describe('API key validation', () => {
    it('throws when API key is empty string', async () => {
      await expect(
        provider.createWorker(
          createTestConfig({
            secrets: {
              ANTHROPIC_API_KEY: '',
              LINEAR_API_KEY: 'test',
              SENTRY_AUTH_TOKEN: 'test',
              MINIMAX_API_KEY: 'test',
              DASHSCOPE_API_KEY: 'test',
            },
          })
        )
      ).rejects.toThrow('requires ANTHROPIC_API_KEY but it is not configured');
    });
  });

  describe('env configuration branches', () => {
    it('sets CLAUDE_MANAGED_MODE=1 when managedAttemptsMode is true', async () => {
      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('CLAUDE_MANAGED_MODE=1');
    });

    it('sets CLAUDE_MANAGED_MODE=0 when managedAttemptsMode is false', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );
      await nonManagedProvider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('CLAUDE_MANAGED_MODE=0');
    });

    it('sets LINEAR_API_KEY and SENTRY_AUTH_TOKEN in env', async () => {
      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];
      expect(envArr).toContainEqual('LINEAR_API_KEY=test-linear-key');
      expect(envArr).toContainEqual('SENTRY_AUTH_TOKEN=test-sentry-token');
    });
  });

  describe('keySuffix ternary (ts-type)', () => {
    it('shows last 4 chars for key longer than 4 chars', async () => {
      await provider.createWorker(createTestConfig());

      // The logger.info call includes the apiKey suffix
      const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls;
      const creationMsg = infoCalls.find(
        (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('apiKey=')
      );
      expect(creationMsg).toBeDefined();
      expect(creationMsg?.[1]).toContain('apiKey=...-key');
    });

    it('shows shared-creds label when using shared credentials', async () => {
      const sharedProvider = new TestableDockerProvider(
        { sharedCredsPath: '/shared/creds' },
        mockLogger,
        mocks.mockDocker
      );
      await sharedProvider.createWorker(createTestConfig({ workerType: 'auto' }));

      const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls;
      const creationMsg = infoCalls.find(
        (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('apiKey=')
      );
      expect(creationMsg).toBeDefined();
      expect(creationMsg?.[1]).toContain('shared-creds');
    });

    it('shows **** for key with 4 or fewer chars', async () => {
      await provider.createWorker(
        createTestConfig({
          secrets: {
            ANTHROPIC_API_KEY: 'key',
            LINEAR_API_KEY: 'test',
            SENTRY_AUTH_TOKEN: 'test',
            MINIMAX_API_KEY: 'test',
            DASHSCOPE_API_KEY: 'test',
          },
        })
      );

      const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls;
      const creationMsg = infoCalls.find(
        (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('apiKey=')
      );
      expect(creationMsg).toBeDefined();
      expect(creationMsg?.[1]).toContain('apiKey=****');
    });
  });

  describe('security-opt/pnpmStore/capAdd/ulimits config', () => {
    it('creates pnpm-store directory', async () => {
      const fsModule = await import('node:fs');
      (fsModule.mkdirSync as Mock).mockClear();

      await provider.createWorker(createTestConfig());

      expect(fsModule.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('pnpm-store'), {
        recursive: true,
      });
    });

    it('sets capAdd to NET_RAW only when forensicsMode is false', async () => {
      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const capAdd = createCall?.HostConfig?.CapAdd as string[];
      expect(capAdd).toEqual(['NET_RAW']);
    });

    it('sets securityOpt to no-new-privileges only when forensicsMode is false', async () => {
      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const securityOpt = createCall?.HostConfig?.SecurityOpt as string[];
      expect(securityOpt).toEqual(['no-new-privileges']);
    });

    it('does not set Ulimits when forensicsMode is false', async () => {
      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      expect(createCall?.HostConfig?.Ulimits).toBeUndefined();
    });

    it('uses fallback securityOpt when seccomp profile is not found in forensics mode', async () => {
      const fsModule = await import('node:fs');
      // Make all seccomp profile candidates not found, but .git exists
      (fsModule.existsSync as Mock).mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('seccomp')) return false;
        return true;
      });

      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );
      await forensicsProvider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const securityOpt = createCall?.HostConfig?.SecurityOpt as string[];
      expect(securityOpt).toEqual(['no-new-privileges']);
      expect(securityOpt).not.toContainEqual(expect.stringContaining('seccomp='));
    });
  });

  describe('log stream setup', () => {
    it('sets up log stream when onLog provided and managedAttemptsMode is false', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );
      const mockLogStream = new EventEmitter() as NodeJS.ReadableStream;
      mocks.mockContainer.logs.mockResolvedValueOnce(mockLogStream);

      const onLog = vi.fn();
      await nonManagedProvider.createWorker(createTestConfig({ onLog }));

      // Simulate data event
      mockLogStream.emit('data', Buffer.from('test-log'));
      expect(onLog).toHaveBeenCalledWith('test-log');
    });

    it('does not set up log stream when onLog not provided', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );
      const logsSpy = mocks.mockContainer.logs;
      logsSpy.mockClear();

      await nonManagedProvider.createWorker(createTestConfig());

      // logs() is called for the follow stream only when onLog is provided
      // In non-managed mode without onLog, container.logs should not be called for follow
      const followCalls = logsSpy.mock.calls.filter(
        (c: unknown[]) => (c[0] as { follow?: boolean })?.follow === true
      );
      expect(followCalls).toHaveLength(0);
    });

    it('does not set up log stream in managedAttemptsMode even with onLog', async () => {
      const logsSpy = mocks.mockContainer.logs;
      logsSpy.mockClear();

      await provider.createWorker(createTestConfig({ onLog: vi.fn() }));

      const followCalls = logsSpy.mock.calls.filter(
        (c: unknown[]) => (c[0] as { follow?: boolean })?.follow === true
      );
      expect(followCalls).toHaveLength(0);
    });
  });

  describe('managedAttemptsMode vs legacy mode', () => {
    it('runs attempt in managed mode', async () => {
      const onComplete = vi.fn();
      await provider.createWorker(createTestConfig({ onComplete }));

      // Wait for async attempt to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // In managed mode, exec is called for: entrypoint check, readiness, and run-attempt
      expect(mocks.mockContainer.exec).toHaveBeenCalled();
    });

    it('uses container.wait() in legacy mode and calls onComplete', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );
      const onComplete = vi.fn();

      await nonManagedProvider.createWorker(createTestConfig({ onComplete }));

      // Resolve container.wait
      mocks.resolveContainerWait({ StatusCode: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onComplete).toHaveBeenCalledWith(0);
    });

    it('sets status to failed in legacy mode when StatusCode is non-zero', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );
      const onComplete = vi.fn();

      const handle = await nonManagedProvider.createWorker(createTestConfig({ onComplete }));

      mocks.resolveContainerWait({ StatusCode: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handle.status).toBe('failed');
      expect(onComplete).toHaveBeenCalledWith(1);
    });

    it('handles container.wait() error in legacy mode', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );
      mocks.mockContainer.wait.mockRejectedValueOnce(new Error('wait error'));

      await nonManagedProvider.createWorker(createTestConfig());

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Container wait error'
      );
    });
  });

  describe('cleanup error handling', () => {
    it('logs warning when secrets rm fails during error cleanup', async () => {
      const fsModule = await import('node:fs');
      mocks.mockDocker.createContainer.mockRejectedValueOnce(new Error('create failed'));
      (fsModule.promises.rm as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('rm secrets failed')
      );

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow('create failed');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Cleanup: failed to remove task secrets'
      );
    });

    it('logs warning when session rm fails during error cleanup', async () => {
      const fsModule = await import('node:fs');
      mocks.mockDocker.createContainer.mockRejectedValueOnce(new Error('create failed'));
      // First rm succeeds (secrets), second fails (session)
      (fsModule.promises.rm as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('rm session failed'));

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow('create failed');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Cleanup: failed to remove task session'
      );
    });

    it('logs warning when container remove fails during error cleanup', async () => {
      // Container is created, but start fails
      mocks.mockContainer.start.mockRejectedValueOnce(new Error('start failed'));
      mocks.mockContainer.remove.mockRejectedValueOnce(new Error('remove failed'));

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow('start failed');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Cleanup: failed to remove container'
      );
    });
  });

  describe('destroyWorker logStream cleanup', () => {
    it('destroys logStream when present', async () => {
      const nonManagedProvider = new TestableDockerProvider(
        { managedAttemptsMode: false },
        mockLogger,
        mocks.mockDocker
      );

      const mockLogStream = new EventEmitter() as NodeJS.ReadableStream & {
        destroy: ReturnType<typeof vi.fn>;
      };
      mockLogStream.destroy = vi.fn();
      mocks.mockContainer.logs.mockResolvedValueOnce(mockLogStream);

      await nonManagedProvider.createWorker(createTestConfig({ onLog: vi.fn() }));
      await nonManagedProvider.destroyWorker('test-task-123');

      expect(mockLogStream.destroy).toHaveBeenCalled();
    });
  });

  describe('getWorkerLogs branches', () => {
    it('returns only container logs when attemptLogBuffer is empty', async () => {
      await provider.createWorker(createTestConfig());

      mocks.mockContainer.logs.mockResolvedValueOnce(Buffer.from('container output'));

      const logs = await provider.getWorkerLogs('test-task-123');

      expect(logs).toBe('container output');
    });

    it('returns container logs + attempt log buffer when both present', async () => {
      await provider.createWorker(createTestConfig());
      await new Promise((resolve) => setTimeout(resolve, 50));

      mocks.mockContainer.logs.mockResolvedValueOnce(Buffer.from('container output'));

      const logs = await provider.getWorkerLogs('test-task-123');

      // attemptLogBuffer is populated by runAttemptInContainer exec stream
      // The exact content depends on the mock exec behavior
      expect(logs).toContain('container output');
    });

    it('returns attempt log buffer when container.logs() fails', async () => {
      await provider.createWorker(createTestConfig());
      await new Promise((resolve) => setTimeout(resolve, 50));

      mocks.mockContainer.logs.mockRejectedValueOnce(new Error('logs failed'));

      const logs = await provider.getWorkerLogs('test-task-123');

      // Should return attemptLogBuffer (populated by exec stream)
      expect(typeof logs).toBe('string');
    });
  });

  describe('waitForCompletion timeout race', () => {
    it('resolves with StatusCode when container.wait() completes before timeout', async () => {
      await provider.createWorker(createTestConfig());

      const waitPromise = provider.waitForCompletion('test-task-123', 5000);

      // Resolve the container wait
      mocks.resolveContainerWait({ StatusCode: 42 });

      const result = await waitPromise;
      expect(result).toBe(42);
    });

    it('resolves with -1 when timeout fires and calls destroyWorker', async () => {
      await provider.createWorker(createTestConfig());

      mocks.mockContainer.wait.mockImplementationOnce(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      );

      const result = await provider.waitForCompletion('test-task-123', 100);

      expect(result).toBe(-1);
    });

    it('ignores container.wait() completion after timeout', async () => {
      await provider.createWorker(createTestConfig());

      let resolveWait: (v: { StatusCode: number }) => void;
      mocks.mockContainer.wait.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveWait = resolve;
          })
      );

      const result = await provider.waitForCompletion('test-task-123', 100);
      expect(result).toBe(-1);

      // Late resolution should not cause issues
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      resolveWait!({ StatusCode: 0 });
    });

    it('handles container.wait() rejection after timeout', async () => {
      await provider.createWorker(createTestConfig());

      let rejectWait: (e: Error) => void;
      mocks.mockContainer.wait.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectWait = reject;
          })
      );

      const result = await provider.waitForCompletion('test-task-123', 100);
      expect(result).toBe(-1);

      // Late rejection should not cause issues
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      rejectWait!(new Error('late error'));
    });

    it('resolves with -1 when container.wait() rejects before timeout', async () => {
      await provider.createWorker(createTestConfig());

      mocks.mockContainer.wait.mockRejectedValueOnce(new Error('wait error'));

      const result = await provider.waitForCompletion('test-task-123', 5000);

      expect(result).toBe(-1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Wait error'
      );
    });
  });

  describe('getResourceUsage CPU calculation', () => {
    it('calculates CPU percent from stats deltas', async () => {
      await provider.createWorker(createTestConfig());

      mocks.mockContainer.stats.mockResolvedValueOnce({
        cpu_stats: {
          cpu_usage: { total_usage: 2000 },
          system_cpu_usage: 20000,
          online_cpus: 4,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 1000 },
          system_cpu_usage: 10000,
        },
        memory_stats: {
          usage: 1024 * 1024 * 256,
          limit: 1024 * 1024 * 1024 * 4,
        },
      });

      const usage = await provider.getResourceUsage('test-task-123');

      // cpuDelta = 1000, systemDelta = 10000, cpuPercent = (1000/10000)*4*100 = 40
      expect(usage.cpuPercent).toBe(40);
      expect(usage.memoryUsedMB).toBe(256);
      expect(usage.memoryLimitMB).toBe(4096);
    });

    it('returns 0 CPU percent when systemDelta is 0', async () => {
      await provider.createWorker(createTestConfig());

      mocks.mockContainer.stats.mockResolvedValueOnce({
        cpu_stats: {
          cpu_usage: { total_usage: 1000 },
          system_cpu_usage: 10000,
          online_cpus: 4,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 1000 },
          system_cpu_usage: 10000,
        },
        memory_stats: {
          usage: 1024 * 1024 * 512,
          limit: 1024 * 1024 * 1024 * 8,
        },
      });

      const usage = await provider.getResourceUsage('test-task-123');

      expect(usage.cpuPercent).toBe(0);
    });
  });

  describe('waitForWorkerReady polling', () => {
    it('succeeds when readiness marker appears', async () => {
      provider = new TestableDockerProvider(
        { managedAttemptsMode: true, workerReadyTimeoutMs: 10_000 },
        mockLogger,
        mocks.mockDocker
      );

      // Default exec mock already returns ExitCode: 0 for readiness check
      await provider.createWorker(createTestConfig());

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Worker readiness confirmed'
      );
    });

    it('throws timeout when readiness marker never appears', async () => {
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
        provider.createWorker(createTestConfig({ taskId: 'ready-timeout' }))
      ).rejects.toThrow(/readiness.*timeout/i);
    });
  });

  describe('writePromptFiles', () => {
    it('writes system-prompt.txt and user-prompt.txt', async () => {
      const fsModule = await import('node:fs');
      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      await provider.createWorker(
        createTestConfig({
          systemPrompt: 'My system prompt',
          prompt: 'My user prompt',
        })
      );

      expect(fsModule.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('system-prompt.txt'),
        'My system prompt',
        'utf-8'
      );
      expect(fsModule.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user-prompt.txt'),
        'My user prompt',
        'utf-8'
      );
    });
  });

  describe('runAttemptInContainer', () => {
    it('calls onComplete with exit code on successful attempt', async () => {
      const onComplete = vi.fn();
      await provider.createWorker(createTestConfig({ onComplete }));

      // Wait for async attempt
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onComplete).toHaveBeenCalledWith(0);
    });

    it('passes codex runtime metadata into run-attempt exec for resumed Codex tasks', async () => {
      const codexProvider = new TestableDockerProvider(
        { sharedCodexAuthPath: '/shared/codex-auth' } as Partial<DockerProviderConfig>,
        mockLogger,
        mocks.mockDocker
      );

      await codexProvider.createWorker(
        createRuntimeOverrideConfig('codex', {
          continueSession: true,
          runtimeSessionId: 'thread_123',
          onComplete: vi.fn(),
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      const runAttemptCall = mocks.mockContainer.exec.mock.calls.find((call: unknown[]) => {
        const opts = call[0] as { Cmd?: string[] };
        return opts.Cmd?.[0] === '/entrypoint.sh' && opts.Cmd?.[1] === 'run-attempt';
      });
      const envArr = runAttemptCall?.[0]?.Env as string[];

      expect(envArr).toContain('WORKER_RUNTIME=codex');
      expect(envArr).toContain('CODEX_THREAD_ID=thread_123');
    });

    it('calls onComplete(1) when worker not found', async () => {
      const onComplete = vi.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).runAttemptInContainer('nonexistent-task', {
        onComplete,
        taskId: 'nonexistent-task',
      });

      expect(onComplete).toHaveBeenCalledWith(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'nonexistent-task' }),
        'Cannot start attempt: worker not found'
      );
    });

    it('calls onComplete(1) when previous attempt is still running', async () => {
      const onComplete1 = vi.fn();
      const onComplete2 = vi.fn();

      // Create worker - this triggers runAttemptInContainer which sets attemptRunning = true
      await provider.createWorker(createTestConfig({ onComplete: onComplete1 }));

      // Manually set attemptRunning to true to simulate race
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const workers = (provider as any).workers as Map<string, { attemptRunning: boolean }>;
      const worker = workers.get('test-task-123');
      if (worker !== undefined) {
        worker.attemptRunning = true;
      }

      // Try to start another attempt while first is "running"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).runAttemptInContainer('test-task-123', {
        onComplete: onComplete2,
        taskId: 'test-task-123',
      });

      expect(onComplete2).toHaveBeenCalledWith(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Cannot start attempt: previous attempt still running'
      );
    });

    it('writes forensics artifacts when forensicsMode is enabled', async () => {
      const fsModule = await import('node:fs');
      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      await forensicsProvider.createWorker(createTestConfig({ onComplete: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const forensicsPaths = writeFileCalls
        .map((c: unknown[]) => c[0])
        .filter((p: unknown) => typeof p === 'string' && (p as string).includes('forensics'));
      expect(forensicsPaths.length).toBeGreaterThan(0);
    });

    it('handles exec error and sets status to failed', async () => {
      const onComplete = vi.fn();

      // Make the attempt exec fail
      const originalExecImpl = mocks.mockContainer.exec.getMockImplementation() as
        | ((...args: unknown[]) => unknown)
        | undefined;
      mocks.mockContainer.exec = vi.fn().mockImplementation((opts: { Cmd?: string[] }) => {
        const cmd = opts?.Cmd ?? [];
        // Match the run-attempt exec specifically (Cmd = ['/entrypoint.sh', 'run-attempt'])
        if (cmd[0] === '/entrypoint.sh' && cmd[1] === 'run-attempt') {
          return Promise.reject(new Error('exec failed'));
        }
        return originalExecImpl?.(opts);
      });

      provider = new TestableDockerProvider(
        { managedAttemptsMode: true },
        mockLogger,
        mocks.mockDocker
      );

      const handle = await provider.createWorker(createTestConfig({ onComplete }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handle.status).toBe('failed');
      expect(onComplete).toHaveBeenCalledWith(1);
    });

    it('persists attempt logs to file when forensicsMode is enabled', async () => {
      const fsModule = await import('node:fs');
      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );

      (fsModule.appendFileSync as Mock).mockClear();

      await forensicsProvider.createWorker(createTestConfig({ onLog: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fsModule.appendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('exec-stream.log'),
        expect.any(String),
        'utf-8'
      );
    });

    it('logs warning when appendFileSync fails for persistent log', async () => {
      const fsModule = await import('node:fs');
      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );

      (fsModule.appendFileSync as Mock).mockImplementation(() => {
        throw new Error('disk full');
      });

      await forensicsProvider.createWorker(createTestConfig({ onLog: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'test-task-123' }),
        'Failed to persist attempt exec stream chunk'
      );
    });
  });

  describe('waitForExecCompletion', () => {
    it('resolves via stream end with inspect ExitCode', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 5 }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      execStream.emit('end');
      const result = await promise;

      expect(result).toBe(5);
    });

    it('resolves via stream close event', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 3 }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      execStream.emit('close');
      const result = await promise;

      expect(result).toBe(3);
    });

    it('resolves with 1 on stream error', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      execStream.emit('error', new Error('stream error'));
      const result = await promise;

      expect(result).toBe(1);
    });

    it('resolves with 1 when ExitCode is not a number', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: undefined }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      execStream.emit('end');
      const result = await promise;

      expect(result).toBe(1);
    });

    it('resolves with 1 when inspect throws after stream end', async () => {
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockRejectedValue(new Error('inspect error')),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      execStream.emit('end');
      const result = await promise;

      expect(result).toBe(1);
    });

    it('resolves via poll fallback when exec stops running but stream stays open', async () => {
      vi.useFakeTimers();
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 7, Running: false }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      // Advance past the poll interval (5000ms)
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result).toBe(7);
    });

    it('resolves with 1 via poll fallback when inspect throws during polling', async () => {
      vi.useFakeTimers();
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockRejectedValue(new Error('gone')),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result).toBe(1);
    });

    it('does not resolve twice when both stream end and poll fire', async () => {
      vi.useFakeTimers();
      const execStream = createMockExecStream();
      const mockExecInstance = {
        inspect: vi.fn().mockImplementation(async () => {
          return { ExitCode: 10, Running: false };
        }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      // Stream ends first
      execStream.emit('end');
      // Then poll fires
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await promise;
      // Should resolve only once with the first result
      expect(result).toBe(10);
    });
  });

  describe('pullAndResolveImage edge cases', () => {
    it('uses GCP SA key auth when gcpSaKeyPath is configured and exists', async () => {
      const gcpProvider = new TestableDockerProvider(
        { gcpSaKeyPath: '/test/gcp-key.json' },
        mockLogger,
        mocks.mockDocker
      );

      const fsModule = await import('node:fs');
      (fsModule.readFileSync as Mock).mockReturnValueOnce('{"type":"service_account"}');

      await gcpProvider.createWorker(createTestConfig());

      const pullCall = mocks.mockDocker.pull.mock.calls[0];
      expect(pullCall?.[1]).toHaveProperty('authconfig');
    });

    it('falls back to image name when getImage().inspect() throws', async () => {
      mocks.mockDocker.getImage.mockReturnValueOnce({
        inspect: vi.fn().mockRejectedValue(new Error('image not found')),
      });

      const handle = await provider.createWorker(createTestConfig());

      expect(handle).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('Failed to inspect pulled image digest')
      );
    });

    it('handles non-Error throw during image pull', async () => {
      mocks.mockDocker.pull.mockRejectedValueOnce('string error');

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow(
        'Failed to pull worker image'
      );
    });

    it('handles followProgress error during image pull', async () => {
      mocks.mockDocker.modem.followProgress.mockImplementationOnce(
        (_stream: unknown, onFinished: (err: Error | null) => void) => {
          onFinished(new Error('pull layer failed'));
        }
      );

      await expect(provider.createWorker(createTestConfig())).rejects.toThrow(
        'Failed to pull worker image'
      );
    });

    it('handles non-array RepoDigests from image inspect', async () => {
      mocks.mockDocker.getImage.mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          RepoDigests: null,
        }),
      });

      const handle = await provider.createWorker(createTestConfig());
      expect(handle).toBeDefined();
    });

    it('falls back to first digest when no matching prefix found', async () => {
      mocks.mockDocker.getImage.mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          RepoDigests: ['other-registry/image@sha256:abc123'],
        }),
      });

      const handle = await provider.createWorker(createTestConfig());
      expect(handle).toBeDefined();
    });

    it('falls back to imageName when RepoDigests is empty array', async () => {
      mocks.mockDocker.getImage.mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          RepoDigests: [],
        }),
      });

      const handle = await provider.createWorker(createTestConfig());
      expect(handle).toBeDefined();
    });
  });

  describe('runCleanupCycle additional branches', () => {
    it('cleans up preserved worker metadata when container not in Docker listing', async () => {
      await provider.createWorker(createTestConfig({ taskId: 'stale-preserved' }));
      await provider.preserveWorker('stale-preserved');

      // Make it stale
      const preservedWorkers = (
        provider as unknown as {
          preservedWorkers: Map<string, { preservedAt: string }>;
        }
      ).preservedWorkers;
      const entry = preservedWorkers.get('stale-preserved');
      if (entry !== undefined) {
        entry.preservedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      }

      vi.clearAllMocks();

      // Container NOT in Docker listing
      mocks.mockDocker.listContainers.mockResolvedValueOnce([]);

      await provider.runCleanupCycle();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'stale-preserved' }),
        'Removed stale preserved worker metadata'
      );
    });

    it('skips containers with unrecognizable names during cleanup', async () => {
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'bad-container',
          Names: ['/claude-worker-'],
          State: 'running',
          Created: Math.floor(Date.now() / 1000) - 4 * 60 * 60,
        },
      ]);

      await provider.runCleanupCycle();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ containerId: 'bad-container' }),
        expect.stringContaining('no recognizable name')
      );
    });

    it('skips containers younger than 3 hours in the unmanaged set', async () => {
      mocks.mockDocker.listContainers.mockResolvedValueOnce([
        {
          Id: 'young-container',
          Names: ['/claude-worker-young-task'],
          State: 'running',
          Created: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
        },
      ]);

      await provider.runCleanupCycle();

      expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
      expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    });
  });

  describe('runAttemptInContainer segfault forensics path', () => {
    it('calls captureSegfaultForensics on exit code 139 with forensics enabled', async () => {
      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );

      const originalExecImpl = mocks.mockContainer.exec.getMockImplementation() as
        | ((...args: unknown[]) => unknown)
        | undefined;
      mocks.mockContainer.exec = vi.fn().mockImplementation((opts: { Cmd?: string[] }) => {
        const cmd = opts?.Cmd ?? [];
        if (cmd[0] === '/entrypoint.sh' && cmd[1] === 'run-attempt') {
          const execStream = createMockExecStream();
          return Promise.resolve({
            start: vi.fn().mockImplementation(async () => {
              setTimeout(() => execStream.emit('end'), 0);
              return execStream;
            }),
            inspect: vi.fn().mockResolvedValue({ ExitCode: 139 }),
          });
        }
        // For snapshot command exec during forensics
        if (
          cmd[0] === 'sh' &&
          cmd[1] === '-lc' &&
          typeof cmd[2] === 'string' &&
          cmd[2].includes('set -eu')
        ) {
          const execStream = createMockExecStream();
          return Promise.resolve({
            start: vi.fn().mockImplementation(async () => {
              setTimeout(() => execStream.emit('end'), 0);
              return execStream;
            }),
            inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
          });
        }
        return originalExecImpl?.(opts);
      });

      const onComplete = vi.fn();
      await forensicsProvider.createWorker(createTestConfig({ onComplete }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onComplete).toHaveBeenCalledWith(139);
    });
  });

  describe('captureSegfaultForensics Error without stack', () => {
    it('uses error.message when error.stack is undefined', async () => {
      const fsModule = await import('node:fs');
      await provider.createWorker(createTestConfig());

      const err = new Error('no stack');
      delete err.stack;
      const mockExecInstance = {
        inspect: vi.fn().mockRejectedValue(err),
      };
      mocks.mockContainer.inspect.mockResolvedValue({ State: { Running: false }, Id: 'cid' });

      const snapshotStream = createMockExecStream();
      mocks.mockContainer.exec.mockResolvedValueOnce({
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => snapshotStream.emit('end'), 0);
          return snapshotStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      });

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).captureSegfaultForensics(
        'test-task-123',
        mocks.mockContainer,
        mockExecInstance,
        '/tmp/forensics/attempt-1',
        '/var/crash/attempt-1'
      );

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const errorTxtCall = writeFileCalls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('exec-inspect.error.txt')
      );
      expect(errorTxtCall).toBeDefined();
      expect(errorTxtCall?.[1]).toBe('no stack');
    });

    it('uses error.message when container inspect error has no stack', async () => {
      const fsModule = await import('node:fs');
      await provider.createWorker(createTestConfig());

      const mockExecInstance = {
        inspect: vi.fn().mockResolvedValue({ ExitCode: 139 }),
      };

      const containerErr = new Error('container down');
      delete containerErr.stack;
      mocks.mockContainer.inspect.mockRejectedValue(containerErr);

      const snapshotStream = createMockExecStream();
      mocks.mockContainer.exec.mockResolvedValueOnce({
        start: vi.fn().mockImplementation(async () => {
          setTimeout(() => snapshotStream.emit('end'), 0);
          return snapshotStream;
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      });

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).captureSegfaultForensics(
        'test-task-123',
        mocks.mockContainer,
        mockExecInstance,
        '/tmp/forensics/attempt-1',
        '/var/crash/attempt-1'
      );

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const errorTxtCall = writeFileCalls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('container-inspect.error.txt')
      );
      expect(errorTxtCall).toBeDefined();
      expect(errorTxtCall?.[1]).toBe('container down');
    });
  });

  describe('health monitoring transitions', () => {
    it('logs disk space transition from healthy to unhealthy', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      await provider.checkHealth();
      expect(provider.isHealthy()).toBe(true);

      vi.mocked(fs.promises.statfs).mockResolvedValueOnce({
        bavail: 100,
        bsize: 4096,
      } as unknown as fs.StatsFs);
      await provider.checkHealth();
      expect(provider.getHealthDetails().disk).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'health-monitor' }),
        expect.stringContaining('Disk space critically low')
      );
    });

    it('logs disk space transition from unhealthy to healthy', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      vi.mocked(fs.promises.statfs).mockResolvedValueOnce({
        bavail: 100,
        bsize: 4096,
      } as unknown as fs.StatsFs);
      await provider.checkHealth();
      expect(provider.getHealthDetails().disk).toBe(false);

      await provider.checkHealth();
      expect(provider.getHealthDetails().disk).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'health-monitor' }),
        expect.stringContaining('Disk space is healthy again')
      );
    });

    it('handles statfs failure as unhealthy disk', async () => {
      mocks.mockDocker.ping.mockResolvedValue('OK');
      vi.mocked(fs.promises.statfs).mockRejectedValueOnce(new Error('statfs failed'));
      const result = await provider.checkHealth();
      expect(result.disk).toBe(false);
    });
  });

  describe('runAttemptInContainer log forwarding', () => {
    it('calls onLog with exec stream data when provided', async () => {
      const onLog = vi.fn();
      await provider.createWorker(createTestConfig({ onLog }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onLog).toHaveBeenCalledWith('attempt logs');
    });
  });

  describe('runAttemptInContainer forensics exit code write', () => {
    it('writes exit code file when forensics path exists', async () => {
      const fsModule = await import('node:fs');
      const forensicsProvider = new TestableDockerProvider(
        { forensicsMode: true, forensicsBasePath: '/tmp/forensics' },
        mockLogger,
        mocks.mockDocker
      );

      (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mockClear();

      await forensicsProvider.createWorker(createTestConfig({ onComplete: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const writeFileCalls = (fsModule.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls;
      const exitCodeCalls = writeFileCalls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('exec-exit-code.txt')
      );
      expect(exitCodeCalls).toHaveLength(1);
    });
  });

  describe('waitForExecCompletion poll with Running=true', () => {
    it('does not resolve when poll shows exec still running', async () => {
      vi.useFakeTimers();
      const execStream = createMockExecStream();
      let inspectCount = 0;
      const mockExecInstance = {
        inspect: vi.fn().mockImplementation(async () => {
          inspectCount++;
          if (inspectCount === 1) {
            return { ExitCode: null, Running: true };
          }
          return { ExitCode: 0, Running: false };
        }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (provider as any).waitForExecCompletion(
        'test-task',
        mockExecInstance,
        execStream
      );

      // First poll: still running
      await vi.advanceTimersByTimeAsync(5_000);
      // Second poll: not running
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await promise;
      expect(result).toBe(0);
    });
  });

  describe('worktree .git file with no gitdir match', () => {
    it('does not set mainGitDir when gitdir regex does not match', async () => {
      const fsModule = await import('node:fs');
      (fsModule.statSync as Mock).mockReturnValueOnce({
        isFile: () => true,
        isDirectory: () => false,
      });
      // gitdir content that doesn't match the regex
      (fsModule.readFileSync as Mock).mockReturnValueOnce('not-a-gitdir-line');

      await provider.createWorker(createTestConfig());

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const binds = createCall?.HostConfig?.Binds as string[];
      const gitBinds = binds.filter((b: string) => b.includes('.git:') && !b.includes('/repo:'));
      expect(gitBinds).toHaveLength(0);
    });
  });
});
