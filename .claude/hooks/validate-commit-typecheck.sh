#!/bin/bash
# PreToolUse Hook: Block git commit if TypeScript errors exist in staged files
# Safety net before commits - verifies staged .ts files pass typecheck.
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

cd "$(dirname "$0")/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Only check git commit commands
if ! echo "$COMMAND" | grep -qE '^git\s+commit'; then
  exit 0
fi

# Get staged TypeScript files
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(ts|tsx)$' | grep -v '\.d\.ts$' || true)

[[ -z "$STAGED_TS" ]] && exit 0

# Group files by workspace and check each
declare -A WORKSPACE_FILES
for FILE in $STAGED_TS; do
  if [[ "$FILE" =~ ^(apps/[^/]+|packages/[^/]+|workers/[^/]+)/ ]]; then
    WS="${BASH_REMATCH[1]}"
    WORKSPACE_FILES[$WS]="${WORKSPACE_FILES[$WS]:-} $FILE"
  fi
done

ERRORS_FOUND=0
ERROR_OUTPUT=""

for WS in "${!WORKSPACE_FILES[@]}"; do
  [[ ! -f "$WS/tsconfig.json" ]] && continue

  OUTPUT=$(cd "$WS" && npx tsc --noEmit --skipLibCheck 2>&1) || {
    ERRORS_FOUND=1
    ERROR_OUTPUT+="
━━━ $WS ━━━
$(echo "$OUTPUT" | grep -E "(error TS|^\s+\d+\s)" | head -10)"
  }
done

if [ "$ERRORS_FOUND" -eq 1 ]; then
  cat >&2 << EOF

⛔ BLOCKED: TypeScript errors in staged files.

Fix these errors before committing:
$ERROR_OUTPUT

Run 'pnpm typecheck' for full output.
EOF
  exit 2
fi

# Also verify packages are built
for pkg in packages/*/; do
  if [ -f "$pkg/package.json" ]; then
    HAS_BUILD=$(jq -r '.scripts.build // empty' "$pkg/package.json" 2>/dev/null)
    if [ -n "$HAS_BUILD" ] && [ ! -d "$pkg/dist" ]; then
      cat >&2 << EOF

⛔ BLOCKED: Package $(basename $pkg) has no dist/ directory.

Run 'pnpm build' before committing.
EOF
      exit 2
    fi
  fi
done

exit 0
