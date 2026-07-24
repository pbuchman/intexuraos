import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const wrapperPath = resolve(repositoryRoot, 'scripts/run-intex-agent-evals-prod.sh');
const usage =
  'usage: run-intex-agent-evals-prod.sh matrix-corpus [--agent-model=or:minimax/minimax-m3]\n';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('production Intex Agent Matrix corpus wrapper', () => {
  it.each([
    { arguments_: [] },
    { arguments_: ['preflight'] },
    { arguments_: ['matrix-corpus', 'extra'] },
    { arguments_: ['matrix-corpus', '--agent-model=or:google/gemini-3-flash-preview'] },
    { arguments_: ['matrix-corpus', '--agent-model='] },
    { arguments_: ['matrix-corpus', '--agent-model=or:minimax/minimax-m3', 'extra'] },
  ])('rejects every non-canonical argument vector before delegation: %j', ({ arguments_ }) => {
    const result = spawnSync(wrapperPath, arguments_, { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(usage);
  });

  it('delegates the single canonical selector to the hardened Home Dev transport', () => {
    const directory = mkdtempSync(join(tmpdir(), 'intex-agent-evals-prod-wrapper-'));
    temporaryDirectories.push(directory);
    const wrapper = join(directory, 'run-intex-agent-evals-prod.sh');
    const transport = join(directory, 'run-intex-agent-evals-home-dev.sh');
    writeFileSync(wrapper, readFileSync(wrapperPath));
    writeFileSync(transport, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@"\n');
    chmodSync(wrapper, 0o755);
    chmodSync(transport, 0o755);

    const result = spawnSync(wrapper, ['matrix-corpus'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('__production-matrix-corpus\n');
    expect(result.stderr).toBe('');
  });

  it('delegates the explicit MiniMax M3 selector without rewriting it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'intex-agent-evals-prod-wrapper-'));
    temporaryDirectories.push(directory);
    const wrapper = join(directory, 'run-intex-agent-evals-prod.sh');
    const transport = join(directory, 'run-intex-agent-evals-home-dev.sh');
    writeFileSync(wrapper, readFileSync(wrapperPath));
    writeFileSync(transport, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@"\n');
    chmodSync(wrapper, 0o755);
    chmodSync(transport, 0o755);

    const result = spawnSync(wrapper, ['matrix-corpus', '--agent-model=or:minimax/minimax-m3'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('__production-matrix-corpus\n--agent-model=or:minimax/minimax-m3\n');
    expect(result.stderr).toBe('');
  });

  it('is the exact root package command for production acceptance', () => {
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(manifest.scripts?.['eval:intex-agent:matrix-corpus']).toBe(
      'scripts/run-intex-agent-evals-prod.sh matrix-corpus'
    );
  });
});
