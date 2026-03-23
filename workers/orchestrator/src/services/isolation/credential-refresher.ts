import * as os from 'node:os';
import type Docker from 'dockerode';
import type { Logger } from '@intexuraos/common-core';

function getHostUserString(): { uid: number; gid: number; userString: string } {
  const info = os.userInfo();
  const uid = info.uid;
  const gid = info.gid;
  return { uid, gid, userString: `${String(uid)}:${String(gid)}` };
}

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
    const { uid, gid, userString } = getHostUserString();

    try {
      container = await this.docker.createContainer({
        Image: this.config.imageName,
        name: `claude-cred-refresh-${String(Date.now())}`,
        Entrypoint: ['claude'],
        Cmd: ['--print', '--model', 'haiku', 'reply ok'],
        User: userString,
        Tty: false,
        HostConfig: {
          Binds: [`${this.config.sharedCredsPath}:/home/claude/.claude:rw`],
          NetworkMode: this.config.networkName,
          AutoRemove: false,
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=100m',
            '/home/claude': `rw,noexec,nosuid,size=100m,uid=${String(uid)},gid=${String(gid)}`,
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
        // intentional no-op
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
        { error: error instanceof Error ? error : new Error(String(error)) },
        'Credential refresh container failed'
      );
      return false;
    } finally {
      if (container !== undefined) {
        try {
          await container.remove({ force: true });
        } catch {
          // intentional no-op
        }
      }
    }
  }
}
