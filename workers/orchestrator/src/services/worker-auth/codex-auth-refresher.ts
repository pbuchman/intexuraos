import * as os from 'node:os';
import type Docker from 'dockerode';
import type { Logger } from '@intexuraos/common-core';

function getHostUserString(): { uid: number; gid: number; userString: string } {
  const info = os.userInfo();
  const uid = info.uid;
  const gid = info.gid;
  return { uid, gid, userString: `${String(uid)}:${String(gid)}` };
}

export interface CodexAuthRefresherConfig {
  sharedAuthPath: string;
  imageName: string;
  networkName: string;
}

export class CodexAuthRefresher {
  private readonly config: CodexAuthRefresherConfig;
  private readonly docker: Docker;
  private readonly logger: Logger;

  constructor(config: CodexAuthRefresherConfig, docker: Docker, logger: Logger) {
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
        name: `codex-auth-refresh-${String(Date.now())}`,
        Entrypoint: ['/bin/sh', '-lc'],
        Cmd: [
          'printf "refresh codex auth\\n" | codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -',
        ],
        WorkingDir: '/tmp',
        User: userString,
        Tty: false,
        Env: [
          'HOME=/home/claude',
          'CODEX_HOME=/home/claude/.codex',
          'CODEX_SQLITE_HOME=/home/claude/.codex',
        ],
        HostConfig: {
          Binds: [`${this.config.sharedAuthPath}:/home/claude/.codex:rw`],
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

      try {
        const logs = await container.logs({ stdout: true, stderr: true });
        const output = logs.toString('utf-8').slice(0, 500);
        this.logger.debug({ output }, 'Codex auth refresh container output');
      } catch {
        // intentional no-op
      }

      if (waitResult.StatusCode === 0) {
        this.logger.info(
          { containerId: container.id },
          'Codex auth refresh completed successfully'
        );
        return true;
      }

      this.logger.error(
        { exitCode: waitResult.StatusCode, containerId: container.id },
        'Codex auth refresh failed with non-zero exit code'
      );
      return false;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error : new Error(String(error)) },
        'Codex auth refresh container failed'
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
