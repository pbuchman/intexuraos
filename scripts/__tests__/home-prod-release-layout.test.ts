import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const deploySource = readFileSync(
  resolve(process.cwd(), 'scripts/home-prod/deploy-release.sh'),
  'utf8'
);

describe('Home PROD immutable code release layout', () => {
  it('installs at the final unique attempt path so pnpm bin links survive activation', () => {
    const root = mkdtempSync(join(tmpdir(), 'home-prod-pnpm-layout-'));
    const sha = 'a'.repeat(40);
    const attempt = join(root, 'releases', `${sha}.attempt`);
    const tool = join(attempt, 'packages', 'tool');
    mkdirSync(tool, { recursive: true });
    writeFileSync(join(attempt, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(
      join(attempt, 'package.json'),
      JSON.stringify({ private: true, devDependencies: { fixtureTool: 'workspace:*' } })
    );
    writeFileSync(
      join(tool, 'package.json'),
      JSON.stringify({ name: 'fixtureTool', version: '1.0.0', bin: { fixtureTool: 'cli.js' } })
    );
    writeFileSync(
      join(tool, 'cli.js'),
      "#!/usr/bin/env node\nprocess.stdout.write('tool-ok\\n');\n"
    );
    chmodSync(join(tool, 'cli.js'), 0o755);

    const install = spawnSync('pnpm', ['install', '--offline', '--lockfile=false'], {
      cwd: attempt,
      encoding: 'utf8',
    });
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
    const current = join(root, 'current');
    symlinkSync(attempt, current);
    const run = spawnSync('pnpm', ['exec', 'fixtureTool'], { cwd: current, encoding: 'utf8' });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain('tool-ok');
    expect(realpathSync(current)).toBe(realpathSync(attempt));
    expect(deploySource).toContain('mktemp -d "${CODE_RELEASES_ROOT}/${TARGET_SHA}.XXXXXX"');
    expect(deploySource).not.toContain('mv -T "${STAGING_RELEASE}"');
    rmSync(root, { recursive: true });
  });
});
