import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAaaaOnlyDockerProxy } from './aaaa-only-docker-proxy.js';

const temporaryDirectories: string[] = [];
const executableTemporaryDirectory = process.platform === 'linux' ? '/var/tmp' : tmpdir();

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('createAaaaOnlyDockerProxy', () => {
  it('injects one IPv6-only hosts entry before the verifier image argument', () => {
    const directory = mkdtempSync(join(executableTemporaryDirectory, 'aaaa-only-docker-proxy-'));
    temporaryDirectories.push(directory);
    const argumentsPath = join(directory, 'arguments');
    const realDockerPath = join(directory, 'real-docker');
    writeFileSync(
      realDockerPath,
      '#!/bin/bash\nprintf \'%s\\n\' "$@" > "$CAPTURED_DOCKER_ARGUMENTS"\n',
      'utf8'
    );
    chmodSync(realDockerPath, 0o755);
    const proxy = createAaaaOnlyDockerProxy({
      directory,
      host: 'fixture.test.ts.net',
      ipv6Address: 'fd00:172:28::42',
      realDockerPath,
    });

    const result = spawnSync(proxy.executable, ['run', '--rm', 'sha256:image'], {
      encoding: 'utf8',
      env: { ...process.env, ...proxy.environment, CAPTURED_DOCKER_ARGUMENTS: argumentsPath },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(argumentsPath, 'utf8').trim().split('\n')).toEqual([
      'run',
      '--rm',
      '--add-host',
      'fixture.test.ts.net=fd00:172:28::42',
      'sha256:image',
    ]);
  });

  it('passes non-run Docker commands through unchanged', () => {
    const directory = mkdtempSync(join(executableTemporaryDirectory, 'aaaa-only-docker-proxy-'));
    temporaryDirectories.push(directory);
    const argumentsPath = join(directory, 'arguments');
    const realDockerPath = join(directory, 'real-docker');
    writeFileSync(
      realDockerPath,
      '#!/bin/bash\nprintf \'%s\\n\' "$@" > "$CAPTURED_DOCKER_ARGUMENTS"\n',
      'utf8'
    );
    chmodSync(realDockerPath, 0o755);
    const proxy = createAaaaOnlyDockerProxy({
      directory,
      host: 'fixture.test.ts.net',
      ipv6Address: 'fd00:172:28::42',
      realDockerPath,
    });

    const result = spawnSync(proxy.executable, ['network', 'inspect', 'code-worker-net'], {
      encoding: 'utf8',
      env: { ...process.env, ...proxy.environment, CAPTURED_DOCKER_ARGUMENTS: argumentsPath },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(argumentsPath, 'utf8').trim().split('\n')).toEqual([
      'network',
      'inspect',
      'code-worker-net',
    ]);
  });
});
