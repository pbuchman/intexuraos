/**
 * Tests for verify-terraform-secret-mounts.mjs.
 */

import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBaseSynthRepo, EMPTY_DRIFT, runScript } from './helpers.js';

const run = (root: string) => runScript('verify-terraform-secret-mounts.mjs', root);

describe('verify-terraform-secret-mounts', () => {
  let repo: ReturnType<typeof createBaseSynthRepo>;

  beforeEach(() => {
    repo = createBaseSynthRepo('verify-secrets-');
    repo.writeKnownDrift(EMPTY_DRIFT);
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  it('exits 0 when there are no secrets declared', () => {
    repo.writeTf('main.tf', `module "x" { source = "../../modules/foo" }\n`);
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_ORPHAN');
  });

  it('reports the EXACT line number of the orphan declaration (N3, I5)', () => {
    // Line 1: module "secret_manager" {
    // Line 2: source
    // Line 3: secrets = {
    // Line 4: "INTEXURAOS_ORPHAN" = "desc"   ←
    // Line 5: }
    // Line 6: }
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
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('main.tf:4');
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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
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
    const r = run(repo.root);
    expect(r.status).toBe(0);
  });

  it('does NOT honor an inline-ignore string embedded in the value (B1)', () => {
    // The ignore-looking text is INSIDE the value's string literal.
    // It must not suppress drift.
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_STRING_EMBEDDED" = "// verify-terraform-secret-mounts:ignore = bogus"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_STRING_EMBEDDED');
  });

  it('matches the secret-manager module by SOURCE, not by name (B3)', () => {
    // The "real" secret-manager module is named differently. Another module
    // with the literal name "secret_manager" but a DIFFERENT source must
    // NOT be treated as the secret-manager module — and since it has a
    // `secrets = { ... }` block, those keys must be treated as MOUNTED, not
    // declared.
    repo.writeTf(
      'main.tf',
      `module "real_secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_REAL" = "desc"
  }
}

module "secret_manager" {
  source = "../../modules/cloud-run-service"
  secrets = {
    INTEXURAOS_REAL = "mounted-here"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(0);
  });

  it('skips heredoc bodies during brace tracking (I1)', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  startup = <<EOT
  echo hello }
  EOT
  secrets = {
    "INTEXURAOS_HEREDOC_ORPHAN" = "desc"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_HEREDOC_ORPHAN');
  });

  it('counts secrets referenced via local.services.<key>.secret_refs list (Subtask E forward-compat)', () => {
    // Subtask E Contract 2 declares `secret_refs = ["INTEXURAOS_X", ...]` as
    // the per-service list of mounted secret names inside `local.services.<key>`.
    // The script MUST harvest these list entries as mounted.
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_FOO" = "desc"
  }
}

locals {
  services = {
    foo = {
      name        = "intexuraos-foo"
      secret_refs = ["INTEXURAOS_FOO"]
    }
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(0);
  });

  it('flags a declared secret absent from secret_refs lists AND any secrets {} block (Subtask E forward-compat)', () => {
    // The secret is declared but appears in NO `secret_refs = [...]` list and
    // NO `secrets = { ... }` block. Must be reported as orphan.
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    "INTEXURAOS_UNREFERENCED" = "desc"
  }
}

locals {
  services = {
    foo = {
      name        = "intexuraos-foo"
      secret_refs = ["INTEXURAOS_OTHER"]
    }
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_UNREFERENCED');
  });

  it('does not enter heredoc mode when <<EOT marker is inside a string literal (I1 string-mask)', () => {
    // The first line contains `<<EOT` INSIDE a quoted string. Heredoc detection
    // must run on the string-masked line so this does NOT enter heredoc mode.
    // If it did, the secrets block below would be eaten as opaque heredoc body
    // and the orphan declaration would be missed.
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  description = "uses <<EOT marker"
  secrets = {
    "INTEXURAOS_AFTER_FAKE_HEREDOC" = "desc"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_AFTER_FAKE_HEREDOC');
  });

  it('strips HCL line comments before brace tracking (I2)', () => {
    repo.writeTf(
      'main.tf',
      `module "secret_manager" {
  source = "../../modules/secret-manager"
  secrets = {
    # "INTEXURAOS_COMMENTED_OUT" = "old" }
    "INTEXURAOS_AFTER_COMMENT" = "desc"
  }
}
`
    );
    const r = run(repo.root);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('INTEXURAOS_AFTER_COMMENT');
  });
});
