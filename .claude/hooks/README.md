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

## Codex Parity Ownership

Codex does not execute this hook layer directly. For orchestrated Codex runs, the equivalent guarantees are intentionally split across bootstrap and orchestrator-owned validation surfaces:

| Bucket                 | Owner                                         | Examples                                                                                                     | Evidence                                                           |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `Codex bootstrap`      | `workers/code-worker/entrypoint.sh`           | session-start readiness, skill restore, env loading, auth setup                                              | `[entrypoint] Bootstrap evidence: ...`                             |
| `orchestrator/runtime` | prompt + completion verifier + deep validator | completion contract, CI/PR evidence, ownership/evidence checks                                               | transcript evidence, deep-validation report, final execution block |
| `Claude-only drop`     | none                                          | edit-time hook blockers/reminders like `detect-common-patterns`, `rebuild-after-git`, `typecheck-after-edit` | explicitly omitted for Codex                                       |

### PostToolUse (File Content Checks)

| Hook                     | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `detect-common-patterns` | **Consolidated checker** for CI-breaking patterns (see below) |

### Stop (Session Completion Checks)

| Hook                   | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `ownership-check`      | Detects ownership-deflecting language in responses                        |
| `completion-validator` | Validates worker task completion (Phase 1: labels, Phase 2: PR/CI/Linear) |

### PreToolUse (Command Blocking)

| Hook                         | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `validate-coverage-commands` | Blocks coverage + grep                  |
| `validate-ci-output-capture` | Blocks CI commands without `tee`        |
| `validate-polling`           | Blocks inefficient polling patterns     |
| `validate-vitest-flags`      | Blocks redundant vitest flags           |
| `validate-verify-workspace`  | Blocks incorrect verify:workspace usage |
| `validate-coverage-config`   | Warns on vitest.config.ts edits         |
| `validate-commit-typecheck`  | TypeScript check before commit          |
| `validate-terraform`         | Terraform validation                    |
| `validate-gcloud-resources`  | GCloud resources via Terraform only     |
| `validate-gcloud-builds`     | Streaming for gcloud builds             |
| `validate-linear-state`      | Blocks agent transitions to QA/Done     |

## Consolidated Pattern Detection

`detect-common-patterns.sh` is the unified PostToolUse checker for file content. It detects:

| Category       | Pattern                 | Scope                                | Escape Hatch            |
| -------------- | ----------------------- | ------------------------------------ | ----------------------- |
| **Logging**    | Direct `import pino`    | `apps/**/*.ts` (not tests/server.ts) | `@allow-pino-import`    |
| **Response**   | Raw `reply.send()`      | `apps/**/routes/**/*.ts`             | `@allow-raw-send`       |
| **ESM**        | Missing `.js` extension | `*.ts/*.tsx`                         | `@allow-missing-js`     |
| **TypeScript** | `\| undefined` in types | `*.ts/*.tsx`                         | `@allow-undefined-type` |
| **TypeScript** | `.value` without `.ok`  | `*.ts/*.tsx`                         | `@allow-result-access`  |
| **Migrations** | Edit/overwrite existing | `migrations/*.mjs`                   | None (absolute rule)    |
| **Coverage**   | `v8 ignore` added       | `*.ts/*.tsx` (not tests)             | None (always reminds)   |

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

| Pattern                      | Level   | Hook                       | Description                              |
| ---------------------------- | ------- | -------------------------- | ---------------------------------------- |
| `pino-import`                | WARNED  | detect-common-patterns     | Direct pino import (use createAppLogger) |
| `reply-send`                 | WARNED  | detect-common-patterns     | Raw reply.send() (use reply.ok/fail)     |
| `missing-js-extension`       | WARNED  | detect-common-patterns     | Import without `.js` extension           |
| `bad-undefined-type`         | WARNED  | detect-common-patterns     | `\| undefined` instead of `?:`           |
| `result-value-without-ok`    | WARNED  | detect-common-patterns     | `.value` without `.ok` check             |
| `migration-immutable`        | WARNED  | detect-common-patterns     | Modifying existing migration file        |
| `v8-ignore-added`            | WARNED  | detect-common-patterns     | v8 ignore added (write test first)       |
| `coverage-with-grep`         | BLOCKED | validate-coverage-commands | Parsing coverage with grep instead of jq |
| `output-truncation`          | BLOCKED | validate-ci-output-capture | Piping CI output to tail/head            |
| `gh-pr-checks-polling`       | BLOCKED | validate-polling           | Using sleep + gh pr checks               |
| `ownership-violation`        | BLOCKED | ownership-check            | Using forbidden ownership language       |
| `forbidden-state-transition` | BLOCKED | validate-linear-state      | Agent trying to set QA/Done status       |
| `phase1-incomplete`          | BLOCKED | completion-validator       | Phase 1 missing code-task/unclear label  |
| `phase2-incomplete`          | BLOCKED | completion-validator       | Phase 2 missing PR/CI/Linear artifacts   |

## Testing Hooks

Run hook tests:

```bash
bash .claude/hooks/__tests__/run-tests.sh
```

Tests use fixtures in `.claude/hooks/__tests__/fixtures/` with valid/invalid examples for each pattern.
