/**
 * Tests for verify-terraform-env-consumers.mjs.
 *
 * Builds synthetic repo trees in os.tmpdir(), invokes the script via spawnSync
 * with INTEXURAOS_VERIFY_REPO_ROOT pointing at the synthetic root, and asserts
 * exit code + output.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'verify-terraform-env-consumers.mjs');

interface SynthRepo {
  root: string;
  writeTf(filename: string, content: string): void;
  writeApp(relPath: string, content: string): void;
  writeKnownDrift(content: object): void;
}

function createSynthRepo(): SynthRepo {
  const root = mkdtempSync(join(tmpdir(), 'verify-tf-env-'));
  mkdirSync(join(root, 'terraform', 'environments', 'dev'), { recursive: true });
  mkdirSync(join(root, 'apps'), { recursive: true });
  mkdirSync(join(root, 'workers'), { recursive: true });
  mkdirSync(join(root, 'scripts', '__fixtures__'), { recursive: true });

  return {
    root,
    writeTf(filename, content) {
      writeFileSync(join(root, 'terraform', 'environments', 'dev', filename), content);
    },
    writeApp(relPath, content) {
      const fullPath = join(root, 'apps', relPath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    },
    writeKnownDrift(content) {
      writeFileSync(
        join(root, 'scripts', '__fixtures__', 'known-drift.json'),
        JSON.stringify(content, null, 2)
      );
    },
  };
}

function runScript(repoRoot: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf8',
    env: { ...process.env, INTEXURAOS_VERIFY_REPO_ROOT: repoRoot },
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('verify-terraform-env-consumers', () => {
  let repo: SynthRepo;

  beforeEach(() => {
    repo = createSynthRepo();
    repo.writeKnownDrift({
      terraformEnvConsumers: {},
      ecosystemCoverage: { missingEcosystemEntry: {}, missingValidateRequiredEnv: {} },
      terraformSecretMounts: {},
    });
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  it('exits 0 when there are no env_vars in Terraform', () => {
    repo.writeTf('main.tf', `module "x" { source = "../../modules/foo" }\n`);
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 0 when every env var has a consumer', () => {
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    INTEXURAOS_FOO = "bar"
  }
}
`
    );
    mkdirSync(join(repo.root, 'apps', 'svc', 'src'), { recursive: true });
    writeFileSync(
      join(repo.root, 'apps', 'svc', 'src', 'index.ts'),
      `const x = process.env.INTEXURAOS_FOO;\n`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 1 with descriptive message when there is unallowlisted drift', () => {
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    INTEXURAOS_ORPHAN = "bar"
  }
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_ORPHAN');
    expect(r.stdout + r.stderr).toContain('main.tf');
  });

  it('exits 0 when drift is in the allowlist', () => {
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    INTEXURAOS_ORPHAN = "bar"
  }
}
`
    );
    repo.writeKnownDrift({
      terraformEnvConsumers: { INTEXURAOS_ORPHAN: 'INT-1536 reason' },
      ecosystemCoverage: { missingEcosystemEntry: {}, missingValidateRequiredEnv: {} },
      terraformSecretMounts: {},
    });
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 1 when an allowlisted entry is no longer drifting (stale allowlist)', () => {
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    INTEXURAOS_FOO = "bar"
  }
}
`
    );
    mkdirSync(join(repo.root, 'apps', 'svc', 'src'), { recursive: true });
    writeFileSync(
      join(repo.root, 'apps', 'svc', 'src', 'index.ts'),
      `const x = process.env.INTEXURAOS_FOO;\n`
    );
    repo.writeKnownDrift({
      terraformEnvConsumers: { INTEXURAOS_FOO: 'INT-1536 stale' },
      ecosystemCoverage: { missingEcosystemEntry: {}, missingValidateRequiredEnv: {} },
      terraformSecretMounts: {},
    });
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('stale allowlist');
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_FOO');
  });

  it('honors inline :ignore = reason comments on the env_var line', () => {
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    INTEXURAOS_INLINE_IGNORE = "bar" // verify-terraform-env-consumers:ignore = INT-X
  }
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('parses for_each = local.services shape AND inline module shape', () => {
    repo.writeTf(
      'services.tf',
      `locals {
  common_service_env_vars = {
    INTEXURAOS_COMMON = "bar"
  }
  services = {
    foo = { name = "intexuraos-foo" }
  }
}
`
    );
    repo.writeTf(
      'main.tf',
      `module "foo" {
  source = "../../modules/cloud-run-service"
  for_each = local.services
  env_vars = merge(local.common_service_env_vars, {
    INTEXURAOS_INLINE = "x"
  })
}
`
    );
    mkdirSync(join(repo.root, 'apps', 'foo', 'src'), { recursive: true });
    writeFileSync(
      join(repo.root, 'apps', 'foo', 'src', 'index.ts'),
      `const a = process.env.INTEXURAOS_COMMON; const b = process.env.INTEXURAOS_INLINE;\n`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('reports both env vars from merge() correctly', () => {
    repo.writeTf(
      'main.tf',
      `locals {
  common_service_env_vars = {
    INTEXURAOS_COMMON_ORPHAN = "bar"
  }
}

module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = merge(local.common_service_env_vars, {
    INTEXURAOS_LOCAL_ORPHAN = "x"
  })
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    const out = r.stdout + r.stderr;
    expect(out).toContain('INTEXURAOS_COMMON_ORPHAN');
    expect(out).toContain('INTEXURAOS_LOCAL_ORPHAN');
  });
});
