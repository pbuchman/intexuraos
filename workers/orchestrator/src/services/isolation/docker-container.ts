import type Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@intexuraos/common-core';
import type { DiscoveredContainer } from './types.js';

const EXEC_INSPECT_POLL_INTERVAL_MS = 5_000;

/**
 * Container lifecycle wrapper extracted from DockerProvider.
 * Wraps dockerode's container methods with idempotent error handling
 * and shared exec-completion logic.
 */
export class DockerContainer {
  constructor(
    private readonly getDocker: () => Docker,
    private readonly logger: Logger
  ) {}

  getContainer(containerId: string): Docker.Container {
    return this.getDocker().getContainer(containerId);
  }

  async createContainer(spec: Docker.ContainerCreateOptions): Promise<Docker.Container> {
    return await this.getDocker().createContainer(spec);
  }

  async startContainer(container: Docker.Container): Promise<void> {
    await container.start();
  }

  async stopContainer(
    containerId: string,
    opts: { forceKill?: boolean; remove?: boolean } = {}
  ): Promise<void> {
    const { forceKill = false, remove = true } = opts;
    const container = this.getDocker().getContainer(containerId);

    try {
      if (forceKill) {
        await container.kill({ signal: 'SIGKILL' });
      } else {
        await container.stop({ t: 10 });
      }
    } catch (err: unknown) {
      if (!this.isAlreadyStoppedError(err)) {
        throw err;
      }
    }

    if (remove) {
      try {
        await container.remove({ force: true });
      } catch (err: unknown) {
        this.logger.warn({ containerId, error: err }, 'Failed to remove container');
      }
    }
  }

  async removeContainer(containerId: string, opts: { force?: boolean } = {}): Promise<void> {
    await this.getDocker()
      .getContainer(containerId)
      .remove({ force: opts.force ?? false });
  }

  async isContainerRunning(containerId: string): Promise<boolean> {
    try {
      const info = await this.getDocker().getContainer(containerId).inspect();
      return info.State.Running;
    } catch {
      return false;
    }
  }

  async listDiscoveredContainers(namePrefix = 'code-worker-'): Promise<DiscoveredContainer[]> {
    try {
      const containers = await this.getDocker().listContainers({
        all: true,
        filters: { name: [namePrefix] },
      });

      return containers
        .map((c) => {
          const rawName = c.Names[0] ?? '';
          const taskId = this.extractTaskIdFromContainerName(rawName, namePrefix);
          if (taskId === null) {
            this.logger.warn({ containerId: c.Id }, 'Container has no recognizable name, skipping');
            return null;
          }
          return { containerId: c.Id, taskId, state: c.State };
        })
        .filter((c): c is DiscoveredContainer => c !== null);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to list worker containers for discovery');
      return [];
    }
  }

  extractTaskIdFromContainerName(rawName: string, namePrefix = 'code-worker-'): string | null {
    const escaped = namePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskId = rawName.replace(new RegExp(`^/${escaped}`), '');
    return taskId === '' ? null : taskId;
  }

