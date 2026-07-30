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
| `ERROR_HUB_HOST` | Private SentryBox host, without URL scheme   |

For a direct local Claude session:

```bash
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxx"
export ERROR_HUB_HOST="home-dev.taild6ad57.ts.net:8443"
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

The checked-in real-image verifier is the production-equivalent evidence test:

```bash
pnpm --filter @intexuraos/orchestrator verify:error-hub-mcp \
  "https://home-dev.taild6ad57.ts.net:8443/organizations/intexuraos/issues/<id>/" \
  "<event-id>"
```

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
2. Open `https://home-dev.taild6ad57.ts.net:8443/health/ready` from the same
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
[ ] ERROR_HUB_HOST is home-dev.taild6ad57.ts.net:8443
[ ] sentry-mcp reports 0.37.0
[ ] claude mcp list shows linear and error_hub only
[ ] a known SentryBox issue can be read through error_hub
[ ] no SENTRY_AUTH_TOKEN or Legacy sentry MCP entry remains
```

Related documentation:

- [Local development](./05-local-dev-with-gcp-deps.md)
- [Claude Code cloud development](./10-claude-code-cloud-dev.md)
- [SentryBox automation](../operations/sentry-code-task-automation.md)
