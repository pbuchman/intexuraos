import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const APPLY_PLAN_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'artifact-registry',
  'apply-prune-plan.mjs'
);

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-registry-cli-'));
  tempDirs.push(dir);
  return dir;
}

function writePlan(dir: string, plan: object): string {
  const planPath = path.join(dir, 'prune-plan.json');
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return planPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('artifact registry cleanup CLI', () => {
  it('prints delete commands without executing by default', () => {
    const dir = makeTempDir();
    const executionLogPath = path.join(dir, 'executed.log');
    const fakeGcloudPath = path.join(dir, 'gcloud');
    fs.writeFileSync(
      fakeGcloudPath,
      `#!/usr/bin/env bash\necho "$*" >> "${executionLogPath}"\nexit 0\n`,
      'utf8'
    );
    fs.chmodSync(fakeGcloudPath, 0o755);

    const planPath = writePlan(dir, {
      deleteDigestCount: 1,
      deletePackageCount: 1,
      generatedAt: '2026-05-07T12:00:00.000Z',
      keepCount: 3,
      packageDecisions: [
        {
          deleteDigests: ['sha256:dead-a'],
          keepDigests: [],
          packageName: 'claude-worker',
          status: 'retired',
        },
      ],
      protectedDigests: [],
      repository: 'intexuraos-dev',
      retiredPackages: ['claude-worker'],
    });

    const result = spawnSync(process.execPath, [APPLY_PLAN_PATH, `--plan=${planPath}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'gcloud artifacts docker images delete europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker@sha256:dead-a --delete-tags --quiet'
    );
    expect(fs.existsSync(executionLogPath)).toBe(false);
  });

  it('refuses to execute a plan that deletes a protected digest', () => {
    const dir = makeTempDir();
    const planPath = writePlan(dir, {
      deleteDigestCount: 1,
      deletePackageCount: 1,
      generatedAt: '2026-05-07T12:00:00.000Z',
      keepCount: 3,
      packageDecisions: [
        {
          deleteDigests: ['sha256:protected'],
          keepDigests: [],
          packageName: 'code-worker',
          status: 'active',
        },
      ],
      protectedDigests: ['sha256:protected'],
      repository: 'intexuraos-dev',
      retiredPackages: [],
    });

    const result = spawnSync(
      process.execPath,
      [APPLY_PLAN_PATH, `--plan=${planPath}`, '--scope=all', '--execute'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to delete protected digest');
  });
});
