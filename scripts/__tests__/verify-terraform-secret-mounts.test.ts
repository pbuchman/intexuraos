/**
 * Tests for verify-terraform-secret-mounts.mjs.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'verify-terraform-secret-mounts.mjs');

interface SynthRepo {
  root: string;
  writeTf(filename: string, content: string): void;
  writeKnownDrift(content: object): void;
}

function createSynthRepo(): SynthRepo {
  const root = mkdtempSync(join(tmpdir(), 'verify-secrets-'));
  mkdirSync(join(root, 'terraform', 'environments', 'dev'), { recursive: true });
  mkdirSync(join(root, 'scripts', '__fixtures__'), { recursive: true });

  return {
    root,
    writeTf(filename, content) {
      writeFileSync(join(root, 'terraform', 'environments', 'dev', filename), content);
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

const EMPTY_DRIFT = {
  terraformEnvConsumers: {},
  ecosystemCoverage: { missingEcosystemEntry: {}, missingValidateRequiredEnv: {} },
  terraformSecretMounts: {},
};

describe('verify-terraform-secret-mounts', () => {
  let repo: SynthRepo;

  beforeEach(() => {
    repo = createSynthRepo();
    repo.writeKnownDrift(EMPTY_DRIFT);
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  it('exits 0 when there are no secrets declared', () => {
    repo.writeTf('main.tf', `module "x" { source = "../../modules/foo" }\n`);
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 0 when every secret is mounted by some service', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_FOO" = "desc"
  }
}

module "svc" {
  source = "../../modules/cloud-run-service"
  secrets = {
    INTEXURAOS_FOO = module.secret_manager.secret_ids["INTEXURAOS_FOO"]
  }
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 1 when a secret is orphaned (no mount)', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_ORPHAN" = "desc"
  }
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_ORPHAN');
  });

  it('exits 0 when an orphan is in the allowlist', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_ORPHAN" = "desc"
  }
}
`
    );
    repo.writeKnownDrift({
      ...EMPTY_DRIFT,
      terraformSecretMounts: { INTEXURAOS_ORPHAN: 'INT-X reason' },
    });
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 1 with stale allowlist (orphan is now mounted)', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_FOO" = "desc"
  }
}

module "svc" {
  source = "../../modules/cloud-run-service"
  secrets = {
    INTEXURAOS_FOO = module.secret_manager.secret_ids["INTEXURAOS_FOO"]
  }
}
`
    );
    repo.writeKnownDrift({
      ...EMPTY_DRIFT,
      terraformSecretMounts: { INTEXURAOS_FOO: 'INT-X stale' },
    });
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('stale allowlist');
  });

  it('counts secrets via local.common_service_secrets membership', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_FOO" = "desc"
  }
}

locals {
  common_service_secrets = {
    INTEXURAOS_FOO = module.secret_manager.secret_ids["INTEXURAOS_FOO"]
  }
}

module "svc" {
  source = "../../modules/cloud-run-service"
  secrets = local.common_service_secrets
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('counts secrets in cloud-function modules', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_FN_SECRET" = "desc"
  }
}

module "function_foo" {
  source = "../../modules/cloud-function"
  secrets = {
    INTEXURAOS_FN_SECRET = module.secret_manager.secret_ids["INTEXURAOS_FN_SECRET"]
  }
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('honors inline :ignore comments on the secret declaration', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_INLINE_IGNORE" = "desc" // verify-terraform-secret-mounts:ignore = INT-X
  }
}
`
    );
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });
});
