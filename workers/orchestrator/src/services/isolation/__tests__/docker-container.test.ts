import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { DockerContainer, redactContainerInspect } from '../docker-container.js';

interface MockContainer {
  id: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

interface MockDocker {
  createContainer: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  listContainers: ReturnType<typeof vi.fn>;
}

function createMocks(): { mockDocker: MockDocker; mockContainer: MockContainer } {
  const mockContainer: MockContainer = {
    id: 'test-container-id',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
    kill: vi.fn().mockResolvedValue(undefined),
  };
  const mockDocker: MockDocker = {
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getContainer: vi.fn().mockReturnValue(mockContainer),
    listContainers: vi.fn().mockResolvedValue([]),
  };
  return { mockDocker, mockContainer };
}

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

describe('DockerContainer', () => {
  let mockDocker: MockDocker;
  let mockContainer: MockContainer;
  let container: DockerContainer;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMocks();
    mockDocker = mocks.mockDocker;
    mockContainer = mocks.mockContainer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    container = new DockerContainer(() => mockDocker as any, createMockLogger());
  });

  it('redacts malformed and non-string container environment entries', () => {
    expect(redactContainerInspect(null)).toBeNull();
    expect(
      redactContainerInspect({
        Config: {
          Env: ['TOKEN_WITHOUT_SEPARATOR', 42, 'SECRET=value'],
        },
      })
    ).toEqual({
      Config: {
        Env: ['TOKEN_WITHOUT_SEPARATOR=[REDACTED]', '[REDACTED]', 'SECRET=[REDACTED]'],
      },
    });
  });

  it('createContainer delegates to docker.createContainer with provided spec', async () => {
    const spec = { Image: 'img:1', name: 'c1' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = await container.createContainer(spec as any);
    expect(mockDocker.createContainer).toHaveBeenCalledWith(spec);
    expect(c).toBe(mockContainer);
  });

  it('startContainer invokes container.start', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await container.startContainer(mockContainer as any);
    expect(mockContainer.start).toHaveBeenCalled();
  });

  it('stopContainer stops and removes a running container', async () => {
    await container.stopContainer('cid');
    expect(mockContainer.stop).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('stopContainer handles already-stopped container silently', async () => {
    mockContainer.stop.mockRejectedValueOnce(new Error('container is not running'));
    await expect(container.stopContainer('cid')).resolves.toBeUndefined();
    expect(mockContainer.remove).toHaveBeenCalled();
  });

  it('stopContainer with forceKill uses kill instead of stop', async () => {
    await container.stopContainer('cid', { forceKill: true });
    expect(mockContainer.kill).toHaveBeenCalledWith({ signal: 'SIGKILL' });
    expect(mockContainer.stop).not.toHaveBeenCalled();
  });

  it('stopContainer skips removal when remove: false', async () => {
    await container.stopContainer('cid', { remove: false });
    expect(mockContainer.stop).toHaveBeenCalled();
    expect(mockContainer.remove).not.toHaveBeenCalled();
  });

  it('removeContainer delegates to container.remove with force option', async () => {
    await container.removeContainer('cid', { force: true });
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('isContainerRunning returns true when State.Running', async () => {
    mockContainer.inspect.mockResolvedValueOnce({ State: { Running: true } });
    expect(await container.isContainerRunning('cid')).toBe(true);
  });

  it('isContainerRunning returns false when inspect fails', async () => {
    mockContainer.inspect.mockRejectedValueOnce(new Error('no such container'));
    expect(await container.isContainerRunning('cid')).toBe(false);
  });

  it('stopContainer rethrows unexpected errors from stop', async () => {
    mockContainer.stop.mockRejectedValueOnce(new Error('docker daemon crashed'));
    await expect(container.stopContainer('cid')).rejects.toThrow('docker daemon crashed');
  });

  it('stopContainer logs warning when remove fails', async () => {
    mockContainer.remove.mockRejectedValueOnce(new Error('remove failed'));
    await expect(container.stopContainer('cid')).resolves.toBeUndefined();
  });

  it('removeContainer defaults force to false when not provided', async () => {
    await container.removeContainer('cid');
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: false });
  });

  it('listWorkerContainers returns discovered containers with extracted taskId', async () => {
    // Simulate Docker server-side name filter (filters: { name: ['code-worker-'] })
    // by having listContainers return only matching names.
    mockDocker.listContainers.mockResolvedValueOnce([
      { Id: 'c1', Names: ['/code-worker-task-1'], State: 'running', Created: 1 },
    ]);
    const list = await container.listDiscoveredContainers();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ containerId: 'c1', taskId: 'task-1', state: 'running' });
  });

