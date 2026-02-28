# Tool Recommendations Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a PreToolUse Bash hook that soft-blocks commands using `grep`, `cat`, or `find` in contexts where `rg`, `bat`, or `fd` are better alternatives, educating Claude to prefer CLAUDE.md-recommended tools.

**Architecture:** A single bash hook script receives Bash tool JSON via stdin, pattern-matches the command against three tool-preference rules, and outputs a JSON soft-block to stdout when a suboptimal tool is detected. Soft blocks (exit 0 + JSON `decision: block`) educate rather than hard-block — Claude Code surfaces the suggestion but allows override.

**Tech Stack:** Bash, jq, shared `lib/log.sh` logging library, Vitest test framework with existing hook test helpers.

---

## Task 1: Register the hook in settings.json

**Files:**
- Modify: `.claude/settings.json` (line ~82, inside the `"matcher": "Bash"` PreToolUse hooks array)

**Step 1: Add the hook entry**

Add a new entry at the end of the Bash PreToolUse hooks array (after `validate-no-direct-hook-exec.sh`):

```json
{
  "type": "command",
  "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-recommendations.sh"
}
```

The complete hooks array entry (appended after line 82 in the Bash matcher block):

```json
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-recommendations.sh"
          }
```

**Step 2: Verify JSON validity**

Run: `jq . .claude/settings.json > /dev/null && echo "Valid JSON"`
Expected: `Valid JSON`

**Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(hooks): register tool-recommendations hook in settings.json"
```

---

## Task 2: Create the hook shell script

**Files:**
- Create: `.claude/hooks/tool-recommendations.sh`

**Step 1: Create the hook script**

Create `.claude/hooks/tool-recommendations.sh` with this content:

```bash
#!/bin/bash
# SOFT-BLOCK: Suggest recommended tools over common alternatives
# Suggests: rg over grep, bat over cat, fd over find
# Uses soft blocks (JSON decision) to educate, not hard block
# Exit 0 always (soft block via JSON stdout)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="tool-recommendations"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only process Bash commands
[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Helper: emit soft block JSON to stdout and log entry
soft_block() {
    local pattern="$1"
    local message="$2"
    local suggestion="$3"

    log_warned "$HOOK_NAME" "$pattern" "-" "$message" "$suggestion"

    cat >&2 << EOF

⚠️ TOOL RECOMMENDATION: $message

$suggestion

Reference: CLAUDE.md > CI Failure Protocol
EOF

    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ TOOL RECOMMENDATION: $message\n\n$suggestion\n\nReference: CLAUDE.md > CI Failure Protocol"
}
EOF
    exit 0
}

# --- Pattern 1: grep → rg ---
# Match: grep used for searching code/files (not inside pipelines like ps aux | grep)
# Conservative: only match grep at the START of a command or after && / ; / |
# Exclude: grep used with ps, env, echo (not code search)
if echo "$COMMAND" | grep -qE '(^|&&|;|\|)\s*grep\s+(-[a-zA-Z]*\s+)*(-r|-R|--include|--recursive)' ||
   echo "$COMMAND" | grep -qE '(^|&&|;)\s*grep\s+(-[a-zA-Z]*\s+)*["\x27]' ||
   echo "$COMMAND" | grep -qE '(^|&&|;)\s*grep\s+(-[a-zA-Z]*\s+)+\S+\s+(apps|packages|src|\.claude)/'; then

    soft_block "grep-over-rg" \
        "Use rg (ripgrep) instead of grep for code searching." \
        "WRONG:  grep -r 'pattern' src/
RIGHT:  rg 'pattern' src/

rg is faster, respects .gitignore, and provides better output formatting."
fi

# --- Pattern 2: cat on log/temp files → bat ---
# Match: cat used on /tmp files, *.log files, or CI output files
# Conservative: only match cat with specific file patterns
if echo "$COMMAND" | grep -qE '(^|&&|;|\|)\s*cat\s+(/tmp/|.*\.log|.*ci-output)'; then

    soft_block "cat-over-bat" \
        "Use bat instead of cat for viewing log and temp files." \
        "WRONG:  cat /tmp/ci-output.txt
RIGHT:  bat /tmp/ci-output.txt

bat provides syntax highlighting and line numbers for easier analysis."
fi

# --- Pattern 3: find . -name → fd ---
# Match: find with -name or -iname flag (file finding pattern)
# Conservative: only match find with path and -name/-iname
if echo "$COMMAND" | grep -qE '(^|&&|;|\|)\s*find\s+\S+\s+.*-(i?name)\s'; then

    soft_block "find-over-fd" \
        "Use fd instead of find for file searching." \
        "WRONG:  find . -name '*.ts'
