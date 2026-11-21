import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { WorkerAuthRefreshContext } from '../../worker-auth/types.js';

// Mock os.userInfo() to prevent crashing in Docker environments without /etc/passwd.
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

import { CredentialRefresher } from '../credential-refresher.js';
import type { Logger } from '@intexuraos/common-core';
import type Docker from 'dockerode';

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

interface MockContainer {
  id: string;
  start: ReturnType<typeof vi.fn>;
  wait: ReturnType<typeof vi.fn>;
  logs: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface MockDocker {
  createContainer: ReturnType<typeof vi.fn>;
}

function refreshContext(signal: AbortSignal): WorkerAuthRefreshContext {
  return { signal, runDockerWork: async (work) => await work() };
}

function createMockDocker(mockContainer: MockContainer): MockDocker {
  return {
    createContainer: vi.fn().mockResolvedValue(mockContainer),
  };
}

describe('CredentialRefresher', () => {
  let refresher: CredentialRefresher;
  let mockLogger: Logger;
  let mockContainer: MockContainer;
  let mockDocker: MockDocker;
  let resolveImage: Mock<() => Promise<string>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();

    mockContainer = {
      id: 'refresh-container-id',
      start: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
      logs: vi.fn().mockResolvedValue(Buffer.from('Claude replied: ok')),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    mockDocker = createMockDocker(mockContainer);
    resolveImage = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue('registry/code-worker@sha256:resolved');

    refresher = new CredentialRefresher(
      {
        sharedCredsPath: '/home/user/.code-orchestrator/claude-creds',
        networkName: 'code-worker-net',
        resolveImage,
      },
      mockDocker as never,
      mockLogger
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for the worker image pull before creating a refresh container', async () => {
    let finishPull: ((image: string) => void) | undefined;
    resolveImage.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishPull = resolve;
        })
    );

    const result = refresher.refresh();
    expect(mockDocker.createContainer).not.toHaveBeenCalled();
    finishPull?.('registry/code-worker@sha256:resolved');

    expect(await result).toBe(true);
    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: 'registry/code-worker@sha256:resolved' })
    );
  });

  it('does not create a container when policy disables auth during the image pull', async () => {
    let finishPull: ((image: string) => void) | undefined;
    resolveImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPull = resolve;
        })
    );
    const controller = new AbortController();

    const result = refresher.refresh(refreshContext(controller.signal));
    controller.abort();
    finishPull?.('registry/code-worker@sha256:resolved');

    expect(await result).toBe(false);
    expect(mockDocker.createContainer).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('removes a created container when auth is disabled before Docker returns it', async () => {
    let finishCreation: ((container: MockContainer) => void) | undefined;
    mockDocker.createContainer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreation = resolve;
        })
    );
    const controller = new AbortController();

    const result = refresher.refresh(refreshContext(controller.signal));
    await vi.waitFor(() => expect(mockDocker.createContainer).toHaveBeenCalledOnce());
    controller.abort();
    finishCreation?.(mockContainer);

    expect(await result).toBe(false);
    expect(mockContainer.start).not.toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('removes a running refresh container when policy disables auth', async () => {
    const controller = new AbortController();
    mockContainer.wait.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () => reject(new Error('wait aborted')), {
            once: true,
          });
        })
    );

    const refresh = refresher.refresh(refreshContext(controller.signal));
    await vi.waitFor(() => expect(mockContainer.wait).toHaveBeenCalledOnce());
    controller.abort();

    expect(await refresh).toBe(false);
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('does not create a refresh container when the registry pull fails', async () => {
    resolveImage.mockRejectedValue(new Error('registry access denied'));

    expect(await refresher.refresh()).toBe(false);
    expect(mockDocker.createContainer).not.toHaveBeenCalled();
    expect(mockContainer.remove).not.toHaveBeenCalled();
  });

  it('creates container with correct mounts and command', async () => {
    await refresher.refresh();

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'registry/code-worker@sha256:resolved',
        Entrypoint: ['/bin/bash', '-lc'],
        Cmd: [expect.stringContaining('cp -r /opt/claude-defaults/. /home/claude/')],
        HostConfig: expect.objectContaining({
          Binds: ['/home/user/.code-orchestrator/claude-creds:/home/claude/.claude:rw'],
          NetworkMode: 'code-worker-net',
          AutoRemove: false,
        }),
      })
    );
    const createArg = mockDocker.createContainer.mock.calls[0]?.[0] as
      | { Cmd?: string[] }
      | undefined;
    expect(createArg?.Cmd?.[0]).toContain('exec claude --print --model haiku');
    const spec = mockDocker.createContainer.mock.calls[0]?.[0] as Docker.ContainerCreateOptions;
    expect(spec.User).toBe(
      `${String(process.getuid?.() ?? 1000)}:${String(process.getgid?.() ?? 1000)}`
    );
    expect(spec.Env).toBeUndefined();
  });

  it('returns true on exit code 0', async () => {
    const result = await refresher.refresh();

    expect(result).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('refresh completed')
    );
  });

  it('returns false on non-zero exit code', async () => {
    mockContainer.wait.mockResolvedValue({ StatusCode: 1 });

    const result = await refresher.refresh();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 1, _skipSentry: true }),
      expect.stringContaining('refresh failed')
    );
  });

  it('handles container creation failure', async () => {
    mockDocker.createContainer.mockRejectedValue(new Error('Docker daemon error'));

    const result = await refresher.refresh();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error), _skipSentry: true }),
      expect.stringContaining('refresh container failed')
    );
  });

  it('handles timeout via wait options', async () => {
    mockContainer.wait.mockRejectedValue(new Error('container timeout'));

    const result = await refresher.refresh();

    expect(result).toBe(false);
  });

  it('reports refresh failure without reading the credential container output', async () => {
    mockContainer.wait.mockResolvedValue({ StatusCode: 1 });

    await refresher.refresh();

    expect(mockContainer.logs).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      { containerId: 'refresh-container-id', exitCode: 1, _skipSentry: true },
      expect.stringContaining('refresh failed')
    );
  });

  it('removes container after completion', async () => {
    await refresher.refresh();

    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('removes container even on failure', async () => {
    mockContainer.wait.mockResolvedValue({ StatusCode: 1 });

    await refresher.refresh();

    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('handles remove failure gracefully', async () => {
    mockContainer.remove.mockRejectedValue(new Error('already removed'));

    const result = await refresher.refresh();

    expect(result).toBe(true);
  });

  it('wraps non-Error thrown during container creation', async () => {
    mockDocker.createContainer.mockRejectedValue('string-error-not-an-Error');

    const result = await refresher.refresh();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error), _skipSentry: true }),
      expect.stringContaining('refresh container failed')
    );
    // Verify the wrapped error contains the string
    const errorArg = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      error: Error;
    };
    expect(errorArg.error.message).toBe('string-error-not-an-Error');
  });

  it('handles container.remove() failure in finally block after successful run', async () => {
    mockContainer.remove.mockRejectedValue(new Error('remove failed'));

    const result = await refresher.refresh();

    // Should still return true because the container exited 0
    expect(result).toBe(true);
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('handles container.remove() failure in finally block after failed run', async () => {
    mockContainer.wait.mockResolvedValue({ StatusCode: 1 });
    mockContainer.remove.mockRejectedValue(new Error('remove also failed'));

    const result = await refresher.refresh();

    // Should return false because exit code was non-zero
    expect(result).toBe(false);
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });
});
