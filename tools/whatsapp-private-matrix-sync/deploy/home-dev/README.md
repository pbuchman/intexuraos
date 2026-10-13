# Independent Home Dev integration

This deployment owns only the IntexuraOS Matrix adapter. Matrix core stays in `pbuchman-dev` under project `whatsapp-matrix`. The integration uses project `intexuraos-matrix-sync`, service `matrix-sync`, container `intexuraos-matrix-sync`, unit `intexuraos-matrix-sync.service` and directory `/home/pbuchman/services/intexuraos-matrix-sync`.

The adapter connects to `https://home-dev`, using `home-dev:host-gateway` and the active Caddy public root CA through `NODE_EXTRA_CA_CERTS`. It has its own Docker network. Preserve port 8099 and the existing host-owned Caddy/Cloudflare Service Auth route `https://matrix-outbound.intexuraos.cloud/api/matrix-outbound`. No new ingress resources are needed.

## Prepare without starting a consumer

Prerequisites are Docker with Compose, Bash, Node 22 and a reviewed, committed IntexuraOS revision. Prepare an integration-only environment from the tool's `.env.example`; set the existing source account, canonical user and phone number. Preserve the exact private-sync Google identity and current audience/ingest/media URLs. Do not copy the core PostgreSQL or bridge secrets into this environment.

The current migration mounts remain:

| Host path                                                                           | Container purpose                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/home/pbuchman/services/whatsapp-matrix/data/whatsapp-sync`                        | Checkpoint, pending media and recovery fence, writable by UID 1000 |
| `/home/pbuchman/services/whatsapp-matrix/secrets/matrix-access-token`               | Matrix API credential, read-only                                   |
| `/home/pbuchman/services/whatsapp-matrix/secrets/matrix-outbound-auth-token`        | Distinct adapter bearer, read-only                                 |
| `/home/pbuchman/services/whatsapp-matrix/secrets/private-sync-service-account.json` | Existing pinned Google credential, read-only                       |
| `/home/pbuchman/services/whatsapp-matrix/config/matrix-outbound-targets.json`       | Existing account/target room mapping, read-only                    |
| `/home/pbuchman/services/intexuraos-matrix-sync/ca/active-caddy-root.crt`           | Active Caddy public root certificate, read-only                    |

Export the public root from the **running Caddy service's** data store, after confirming its service user and data directory. Home Dev currently runs Caddy as `caddy`, whose standard store is `/var/lib/caddy/.local/share/caddy`. A copied certificate from the login user's store did not validate the active server at preflight. Never copy Caddy's root/intermediate private keys.

These administrator commands prepare the public trust file only; they do not restart Caddy, Matrix or the adapter:

```bash
systemctl show caddy -p User -p Environment -p ExecStart
sudo install -d -o pbuchman -g pbuchman -m 0700 /home/pbuchman/services/intexuraos-matrix-sync
sudo install -d -o pbuchman -g pbuchman -m 0755 /home/pbuchman/services/intexuraos-matrix-sync/ca
sudo install -o pbuchman -g pbuchman -m 0644 \
  /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt \
  /home/pbuchman/services/intexuraos-matrix-sync/ca/active-caddy-root.crt
```

If the service uses a different data directory, use the verified active path. Validate trust from the intended image before stopping the existing consumer. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`, use curl `-k`, or grant the adapter access to the core network.

```bash
source_sha="$(git rev-parse HEAD)"
bash tools/whatsapp-private-matrix-sync/deploy/home-dev/build.sh "$source_sha"
bash tools/whatsapp-private-matrix-sync/deploy/home-dev/install.sh \
  --prepare-only --source-sha "$source_sha" \
  --env-file /home/pbuchman/services/integration-only.env \
  --state-dir /home/pbuchman/services/whatsapp-matrix/data/whatsapp-sync \
  --secrets-dir /home/pbuchman/services/whatsapp-matrix/secrets \
  --targets-file /home/pbuchman/services/whatsapp-matrix/config/matrix-outbound-targets.json \
  --ca-file /home/pbuchman/services/intexuraos-matrix-sync/ca/active-caddy-root.crt
```

`build.sh` and the installer reject a revision other than `HEAD` or dirty canonical tool source. The image uses frozen npm dependencies and a digest-pinned Node 22.23.3 base. Inspect `org.opencontainers.image.revision` and require `com.intexuraos.build.fixture=false` before using the release image. `test:image` builds a separate fixture image; its sentinel SHA is never a production source revision.

The installer only writes `.env`, `compose.yaml` and a staged unit into the deployment directory and validates Compose. It never builds, starts, stops, removes or restarts containers; never writes protected state/secrets; and never installs or reloads systemd. A repeated identical prepare preserves the environment. It rejects an existing different environment, leaving deliberate revision/configuration changes to the operator after review. Use `--deploy-dir` to stage elsewhere when a release already occupies the canonical path.

Integration environment input uses simple `KEY=VALUE` lines, optional single-line quoted values, blank lines and comments. Export-prefixed, colon and multiline assignments are rejected. `NODE_TLS_REJECT_UNAUTHORIZED` is forbidden in all input forms; the effective Compose runtime additionally pins it to `1`. Deployment revision/mount variables must come from the explicit installer arguments.

Read-only runtime TLS preflight, without mounting live state or a Matrix credential:

```bash
docker run --rm --add-host home-dev:host-gateway \
  --mount type=bind,src=/home/pbuchman/services/intexuraos-matrix-sync/ca/active-caddy-root.crt,dst=/run/matrix-ca/root.crt,readonly \
  --env NODE_EXTRA_CA_CERTS=/run/matrix-ca/root.crt \
  "intexuraos-matrix-sync:$source_sha" node --input-type=module -e \
  'const response = await fetch("https://home-dev/_matrix/client/versions"); if (!response.ok) process.exit(1); console.log(JSON.stringify({status:response.status}));'
```

