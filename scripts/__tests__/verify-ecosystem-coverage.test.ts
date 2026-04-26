/**
 * Tests for verify-ecosystem-coverage.mjs.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'verify-ecosystem-coverage.mjs');

interface SynthRepo {
  root: string;
  writeTf(content: string): void;
  writeEcosystem(content: string): void;
  writeApp(name: string, indexContent: string | null): void;
  writeKnownDrift(content: object): void;
}

function createSynthRepo(): SynthRepo {
  const root = mkdtempSync(join(tmpdir(), 'verify-eco-'));
  mkdirSync(join(root, 'terraform', 'environments', 'dev'), { recursive: true });
  mkdirSync(join(root, 'apps'), { recursive: true });
  mkdirSync(join(root, 'scripts', '__fixtures__'), { recursive: true });

  return {
    root,
    writeTf(content) {
      writeFileSync(join(root, 'terraform', 'environments', 'dev', 'main.tf'), content);
    },
    writeEcosystem(content) {
      writeFileSync(join(root, 'ecosystem.config.cjs'), content);
    },
    writeApp(name, indexContent) {
      const dir = join(root, 'apps', name, 'src');
      mkdirSync(dir, { recursive: true });
      if (indexContent !== null) {
        writeFileSync(join(dir, 'index.ts'), indexContent);
      }
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

describe('verify-ecosystem-coverage', () => {
  let repo: SynthRepo;

  beforeEach(() => {
    repo = createSynthRepo();
    repo.writeKnownDrift(EMPTY_DRIFT);
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  it('exits 0 when there are no Cloud Run services', () => {
    repo.writeTf(`module "x" { source = "../../modules/foo" }\n`);
    repo.writeEcosystem(`module.exports = { apps: [] };\n`);
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 0 when every service is in ecosystem and has validateRequiredEnv', () => {
    repo.writeTf(`
locals {
  services = { foo_svc = { name = "intexuraos-foo-svc" } }
}
module "foo_svc" {
  source = "../../modules/cloud-run-service"
  service_name = local.services.foo_svc.name
}
`);
    repo.writeEcosystem(`module.exports = {
  apps: [createServiceConfig('foo-svc', 8080)],
};
`);
    repo.writeApp('foo-svc', `validateRequiredEnv(['X']);\n`);
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 1 when service is missing from ecosystem', () => {
    repo.writeTf(`
locals {
  services = { foo_svc = { name = "intexuraos-foo-svc" } }
}
module "foo_svc" {
  source = "../../modules/cloud-run-service"
  service_name = local.services.foo_svc.name
}
`);
    repo.writeEcosystem(`module.exports = { apps: [] };\n`);
    repo.writeApp('foo-svc', `validateRequiredEnv(['X']);\n`);
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('intexuraos-foo-svc');
  });

  it('exits 0 when ecosystem-missing service is allowlisted', () => {
    repo.writeTf(`
locals {
  services = { foo_svc = { name = "intexuraos-foo-svc" } }
}
module "foo_svc" {
  source = "../../modules/cloud-run-service"
  service_name = local.services.foo_svc.name
}
`);
    repo.writeEcosystem(`module.exports = { apps: [] };\n`);
    repo.writeApp('foo-svc', `validateRequiredEnv(['X']);\n`);
    repo.writeKnownDrift({
      ...EMPTY_DRIFT,
      ecosystemCoverage: {
        missingEcosystemEntry: { 'intexuraos-foo-svc': 'INT-X reason' },
        missingValidateRequiredEnv: {},
      },
    });
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 1 when validateRequiredEnv is missing in app index.ts', () => {
    repo.writeTf(`
locals {
  services = { foo_svc = { name = "intexuraos-foo-svc" } }
}
module "foo_svc" {
  source = "../../modules/cloud-run-service"
  service_name = local.services.foo_svc.name
}
`);
    repo.writeEcosystem(`module.exports = {
  apps: [createServiceConfig('foo-svc', 8080)],
};
`);
    repo.writeApp('foo-svc', `// no validation\n`);
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('apps/foo-svc');
  });

  it('exits 0 when validateRequiredEnv miss is allowlisted', () => {
    repo.writeTf(`
locals {
  services = { foo_svc = { name = "intexuraos-foo-svc" } }
}
module "foo_svc" {
  source = "../../modules/cloud-run-service"
  service_name = local.services.foo_svc.name
}
`);
    repo.writeEcosystem(`module.exports = {
  apps: [createServiceConfig('foo-svc', 8080)],
};
`);
    repo.writeApp('foo-svc', `// no validation\n`);
    repo.writeKnownDrift({
      ...EMPTY_DRIFT,
      ecosystemCoverage: {
        missingEcosystemEntry: {},
        missingValidateRequiredEnv: { 'apps/foo-svc': 'INT-X reason' },
      },
    });
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });

  it('exits 1 with stale allowlist (ecosystem entry now exists)', () => {
    repo.writeTf(`
locals {
  services = { foo_svc = { name = "intexuraos-foo-svc" } }
}
module "foo_svc" {
  source = "../../modules/cloud-run-service"
  service_name = local.services.foo_svc.name
}
`);
    repo.writeEcosystem(`module.exports = {
  apps: [createServiceConfig('foo-svc', 8080)],
};
`);
    repo.writeApp('foo-svc', `validateRequiredEnv(['X']);\n`);
    repo.writeKnownDrift({
      ...EMPTY_DRIFT,
      ecosystemCoverage: {
        missingEcosystemEntry: { 'intexuraos-foo-svc': 'stale' },
        missingValidateRequiredEnv: {},
      },
    });
    const r = runScript(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('stale allowlist');
  });

  it('skips apps/web entirely', () => {
    repo.writeTf(`module "x" { source = "../../modules/foo" }\n`);
    repo.writeEcosystem(`module.exports = { apps: [] };\n`);
    repo.writeApp('web', `// no validateRequiredEnv but should be skipped\n`);
    const r = runScript(repo.root);
    expect(r.status).toBe(0);
  });
});
