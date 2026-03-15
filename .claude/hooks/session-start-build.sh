#!/bin/bash

# Session Start Hook: Build packages + verify environment
# 1. Ensures all buildable packages have dist/ at session start.
#    This prevents the ~2,400 no-unsafe-* lint errors caused by unresolved types.
# 2. Ensures direnv is allowed and critical env vars are loadable.
#    Bash tool calls use login shells (zsh -c -l) which trigger the direnv hook,
#    but direnv won't load .envrc unless it's been `direnv allow`-ed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/sessions.log"
SESSION_BLOCKED_FILE="${SCRIPT_DIR}/session-blocked.log"
SESSION_COMMANDS_FILE="${SCRIPT_DIR}/session-commands.log"

cd "$(dirname "$0")/../.." || exit 0

# Clear session-scoped logs (atomic truncate)
: > "$SESSION_BLOCKED_FILE"
: > "$SESSION_COMMANDS_FILE"

# Log session start with timestamp
if command -v gdate &>/dev/null; then
    TIMESTAMP_ISO=$(gdate -u +%Y-%m-%dT%H:%M:%S.%3NZ)
elif [[ "$(uname)" == "Darwin" ]]; then
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
else
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
fi
echo "[${TIMESTAMP_ISO}] Session started" >> "$LOG_FILE"

# ── Phase 1: Ensure direnv is allowed ──────────────────────────────────────
# direnv won't load .envrc unless explicitly allowed. Run `direnv allow` to
# ensure subsequent Bash tool calls (login shells) pick up the vars.
if command -v direnv &>/dev/null && [ -f ".envrc" ]; then
  direnv allow . 2>/dev/null || true
fi

# ── Phase 2: Verify critical env vars are loadable ─────────────────────────
# Source .envrc + .envrc.local in a subshell to test without affecting parent.
# This catches issues like missing .envrc.local or broken variable references.
CRITICAL_VARS="INTEXURAOS_GCP_PROJECT_ID INTEXURAOS_INTERNAL_AUTH_TOKEN INTEXURAOS_AUTH_JWKS_URL INTEXURAOS_ZAI_APP_API_KEY INTEXURAOS_DASHSCOPE_APP_API_KEY INTEXURAOS_OPENAI_APP_API_KEY INTEXURAOS_SENTRY_DSN"

missing_vars=$(
  # Source in subshell to avoid polluting hook environment
  set +u
  source .envrc 2>/dev/null || true
  for var in $CRITICAL_VARS; do
    eval "val=\${$var:-}"
    if [ -z "$val" ]; then
      echo "$var"
    fi
  done
)

if [ -n "$missing_vars" ]; then
  echo "⚠ Env vars missing after sourcing .envrc: $missing_vars" >&2
  echo "  Check .envrc and .envrc.local exist and are correct." >&2
else
  echo "✓ All critical env vars verified" >&2
fi

# ── Phase 3: Check if node_modules exists ──────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "CONTINUE"
  exit 0
fi

# ── Phase 4: Build packages if dist/ is missing ───────────────────────────
# Build only specific packages with missing dist/ (not full monorepo).
# Full `pnpm build` includes apps/web (Vite) which OOM-kills in containers.
missing_pkgs=""

for pkg in packages/*/; do
  if [ -f "$pkg/package.json" ]; then
    has_build=$(jq -r '.scripts.build // empty' "$pkg/package.json" 2>/dev/null) || true
    if [ -n "$has_build" ] && [ ! -d "$pkg/dist" ]; then
      pkg_name=$(jq -r '.name // empty' "$pkg/package.json" 2>/dev/null) || true
      if [ -n "$pkg_name" ]; then
        missing_pkgs="$missing_pkgs $pkg_name"
      fi
    fi
  fi
done

if [ -n "$missing_pkgs" ]; then
  echo "Building packages with missing dist/:$missing_pkgs" >&2
  if [ "${HOOK_DRY_RUN:-}" != "1" ]; then
    for pkg_name in $missing_pkgs; do
      echo "  Building $pkg_name..." >&2
      pnpm --filter "$pkg_name" build >&2 || {
        echo "  WARNING: Failed to build $pkg_name (exit $?), continuing..." >&2
      }
    done
  fi
fi

echo "CONTINUE"
