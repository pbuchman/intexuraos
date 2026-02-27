# Notion Service

The integration bridge between IntexuraOS and Notion — connect your workspace once, and your research results have a place to land.

## The Problem

Research without a destination is research forgotten. IntexuraOS agents can gather sources, synthesize findings, and compile reports — but the results need to end up somewhere you will actually revisit. For many knowledge workers, that somewhere is Notion. Without a live connection, exporting means copy-pasting between tabs, reformatting content by hand, and losing the thread between what the system produced and where it belongs in your knowledge base.

## Use Case: Research That Arrives Where You Work

You kick off a research task from the web dashboard. The research-agent gathers sources, synthesizes findings, and builds a report. When it is time to export, the agent checks whether you have a connected Notion workspace and whether the target page is accessible. If both checks pass, the results land directly in your Notion page — no manual transfer, no reformatting, no switching between tools.

The connection stays active across sessions. Once linked, every future export targets the same workspace without re-entering credentials.

## How It Helps

### One-Time Setup, Persistent Connection

Generate an integration token in your Notion settings. Hand it to IntexuraOS through the connect endpoint. The service validates the token against the Notion API before storing anything — if the token is invalid or expired, you find out immediately, not when an export fails an hour later. A successful connection records timestamps so you always know when the link was established and last updated.

Reconnecting replaces the existing token. One active integration per user, no ambiguity about which workspace is linked.

### Export Target Validation

Before the research-agent writes to a Notion page, it needs to know two things: does the user have an active connection, and can that connection access the target page? The notion-service answers both. It checks the connection state, then reaches out to the Notion API to confirm the page is accessible and returns its title and URL. If anything is wrong — expired token, revoked page access, missing connection — the failure surfaces before the export attempt, not during it.

### Clean Disconnection

Removing the integration marks the connection as inactive. The stored token is retained in case you reconnect, but no service will use it while the connection is off. Reconnecting later replaces the old token with a fresh one.

## Key Benefits

- **Validated before stored** — Tokens are checked against the Notion API before the service accepts them
- **Pre-flight export checks** — Page access is verified before the research-agent attempts to write
- **Single active connection** — One integration per user eliminates confusion about which workspace is linked
- **Immediate feedback** — Invalid tokens, revoked access, and unreachable pages surface at the moment of the check, not during a downstream export

## Limitations

- **Manual token generation** — You must create the integration token in Notion's settings yourself; there is no OAuth flow
- **No sync** — The service manages the connection lifecycle and validates export targets, but does not sync content between systems
- **No page creation or browsing** — You point to an existing page; the service does not create pages or list your workspace contents
- **No automatic sync from Notion** — Changes made in Notion are not reflected in IntexuraOS automatically; the connection is one-directional for now
- **Connection failures require manual reconnect** — If a token expires or is revoked, you must connect again with a new one

---

_Part of [IntexuraOS](../overview.md) — The bridge between your research and the knowledge base where it belongs._