  it('listWorkerContainers logs warning when name has no recognizable prefix', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([
      { Id: 'cx', Names: ['/code-worker-'], State: 'running', Created: 1 },
    ]);
    const list = await container.listDiscoveredContainers();
    expect(list).toHaveLength(0);
  });

  describe('waitForExecCompletion', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const makeStream = (): any => {
      const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
      const stream = {
        on: (event: string, cb: (arg?: unknown) => void): any => {
          handlers[event] = handlers[event] ?? [];
          handlers[event].push(cb);
          return stream;
        },
        resume: (): void => {
          // no-op: test streams are manually driven via emit()
        },
        emit: (event: string, arg?: unknown): void => {
          for (const cb of handlers[event] ?? []) cb(arg);
        },
      };
      return stream;
    };

    it('resolves via stream end using exit code from inspect', async () => {
      const execInstance = {
        inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: 0 }),
      };
      const stream = makeStream();
      const promise = container.waitForExecCompletion('task-1', execInstance as any, stream as any);
      stream.emit('end');
      expect(await promise).toBe(0);
    });

    it('defaults exit code to 1 when inspect returns no ExitCode on stream end', async () => {
      const execInstance = {
        inspect: vi.fn().mockResolvedValue({ Running: false }),
      };
      const stream = makeStream();
      const promise = container.waitForExecCompletion('task-1', execInstance as any, stream as any);
      stream.emit('end');
      expect(await promise).toBe(1);
    });

    it('resolves to 1 when stream end inspect rejects', async () => {
      const execInstance = {
        inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
      };
      const stream = makeStream();
      const promise = container.waitForExecCompletion('task-1', execInstance as any, stream as any);
      stream.emit('end');
      expect(await promise).toBe(1);
    });

    it('resolves to 1 when stream emits error', async () => {
      const execInstance = { inspect: vi.fn() };
      const stream = makeStream();
      const promise = container.waitForExecCompletion('task-1', execInstance as any, stream as any);
      stream.emit('error', new Error('boom'));
      expect(await promise).toBe(1);
    });

    it('resolves via poll timer when exec exits but stream stays open', async () => {
      vi.useFakeTimers();
      try {
        let inspectCall = 0;
        const execInstance = {
          inspect: vi.fn().mockImplementation(async () => {
            inspectCall += 1;
            // First tick: still running. Second tick: exited.
            return inspectCall === 1
              ? { Running: true, ExitCode: null }
              : { Running: false, ExitCode: 42 };
          }),
        };
        const stream = makeStream();
        const promise = container.waitForExecCompletion(
          'task-1',
          execInstance as any,
          stream as any
        );

        // First poll tick (Running: true)
        await vi.advanceTimersByTimeAsync(5_000);
        // Second poll tick (Running: false, ExitCode: 42)
        await vi.advanceTimersByTimeAsync(5_000);

        expect(await promise).toBe(42);
      } finally {
        vi.useRealTimers();
      }
    });

    it('defaults exit code to 1 when poll-path inspect returns non-number ExitCode', async () => {
      vi.useFakeTimers();
      try {
        const execInstance = {
          inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: null }),
        };
        const stream = makeStream();
        const promise = container.waitForExecCompletion(
          'task-1',
          execInstance as any,
          stream as any
        );
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await promise).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves to 1 when poll-path inspect rejects', async () => {
      vi.useFakeTimers();
      try {
        const execInstance = {
          inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
        };
        const stream = makeStream();
        const promise = container.waitForExecCompletion(
          'task-1',
          execInstance as any,
          stream as any
        );
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await promise).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
});
