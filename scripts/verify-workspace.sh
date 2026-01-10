#!/bin/bash
# Targeted verification for a single workspace
# Usage: ./scripts/verify-workspace.sh <workspace-name>
# Example: ./scripts/verify-workspace.sh llm-orchestrator

WORKSPACE=$1
if [ -z "$WORKSPACE" ]; then
  echo "Usage: $0 <workspace-name>"
  echo "Example: $0 llm-orchestrator"
  exit 1
fi

set -e

echo "=== Targeted Verification: $WORKSPACE ==="
echo ""

echo "[1/4] TypeCheck (source)..."
npm run typecheck --workspace @intexuraos/$WORKSPACE

echo ""
echo "[2/4] TypeCheck (tests)..."
# Create temporary tsconfig in project root for workspace-specific test checking
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEMP_TSCONFIG="$PROJECT_ROOT/.tsconfig.tests-workspace.json"
cat > "$TEMP_TSCONFIG" << EOF
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["vitest/globals", "node"],
    "baseUrl": ".",
    "paths": {
      "@intexuraos/*": ["packages/*/src", "apps/*/src"]
    }
  },
  "include": ["apps/$WORKSPACE/src/__tests__/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF
tsc --project "$TEMP_TSCONFIG"
rm "$TEMP_TSCONFIG"

echo ""
echo "[3/4] Lint..."
npm run lint -- apps/$WORKSPACE/src

echo ""
echo "[4/4] Tests + Coverage..."
npm run test -- apps/$WORKSPACE --coverage --coverage.include="apps/$WORKSPACE/src/**/*.ts"

echo ""
echo "=== All checks passed for $WORKSPACE ==="
