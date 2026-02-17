import * as os from 'node:os';
import type Docker from 'dockerode';
import type { Logger } from '@intexuraos/common-core';

const HOST_UID = os.userInfo().uid;
const HOST_GID = os.userInfo().gid;
const HOST_USER_STRING = `${String(HOST_UID)}:${String(HOST_GID)}`;

export interface CredentialRefresherConfig {
  sharedCredsPath: string;
  imageName: string;
  networkName: string;
}

export class CredentialRefresher {
  private readonly config: CredentialRefresherConfig;
  private readonly docker: Docker;
  private readonly logger: Logger;

  constructor(config: CredentialRefresherConfig, docker: Docker, logger: Logger) {
    this.config = config;
    this.docker = docker;
    this.logger = logger;
  }

  async refresh(): Promise<boolean> {
    let container: Docker.Container | undefined;

    try {
      container = await this.docker.createContainer({
        Image: this.config.imageName,
        name: `claude-cred-refresh-${String(Date.now())}`,
        Cmd: ['claude', '--print', '--model', 'haiku', 'reply ok'],
        User: HOST_USER_STRING,
        Tty: false,
        HostConfig: {
          Binds: [`${this.config.sharedCredsPath}:/home/claude/.claude:rw`],
          NetworkMode: this.config.networkName,
          AutoRemove: false,
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=100m',
            '/home/claude': `rw,noexec,nosuid,size=100m,uid=${String(HOST_UID)},gid=${String(HOST_GID)}`,
          },
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
        },
      });

      await container.start();

      const waitResult = await container.wait({
        condition: 'not-running',
      } as Docker.ContainerWaitOptions & { signal?: AbortSignal });

      // Capture logs for debugging
      try {
        const logs = await container.logs({ stdout: true, stderr: true });
        const output = logs.toString('utf-8').slice(0, 500);
        this.logger.debug({ output }, 'Credential refresh container output');
      } catch {
        /* v8 ignore start -- upstream: log retrieval failure after container exit @preserve */
        /* v8 ignore stop @preserve */
      }

      if (waitResult.StatusCode === 0) {
        this.logger.info(
          { containerId: container.id },
          'Credential refresh completed successfully'
        );
        return true;
      }

      this.logger.error(
        { exitCode: waitResult.StatusCode, containerId: container.id },
        'Credential refresh failed with non-zero exit code'
      );
      return false;
    } catch (error) {
      this.logger.error(
        /* v8 ignore start -- ts-type: catch always receives Error instances @preserve */
        { error: error instanceof Error ? error : new Error(String(error)) },
        /* v8 ignore stop @preserve */
        'Credential refresh container failed'
      );
      return false;
    } finally {
      if (container !== undefined) {
        try {
          await container.remove({ force: true });
        } catch {
          /* v8 ignore start -- upstream: container removal failure during cleanup @preserve */
          /* v8 ignore stop @preserve */
        }
      }
    }
  }
}
