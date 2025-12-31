# Scripts

Build, deployment, and utility scripts.

## populate-secrets.sh

Interactive script to populate GCP Secret Manager secrets from Terraform configuration.

```bash
# Run from repository root
./scripts/populate-secrets.sh [environment]

# Examples:
./scripts/populate-secrets.sh      # uses dev environment
./scripts/populate-secrets.sh dev  # explicit dev
```

The script:

1. Extracts all `INTEXURAOS_*` secret names from `terraform/environments/<env>/main.tf`
2. Prompts for each secret value (sensitive values like tokens/secrets are hidden)
3. Skips secrets that already have values (with option to overwrite)
4. Outputs all populated secrets at the end (save this output!)

Prerequisites:

- gcloud CLI installed and authenticated
- Project configured: `gcloud config set project <PROJECT_ID>`
- Terraform applied: secrets must exist before populating values

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

- `sync-secrets.sh` - Sync secrets between environments
- `verify-boundaries.mjs` - Verify package import boundaries
- `verify-common.mjs` - Verify common package constraints
- `verify-package-json.mjs` - Verify package.json consistency
