# Restore worker access to Error Hub

Approved implementation and rollout plan, 2026-11-23.

## Scope and acceptance

Restore real worker MCP access to SentryBox after Tailscale 1.104 began binding
Serve listeners to the Tailscale device. A worker on a local Docker bridge is
refused before TLS. Preserve TLS hostname verification and the private origin.
Do not set `TS_SERVE_ALLOW_ALL_INTERFACES`, weaken TLS, broaden host sudo grants,
change application data, or fix the separate Firestore synchronization defect.

Success requires merged reviewed PRs, exact-revision runtime deployment, a strict
MCP issue/event read from the production worker image, a working periodic probe,
and one retry of the original failed Code Task observed to a terminal result.
CI, a merge, or a host-only HTTP 200 alone does not establish success.

## Global constraints

- Repositories: `pbuchman/intexuraos`, `pbuchman/sentrybox`, `pbuchman/pbuchman-dev`.
- Use `codex/` branches. No Git worktrees in IntexuraOS. Preserve unrelated files.
- Pin GitHub credentials to each command and verify the `pbuchman` identity.
- Read the installed Home Dev secrets policy; never log or commit secret values.
- Worker network: `code-worker-net`, interface `code-worker-br`, IPv6 subnet
  `fd00:172:28::/64`, gateway/relay address `fd00:172:28::1`, port `8443`.
- Optional orchestrator variable: `INTEXURAOS_ERROR_HUB_CONNECT_ADDRESS`.
  Only the approved IPv6 gateway is accepted. Absence preserves current routing.
- Keep `INTEXURAOS_ERROR_HUB_HOST` and worker `ERROR_HUB_HOST` unchanged.
- Share routing/validation code between worker creation, env generator, and MCP verifier.
- Public documentation uses illustrative tailnet names; private host evidence stays private.
- Run meaningful tests, retain quality thresholds, and review cross-repository interfaces.

## Task 1: IntexuraOS routing, probe and runtime metadata

Read local README, manifests, implementation and tests before editing. Add the
optional connect-address configuration and Docker `ExtraHosts` mapping for only
the Error Hub DNS hostname. Home Dev env generation supplies the approved gateway.
Generic runtime configuration remains backward compatible when unset.

Extend `workers/orchestrator/scripts/verify-error-hub-mcp.mjs`: retain strict
`<issueURL> <eventID>` acceptance; add `--probe <issueURL>` with current evidence
selection and `--transport-only` for an empty store. Always validate TLS and baked
MCP config; use the production local immutable image with `--pull=never`, no task
or model credentials. Bound execution, clean only its labeled disposable
container, and emit sanitized machine-readable results. Transport-only checks
HTTPS readiness, MCP initialize and tools/list without claiming business access.

On orchestrator startup atomically write mode-0600 runtime projection
`<stateDir>/error-hub-probe-runtime.json` with exactly `{schemaVersion:1,imageRef,
errorHubHost,connectAddress,invocationId}`. Source invocationId from systemd
`INVOCATION_ID`; use null when absent. No secrets. A monitor compares the projection
against the running service InvocationID and resolves the local image tag to an
immutable image ID before probe creation. Agree any unavoidable interface change
with the controller and host implementer before coding it.

Cover hostname/address validation, absence compatibility, Docker mapping, shared
generator behavior, strict acceptance, empty transport mode, sanitized failures,
timeout cleanup and atomic runtime projection. Run Node 22,
`pnpm run verify:workspace:tracked orchestrator`, and `pnpm run ci:tracked`.
Update orchestrator/environment/verifier documentation. Do not rebuild the worker
image solely for these host-side changes.

## Task 2: SentryBox host relay

Implement `sentrybox-worker-relay.socket` and `.service` in the protected Home Dev
control installer. Socket binds only `[fd00:172:28::1]:8443`,
`BindToDevice=code-worker-br`, `BindIPv6Only=ipv6-only`, `Accept=no`, no wildcard or
FreeBind. Use systemd 255 `systemd-socket-proxyd` in the host network namespace,
DynamicUser, no capabilities, NoNewPrivileges, ProtectSystem=strict,
ProtectHome=yes, max 128 connections, five-minute idle exit.

Root-owned mode-0600 `/etc/sentrybox/worker-relay.env` contains only
`SENTRYBOX_WORKER_RELAY_TARGET=<own-MagicDNS>:8443`. Derive it from the configured
private origin and verify against Tailscale Self.DNSName. TLS remains end to end.
The socket follows firewall and bridge device lifetime. Use bounded readiness of
the exact gateway; verify boot ordering on systemd 255, including shutdown. Stop
the running proxy along with socket/dependencies so accepted FDs cannot survive.
Enabled socket must rearm after the bridge and firewall return. Do not start a
dependent socket synchronously from firewall ExecStart.

