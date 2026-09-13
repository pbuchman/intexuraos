# Scripts

Repository utilities for configuration, package publication, deployment,
database maintenance, and CI. Secret-bearing output must always remain outside
the repository in mode-`0600` files.

## Runtime Configuration

Render reviewable non-secret configuration:

```bash
node scripts/render-runtime-config.mjs --environment local --format shell-export
node scripts/render-runtime-config.mjs --environment prod --format dotenv
```

The renderer uses the exact tracked allowlist. It rejects missing, duplicate,
unknown, and secret-classified names.

## Secret Packages

`config/environments/secret-packages.json` defines the exact local/worker (historically `dev`) and PROD
package membership. `config/environments/secret-package-sources.json` permits
only the current base package as an incremental build source.

Build a complete candidate from an exact current version and explicit private
overrides:

```bash
node scripts/build-secret-package.mjs \
  --environment dev \
  --project-id intexuraos-dev-pbuchman \
  --base-version <numeric-version> \
  --override-env NAME=<mode-0600-file> \
  --override-file NAME=<mode-0600-file> \
  --output <mode-0600-candidate>
```

Alternatively provide every manifest member exactly once without a base
version. The builder rejects `latest`, incomplete/duplicate/unknown members,
symlinks, unsafe modes, empty values, and files larger than 64 KiB.

Validate, publish, fetch, or render one exact version:

```bash
node scripts/secret-package.mjs validate \
  --environment dev --payload-file <candidate>
node scripts/secret-package.mjs publish \
  --environment dev --project-id intexuraos-dev-pbuchman \
  --payload-file <candidate> --receipt-file <private-receipt>
node scripts/secret-package.mjs fetch \
  --environment dev --version <numeric-version> \
  --project-id intexuraos-dev-pbuchman --output <mode-0600-file>
node scripts/secret-package.mjs render \
  --environment dev --version <numeric-version> \
  --project-id intexuraos-dev-pbuchman --output-dir <private-directory>
```

All commands validate schema, environment, exact membership, string/file
shape, CRC32C, permissions, and numeric versions. Output is limited to safe
metadata and counts. Package values never enter Terraform state or Git.

Verify tracked contracts:

```bash
pnpm run verify:secret-packages
```

See [Secret Packages Operations](../docs/operations/secret-packages.md).

## Home Dev Package Projection

Render one exact DEV version:

```bash
SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS="${HOME}/.config/intexuraos/secret-renderer-sa-key.json" \
  ./scripts/sync-secrets.sh --version <numeric-version>
```

The renderer atomically installs mode-`0600` `.envrc` and the approved private
files, deletes superseded local renders, and never reads individual Secret
Manager containers. The renderer credential is selected only for this command
and is not exported to runtime.

The DEV projection root is application-managed and must never be passed to
generic `secret-package render`; use a separate private scratch directory for
generic rendering.

Generate the strict orchestrator environment only after the package render:

```bash
node scripts/generate-orchestrator-env.mjs \
  --output "${HOME}/.code-orchestrator/env" \
  --user-home "${HOME}"
```

The generator pins the Home Dev orchestrator Code Agent base and usage webhook
to exact production endpoints. It ignores inherited localhost or DEV URLs;
`INTEXURAOS_ENVIRONMENT=dev` and `INTEXURAOS_RUNTIME=dev` remain audited legacy
host/observability tags, not routing inputs.

Production routing is covered by focused tests for generated worker callbacks,
Matrix configuration, strict worker secret projection, and the real production
web deployment environment. Matrix edge validation belongs to `pbuchman-dev`,
which owns the static Caddy fragment.

Build the Alloy projection without direct GCP access:

```bash
sudo -n env \
  HOME=/home/pbuchman \
  SECRET_PACKAGE_RENDER_DIR=/home/pbuchman/.config/intexuraos/secret-packages/dev \
  INTEXURAOS_ENVIRONMENT=dev \
  bash scripts/observability/load-grafana-cloud-env.sh
```

## Production Deployment

`scripts/hetzner/github-actions-deploy.sh` deploys the exact GitHub Actions SHA
and exact protected package version. It validates an isolated secret candidate
while the current runtime remains online, then stops PM2 and Alloy, publishes
the admitted package, installs static web and code, starts services, writes the
deployment attestation, verifies health, and retains existing code and web
artifacts for recovery. It does not prune code or web releases; storage cleanup
is a separate deliberate maintenance operation.

The production loader may run manually only while PM2 and Alloy are stopped:

```bash
sudo -n INTEXURAOS_ENVIRONMENT=prod \
  bash scripts/hetzner/load-secrets.sh --version <numeric-version>
```

It publishes a complete stable projection and has no partial activation or
secret rollback mode. `--validate-only` renders and checks an isolated candidate
without changing active files. A publication failure leaves services stopped
for a fix-forward repair.

## Runtime Ownership

Production runs on Hetzner. Use `pnpm dev` for a manually started localhost stack.
Home Dev retains the production-serving orchestrator and workers; it has no
hosted application DEV, public DEV edge, or application autostart.
The host repository `pbuchman-dev` owns Caddy and the static production Matrix
fragment at `machine-setup/config/matrix-outbound.caddy`.

## Connection Verification

```bash
./scripts/verify-connections.sh
```

Checks Git/GitHub, GCP identity, repository secret hygiene, and branch state.

## CI

```bash
pnpm run ci
pnpm run ci:tracked
./scripts/ci-capture.sh
```

- `ci.mjs`: full repository CI pipeline.
- `ci-tracked.mjs`: compatibility alias for the full repository CI pipeline.
- `ci-capture.sh`: captures output to a private temporary file.

## Builds And Deployments

- `build-service.mjs <service>`: bundle one service.
- `build-all-services.mjs`: bundle all deployable services.
- `build-worker-image.sh [tag]`: build and push the code-worker image.
- `push-missing-images.sh`: build images missing from Artifact Registry.
- `deploy-workers.sh [worker|--all]`: deploy retained function workers.
- `setup-worker-network.sh`: validate/create the code-worker Docker network.

Artifact Registry cleanup tools live under `scripts/artifact-registry/`; see
[Artifact Registry Cleanup](../docs/operations/artifact-registry-cleanup.md).

## Development

- `dev-setup.mjs`: start local emulators and validate the environment.
- `pm2-wait-start.mjs`: wait for a dependency health endpoint.
- `pubsub-publish-test.mjs`: publish local test events.
- `test-llm-clients.ts <userId>`: exercise allowed LLM routes with user-service
  credentials.

## Firestore

```bash
node scripts/migrate.mjs
node scripts/migrate.mjs --status
node scripts/migrate.mjs --dry-run
node scripts/migrate.mjs --write-artifacts-only
```

`generate-firestore-config.mjs` regenerates tracked rules and indexes from the
migration set.

## Static Verification

The `verify-*.mjs` scripts enforce repository invariants for boundaries,
configuration, environment mappings, Firestore ownership, generated artifacts,
hash routing, LLM architecture, logging, migrations, secret packages, and
source hygiene. They run through CI and should also be used as focused checks
for the changed area.
