import type Docker from 'dockerode';

export interface DockerNetworkConfig {
  networkName: string;
}

/**
 * Thin wrapper around Docker network attach/detach for worker containers.
 * Extracted from DockerProvider for separation of concerns.
 */
export class DockerNetwork {
  constructor(
    private readonly getDocker: () => Docker,
    private readonly config: DockerNetworkConfig
  ) {}

  getNetworkMode(): string {
    return this.config.networkName;
  }

  async attachToNetwork(containerId: string): Promise<void> {
    const docker = this.getDocker();
    try {
      await docker.getNetwork(this.config.networkName).connect({ Container: containerId });
    } catch (err: unknown) {
      if (err instanceof Error && this.isAlreadyAttachedError(err)) {
        return;
      }
      throw err;
    }
  }

  async detachFromNetwork(containerId: string): Promise<void> {
    const docker = this.getDocker();
    try {
      await docker.getNetwork(this.config.networkName).disconnect({ Container: containerId });
    } catch (err: unknown) {
      if (err instanceof Error && this.isAlreadyDetachedError(err)) {
        return;
      }
      throw err;
    }
  }

  private isAlreadyAttachedError(err: Error): boolean {
    return err.message.includes('already exists') || err.message.includes('endpoint with name');
  }

  private isAlreadyDetachedError(err: Error): boolean {
    return (
      err.message.includes('is not connected') ||
      err.message.includes('not found') ||
      err.message.includes('No such')
    );
  }
}
