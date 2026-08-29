# Secret Packages Operations

This runbook describes the final package model after the completed destructive security cutover. It
contains no rollback, legacy-read, dual-package, recovery, or soak procedure; old-key compatibility
is forbidden. If a step fails, keep affected production services stopped, fix forward, and repeat
the failed verification; retained DEV application recovery follows the separate hibernation
runbook.

The [Secret Exposure Final Cutover Plan](./secret-exposure-final-cutover-plan.md) is a historical
archive and is not current execution authority.

## Final State

- `INTEXURAOS_SECRET_PACKAGE_DEV` contains the complete DEV application-secret
  payload.
- `INTEXURAOS_SECRET_PACKAGE_PROD` contains the complete PROD application-secret
  payload.
- `INTEXURAOS_INTERNAL_AUTH_TOKEN` and
  `INTEXURAOS_SPEECHMATICS_APP_API_KEY` are the only native application-secret
  containers.
- Every runtime uses an exact positive numeric version. `latest` is forbidden.
- Terraform owns containers and IAM only. It never owns secret values or
  versions.
- Package publishers can add, read, and inspect only their own target package.
  They cannot read obsolete source containers.
- Old package versions, legacy containers, old keys, compatibility readers,
  and package projection history do not exist after cutover.

The tracked contract is
`config/environments/secret-packages.json`. The active package member counts
must match that file exactly.

## Build One Complete Candidate

Use a private directory outside the repository with mode `0700`; every input
and candidate file must be a regular non-symlink file with mode `0600`.

Build from the currently active exact package version and provide every changed
member as an explicit private-file override:

```bash
node scripts/build-secret-package.mjs \
  --environment dev \
  --project-id intexuraos-dev-pbuchman \
  --base-version <exact-current-version> \
  --override-env INTEXURAOS_OPENROUTER_APP_API_KEY=<private-file> \
  --output <private-dir>/dev.json
```

Use `--override-file NAME=FILE` for package file members. A complete explicit
build is also accepted when every manifest member is supplied exactly once.
The builder rejects `latest`, incomplete membership, duplicate/unknown names,
symlinks, unsafe modes, empty values, and values larger than 64 KiB.

Validate before publication:

```bash
node scripts/secret-package.mjs validate \
  --environment dev \
  --payload-file <private-dir>/dev.json
```

The command output may contain names, counts, and validation status only. It
must never contain member values or value fingerprints.

## Publish One Numeric Version

Publish with the environment-specific publisher identity:

```bash
node scripts/secret-package.mjs publish \
  --environment dev \
  --project-id intexuraos-dev-pbuchman \
  --payload-file <private-dir>/dev.json \
  --receipt-file <private-dir>/dev-publish-receipt.json
```

The receipt is private metadata and must remain mode `0600`. Accept the result
only when server CRC32C and exact readback verification pass and the command
returns the new numeric version. Record only that number in tracked manifests
and deployment inputs. Delete the candidate and receipt immediately after the
cutover is verified.

Repeat independently for PROD. Never reuse a DEV payload for PROD or vice
versa.

## Render And Stage Retained DEV

If the retained DEV application stack is active under an approved recovery window, stop its writers
before changing the package version. Then render the exact DEV version on Home Dev:

```bash
SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS=/home/pbuchman/.config/intexuraos/secret-renderer-sa-key.json \
  ./scripts/sync-secrets.sh --version <dev-version>
```

Required result:

- `.envrc` is mode `0600` and contains exact versioned config plus exact DEV
  package environment members;
- the GitHub App PEM is installed as mode `0600`;
- the package projection root contains only the new release;
- no obsolete secret name, projection, or package version is selected;
- orchestrator and Alloy projections validate before their services start.

Do not start the retained DEV PM2 stack as part of package staging. Normal completion leaves the DEV
application profile hibernated. A live recovery check requires a separately authorized
`intexuraos-dev-mode resume` transaction, all runbook gates, and a final return to hibernation. The
production-owned orchestrator remains a separate retained Home Dev service.

## Render And Start PROD

Production deployment passes the exact numeric version through the protected
`PROD_SECRET_PACKAGE_VERSION` repository variable. The one-shot loader requires
PM2 and Alloy to be stopped and publishes a complete stable projection:

```bash
sudo -n INTEXURAOS_ENVIRONMENT=prod \
  bash scripts/hetzner/load-secrets.sh --version <prod-version>
```

Required result:

- `/etc/intexuraos/.env.prod` is complete and mode `0600`;
- the internal-auth token, Cloudflare DNS token, runtime service-account JSON,
  TLS key, and deployment metadata pass their format and permission checks;
- no package `current` link, prior render release, staging directory, or
  rollback marker remains;
- PM2, Alloy, nginx, and static web start only after all files are valid.

The deployment workflow is manual-only and deploys the exact frozen
`development` SHA. The deployment attestation records the SHA, workflow run,
timestamp, and numeric package version.

## Rotate A Package Member

1. Stop every DEV and PROD writer that uses the member.
2. Create the replacement at the provider or generate it locally.
3. Build complete DEV and PROD candidates from their active numeric versions.
4. Publish one new numeric version per environment.
5. Update both tracked pins, deploy the exact reviewed SHA to production, and stage that SHA plus
   the retained DEV projection on Home Dev without starting the DEV application stack.
6. Run production provider, application, browser, and direct-origin smoke tests. If DEV recovery
   must be tested, use a separately authorized resume-and-rehibernate drill.
7. Verify the final Home Dev application mode is `hibernated`.
8. Revoke the old provider credential and destroy every older package version.
9. Delete all private candidate and receipt files.

For encrypted Firestore values, run the tracked one-time offline migrator while
all writers are stopped. Runtime receives only the new key. The old and new
keys may coexist only inside the migrator process. A failed migration leaves
services stopped and is repaired forward.

## Verification

Every package operation finishes only when all checks below pass:

- `pnpm run verify:secret-packages` reports a valid exact manifest;
- DEV and PROD render from explicit numeric versions;
- rendered names exactly equal their manifest and versioned-config sets;
- secret payloads never enter Terraform state, Git, logs, or evidence;
- old credentials reject requests or are absent;
- obsolete package/native versions are destroyed;
- production runs the reviewed SHA and Home Dev stages that same SHA with the DEV application
  profile hibernated, except during a bounded recovery drill;
- PM2, systemd, nginx, Alloy, public/direct health, Auth0, Firebase, OAuth,
  WhatsApp, Matrix, transcription, OpenRouter, and browser smokes pass;
- Secret Manager inventory contains only the four final application containers
  and no legacy accessor.

## Evidence

Record only non-secret metadata: environment, numeric version, resource name,
provider credential UID, creation/deletion time, plan checksum, state lineage
and serial, deploy SHA, workflow run, HTTP status, and PASS/FAIL counts. Never
record payloads, raw environment files, private keys, tokens, reversible hashes,
or screenshots containing values.
