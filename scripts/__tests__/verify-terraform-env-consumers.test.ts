/**
 * Tests for verify-terraform-env-consumers.mjs.
 *
 * Builds synthetic repo trees in os.tmpdir(), invokes the script via spawnSync
 * with INTEXURAOS_VERIFY_REPO_ROOT pointing at the synthetic root, and asserts
 * exit code + output.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBaseSynthRepo, EMPTY_DRIFT, runScript } from './helpers.js';

interface SynthRepo {
  root: string;
  writeTf(filename: string, content: string): void;
  writeApp(relPath: string, content: string): void;
  writeKnownDrift(content: object): void;
}

function createSynthRepo(): SynthRepo {
  const base = createBaseSynthRepo('verify-tf-env-');
  mkdirSync(join(base.root, 'apps'), { recursive: true });
  mkdirSync(join(base.root, 'workers'), { recursive: true });

  return {
    root: base.root,
    writeTf: base.writeTf,
    writeApp(relPath, content) {
      const fullPath = join(base.root, 'apps', relPath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    },
    writeKnownDrift: base.writeKnownDrift,
  };
}

const run = (root: string) => runScript('verify-terraform-env-consumers.mjs', root);

describe('verify-terraform-env-consumers', () => {
  let repo: SynthRepo;

  beforeEach(() => {
    repo = createSynthRepo();
    repo.writeKnownDrift(EMPTY_DRIFT);
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  it('exits 0 when there are no env_vars in Terraform', () => {
    repo.writeTf('main.tf', `module "x" { source = "../../modules/foo" }\n`);
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_ORPHAN');
    expect(r.stdout + r.stderr).toContain('main.tf');
  });

  it('reports the EXACT line number of an orphan env var (N3)', () => {
    repo.writeTf(
      'main.tf',
      // Line 1: module
      // Line 2: source
      // Line 3: env_vars
      // Line 4: INTEXURAOS_ORPHAN ←
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    INTEXURAOS_ORPHAN = "bar"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('main.tf:4');
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
      ...EMPTY_DRIFT,
      terraformEnvConsumers: { INTEXURAOS_ORPHAN: 'INT-1536 reason' },
    });
    const r = run(repo.root);
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
      ...EMPTY_DRIFT,
      terraformEnvConsumers: { INTEXURAOS_FOO: 'INT-1536 stale' },
    });
    const r = run(repo.root);
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
    const r = run(repo.root);
    expect(r.status).toBe(0);
  });

  it('does NOT honor an inline-ignore comment that is embedded inside a string literal (B1)', () => {
    // The ignore-looking text lives INSIDE the value's string literal — it
    // must not suppress the drift. The variable has no consumer.
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    INTEXURAOS_STRING_EMBEDDED = "// verify-terraform-env-consumers:ignore = bogus"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_STRING_EMBEDDED');
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
    const r = run(repo.root);
    expect(r.status).toBe(0);
  });

  it('extracts per-service env_vars nested under locals.services.<key>.env_vars (B2)', () => {
    // The module body has NO inline env_vars — env_vars are defined per-service
    // inside locals.services.<key>.env_vars. The extractor must still pick them up.
    repo.writeTf(
      'services.tf',
      `locals {
  services = {
    foo = {
      name     = "intexuraos-foo"
      env_vars = {
        INTEXURAOS_PER_SVC = "x"
      }
    }
  }
}
`
    );
    repo.writeTf(
      'main.tf',
      `module "foo" {
  source   = "../../modules/cloud-run-service"
  for_each = local.services
  service_name = each.value.name
}
`
    );
    // No consumer → drift, but the variable IS extracted (we expect it in output).
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_PER_SVC');
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
    const r = run(repo.root);
    expect(r.status).toBe(1);
    const out = r.stdout + r.stderr;
    expect(out).toContain('INTEXURAOS_COMMON_ORPHAN');
    expect(out).toContain('INTEXURAOS_LOCAL_ORPHAN');
  });

  it('skips heredoc bodies during brace tracking (I1)', () => {
    // The heredoc body contains a stray `}` that, if counted, would
    // prematurely close the env_vars block and cause the LATER orphan to be
    // missed.
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  startup_script = <<EOT
  echo hello }
  EOT
  env_vars = {
    INTEXURAOS_HEREDOC_ORPHAN = "x"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_HEREDOC_ORPHAN');
  });

  it('strips HCL line comments before brace tracking (I2)', () => {
    // The commented-out `}` would, if literally counted, close the env_vars
    // block and cause the later declaration to be missed.
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  env_vars = {
    # INTEXURAOS_COMMENTED_OUT = "old" }
    INTEXURAOS_AFTER_COMMENT = "x"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_AFTER_COMMENT');
  });

  it('extracts extra_env_vars nested under locals.services.<key>.extra_env_vars (Subtask E forward-compat)', () => {
    // Subtask E Contract 2 names the per-service field `extra_env_vars`.
    // The module body has NO inline env_vars — variables are defined per-service
    // inside locals.services.<key>.extra_env_vars. The extractor MUST pick them up.
    repo.writeTf(
      'services.tf',
      `locals {
  services = {
    foo = {
      name           = "intexuraos-foo"
      extra_env_vars = {
        INTEXURAOS_FROM_EXTRA = "x"
      }
    }
  }
}
`
    );
    repo.writeTf(
      'main.tf',
      `module "foo" {
  source       = "../../modules/cloud-run-service"
  for_each     = local.services
  service_name = each.value.name
}
`
    );
    // No consumer → drift, but the variable IS extracted (we expect it in output).
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_FROM_EXTRA');
  });

  it('does not enter heredoc mode when <<EOT marker is inside a string literal (I1 string-mask)', () => {
    // The first line contains `<<EOT` INSIDE a quoted string. Heredoc detection
    // must run on the string-masked line so this does NOT enter heredoc mode.
    // If it did, the env_vars block below would be eaten as opaque heredoc body
    // and the orphan declaration would be missed.
    repo.writeTf(
      'main.tf',
      `module "svc" {
  source = "../../modules/cloud-run-service"
  description = "uses <<EOT marker"
  env_vars = {
    INTEXURAOS_AFTER_FAKE_HEREDOC = "x"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_AFTER_FAKE_HEREDOC');
  });

  it('reports "checked N" rather than "All N covered" in the success message (N4)', () => {
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
    const r = run(repo.root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('checked');
    expect(r.stdout).not.toContain('have a code consumer');
  });
});