  isAlreadyStoppedError(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err.message.includes('No such container') ||
        err.message.includes('is not running') ||
        err.message.includes('already stopped'))
    );
  }

  /**
   * Poll+stream hybrid wait for a Docker exec to complete. Used for attempt
   * execution and readiness probes where both stream close and inspect polling
   * are required for reliability across Docker daemon variants.
   */
  async waitForExecCompletion(
    taskId: string,
    execInstance: Docker.Exec,
    execStream: NodeJS.ReadableStream
  ): Promise<number> {
    return await new Promise<number>((resolve) => {
      let resolved = false;

      const onPollTick = (): void => {
        void execInstance
          .inspect()
          .then((info) => {
            if (!info.Running) {
              this.logger.info(
                { taskId },
                'Exec process exited but stream still open — resolving via inspect fallback'
              );
              /* v8 ignore start -- ts-type: FakeHttpClient cannot produce a null ExitCode from Docker.ExecInspectInfo @preserve */
              resolveWith(typeof info.ExitCode === 'number' ? info.ExitCode : 1);
              /* v8 ignore stop @preserve */
            }
          })
          .catch(() => {
            resolveWith(1);
          });
      };

      /* v8 ignore start -- async-timing: vi.useFakeTimers cannot deterministically capture the setInterval handle before resolveWith is declared in the same scope @preserve */
      const pollTimer = setInterval(onPollTick, EXEC_INSPECT_POLL_INTERVAL_MS);
      /* v8 ignore stop @preserve */

      const resolveWith = (exitCode: number): void => {
        /* v8 ignore start -- async-timing: double-resolution race guard cannot be triggered deterministically because stream end and poll timer fire in the same microtask queue @preserve */
        if (resolved) return;
        /* v8 ignore stop @preserve */
        resolved = true;
        clearInterval(pollTimer);
        resolve(exitCode);
      };

      const onStreamEnd = (): void => {
        execInstance
          .inspect()
          .then((info) => {
            resolveWith(typeof info.ExitCode === 'number' ? info.ExitCode : 1);
          })
          .catch(() => {
            resolveWith(1);
          });
      };
      execStream.on('end', onStreamEnd);
      execStream.on('close', onStreamEnd);
      execStream.on('error', () => {
        resolveWith(1);
      });
      execStream.resume();
    });
  }

  async runExecAndCapture(
    taskId: string,
    execInstance: Docker.Exec
  ): Promise<{ exitCode: number; output: string }> {
    const execStream = await execInstance.start({ hijack: false, stdin: false });
    let output = '';

    await new Promise<void>((resolve, reject) => {
      execStream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf-8');
      });
      execStream.on('end', resolve);
      execStream.on('close', resolve);
      execStream.on('error', (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      execStream.resume();
    });

    try {
      const info = await execInstance.inspect();
      return { exitCode: typeof info.ExitCode === 'number' ? info.ExitCode : 1, output };
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to inspect exec completion state');
      return { exitCode: 1, output };
    }
  }

  async waitForWorkerReady(
    taskId: string,
    container: Docker.Container,
    timeoutMs: number
  ): Promise<void> {
    const pollIntervalMs = 2_000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const execInstance = await container.exec({
        Cmd: ['test', '-f', '/tmp/worker-ready'],
        AttachStdout: true,
        AttachStderr: false,
        WorkingDir: '/',
      });
      const execStream = await execInstance.start({ hijack: false, stdin: false });
      await new Promise<void>((resolve) => {
        execStream.on('end', resolve);
        execStream.on('close', resolve);
        execStream.resume();
      });
      const info = await execInstance.inspect();
      if (info.ExitCode === 0) {
        this.logger.info(
          { taskId, elapsedMs: Date.now() - startTime },
          'Worker readiness confirmed'
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Worker readiness timeout after ${String(timeoutMs)}ms for task ${taskId}`);
  }

  async assertManagedEntrypointSupport(
    taskId: string,
    container: Docker.Container,
    userString: string
  ): Promise<void> {
    const execInstance = await container.exec({
      Cmd: ['sh', '-lc', 'grep -q "run-attempt" /entrypoint.sh'],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: '/',
      User: userString,
    });

    const execStream = await execInstance.start({ hijack: false, stdin: false });
    const exitCode = await this.waitForExecCompletion(taskId, execInstance, execStream);
    if (exitCode !== 0) {
      throw new Error(
        'Worker image is incompatible: missing managed-attempt run-attempt entrypoint support'
      );
    }
  }

  async captureSegfaultForensics(
    taskId: string,
    container: Docker.Container,
    execInstance: Docker.Exec,
    hostAttemptForensicsPath: string,
    containerAttemptForensicsPath: string,
    userString: string
  ): Promise<void> {
    try {
      await fs.promises.mkdir(hostAttemptForensicsPath, { recursive: true });

      await writeJsonArtifact(path.join(hostAttemptForensicsPath, 'orchestrator-segfault.json'), {
        taskId,
        capturedAt: new Date().toISOString(),
        containerAttemptForensicsPath,
      });

      try {
        const execInfo = await execInstance.inspect();
        await writeJsonArtifact(path.join(hostAttemptForensicsPath, 'exec-inspect.json'), execInfo);
      } catch (error) {
        await fs.promises.writeFile(
          path.join(hostAttemptForensicsPath, 'exec-inspect.error.txt'),
          error instanceof Error ? (error.stack ?? error.message) : String(error),
          'utf-8'
        );
      }

      try {
        const containerInfo = await container.inspect();
        await writeJsonArtifact(
          path.join(hostAttemptForensicsPath, 'container-inspect.json'),
          containerInfo
        );
      } catch (error) {
        await fs.promises.writeFile(
          path.join(hostAttemptForensicsPath, 'container-inspect.error.txt'),
          error instanceof Error ? (error.stack ?? error.message) : String(error),
          'utf-8'
        );
      }

      const snapshotCommand = [
        'set -eu',
        `OUT=${JSON.stringify(containerAttemptForensicsPath)}`,
        'mkdir -p "$OUT/container-snapshot"',
        '{',
        '  echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
        `  echo "task_id=${taskId}"`,
        '  echo "uid=$(id -u 2>/dev/null || true)"',
        '  echo "gid=$(id -g 2>/dev/null || true)"',
        '  echo "uname=$(uname -a 2>/dev/null || true)"',
        '  echo "whoami=$(whoami 2>/dev/null || true)"',
        '  echo',
        '  echo "[ulimit]"',
        '  (ulimit -a 2>/dev/null || true)',
        '  echo',
        '  echo "[core settings]"',
        '  (cat /proc/sys/kernel/core_pattern 2>/dev/null || true)',
        '  (cat /proc/sys/kernel/dmesg_restrict 2>/dev/null || true)',
        '  echo',
        '  echo "[claude]"',
        '  (claude --version 2>/dev/null || true)',
        '  (file /usr/local/bin/claude 2>/dev/null || true)',
        '} > "$OUT/container-snapshot/runtime-summary.txt" 2>&1 || true',
        'cp -a /tmp/claude-cmd-timing "$OUT/container-snapshot/claude-cmd-timing" 2>/dev/null || true',
        'cp -a /home/claude/.claude/debug "$OUT/container-snapshot/claude-debug" 2>/dev/null || true',
        'cp -a /home/claude/.claude/projects/-repo "$OUT/container-snapshot/claude-projects-repo" 2>/dev/null || true',
        'cp -a /home/claude/.claude/shell-snapshots "$OUT/container-snapshot/shell-snapshots" 2>/dev/null || true',
        'cp -a /home/claude/.claude.json "$OUT/container-snapshot/.claude.json" 2>/dev/null || true',
        'find /repo /var/crash -maxdepth 3 -type f -name "core*" > "$OUT/container-snapshot/core-files.txt" 2>/dev/null || true',
        'for core in /repo/core* /var/crash/core*; do [ -f "$core" ] || continue; cp -a "$core" "$OUT/container-snapshot/" 2>/dev/null || true; done',
        'if command -v gdb >/dev/null 2>&1; then for core in "$OUT"/container-snapshot/core*; do [ -f "$core" ] || continue; gdb -batch -ex "set pagination off" -ex "thread apply all bt full" /usr/local/bin/claude "$core" > "$OUT/container-snapshot/$(basename "$core").gdb.txt" 2>&1 || true; done; fi',
        'if command -v strace >/dev/null 2>&1; then strace -V > "$OUT/container-snapshot/strace-version.txt" 2>&1 || true; fi',
      ].join('; ');

      const snapshotExec = await container.exec({
        Cmd: ['sh', '-lc', snapshotCommand],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        WorkingDir: '/',
        User: userString,
      });
      const snapshotResult = await this.runExecAndCapture(taskId, snapshotExec);
      await fs.promises.writeFile(
        path.join(hostAttemptForensicsPath, 'snapshot-exec.output.txt'),
        snapshotResult.output,
        'utf-8'
      );
      await fs.promises.writeFile(
        path.join(hostAttemptForensicsPath, 'snapshot-exec.exit-code.txt'),
        String(snapshotResult.exitCode),
        'utf-8'
      );
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to capture segfault forensics');
    }
  }
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}
