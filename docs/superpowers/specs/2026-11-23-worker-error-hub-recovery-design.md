# Worker access to Error Hub after Tailscale 1.104

## Problem

Sentry remediation tasks fail with `SENTRY_EVIDENCE_UNAVAILABLE` before they can
inspect their triggering issue. The worker's `error_hub` MCP server reaches the
configured private HTTPS origin from a Docker bridge. On the affected host,
Tailscale Serve accepts the host's own connection but refuses the bridge's
connection before TLS. Worker tests for the application code can still pass;
they do not exercise this network path.

Tailscale 1.104 intentionally restricts Serve listeners to its network device.
Previously, Linux's weak-host networking allowed traffic arriving on another
interface to reach a listener bound to the tailnet IP. See the upstream
[same-host Docker report](https://github.com/tailscale/tailscale/issues/21737)
and [listener binding implementation](https://github.com/tailscale/tailscale/blob/v1.104.7/ipn/ipnlocal/peerapi_linux.go).
Host upgrade dates, historical task results and evidence-retention limitations
are recorded in the private deployment evidence. The listener change explains
why a previously reachable same-host bridge path can fail after an upgrade.

The original Firestore monitoring error remains a separate application issue.
Repairing access allows its agent to obtain evidence; it does not itself repair
Firestore synchronization.

## Design

```text
worker error_hub MCP
  HTTPS original private hostname:8443 (normal certificate validation)
  Docker ExtraHosts maps only this hostname to bridge gateway
    -> relay socket on code-worker-br IPv6 gateway:8443
    -> host systemd-socket-proxyd
    -> original private hostname:8443 on Tailscale Serve
    -> SentryBox
```

The relay forwards TCP without terminating TLS. It binds to one interface,
one IPv6 address and one port. The firewall permits only the established worker
subnet on that bridge. Other ingress to the relay is rejected. The origin,
certificate trust, SNI, MCP protocol and application API remain unchanged.
The relay conveys the private API's existing authority; it does not make the API
read-only. The periodic monitor uses only read operations.

This design deliberately avoids the global Tailscale
`TS_SERVE_ALLOW_ALL_INTERFACES` override. That override changes every Serve
listener's interface boundary. A narrow relay preserves the existing private
listener behavior and makes the exceptional worker route explicit.

## Ownership and contracts

- IntexuraOS owns optional worker DNS routing, strict configuration validation,
  the disposable real-image MCP verifier and minimal startup runtime metadata.
- SentryBox owns the protected installer, socket/proxy units and their lifecycle.
- The private host repository owns bridge/firewall policy, cleanup recovery,
  periodic probe, Netdata file collector and actual deployment evidence.

The route is optional in generic orchestrator configuration. The Home Dev env
generator supplies its approved gateway. The probe uses the same route builder
as task workers and validates the running service invocation against the startup
projection. It resolves the local production image to an immutable ID and never
pulls a replacement image during monitoring.

An empty issue store is a valid state under retention. It receives a transport
check (TLS readiness plus MCP initialization and tool discovery), recorded
separately from a successful business evidence read. Selector failures and
malformed replies remain failures. No issue is retained permanently just to
satisfy monitoring.

## Acceptance and operational boundaries

Required acceptance includes actual worker-image issue/event reads, certificate
rejection for the wrong hostname, rejection from disallowed ingress, and relay
teardown/recovery tests under systemd 255. Lifecycle tests run in an isolated
Ubuntu environment; production Docker and Tailscale are not restarted to test
them. Unit and sibling-container HTTPS tests supplement this verification.

Deployments freeze admission under the existing maintenance locks, preserve
retained task containers until their normal expiration, and apply the firewall
and relay before restarting the orchestrator. A live rule check and real MCP
read precede the guarded restart because that helper does not validate Error Hub.
Failures retain the freeze. No additional sudo or IAM authority is introduced.

The final retry must be traced to the original failed task and observed to a
terminal state. Its result can expose the original application defect; that
outcome is documented separately from network recovery. Merge SHAs, runtime
digests and actual acceptance results belong in private deployment evidence.

Implementation and rollout steps are tracked in the
[approved plan](../plans/2026-11-23-worker-error-hub-recovery.md).
