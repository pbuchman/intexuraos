# Scripts

Build, deployment, and utility scripts.

## sync-secrets.sh

Single entrypoint for local secrets workflow.

```bash
# Run from repository root
./scripts/sync-secrets.sh [environment]

# Examples:
./scripts/sync-secrets.sh                  # sync only (non-interactive)
./scripts/sync-secrets.sh dev              # explicit environment
./scripts/sync-secrets.sh --add-new        # sync + prompt for missing values
./scripts/sync-secrets.sh dev --add-new    # env-specific add-new mode
```

Mode 1: default (non-interactive)

1. Reads Terraform-defined `INTEXURAOS_*` secrets from `terraform/environments/<env>/main.tf`
2. Syncs readable/exportable secrets from GCP Secret Manager into `.envrc`
3. Prints missing/unreadable secrets (no prompts)

Mode 2: `--add-new` (interactive)

1. Runs the same sync flow as default mode
2. Prompts only for missing secret values (no overwrite flow)
3. Re-syncs `.envrc` after successful additions

Prerequisites:

- gcloud CLI installed and authenticated
- Project configured (or provided with `--project-id`)
- Terraform applied (secret resources must exist before adding versions)

## verify-connections.sh

Verification script for Claude Code cloud development setup.

```bash
# Run from repository root
./scripts/verify-connections.sh
```

The script verifies:

1. GitHub/Git connectivity
2. GCP service account configuration
3. Security (gitignore verification)
4. Current branch status

See [docs/setup/10-claude-code-cloud-dev.md](../docs/setup/10-claude-code-cloud-dev.md) for full setup guide.

## Other Scripts

- `sync-secrets.sh` - Sync `.envrc` from Secret Manager and optionally add missing values
- `verify-boundaries.mjs` - Verify package import boundaries
- `verify-common.mjs` - Verify common package constraints
- `verify-package-json.mjs` - Verify package.json consistency
