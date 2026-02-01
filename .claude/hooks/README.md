# Claude Hooks

PostToolUse and PreToolUse hooks that validate and guide Claude's behavior.

## Structured Logging

All hooks now use a shared logging library (`lib/log.sh`) that writes to a unified TSV log file.

### Log Format

Each log entry is a tab-separated line with 7 fields:

| Field        | Description                | Example                         |
| ------------ | -------------------------- | ------------------------------- |
| `timestamp`  | ISO 8601 UTC               | `2026-01-31T23:46:20.123Z`      |
| `level`      | Severity                   | `WARNED`, `BLOCKED`, `INFO`     |
| `hook`       | Source hook name           | `detect-common-patterns`        |
| `pattern`    | Specific pattern matched   | `missing-js-extension`          |
| `file`       | Affected file (or `-`)     | `apps/foo/src/index.ts`         |
| `message`    | Human-readable explanation | `Line 42: from './helper'`      |
| `suggestion` | Alternative approach       | `Change to: from './helper.js'` |

### Log File Location

```
.claude/hooks/hooks.log
```

## Query Interface

Use `query-hooks.sh` to search and filter hook logs:

```bash
# All warnings for a specific file
./query-hooks.sh --file migrations/__tests__/040-create-doc-embeddings.test.ts

# All blocked commands from a specific hook
./query-hooks.sh --hook validate-ci-output-capture --level BLOCKED

# Most recent 10 entries
./query-hooks.sh --tail 10

# Entries from the last hour
./query-hooks.sh --since '1 hour ago'

# Summary of patterns by frequency
./query-hooks.sh --summary
```

## Available Hooks

| Hook                         | Type        | Purpose                                 |
| ---------------------------- | ----------- | --------------------------------------- |
| `detect-common-patterns`     | PostToolUse | Detects TypeScript anti-patterns        |
| `validate-coverage-commands` | PreToolUse  | Blocks coverage + grep                  |
| `validate-ci-output-capture` | PreToolUse  | Blocks CI commands without `tee`        |
| `validate-polling`           | PreToolUse  | Blocks inefficient polling patterns     |
| `validate-vitest-flags`      | PreToolUse  | Blocks redundant vitest flags           |
| `validate-verify-workspace`  | PreToolUse  | Blocks incorrect verify:workspace usage |
| `validate-coverage-config`   | PreToolUse  | Warns on vitest.config.ts edits         |
| `ownership-check`            | PostToolUse | Detects ownership-deflecting language   |

## Adding a New Hook

1. Create the hook script following the naming convention: `validate-*.sh` or `detect-*.sh`
2. Source the shared logging library:

```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/log.sh"
```

3. Use the logging functions:

```bash
# For warnings
log_warned "$HOOK_NAME" "pattern-name" "$file" "$message" "$suggestion"

# For blocked commands
log_blocked "$HOOK_NAME" "pattern-name" "$message" "$suggestion"

# For informational entries
log_info "$HOOK_NAME" "pattern-name" "$message" "$suggestion"
```

4. Make the script executable: `chmod +x your-hook.sh`

## Pattern Reference

Common patterns logged by hooks:

| Pattern                   | Level   | Hook                       | Description                              |
| ------------------------- | ------- | -------------------------- | ---------------------------------------- | ------------------------ |
| `missing-js-extension`    | WARNED  | detect-common-patterns     | Import from local file without `.js`     |
| `bad-undefined-type`      | WARNED  | detect-common-patterns     | Using `                                  | undefined`instead of`?:` |
| `result-value-without-ok` | WARNED  | detect-common-patterns     | Accessing `.value` without `.ok` check   |
| `coverage-with-grep`      | BLOCKED | validate-coverage-commands | Parsing coverage with grep instead of jq |
| `output-truncation`       | BLOCKED | validate-ci-output-capture | Piping CI output to tail/head            |
| `gh-pr-checks-polling`    | BLOCKED | validate-polling           | Using sleep + gh pr checks               |
| `ownership-violation`     | BLOCKED | ownership-check            | Using forbidden ownership language       |
