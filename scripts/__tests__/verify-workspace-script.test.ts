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
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../verify-workspace.sh', import.meta.url), 'utf8');

function runMatrixVerification({
  nodeExitCode = 0,
  pnpmExitCode = 0,
}: {
  nodeExitCode?: number;
  pnpmExitCode?: number;
} = {}): {
  status: number | null;
  output: string;
  commands: string[];
} {
  const root = mkdtempSync(join(tmpdir(), 'verify-workspace-matrix-'));
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    const result = runMatrixVerification({ pnpmExitCode: 37 });

    expect(result.status).toBe(37);
    expect(result.output).not.toContain('All checks passed for whatsapp-private-matrix-sync');
  });

  it('stops before package tests when a Matrix adapter module fails syntax checking', () => {
    const result = runMatrixVerification({ nodeExitCode: 38 });

    expect(result.status).toBe(38);
    expect(result.commands).toEqual([
      'node --check tools/whatsapp-private-matrix-sync/src/server.mjs',
    ]);
    expect(result.output).not.toContain('All checks passed for whatsapp-private-matrix-sync');
  });

  it('continues to reject unknown tool workspaces', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-workspace-unknown-'));
    try {
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
