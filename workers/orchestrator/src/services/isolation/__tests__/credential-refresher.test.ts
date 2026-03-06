import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock os.userInfo() to prevent crashing in Docker environments without /etc/passwd.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return {
    ...actual,
    userInfo: vi
      .fn()
      .mockReturnValue({
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

    refresher = new CredentialRefresher(
      {
        sharedCredsPath: '/home/user/.claude-orchestrator/claude-creds',
        imageName: 'europe-central2-docker.pkg.dev/project/repo/claude-worker:latest',
        networkName: 'claude-worker-net',
      },
      mockDocker as never,
      mockLogger
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates container with correct mounts and command', async () => {
    await refresher.refresh();

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'europe-central2-docker.pkg.dev/project/repo/claude-worker:latest',
        Entrypoint: ['claude'],
        Cmd: ['--print', '--model', 'haiku', 'reply ok'],
        HostConfig: expect.objectContaining({
          Binds: expect.arrayContaining([
            '/home/user/.claude-orchestrator/claude-creds:/home/claude/.claude:rw',
          ]),
          NetworkMode: 'claude-worker-net',
          AutoRemove: false,
        }),
      })
    );
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
      expect.objectContaining({ exitCode: 1 }),
      expect.stringContaining('refresh failed')
    );
  });

  it('handles container creation failure', async () => {
    mockDocker.createContainer.mockRejectedValue(new Error('Docker daemon error'));

    const result = await refresher.refresh();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringContaining('refresh container failed')
    );
  });

  it('handles timeout via wait options', async () => {
    mockContainer.wait.mockRejectedValue(new Error('container timeout'));

    const result = await refresher.refresh();

    expect(result).toBe(false);
  });

  it('logs container output', async () => {
    await refresher.refresh();

    expect(mockContainer.logs).toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ output: expect.stringContaining('Claude replied') }),
      expect.stringContaining('output')
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
});
