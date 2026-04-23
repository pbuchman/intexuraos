import type Docker from 'dockerode';
import * as fs from 'node:fs';
import type { Logger } from '@intexuraos/common-core';

export interface DockerRegistryConfig {
  imageName: string;
  imagePullPolicy: 'always' | 'if-not-present';
  gcpSaKeyPath: string;
}

/**
 * Handles image pull + auth + digest resolution against a Docker registry.
 * Extracted from DockerProvider for separation of concerns.
 */
export class DockerRegistry {
  private lastResolvedDigest: string | null = null;

  constructor(
    private readonly getDocker: () => Docker,
    private readonly logger: Logger,
    private readonly config: DockerRegistryConfig
  ) {}

  async pullImage(taskId: string, onProgress?: (message: string) => void): Promise<string> {
    return await this.pullAndResolveImage(taskId, this.config.imageName, onProgress);
  }

  getLastResolvedDigest(): string | null {
    return this.lastResolvedDigest;
  }

  getImageInfo(managedAttemptsMode: boolean): {
    configuredRef: string;
    lastResolvedDigest: string | null;
    pullPolicy: string;
    managedAttemptsMode: boolean;
  } {
    return {
      configuredRef: this.config.imageName,
      lastResolvedDigest: this.lastResolvedDigest,
      pullPolicy: this.config.imagePullPolicy,
      managedAttemptsMode,
    };
  }

  async pullAndResolveImage(
    taskId: string,
    imageName: string,
    onProgress?: (message: string) => void
  ): Promise<string> {
    if (this.config.imagePullPolicy !== 'always') {
      return imageName;
    }

    const docker = this.getDocker();
    const pullOpts: Record<string, unknown> = {};
    if (this.config.gcpSaKeyPath !== '' && fs.existsSync(this.config.gcpSaKeyPath)) {
      const saKey = fs.readFileSync(this.config.gcpSaKeyPath, 'utf-8');
      /* v8 ignore start -- ts-type: nullish coalescing on array access required by noUncheckedIndexedAccess @preserve */
      const registry = imageName.split('/')[0] ?? '';
      /* v8 ignore stop @preserve */
      pullOpts['authconfig'] = {
        username: '_json_key',
        password: saKey,
        serveraddress: `https://${registry}`,
      };
    }

    const pullStart = Date.now();
    onProgress?.('Pulling image...');
    try {
      const pullStream = await docker.pull(imageName, pullOpts);
      await new Promise<void>((resolve, reject) => {
        let lastProgressAt = 0;
        const PROGRESS_THROTTLE_MS = 10_000;
        docker.modem.followProgress(
          pullStream,
          (err: Error | null) => {
            if (err !== null) reject(err);
            else resolve();
          },
          () => {
            const now = Date.now();
            if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
              lastProgressAt = now;
              const elapsedS = Math.round((now - pullStart) / 1000);
              onProgress?.(`Image pull in progress (${String(elapsedS)}s)...`);
            }
          }
        );
      });
    } catch (error) {
      throw new Error(
        `Failed to pull worker image ${imageName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const pullDurationMs = Date.now() - pullStart;
    onProgress?.(`Image pull completed in ${String(Math.round(pullDurationMs / 1000))}s`);

    try {
      const imageInfo = await docker.getImage(imageName).inspect();
      const repoDigests = Array.isArray(imageInfo.RepoDigests) ? imageInfo.RepoDigests : [];
      /* v8 ignore start -- ts-type: nullish coalescing on array access required by noUncheckedIndexedAccess @preserve */
      const resolvedImage = repoDigests.find((digest) =>
        digest.startsWith(imageName.split(':')[0] ?? '')
      );
      /* v8 ignore stop @preserve */
      const finalImage = resolvedImage ?? repoDigests[0] ?? imageName;
      this.lastResolvedDigest = finalImage;
      this.logger.info(
        { taskId, pullDurationMs },
        `Worker image pulled: requested=${imageName} resolved=${finalImage}`
      );
      if (imageName.includes(':latest')) {
        this.logger.warn(
          { taskId, imageName },
          'Worker image uses mutable tag :latest — consider pinning to digest for reproducibility'
        );
      }
      return finalImage;
    } catch (error) {
      this.logger.warn(
        { taskId, error },
        'Failed to inspect pulled image digest; using configured image reference'
      );
      return imageName;
    }
  }
}
