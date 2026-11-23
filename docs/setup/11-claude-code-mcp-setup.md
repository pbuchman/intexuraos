# 11 - Claude Code MCP Setup

This guide configures Claude Code for Linear and the private SentryBox
compatibility API. Legacy Sentry SaaS credentials are not used.

## Prerequisites

- Node.js and npm are installed.
- The machine can reach Home Dev through Tailscale.
- `LINEAR_API_KEY` is available for Linear operations.

Install the same pinned MCP client used by the Code Worker image:

```bash
npm install --global @sentry/mcp-server@0.37.0
sentry-mcp --version
```

The reported version must be `0.37.0`. Do not use `npx`, `latest`, or install a
second version at task startup.

## Environment

| Variable         | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `LINEAR_API_KEY` | Linear issue-management access               |
| `ERROR_HUB_HOST` | Private SentryBox `.ts.net:8443` host, without URL scheme |

For a direct local Claude session:

```bash
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxx"
export ERROR_HUB_HOST="home-dev.example.ts.net:8443"
```

`ERROR_HUB_HOST` is not a credential. Tailnet access is the SentryBox access
boundary. The fixed `tailnet-only` value in `.mcp.json` is syntax required by
the official MCP client, not an authentication secret.

The Home Dev orchestrator uses the corresponding non-secret variable
`INTEXURAOS_ERROR_HUB_HOST` and injects `ERROR_HUB_HOST` into each Code Worker.

## Linear API key

1. Open [Linear Settings → API](https://linear.app/settings/api).
2. Create a personal API key named `Claude Code`.
3. Store it outside the repository and export it as `LINEAR_API_KEY`.

Personal Linear API keys inherit the account permissions. Never commit or log
the key.

## Project MCP configuration

The checked-in `.mcp.json` is the source of truth for Claude:

```json
{
  "mcpServers": {
    "linear": {
      "type": "sse",
      "url": "https://mcp.linear.app/sse",
      "headers": {
        "Authorization": "Bearer ${LINEAR_API_KEY}"
      },
      "timeoutMs": 60000
    },
    "error_hub": {
      "command": "sh",
      "args": [
        "-lc",
        "exec sentry-mcp --access-token tailnet-only --host \"$ERROR_HUB_HOST\" --disable-skills=seer"
      ]
    }
  }
}
```

There must be no `sentry` server, `SENTRY_AUTH_TOKEN`, SaaS hostname, or runtime
package download in this file. The `error_hub` entry reads issue and event
evidence from SentryBox only.

## Verification

Check that variables are set without printing their values:

```bash
printf 'LINEAR_API_KEY=%s\n' "${LINEAR_API_KEY:+SET}"
printf 'ERROR_HUB_HOST=%s\n' "${ERROR_HUB_HOST:+SET}"
```

Then verify the registered servers:

```bash
claude mcp list
```

Expected servers are `linear` and `error_hub`. There must be no Legacy `sentry`
entry.

From a Claude session, test one known private SentryBox issue URL with
`error_hub` and list the Linear teams. The SentryBox request must stay on the
tailnet hostname.

Run the checked-in verifier on the worker host. Set the Error Hub hostname and
the ID of the existing local worker image. Resolve the image ID from the same
local image reference configured in the running orchestrator.

On deployments that use the Home Dev relay, run this export before invoking
the verifier. Leave the variable unset on deployments that use normal DNS.

```bash
export INTEXURAOS_ERROR_HUB_CONNECT_ADDRESS='fd00:172:28::1'
```

```bash
export INTEXURAOS_ERROR_HUB_HOST="home-dev.example.ts.net:8443"
export INTEXURAOS_CODE_WORKER_IMAGE="$(docker image inspect --format '{{.Id}}' '<configured-local-worker-image>')"

pnpm --filter @intexuraos/orchestrator verify:error-hub-mcp \
  "https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/<id>/" \
  "<event-id>"
```

The strict command reads the known event by ID, including its stack frame and
required metadata. It also verifies recent-event search, whose finite result page
can contain newer events without the retained original event. For a periodic
check, pass `--probe <issue-url>` to select
the current event from the MCP issue details and verify it appears in the MCP
event search. If the issue or event vanishes during that check, the verifier
reports `issue_not_found` after a verified HTTPS 404. Use `--transport-only`
when the store has no issue to select. It checks HTTPS readiness,
`initialize`, and `tools/list` and reports `businessAccess: false`.

Each mode validates the negotiated MCP protocol and advertised tools capability,
checks the baked `error_hub` configuration and verifies HTTPS against
the configured DNS hostname. The verifier runs one disposable, labeled
container on `code-worker-net` with `--pull=never`. It prints one JSON summary
with the mode and result. Failures exit nonzero and use fixed categories
without private issue data or child-process diagnostics.

## Troubleshooting

### `error_hub` does not start

```bash
command -v sentry-mcp
sentry-mcp --version
printf 'ERROR_HUB_HOST=%s\n' "${ERROR_HUB_HOST:+SET}"
```

Reinstall exactly `@sentry/mcp-server@0.37.0` if the binary is absent or the
version differs.

### Connection refused or timeout

1. Confirm Tailscale is connected.
2. Open `https://home-dev.example.ts.net:8443/health/ready` from the same
   machine.
3. Confirm `ERROR_HUB_HOST` contains only the DNS hostname and port, with no
   scheme, path, credentials, or whitespace.

### Linear needs authentication

Verify `LINEAR_API_KEY` is exported and restart the Claude session after
changing it. SentryBox itself does not require an auth token.

## Security rules

- Keep the Linear key outside tracked files and logs.
- Do not add a Sentry SaaS token or DSN to MCP configuration.
- Do not expose the private SentryBox UI or API outside Tailscale.
- Keep the MCP package pinned to the version exercised by CI and the Code
  Worker image.

## Quick checklist

```text
[ ] LINEAR_API_KEY is set
[ ] ERROR_HUB_HOST is home-dev.example.ts.net:8443 (replace with the configured hostname)
[ ] sentry-mcp reports 0.37.0
[ ] claude mcp list shows linear and error_hub only
[ ] a known SentryBox issue can be read through error_hub
[ ] no SENTRY_AUTH_TOKEN or Legacy sentry MCP entry remains
```

Related documentation:

- [Local development](./05-local-dev-with-gcp-deps.md)
- [Claude Code cloud development](./10-claude-code-cloud-dev.md)
- [SentryBox automation](../operations/sentry-code-task-automation.md)
