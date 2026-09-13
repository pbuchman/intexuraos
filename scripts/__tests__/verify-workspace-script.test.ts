import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, onTestFinished } from 'vitest';

const script = readFileSync(new URL('../verify-workspace.sh', import.meta.url), 'utf8');

function createTemporaryWorkspace(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runMatrixVerification(
  pnpmExitCode = 0,
  nodeExitCode = 0
): {
  status: number | null;
  output: string;
  commands: string[];
} {
  const root = createTemporaryWorkspace('verify-workspace-matrix-');
  const scriptsDirectory = join(root, 'scripts');
  const sourceDirectory = join(root, 'tools', 'whatsapp-private-matrix-sync', 'src');
  const binaryDirectory = join(root, 'bin');
  const commandLog = join(root, 'commands.log');

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(join(scriptsDirectory, 'verify-workspace.sh'), script);
  writeFileSync(join(sourceDirectory, 'server.mjs'), 'export const value = 1;\n');
  writeFileSync(join(sourceDirectory, 'server.test.mjs'), 'export const testValue = 2;\n');

  for (const [name, contents] of [
    ['node', `#!/bin/sh\nprintf "node %s\\n" "$*" >> "$COMMAND_LOG"\nexit ${nodeExitCode}\n`],
    ['pnpm', `#!/bin/sh\nprintf "pnpm %s\\n" "$*" >> "$COMMAND_LOG"\nexit ${pnpmExitCode}\n`],
  ] as const) {
    const path = join(binaryDirectory, name);
    writeFileSync(path, contents);
    chmodSync(path, 0o755);
  }

  const result = spawnSync(
    'bash',
    [join(scriptsDirectory, 'verify-workspace.sh'), 'whatsapp-private-matrix-sync'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        COMMAND_LOG: commandLog,
        PATH: `${binaryDirectory}:${process.env.PATH ?? ''}`,
      },
    }
  );

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    commands: existsSync(commandLog) ? readFileSync(commandLog, 'utf8').trim().split('\n') : [],
  };
}

describe('verify-workspace.sh', () => {
  it('runs Web tests inside the Web workspace instead of the repository root', () => {
    expect(script).toContain('pnpm --filter @intexuraos/$WORKSPACE test');
    expect(script).not.toContain('pnpm run test -- $SERVICE_DIR');
  });

  it('checks every Matrix adapter module before running its package tests', () => {
    const result = runMatrixVerification();

    expect(result.status).toBe(0);
    expect(result.commands).toEqual([
      'node --check tools/whatsapp-private-matrix-sync/src/server.mjs',
      'node --check tools/whatsapp-private-matrix-sync/src/server.test.mjs',
      'pnpm --filter whatsapp-private-matrix-sync --fail-if-no-match test',
    ]);
    expect(result.output).toContain('All checks passed for whatsapp-private-matrix-sync');
  });

  it('propagates Matrix adapter package test failures', () => {
    const result = runMatrixVerification(37);

    expect(result.status).toBe(37);
    expect(result.output).not.toContain('All checks passed for whatsapp-private-matrix-sync');
  });

  it('stops before package tests when a Matrix adapter syntax check fails', () => {
    const result = runMatrixVerification(0, 23);

    expect(result.status).toBe(23);
    expect(result.commands).toEqual([
      'node --check tools/whatsapp-private-matrix-sync/src/server.mjs',
    ]);
    expect(result.output).not.toContain('All checks passed for whatsapp-private-matrix-sync');
  });

  it('continues to reject unknown tool workspaces', () => {
    const root = createTemporaryWorkspace('verify-workspace-unknown-');
    const scriptsDirectory = join(root, 'scripts');
    mkdirSync(join(root, 'tools', 'unknown-tool', 'src'), { recursive: true });
    mkdirSync(scriptsDirectory, { recursive: true });
    writeFileSync(join(scriptsDirectory, 'verify-workspace.sh'), script);

    const result = spawnSync(
      'bash',
      [join(scriptsDirectory, 'verify-workspace.sh'), 'unknown-tool'],
      {
        cwd: root,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'ERROR: Cannot find workspace directory for unknown-tool'
    );
  });
});
