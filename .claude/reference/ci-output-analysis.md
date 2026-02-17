# CI Output Analysis Reference

## Required Pattern: Capture First, Analyze Second

### Step 1: Run CI with tee capture

```bash
BRANCH=$(git branch --show-current | sed 's/\//-/g')
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-${BRANCH}-$(date +%Y%m%d-%H%M%S).txt
```

### Step 2: Analyze saved output with proper tools

**Tool Priority (use first available):**

| Tool   | Command                                | Why                                       |
| ------ | -------------------------------------- | ----------------------------------------- |
| `bat`  | `bat /tmp/ci-output-*.txt`             | Syntax highlighting, line numbers, paging |
| `rg`   | `rg "error\|FAIL" /tmp/ci-*.txt -C3`   | Fast, smart regex, context lines          |
| `jq`   | For JSON files only (coverage-summary) | Structured data parsing                   |
| `grep` | `grep -E "error\|FAIL" /tmp/ci-*.txt`  | Fallback only                             |

### Examples

```bash
# Find errors with context (ripgrep)
rg -i "error|fail|exception" /tmp/ci-output-*.txt --context 5

# View with syntax highlighting (bat)
bat /tmp/ci-output-*.txt --paging=never

# Search multiple patterns
rg "(FAIL|error TS|Cannot find)" /tmp/ci-output-*.txt

# Count occurrences
rg -c "error" /tmp/ci-output-*.txt
```

## FORBIDDEN

- `pnpm run ci:tracked | grep`
- `pnpm run ci:tracked | tail -30`
- Any CI command piped directly to text processors

## Why

- Terminal output truncates at ~30k chars
- Piping loses the full output permanently
- Saved files allow multiple analysis passes
- Better tools provide context, highlighting, fast search