After passing trust and image checks, installing the staged unit is still prepare-only:

```bash
systemd-analyze verify /home/pbuchman/services/intexuraos-matrix-sync/intexuraos-matrix-sync.service
sudo install -m 0644 /home/pbuchman/services/intexuraos-matrix-sync/intexuraos-matrix-sync.service /etc/systemd/system/intexuraos-matrix-sync.service
sudo systemctl daemon-reload
```

Do not enable/start the new unit during preparation. Lack of administrator access or authorized recovery ADC blocks cutover, not repository validation. Do not use unrelated sudo launchers or privileged Docker mounts to bypass those prerequisites.

## Controlled ownership transfer

1. Refresh the baseline: record core container IDs/restart counts, image identities, adapter checkpoint hash and its `updatedAt`, without exposing private content. Make consistent PostgreSQL and protected configuration/credential/state backups, and rehearse their restore in isolation without starting a copied WhatsApp session.
2. Confirm the active root CA validates the Matrix endpoint from the release image, the existing ingest service account can mint the expected OIDC token, and the existing authorized recovery reader is available. Keep both the release image and prior adapter image.
3. Fence the old adapter by creating a mode 600 `recovery-required` file in its state directory. Disable only its Docker restart policy, then stop only `whatsapp-matrix-sync`. Preserve S0 after the consumer is fully stopped. Never invoke the old shared unit's `ExecStop=... down`, broad shared Compose `down`, `--remove-orphans`, or core stop/start/restart.
4. Install the reviewed core supervisor/configuration that owns exactly four core services, then daemon-reload without calling the old shared stop operation. Ensure the legacy supervisor/configuration cannot recreate the old adapter. The host setup guide owns that transition. Remove only the stopped legacy adapter container, retaining its image and all bind-mounted data.
5. Install the separate integration unit but keep it stopped. Verify exactly one owner of the adapter state and no running consumers. Run [the manual two-segment recovery](../../../../docs/setup/16-private-whatsapp-matrix-sync.md#controlled-history-recovery) against the preserved checkpoint. Discovery can join eligible rooms; apply/finalize write private data and state, so these stages belong to the authorized recovery window.
6. After both contiguous segments pass verification and finalization, remove only the reviewed recovery fence and start/enable `intexuraos-matrix-sync.service`. Observe at least 15 minutes of fresh successful iterations/checkpoints, naturally arriving successful ingest, and unchanged core IDs/restart counts. Verify the public route using its existing Cloudflare Service Auth credentials plus adapter bearer, with secrets supplied from protected files. Do not send real test messages.
7. Retire the legacy source snapshot/startup definitions only after canonical deployment and recovered live synchronization succeed. Preserve backups and sanitized source/image evidence.

## Rollback and deliberate upgrades

Stop only `intexuraos-matrix-sync.service` and retain or create the recovery fence. Keep core running. Preserve the newest checkpoint, media queue and recovery manifest. Select the previously retained image only after proving that it accepts the latest state format; never restore pre-finalization S0 over a successfully finalized state. If compatibility is unclear, keep the consumer fenced.

Prepare the prior image and reviewed configuration under the separate project/supervisor, verify its image label and TLS trust, and create a single replacement adapter only after its predecessor is stopped. Keep the latest compatible checkpoint and explicit bind paths. Resume only after resolving the fence according to the recovery contract. Do not restore the legacy shared supervisor or run a shared-stack shutdown. Upgrades use the same prepare, stop-one-consumer, preserve-state and replace-one-container sequence.

The first migration's retained legacy image is named `whatsapp-matrix-sync:local`. Before cutover, record its immutable image ID and `org.opencontainers.image.revision` and retain that image. It predates `com.intexuraos.build.fixture`; absence of that new label is expected for a verified legacy image and does not prove it is a fixture or invalidate captured revision evidence. New canonical release images must still have `fixture=false`.

When rollback compatibility has been proved and the new consumer is stopped/fenced, select the recorded immutable image explicitly for the separate Compose project:

```bash
# Use the immutable ID and exact revision recorded before cutover.
docker tag "$prior_image_id" "intexuraos-matrix-sync:$prior_source_sha"
```

In the reviewed protected deployment `.env`, set only `INTEXURAOS_SOURCE_SHA` to that recorded prior revision; retain account/user, active CA, current checkpoint directory and all explicit credential/target mounts. Do not restore an old environment blindly or copy old state. Validate the separate Compose configuration and compare the selected tag's image ID to the recorded ID before any eventual resume. The prepare-only installer refuses an existing different environment, so this rollback selection is a deliberate operator change. Keep the recovery fence until the latest checkpoint's compatibility and recovery status permit a single consumer to resume.

## Verification fixtures

```bash
pnpm run verify:workspace:tracked whatsapp-private-matrix-sync
pnpm --filter whatsapp-private-matrix-sync test:image
```

The workspace tests execute prepare/idempotency/Compose validation and regression coverage for ingest, media, outbound auth, identities and recovery. The image rehearsal uses an ephemeral HTTPS Matrix fixture on an internal network, exercises good/bad CA and actual image health, stops/replaces the fixture consumer with its cursor preserved, and checks the fixture core ID/restart count. It never starts a real WhatsApp bridge or mounts live protected data. Existing recovery tests cover idempotent apply/finalize and relation/media/identity failures; the image runs those tests against its built modules too.
