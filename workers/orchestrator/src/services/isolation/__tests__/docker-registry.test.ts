import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { DockerRegistry, type DockerRegistryConfig } from '../docker-registry.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('FAKE_SA_KEY_CONTENTS'),
  };
});

interface MockDocker {
  pull: ReturnType<typeof vi.fn>;
  getImage: ReturnType<typeof vi.fn>;
  modem: { followProgress: ReturnType<typeof vi.fn> };
}

function createMockDocker(): MockDocker {
  return {
    pull: vi.fn().mockResolvedValue({}),
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        RepoDigests: [
          'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker@sha256:testdigest',
        ],
      }),
    }),
    modem: {
      followProgress: vi.fn(
        (_stream: unknown, onFinished: (err: Error | null) => void, _onProgress?: () => void) => {
          _onProgress?.();
          onFinished(null);
        }
      ),
    },
  };
}

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

function makeRegistry(
  mockDocker: MockDocker,
  overrides: Partial<DockerRegistryConfig> = {}
): { registry: DockerRegistry; logger: Logger } {
  const logger = createMockLogger();
  const config: DockerRegistryConfig = {
    imageName:
      'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest',
    imagePullPolicy: 'always',
    gcpSaKeyPath: '/test/gcp-sa.json',
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registry = new DockerRegistry(() => mockDocker as any, logger, config);
  return { registry, logger };
}

describe('DockerRegistry', () => {
  let mockDocker: MockDocker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocker = createMockDocker();
  });

  it('invokes pull with GCP SA key auth when gcpSaKeyPath configured', async () => {
    const { registry } = makeRegistry(mockDocker);
    await registry.pullImage('task-1');

    expect(mockDocker.pull).toHaveBeenCalledWith(
      expect.stringContaining('code-worker'),
      expect.objectContaining({
        authconfig: expect.objectContaining({
          username: '_json_key',
          password: 'FAKE_SA_KEY_CONTENTS',
          serveraddress: 'https://europe-central2-docker.pkg.dev',
        }),
      })
    );
  });

  it('pulls without auth when gcpSaKeyPath is empty', async () => {
    const { registry } = makeRegistry(mockDocker, { gcpSaKeyPath: '' });
    await registry.pullImage('task-1');

    const [, opts] = mockDocker.pull.mock.calls[0] ?? [];
    expect((opts as { authconfig?: unknown } | undefined)?.authconfig).toBeUndefined();
  });

  it('skips pull when imagePullPolicy is if-not-present', async () => {
    const { registry } = makeRegistry(mockDocker, { imagePullPolicy: 'if-not-present' });
    const result = await registry.pullImage('task-1');

    expect(mockDocker.pull).not.toHaveBeenCalled();
    expect(result).toBe(
      'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest'
    );
  });

  it('returns resolved digest from getImage.inspect', async () => {
    const { registry } = makeRegistry(mockDocker);
    const resolved = await registry.pullImage('task-1');

    expect(resolved).toBe(
      'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker@sha256:testdigest'
    );
    expect(registry.getLastResolvedDigest()).toBe(resolved);
  });

  it('wraps pull errors with "Failed to pull worker image" prefix', async () => {
    mockDocker.pull.mockRejectedValueOnce(new Error('network down'));
    const { registry } = makeRegistry(mockDocker);

    await expect(registry.pullImage('task-1')).rejects.toThrow('Failed to pull worker image');
  });

  it('getImageInfo reflects config + last resolved digest', async () => {
    const { registry } = makeRegistry(mockDocker);
    const before = registry.getImageInfo(true);
    expect(before.lastResolvedDigest).toBeNull();
    expect(before.managedAttemptsMode).toBe(true);
    expect(before.pullPolicy).toBe('always');

    await registry.pullImage('task-1');
    const after = registry.getImageInfo(false);
    expect(after.lastResolvedDigest).toContain('sha256:testdigest');
    expect(after.managedAttemptsMode).toBe(false);
  });

  it('emits Pulling image and completion progress messages', async () => {
    const { registry } = makeRegistry(mockDocker);
    const onProgress = vi.fn();
    await registry.pullImage('task-1', onProgress);

    expect(onProgress).toHaveBeenCalledWith('Pulling image...');
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Image pull completed in'));
  });
});