RIGHT:  fd '\.ts$'

fd is faster, respects .gitignore, and has simpler syntax."
fi

exit 0
```

**Step 2: Make it executable**

Run: `chmod +x .claude/hooks/tool-recommendations.sh`

**Step 3: Verify basic execution**

Run: `echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | bash .claude/hooks/tool-recommendations.sh && echo "Exit: $?"`
Expected: `Exit: 0` (no output for unrelated commands)

**Step 4: Commit**

```bash
git add .claude/hooks/tool-recommendations.sh
git commit -m "feat(hooks): add tool-recommendations hook for grep/cat/find"
```

---

## Task 3: Write the test file — blocked scenarios

**Files:**
- Create: `.claude/hooks/__tests__/tool-recommendations.test.ts`

**Step 1: Write tests for all three blocked patterns**

Create `.claude/hooks/__tests__/tool-recommendations.test.ts`:

```typescript
import { describe, it, beforeEach } from 'vitest';
import {
  executeHookSync,
  clearHooksLog,
  HookFixtureBuilder,
  expectSoftBlock,
  expectAllowed,
  expectLogEntry,
} from './helpers/index.js';

describe.sequential('Claude Hooks - Tool Recommendations', () => {
  beforeEach(() => {
    clearHooksLog();
  });

  describe('grep → rg suggestions', () => {
    it('suggests rg when grep is used with -r flag for recursive search', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -r "pattern" src/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('suggests rg when grep is used with -R flag', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -R "error" apps/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('suggests rg when grep is used with --recursive', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep --recursive "TODO" packages/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('suggests rg when grep is used with --include flag', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep --include="*.ts" "import" .'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('suggests rg when grep searches code directories', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -n "function" apps/code-agent/src/'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('suggests rg when grep is used with a quoted pattern at command start', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep "error" file.ts'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'rg',
      });
    });

    it('logs a WARNED entry when grep is detected', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('grep -r "pattern" src/'),
      });

      expectLogEntry(result, {
        level: 'WARNED',
        hook: 'tool-recommendations',
        pattern: 'grep-over-rg',
      });
    });
  });

  describe('cat → bat suggestions', () => {
    it('suggests bat when cat is used on /tmp files', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat /tmp/ci-output.txt'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'bat',
      });
    });

    it('suggests bat when cat is used on .log files', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat server.log'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'bat',
      });
    });

    it('suggests bat when cat is used on ci-output files', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat ci-output-main-20260228.txt'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'bat',
      });
    });

    it('suggests bat when cat is used after && on /tmp file', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('echo "done" && cat /tmp/results.log'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'bat',
      });
    });

    it('logs a WARNED entry when cat on log file is detected', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat /tmp/output.log'),
      });

      expectLogEntry(result, {
        level: 'WARNED',
        hook: 'tool-recommendations',
        pattern: 'cat-over-bat',
      });
    });
  });

  describe('find → fd suggestions', () => {
    it('suggests fd when find is used with -name flag', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find . -name "*.ts"'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'fd',
      });
    });

    it('suggests fd when find is used with -iname flag', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find src -iname "readme*"'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'fd',
      });
    });

    it('suggests fd when find has additional flags before -name', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find . -type f -name "*.json"'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'fd',
      });
    });

    it('suggests fd when find is used after &&', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cd /repo && find . -name "*.sh"'),
      });

      expectSoftBlock(result, {
        reasonIncludes: 'fd',
      });
    });

    it('logs a WARNED entry when find -name is detected', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find . -name "*.ts"'),
      });

      expectLogEntry(result, {
        level: 'WARNED',
        hook: 'tool-recommendations',
        pattern: 'find-over-fd',
      });
    });
  });

  describe('allowed commands (no suggestions)', () => {
    it('allows rg commands without suggestion', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('rg "pattern" src/'),
      });

      expectAllowed(result);
    });

    it('allows bat commands without suggestion', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('bat /tmp/ci-output.txt'),
      });

      expectAllowed(result);
    });

    it('allows fd commands without suggestion', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('fd "*.ts" src/'),
      });

      expectAllowed(result);
    });

    it('allows git commands without suggestion', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('git status'),
      });

      expectAllowed(result);
    });

    it('allows pnpm commands without suggestion', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('pnpm test'),
      });

      expectAllowed(result);
    });

    it('allows cat on regular source files (not logs/tmp)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('cat package.json'),
      });

      expectAllowed(result);
    });

    it('allows find without -name flag (e.g. find with -exec)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('find . -type d'),
      });

      expectAllowed(result);
    });

    it('allows grep inside a pipeline from ps/env (not code search)', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash('ps aux | grep node'),
      });

      expectAllowed(result);
    });

    it('allows empty commands', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: HookFixtureBuilder.bash(''),
      });

      expectAllowed(result);
    });

    it('allows non-Bash tools', () => {
      const result = executeHookSync({
        hookName: 'tool-recommendations',
        input: { tool_name: 'Edit', tool_input: { file_path: 'test.ts', old_string: '', new_string: '' } },
      });

      expectAllowed(result);
    });
  });
});
```

**Step 2: Run tests to verify they fail (hook script not fully wired yet is OK if created in Task 2)**

Run: `cd /repo && pnpm vitest run tool-recommendations.test.ts --config .claude/hooks/__tests__/vitest.config.ts`
Expected: Tests pass if Task 2 was completed first.

**Step 3: Commit**

```bash
git add .claude/hooks/__tests__/tool-recommendations.test.ts
git commit -m "test(hooks): add tool-recommendations hook tests"
```

---

## Task 4: Run tests, fix edge cases, verify coverage

**Step 1: Run all hook tests**

Run: `cd /repo && pnpm vitest run --config .claude/hooks/__tests__/vitest.config.ts`
Expected: All tests pass including new tool-recommendations tests.

**Step 2: Check for false positives in patterns**

Manually verify these edge cases don't trigger false positives by running:

```bash
# Should NOT trigger (grep in pipeline from ps)
echo '{"tool_name":"Bash","tool_input":{"command":"ps aux | grep node"}}' | bash .claude/hooks/tool-recommendations.sh
echo "Exit: $?"

