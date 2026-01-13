#!/bin/bash
# Targeted verification for a single workspace
# Usage: ./scripts/verify-workspace.sh <workspace-name>
# Example: ./scripts/verify-workspace.sh research-agent

WORKSPACE=$1
if [ -z "$WORKSPACE" ]; then
  echo "Usage: $0 <workspace-name>"
  echo "Example: $0 research-agent"
  exit 1
fi

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Web app has different verification due to planned refactoring
# - Tests are in nested __tests__ directories (not centralized)
# - Source files use Vite-specific patterns (import.meta.env)
# - Coverage threshold excluded (refactoring planned)
if [ "$WORKSPACE" = "web" ]; then
  echo "=== Targeted Verification: $WORKSPACE (adjusted for web config) ==="
  echo ""

  echo "[1/3] TypeCheck (source)..."
  pnpm run --filter @intexuraos/$WORKSPACE typecheck

  echo ""
  echo "[2/3] Lint..."
  pnpm run lint -- apps/$WORKSPACE/src

  echo ""
  echo "[3/3] Tests (no coverage threshold)..."
  pnpm run test -- apps/$WORKSPACE

  echo ""
  echo "=== All checks passed for $WORKSPACE ==="
  exit 0
fi

# Standard verification for all other workspaces
echo "=== Targeted Verification: $WORKSPACE ==="
echo ""

echo "[1/4] TypeCheck (source)..."
pnpm run --filter @intexuraos/$WORKSPACE typecheck

echo ""
echo "[2/4] TypeCheck (tests)..."
# Create temporary tsconfig in project root for workspace-specific test checking
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
pnpm run lint -- apps/$WORKSPACE/src

echo ""
echo "[4/4] Tests + Coverage..."
pnpm run test -- apps/$WORKSPACE --coverage --coverage.include="apps/$WORKSPACE/src/**/*.ts"

echo ""
echo "=== All checks passed for $WORKSPACE ==="
