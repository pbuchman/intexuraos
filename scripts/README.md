# Scripts

Repository utilities for configuration, package publication, deployment,
database maintenance, and CI. Secret-bearing output must always remain outside
the repository in mode-`0600` files.

## Runtime Configuration

Render reviewable non-secret configuration:

```bash
node scripts/render-runtime-config.mjs --environment dev --format shell-export
node scripts/render-runtime-config.mjs --environment prod --format dotenv
```

The renderer uses the exact tracked allowlist. It rejects missing, duplicate,
unknown, and secret-classified names.

## Secret Packages

`config/environments/secret-packages.json` defines the exact DEV and PROD
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

Run the production-to-DEV dependency regression gate after editing any tracked
or non-ignored repository file:

```bash
pnpm run verify:production-dev-dependencies
```

This direct command is the CI authority. The unit suite skips a second full
repository traversal by default; to exercise that redundant wrapper explicitly,
run `INTEXURAOS_RUN_TRACKED_PRODUCTION_DEV_GATE_TEST=1 pnpm exec vitest run
scripts/__tests__/production-dev-dependency-gate.test.ts`.

The file universe is derived by the verifier and cannot be narrowed by policy.
Intentional historical/test/hibernation occurrences require an exact line,
occurrence count, classification, owner, and reason in the tracked policy. The
literal scanner canonicalizes supported JS/JSON, YAML/HCL, shell ANSI-C, CSS,
and HTML/XML escape forms through Node's WHATWG/UTS-46 host implementation.
It also folds bounded recursive percent encoding and common statically computable
JavaScript/TypeScript expressions: adjacent literal concatenation, template
interpolation from literals or one unambiguous `const`, `String(...)`, literal
array `.join(...)`, and literal UTF-8 base64 decoding. For GitHub Actions
workflows it also composes statically enumerable `env` references with literal
`format(...)` expressions and shell-adjacent quote/ANSI-C projections. A
relevant unresolved workflow value that could complete the forbidden hostname
fails closed after all supported projections; harmless standalone unresolved
values remain outside the hostname contract. Case/Unicode variants, duplicate
or stale entries, duplicate JSON keys, malformed text, NUL bytes, symlinks,
inventory changes, files whose SHA-256 changes across the whole scan, and
bounded expansion overflow all fail closed. The one intentional non-text test
fixture is pinned separately by SHA-256. Other dynamic environment
substitution, mutable identifiers, runtime branches, and custom decoders still
require an executable or data-flow-specific regression test.

For a statically computed occurrence, `lineEquals` names the exact discovered
sink line even when that isolated line does not spell the hostname. Such an
entry is accepted only when whole-file constant analysis produces an occurrence
at the same path and exact line; an arbitrary or stale sink line fails closed.

Production Web deployment consumes the manifest only through
`scripts/render-production-web-service-env.mjs`, which emits validated relative
`apiPath` entries. Its regression test executes the real deployment shell with
a DEV `serviceUrl` sentinel and verifies both the final build environment and
sanitized dotenv output.

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
and exact protected package version. It stops PM2 and Alloy, runs the one-shot
loader, installs static web and code, starts services, writes the deployment
attestation, verifies health, and deletes prior releases.

The production loader may run manually only while PM2 and Alloy are stopped:

```bash
sudo -n INTEXURAOS_ENVIRONMENT=prod \
  bash scripts/hetzner/load-secrets.sh --version <numeric-version>
```

It publishes a complete stable projection and has no partial, activation,
previous-release, or rollback mode. Any failure leaves services stopped for a
fix-forward repair.

## Edge And Cutover Verification

- `generate-dev-caddy.mjs`: generates one explicitly selected immutable DEV
  edge profile (`active-pre-cutover`, `active-post-cutover`, `draining`, or
  `hibernated`) or the separate production Matrix fragment from the tracked
  manifests. The byte-exact outputs in `config/edge/generated/` are deployment
  inputs and must match the generator; live hosts select these files instead of
  regenerating or editing route semantics.
- `validate-dev-caddy-profiles.mjs`: compares every tracked edge fixture with
  fresh generator output, then validates all five files with a pinned Caddy
  container in isolated, networkless runs. Missing Docker/Caddy validation is a
  hard failure.

Generate one reviewable output on stdout or validate the complete tracked set:

```bash
node scripts/generate-dev-caddy.mjs --profile active-post-cutover
node scripts/generate-dev-caddy.mjs --matrix-fragment
pnpm run verify:dev-edge-profiles
```

- `install-dev-static-web.sh`: verifies and publishes an exact-SHA Home Dev
  static build under `/var/www/intexuraos-dev/current` with Caddy-readable
  permissions.
- `verify-final-cutover-plan.mjs`: checks saved Terraform plan JSON against the
  frozen exact address/action allowlist.
- `security/final-cutover-data.mjs`: one-time offline encrypted-data and
  retired-worker migration while every writer is stopped.

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
