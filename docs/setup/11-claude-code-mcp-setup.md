# 11 - Claude Code MCP Setup

This document describes how to configure MCP (Model Context Protocol) servers for Claude Code integration with Linear and Sentry.

## Overview

**Use this guide when:**

- Setting up a new development environment (local or cloud)
- Configuring Claude Code for the first time
- Troubleshooting MCP connectivity issues

## Required Environment Variables

| Variable            | Service | Purpose                     |
| ------------------- | ------- | --------------------------- |
| `LINEAR_API_KEY`    | Linear  | Issue tracking API access   |
| `SENTRY_AUTH_TOKEN` | Sentry  | Error monitoring API access |

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxx"
export SENTRY_AUTH_TOKEN="sntrys_xxxxxxxxxxxxx"
```

## 1. Linear API Key

### 1.1 Create Personal API Key

1. Go to [Linear Settings → API](https://linear.app/settings/api)
2. Click **Create new API key**
3. Name: `Claude Code` (or descriptive name)
4. Click **Create**
5. Copy the key immediately (shown only once)

### 1.2 Key Format

Linear API keys follow this format:

```
lin_api_<alphanumeric-characters>
```

### 1.3 Permissions

Personal API keys inherit your Linear account permissions. No additional scopes needed.

## 2. Sentry Auth Token

### 2.1 Create Auth Token

1. Go to [Sentry Settings → Auth Tokens](https://sentry.io/settings/account/api/auth-tokens/)
2. Click **Create New Token**
3. Name: `Claude Code MCP`

### 2.2 Required Scopes

Select the following scopes:

| Scope           | Purpose                 |
| --------------- | ----------------------- |
| `org:read`      | List organizations      |
| `project:read`  | List and view projects  |
| `project:write` | Update project settings |
| `team:read`     | List teams              |
| `team:write`    | Manage team membership  |
| `event:write`   | Create test events      |

### 2.3 Key Format

Sentry tokens follow this format:

```
sntrys_<alphanumeric-characters>
# or
sntryu_<alphanumeric-characters>
```

## 3. Configuration Files

### 3.1 MCP Servers (`.mcp.json`)

Located at project root, defines MCP server connections:

```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": {
        "Authorization": "Bearer ${LINEAR_API_KEY}"
      }
    },
    "sentry": {
      "command": "npx",
      "args": ["@sentry/mcp-server@latest", "--access-token", "${SENTRY_AUTH_TOKEN}"]
    }
  }
}
```

**Transport types:**

| Type  | Linear | Sentry | Description                         |
| ----- | ------ | ------ | ----------------------------------- |
| HTTP  | Yes    | No     | Stateless, headers per request      |
| STDIO | No     | Yes    | Subprocess, token passed at startup |

### 3.2 Plugins (`.claude/settings.json`)

Defines enabled plugins for the project:

```json
{
  "enabledPlugins": {
    "superpowers@superpowers-marketplace": true,
    "context7@claude-plugins-official": true,
    "commit-commands@claude-plugins-official": true,
    "pr-review-toolkit@claude-code-plugins": true,
    "playwright@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true
  }
}
```

**Plugin descriptions:**

| Plugin              | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `superpowers`       | TDD workflow, brainstorming, subagent development |
| `context7`          | Library documentation lookup                      |
| `commit-commands`   | Git commit workflow helpers                       |
| `pr-review-toolkit` | Code review agents (6 specialized reviewers)      |
| `playwright`        | Browser automation and testing                    |
| `frontend-design`   | UI/frontend design assistance                     |

### 3.3 First-Time Plugin Setup

New developers need to add the superpowers marketplace once:

```bash
claude plugins marketplace add obra/superpowers-marketplace
```

Then install the plugin:

```bash
claude plugins install superpowers@superpowers-marketplace
```

Other plugins from official marketplaces install automatically when enabled in project settings.

## 4. Verification

### 4.1 Check Environment Variables

```bash
echo "LINEAR_API_KEY: ${LINEAR_API_KEY:+SET}"
echo "SENTRY_AUTH_TOKEN: ${SENTRY_AUTH_TOKEN:+SET}"
```

Expected output:

```
LINEAR_API_KEY: SET
SENTRY_AUTH_TOKEN: SET
```

### 4.2 Check MCP Connectivity

```bash
claude mcp list
```

Expected output:

```
Checking MCP server health...

linear: https://mcp.linear.app/mcp (HTTP) - ✓ Connected
sentry: npx @sentry/mcp-server@latest --access-token ... - ✓ Connected
```

### 4.3 Test API Access

From within Claude Code session:

```
# Test Linear
"List my Linear teams"

# Test Sentry
"List my Sentry organizations"
```

## 5. Troubleshooting

### "Needs authentication" Error

**Cause:** Environment variable not set or incorrect

**Solution:**

1. Verify variable is exported: `echo $LINEAR_API_KEY`
2. Check for typos in token value
3. Restart shell after adding to profile
4. Restart Claude Code session

### "Connection refused" Error

**Cause:** Network or firewall blocking MCP server

**Solution:**

1. Check internet connectivity
2. Verify no proxy/firewall blocking `mcp.linear.app` or `npx`
3. Try accessing Linear/Sentry web UI to confirm access

### Token Expired or Revoked

**Cause:** Token was deleted or expired

**Solution:**

1. Go to Linear/Sentry settings
2. Create new token
3. Update environment variable
4. Restart Claude Code session

### Sentry STDIO Not Starting

**Cause:** `npx` or Node.js issues

**Solution:**

```bash
# Verify npx works
npx --version

# Try running Sentry MCP directly
npx @sentry/mcp-server@latest --help
```

## 6. Security Best Practices

### DO

- Store tokens in shell profile (not in committed files)
- Use separate tokens for different environments
- Rotate tokens periodically
- Use minimal required scopes for Sentry

### DON'T

- Never commit tokens to git
- Never share tokens in screenshots or logs
- Don't use production tokens for development
- Don't grant excessive Sentry scopes

## 7. Environment-Specific Notes

### Local Development

- Tokens in `~/.zshrc` or `~/.bashrc`
- Restart terminal after changes

### CI/CD Environments

- Store tokens in CI secrets (GitHub Actions, etc.)
- Reference as environment variables in workflow

### Cloud Development (Claude Code Web)

- Provide tokens when prompted
- Tokens stored in session only

## 8. Related Documentation

- [05 - Local Development](./05-local-dev-with-gcp-deps.md) - GCP local setup
- [10 - Claude Code Cloud Dev](./10-claude-code-cloud-dev.md) - Cloud environment setup
- [Linear MCP Docs](https://linear.app/docs/mcp) - Official Linear MCP documentation
- [Sentry MCP Docs](https://docs.sentry.io/product/sentry-mcp/) - Official Sentry MCP documentation

## 9. Quick Start Checklist

```
[ ] LINEAR_API_KEY exported in shell profile
[ ] SENTRY_AUTH_TOKEN exported in shell profile
[ ] Shell restarted (or `source ~/.zshrc`)
[ ] Superpowers marketplace added: `claude plugins marketplace add obra/superpowers-marketplace`
[ ] Superpowers installed: `claude plugins install superpowers@superpowers-marketplace`
[ ] `claude mcp list` shows Linear and Sentry connected
[ ] Test query works for both services
```
