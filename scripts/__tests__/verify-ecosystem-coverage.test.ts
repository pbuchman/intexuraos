/**
 * Tests for verify-ecosystem-coverage.mjs.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBaseSynthRepo, EMPTY_DRIFT, runScript } from './helpers.js';

interface SynthRepo {
  root: string;
  writeTf(content: string): void;
  writeEcosystem(content: string): void;
  writeApp(name: string, indexContent: string | null): void;
  writeKnownDrift(content: object): void;
}

function createSynthRepo(): SynthRepo {
  const base = createBaseSynthRepo('verify-eco-');
  mkdirSync(join(base.root, 'apps'), { recursive: true });

  return {
    root: base.root,
    writeTf(content) {
      base.writeTf('main.tf', content);
    },
    writeEcosystem(content) {
      writeFileSync(join(base.root, 'ecosystem.config.cjs'), content);
    },
    writeApp(name, indexContent) {
      const dir = join(base.root, 'apps', name, 'src');
      mkdirSync(dir, { recursive: true });
      if (indexContent !== null) {
        writeFileSync(join(dir, 'index.ts'), indexContent);
      }
    },
    writeKnownDrift: base.writeKnownDrift,
  };
}

const run = (root: string) => runScript('verify-ecosystem-coverage.mjs', root);

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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('stale allowlist');
  });

  it('skips apps/web entirely', () => {
    repo.writeTf(`module "x" { source = "../../modules/foo" }\n`);
    repo.writeEcosystem(`module.exports = { apps: [] };\n`);
    repo.writeApp('web', `// no validateRequiredEnv but should be skipped\n`);
    const r = run(repo.root);
    expect(r.status).toBe(0);
  });

  it('parses locals.services entries with NESTED env_vars maps via brace-walker (I3)', () => {
    // The previous regex `[^}]*?\bname` would stop at the FIRST `}` and
    // miss `name` if it appeared after a nested `env_vars = { ... }` block.
    // The brace-walker must handle this.
    repo.writeTf(`
locals {
  services = {
    foo_svc = {
      env_vars = {
        INTEXURAOS_X = "y"
      }
      name = "intexuraos-foo-svc"
    }
  }
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
    const r = run(repo.root);
    expect(r.status).toBe(0);
  });

  it('FAILS LOUDLY when service_name cannot be resolved (I4)', () => {
    // No inline service_name and no matching locals entry → script must
    // exit 1 with a clear "could not resolve" error rather than silently
    // deriving from the module name.
    repo.writeTf(`
module "weird" {
  source = "../../modules/cloud-run-service"
}
`);
    repo.writeEcosystem(`module.exports = { apps: [] };\n`);
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('could not resolve service_name');
    expect(r.stdout + r.stderr).toContain('weird');
  });

  it('reports the EXACT line number of the unresolvable module (N3)', () => {
    repo.writeTf(`
module "weird" {
  source = "../../modules/cloud-run-service"
}
`);
    repo.writeEcosystem(`module.exports = { apps: [] };\n`);
    const r = run(repo.root);
    expect(r.status).toBe(1);
    // module "weird" starts at line 2 (line 1 is empty due to leading \n).
    expect(r.stdout + r.stderr).toContain('main.tf:2');
  });
});
