# GLM Coder MCP Server

An MCP server that delegates code generation to GLM-4.7 via Z.AI's coding API, with built-in metrics tracking to measure effectiveness.

## Overview

The GLM Coder enables a cost-effective "orchestrator + specialist" pattern:

- **Claude (Opus):** Handles reasoning, planning, architecture decisions, code review
- **GLM-4.7:** Handles implementation code generation (cheaper, unlimited tokens)

## Quick Start

### 1. Install Dependencies

```bash
cd tools/mcp-glm-coder
pnpm install
pnpm build
```

### 2. Configure API Key

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export Z_API_KEY="your-api-key-here"
```

### 3. Add to MCP Configuration

Add to `.mcp.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "glm-coder": {
      "command": "node",
      "args": ["tools/mcp-glm-coder/dist/index.js"],
      "cwd": "${workspaceFolder}",
      "env": {
        "Z_API_KEY": "${env:Z_API_KEY}",
        "GLM_MODEL": "glm-4.7",
        "GLM_ENDPOINT": "https://api.z.ai/api/coding/paas/v4"
      }
    }
  }
}
```

## Available Tools

### `generate_code`

Generate TypeScript code using GLM-4.7 with automatic project context loading.

**Parameters:**

| Parameter      | Type     | Required | Description                                      |
| -------------- | -------- | -------- | ------------------------------------------------ |
| `task`         | string   | Yes      | What code to implement                           |
| `contextFiles` | string[] | No       | Paths to files that provide context              |
| `targetFile`   | string   | No       | Where this code will live (helps with imports)   |
| `style`        | enum     | No       | Code style: `minimal`, `documented`, `defensive` |

**Example:**

```typescript
mcp__glm_coder__generate_code({
  task: 'Implement deleteBookmark use case that soft-deletes by setting deletedAt',
  contextFiles: [
    'apps/bookmark-service/src/domain/usecases/createBookmark.ts',
    'apps/bookmark-service/src/domain/repos/BookmarkRepo.ts',
  ],
  targetFile: 'apps/bookmark-service/src/domain/usecases/deleteBookmark.ts',
  style: 'minimal',
});
```

### `glm_stats`

View usage statistics and metrics for GLM code generation.

**Example output:**

```
GLM Coder Metrics Report
========================
Period: 2026-02-01 → 2026-02-06
Total Calls: 47

SUCCESS RATES
─────────────
Final Success Rate:     85.1%
First-Attempt Success:  68.1%
Average Attempts:       1.32
Manual Edits Required:  12.8%

PERFORMANCE
───────────
Average Latency: 2.34s
```

## Metrics System

### What's Tracked

| Metric                    | Description                                    |
| ------------------------- | ---------------------------------------------- |
| **Call count**            | Total GLM invocations                          |
| **Success rate**          | Percentage of calls that pass validation       |
| **First-attempt success** | Calls that succeed without retries             |
| **Average attempts**      | Mean number of attempts per call               |
| **Manual edit rate**      | Percentage of outputs that Claude later edited |
| **Latency**               | Time per API call                              |
| **Error categories**      | Type of validation failures                    |

### Storage Location

Metrics are stored in `~/.glm-coder/`:

- `metrics.jsonl` - Call metrics (one JSON object per line)
- `post-hoc.jsonl` - Manual edit tracking

### CLI Stats Command

```bash
# From project root
pnpm --filter @intexuraos/mcp-glm-coder stats

# Or directly
node tools/mcp-glm-coder/dist/cli/stats.js

# Options
glm-stats --recent 10     # Last 10 calls only
glm-stats --since 2026-02-01  # Since specific date
glm-stats --json          # Raw JSON output
```

## Post-Hoc Edit Tracking

A Claude Code hook (`track-glm-usage.sh`) automatically detects when GLM-generated files are manually edited afterward. This measures the "true quality" of GLM output.

**How it works:**

1. GLM generates code for `targetFile`
2. Metrics record the call with the target file path
3. If Claude's Edit/Write tool modifies that file within 5 minutes, it's flagged as "manual edit required"
4. Stats report shows the manual edit rate

## When to Delegate to GLM

| Task Type                   | Delegate? | Notes                                |
| --------------------------- | --------- | ------------------------------------ |
| New use case implementation | ✅ Yes    | Provide similar use case as context  |
| Test file generation        | ✅ Yes    | Best ROI, saves most Opus tokens     |
| CRUD operations             | ✅ Yes    | Boilerplate-heavy, pattern-based     |
| Route handlers              | ✅ Yes    | Follow existing patterns             |
| Complex business logic      | ⚠️ Maybe  | Review output carefully              |
| Architecture decisions      | ❌ No     | Requires deep codebase understanding |
| Bug investigation           | ❌ No     | Requires reasoning about behavior    |
| Refactoring                 | ❌ No     | Needs context of why code exists     |

## Cost Analysis

With Z.AI's $90/quarter unlimited plan:

| Scenario        | All-Opus | Opus + GLM       | Savings          |
| --------------- | -------- | ---------------- | ---------------- |
| 50 tasks/month  | $55      | $40 + $30 fixed  | ~15%             |
| 100 tasks/month | $110     | $80 + $30 fixed  | ~0% (break-even) |
| 200 tasks/month | $220     | $160 + $30 fixed | ~14%             |
| 500 tasks/month | $550     | $400 + $30 fixed | ~22%             |

**Key insight:** Savings scale with volume. The more you delegate, the more you save.

## Validation Pipeline

GLM output goes through multiple validation steps:

1. **Syntax check** - Basic bracket/quote balancing
2. **TypeScript check** - `tsc --noEmit` on temp file
3. **Retry with feedback** - If validation fails, GLM retries with error context (up to 3 attempts)
4. **Return with warnings** - If all attempts fail, returns code with warning comments

## Project Context

The MCP server automatically loads:

1. **CLAUDE.md rules** - Extracted coding patterns and rules
2. **tsconfig.json** - TypeScript configuration
3. **Pattern examples** - Sample code from common-types package
4. **Context files** - Files you explicitly pass

This context is injected into GLM's system prompt to improve output quality.

## Troubleshooting

### "Z_API_KEY environment variable is required"

Ensure your API key is set:

```bash
echo $Z_API_KEY  # Should print your key
```

### High manual edit rate (>30%)

GLM output frequently needs fixing. Try:

1. Provide more context files
2. Include similar existing code as reference
3. Check if GLM is missing specific patterns

### Validation always fails

Check if TypeScript compilation works:

```bash
cd ~/personal/intexuraos-2
pnpm build  # Ensure packages are built
```

### Metrics not appearing

Verify metrics file exists:

```bash
ls -la ~/.glm-coder/
cat ~/.glm-coder/metrics.jsonl | tail -5
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Code                                                 │
│   • Orchestrates tasks                                      │
│   • Calls mcp__glm_coder__generate_code                     │
│   • Reviews and integrates output                           │
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP protocol
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ GLM Coder MCP Server (tools/mcp-glm-coder)                  │
│   • Loads project context                                   │
│   • Builds system prompt                                    │
│   • Calls Z.AI API                                          │
│   • Validates output                                        │
│   • Tracks metrics                                          │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Z.AI Coding API                                             │
│   • Endpoint: api.z.ai/api/coding/paas/v4                   │
│   • Model: glm-4.7                                          │
│   • Unlimited tokens ($90/quarter)                          │
└─────────────────────────────────────────────────────────────┘
```
