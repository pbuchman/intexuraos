# Home PROD runtime and edge

The `basic` production profile runs 17 applications on loopback ports `181xx`.
The edge listens only on `127.0.0.1:18080`, behind the host's existing Caddy and
Cloudflare Tunnel. It serves `/var/www/intexuraos-prod/web/current` and retains the
public origin and Google OIDC audience `https://intexuraos.cloud`.

Each application attempt is installed and built at its final immutable
`deploy/releases/<sha>.<attempt>` path before `deploy/current` changes. This preserves
pnpm's absolute bin links and metadata. The web build uses the exact commit timestamp as
`SOURCE_DATE_EPOCH` and a sanitized public capability value, so rebuilding the same SHA is
stable while a changed public configuration is rejected before activation.

`render-edge.mjs` derives the dedicated configuration from the canonical
`scripts/home-prod/nginx/intexuraos.conf` and `jwt-verify.lua`; those files remain
active dependencies. Render the three reviewed artifacts with:

```bash
node scripts/home-prod/render-edge.mjs nginx
node scripts/home-prod/render-edge.mjs lua
node scripts/home-prod/render-edge.mjs callback-proxy
```

The host installer, dedicated systemd unit and apex Caddy fragment are maintained
in `pbuchman-dev/machine-setup/config/intexuraos-home-prod/`. Follow that repository's
Home PROD runbook after a healthy application deployment. Both nginx and PM2 run
as `intexuraos-prod`; the internal token remains mode `0600` at
`/home/intexuraos-prod/.config/intexuraos/prod/internal-auth-token`. nginx needs
outbound DNS, Google discovery/JWKS and GCS access, so its unit has no private network.

Google OIDC is restricted to the existing exact Scheduler/Pub/Sub routes, methods
and service accounts. Public aliases of internal routes are denied except the
explicit code callbacks: POST task-complete, task-event, compliance-report,
usage-events, logs, turn-metrics and code/heartbeat, plus PATCH code-tasks/status.
Their canonical URLs and signature headers are retained; application middleware
still verifies HMAC or the route's internal token. GET tasks/:id/dispatch-metadata
preserves only the caller-supplied internal token needed by its backend. No callback
receives a privileged token or caller role from nginx. Other methods are rejected.
Research and message-digest aliases return a standard temporary-unavailability
503 response. Encoded separators and ambiguous API paths are rejected.

```bash
docker build -t intexuraos-home-prod-edge-test scripts/home-prod/tests
node --test scripts/home-prod/tests/edge-render.test.mjs \
  scripts/home-prod/tests/edge-integration.test.mjs
```

Docker is used only for tests. The integration suite runs real OpenResty/nginx as
UID 10001 against local discovery/JWKS and application stubs. It verifies real RSA
JWT signatures and claims, route/method policy, header sanitation, callback
forwarding and backend token rejection. HMAC application cryptography remains
covered by the application's own tests; the edge stub tests forwarding and denial.
The installer also tests Ubuntu's native nginx configuration as the actual runtime
user before activation, since its nginx/module build differs from the test image.
