import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { DockerNetwork } from '../docker-network.js';

interface MockNetwork {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockDocker {
  getNetwork: ReturnType<typeof vi.fn>;
}

function createMockDocker(): { mockDocker: MockDocker; mockNetwork: MockNetwork } {
  const mockNetwork: MockNetwork = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const mockDocker: MockDocker = {
    getNetwork: vi.fn().mockReturnValue(mockNetwork),
  };
  return { mockDocker, mockNetwork };
}

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

describe('DockerNetwork', () => {
  let mockDocker: MockDocker;
  let mockNetwork: MockNetwork;
  let network: DockerNetwork;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMockDocker();
    mockDocker = mocks.mockDocker;
    mockNetwork = mocks.mockNetwork;
    network = new DockerNetwork(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mockDocker as any,
      createMockLogger(),
      { networkName: 'code-worker-net' }
    );
  });

  it('getNetworkMode returns configured network name', () => {
    expect(network.getNetworkMode()).toBe('code-worker-net');
  });

  it('attachToNetwork connects container to configured network', async () => {
    await network.attachToNetwork('container-id');
    expect(mockDocker.getNetwork).toHaveBeenCalledWith('code-worker-net');
    expect(mockNetwork.connect).toHaveBeenCalledWith({ Container: 'container-id' });
  });

  it('attachToNetwork is idempotent when container is already attached', async () => {
    mockNetwork.connect.mockRejectedValueOnce(
      new Error('endpoint with name container-id already exists')
    );
    await expect(network.attachToNetwork('container-id')).resolves.toBeUndefined();
  });

  it('attachToNetwork propagates unexpected errors', async () => {
    mockNetwork.connect.mockRejectedValueOnce(new Error('boom'));
    await expect(network.attachToNetwork('container-id')).rejects.toThrow('boom');
  });

  it('detachFromNetwork disconnects and is idempotent on not-connected error', async () => {
    await network.detachFromNetwork('container-id');
    expect(mockNetwork.disconnect).toHaveBeenCalledWith({ Container: 'container-id' });

    mockNetwork.disconnect.mockRejectedValueOnce(
      new Error('endpoint with name container-id is not connected')
    );
    await expect(network.detachFromNetwork('container-id')).resolves.toBeUndefined();
  });

  it('detachFromNetwork is idempotent on "not found" and "No such" errors', async () => {
    mockNetwork.disconnect.mockRejectedValueOnce(new Error('network not found'));
    await expect(network.detachFromNetwork('cid')).resolves.toBeUndefined();
    mockNetwork.disconnect.mockRejectedValueOnce(new Error('No such network'));
    await expect(network.detachFromNetwork('cid')).resolves.toBeUndefined();
  });

  it('detachFromNetwork propagates unexpected errors', async () => {
    mockNetwork.disconnect.mockRejectedValueOnce(new Error('boom'));
    await expect(network.detachFromNetwork('cid')).rejects.toThrow('boom');
  });
});