# Should NOT trigger (cat on source file)
echo '{"tool_name":"Bash","tool_input":{"command":"cat package.json"}}' | bash .claude/hooks/tool-recommendations.sh
echo "Exit: $?"

# Should NOT trigger (find without -name)
echo '{"tool_name":"Bash","tool_input":{"command":"find . -type d"}}' | bash .claude/hooks/tool-recommendations.sh
echo "Exit: $?"
```

Expected: All exit 0 with no JSON output.

**Step 3: Verify soft block output format**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"grep -r \"error\" src/"}}' | bash .claude/hooks/tool-recommendations.sh 2>/dev/null | jq .
```

Expected: Valid JSON with `"decision": "block"` and `"reason"` containing `rg`.

**Step 4: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All phases pass.

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(hooks): address edge cases in tool-recommendations patterns"
```

---

## Design Decisions

| Decision                    | Choice                                          | Rationale                                                                  |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Block type                  | Soft block (JSON `decision: block`, exit 0)     | Issue explicitly requires soft blocks for education, not enforcement       |
| Pattern matching approach   | Conservative regex with context checks          | Avoids false positives (e.g., `ps aux \                                    | grep` should not trigger) |
| grep trigger scope          | Recursive flags, `--include`, quoted patterns   | Targets code search, not pipeline filtering                                |
| cat trigger scope           | `/tmp/` files, `*.log`, `ci-output*`            | Only log/temp files where bat adds value, not source files                 |
| find trigger scope          | Requires `-name` or `-iname` flag               | Only file finding patterns where fd is faster, not `find -type d`          |
| CLAUDE.md reference         | Included in every suggestion message            | Issue requirement: suggestions must reference CLAUDE.md                    |
| Logging level               | `log_warned` (not `log_blocked`)                | Soft blocks are warnings, not hard blocks                                  |

## Edge Cases to Be Aware Of

1. **`grep` in pipeline from `ps` or `env`**: The pattern checks for `grep` at command start or after `&&`/`;`, avoiding `ps aux | grep node`. However, `echo "text" | grep pattern` at the START of a command line would trigger — this is acceptable since `rg` handles stdin too.
2. **`cat` on regular files**: Only matches `/tmp/`, `*.log`, and `ci-output` patterns. `cat package.json` is allowed since that's normal file reading.
3. **`find` without `-name`**: `find . -type d` is allowed since `fd` doesn't replace all `find` use cases.
4. **Multiple patterns in one command**: The script exits after the first match (via `exit 0` inside `soft_block`), so only one suggestion is shown per command. This is intentional to avoid overwhelming suggestions.
