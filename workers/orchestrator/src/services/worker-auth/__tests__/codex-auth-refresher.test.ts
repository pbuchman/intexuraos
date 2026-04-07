import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { CodexAuthRefresher } from '../codex-auth-refresher.js';

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
      homedir: '/home/testuser',
      shell: '/bin/bash',
    }),
  };
});

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

describe('CodexAuthRefresher', () => {
  let refresher: CodexAuthRefresher;
  let mockLogger: Logger;
  let mockContainer: MockContainer;
  let mockDocker: MockDocker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    mockContainer = {
      id: 'codex-refresh-container-id',
      start: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
      logs: vi.fn().mockResolvedValue(Buffer.from('Codex refreshed auth')),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    mockDocker = {
      createContainer: vi.fn().mockResolvedValue(mockContainer),
    };

    refresher = new CodexAuthRefresher(
      {
        sharedAuthPath: '/home/user/.code-orchestrator/codex-auth',
        imageName: 'europe-central2-docker.pkg.dev/project/repo/code-worker:latest',
        networkName: 'code-worker-net',
      },
      mockDocker as never,
      mockLogger
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a refresh container with the shared auth mounted into ~/.codex', async () => {
    await refresher.refresh();

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'europe-central2-docker.pkg.dev/project/repo/code-worker:latest',
        Entrypoint: ['/bin/sh', '-lc'],
        Cmd: [expect.stringContaining('codex exec --json')],
        HostConfig: expect.objectContaining({
          Binds: expect.arrayContaining([
            '/home/user/.code-orchestrator/codex-auth:/home/claude/.codex:rw',
          ]),
          NetworkMode: 'code-worker-net',
          AutoRemove: false,
        }),
      })
    );
  });

  it('returns true on exit code 0', async () => {
    const result = await refresher.refresh();

    expect(result).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: 'codex-refresh-container-id' }),
      expect.stringContaining('completed successfully')
    );
  });

  it('returns false on non-zero exit code', async () => {
    mockContainer.wait.mockResolvedValue({ StatusCode: 9 });

    const result = await refresher.refresh();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 9 }),
      expect.stringContaining('failed')
    );
  });

  it('returns false when container creation throws', async () => {
    mockDocker.createContainer.mockRejectedValue(new Error('docker unavailable'));

    const result = await refresher.refresh();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'docker unavailable' }),
      }),
      expect.stringContaining('failed')
    );
  });

  it('normalizes non-Error refresh failures before logging', async () => {
    mockDocker.createContainer.mockRejectedValue('docker unavailable');

    const result = await refresher.refresh();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'docker unavailable' }),
      }),
      expect.stringContaining('failed')
    );
  });

  it('still succeeds when container removal throws in finally', async () => {
    mockContainer.remove.mockRejectedValue(new Error('remove failed'));

    const result = await refresher.refresh();

    expect(result).toBe(true);
  });
});