Extend installer allowlists and protected-control staging; preserve existing
application deployment. Add Bats/unit tests and an isolated real TLS forwarding
and lifecycle integration test. Update network-exposure, protected-control and
rollback runbooks. Rollback must explicitly stop/disable service/socket and remove
new files before invoking an older installer. Run full current SentryBox CI gates.

## Task 3: Host firewall, network recovery and monitoring

Replace worker direct-tailnet /128 access with bridge+source subnet+exact gateway
tcp/8443 access. Add early drop for other ingress to the relay address/port,
including quiesce. Preserve ND hoplimit checks, IPv6 terminal drops, IPv4 metadata
protection and existing IPv4 policy. Validate gateway in setup, cleanup recovery
and verification. Rearm an optional enabled relay socket after verified network
and firewall recovery, including cleanup EXIT recovery. Preserve activity gates.

Create a 15-minute, 120-second maximum, non-overlapping probe running as the
existing Docker-authorized runtime user. Acquire shared cleanup lock then shared
orchestrator transaction lock; skip while deployment freeze is set. Read only the
sanitized runtime projection and reject an invocation mismatch. Select a current
issue privately through `/api/issues?limit=1`, then invoke the IntexuraOS verifier
against the local immutable worker image. Reselect once on retention race.
Empty corpus uses transport-only mode; selector HTTP/JSON failures are failures.

Atomically publish sanitized `/var/lib/sentrybox-worker-probe/status.json`:
attempt time, separate last transport/business success, failure counter/reason,
image digest. Producer:netdata directory 2750 and file 0640. Netdata only reads
that file; no Docker group or sudo grants. Two consecutive failures critical,
one positive clears, independent 35-minute stale-attempt detection. Empty corpus
does not falsely claim business success or raise a stale-business alarm. No
recursive Sentry event/task generation. Test collector, selector, retention,
timeout, concurrency and stale-file behavior. Add path-filtered CI covering new
host code, real firewall/lifecycle tests on isolated Ubuntu 24.04, and update
phase 3/4/6 documentation and verify-setup.

## Task 4: Integration, merge and production rollout

Complete all three implementations, required checks and independent review before
merging in order: host repository, SentryBox, IntexuraOS. Verify remote merge SHAs.
Wait for normal SentryBox image release and verify its deployed immutable image
separately from the protected control tree. No unrelated full application deploy.

Stage exact-SHA artifacts and protected backups; leave probe timer disabled.
An authorized root session holds the Docker cleanup exclusive lock, then the
orchestrator transaction exclusive lock. Establish the admission freeze and prove
zero active/pending/persisted work and no worker containers. Respect retained
container cleanup policy. Do not force-stop active or retained work.

Apply host firewall in place and verify live rules, not only systemd active state.
Install the reviewed SentryBox protected control tree with the existing private
origin and `--enable-worker-relay`, verify current symlink and reload the application as documented. Build
and stage the exact IntexuraOS SHA with Node 22 and generate runtime configuration.
Before reopening admission, prove real worker MCP read and negative TLS/ingress
checks and remove the disposable test container. Release the transaction lock
while retaining freeze and cleanup lock; invoke the existing no-argument guarded
zero-work restart helper, which independently verifies zero work and removes the
freeze. Verify runtime artifact/projection and a newly created container, then
convert the cleanup lock to shared mode (rechecking state after conversion) so
the monitor can acquire its own shared lock. Obtain a fresh successful manual
probe before activating its collector and alerts, then enable the timer and
observe a fresh scheduled success before releasing the shared cleanup lock. Do not
manually remove the freeze or bypass helper safeguards.

If verification fails before the guard reopens admission, retain the owned freeze.
After reopening, reacquire the locks, establish a new owned freeze and prove zero
work before rollback. Prepare a concrete reviewed operator procedure if root
access is unavailable; never expand privileges or use Docker to bypass host authorization.
Production Docker/Tailscale restarts or reboot are not test mechanisms.

Retry the original task using the signed-in production UI, record the new task ID
and `retriedFrom`, and observe the terminal result. Evidence retrieval must pass;
any newly exposed application defect is reported separately and is outside scope.

## Task 5: Evidence and documentation completion

Update per-repository README/runbooks with exact install, verify, monitor and
rollback procedures. Record rationale and test limitations. Open and merge a
final private documentation PR containing actual merge SHAs, image digest,
protected-control selector, versions, positive/negative runtime results, monitor
timestamps and retry result. Do not claim tests that were not run or put private
origins, credentials or raw issue payloads in public documentation.
