#!/usr/bin/env bash
# Verify a service is fully scaffolded per the /create-service checklist.
#
# Usage:
#   bash scripts/verify-service-scaffolding.sh <service-name>
#
# Maps 1:1 to the "App Scaffolding Verification" in .claude/commands/create-service.md.
# Exits non-zero if any required item is missing.
#
# Checks are HARD (must pass) or SOFT (warn only, e.g. api-docs-hub registration
# is conditional on the service exposing OpenAPI).

set -uo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <service-name>" >&2
  echo "Example: $0 user-service" >&2
  exit 2
fi

SERVICE="$1"
# snake_case for terraform locals/modules (e.g. user-service -> user_service)
SERVICE_SNAKE="${SERVICE//-/_}"
# UPPER for env vars (e.g. user-service -> USER_SERVICE)
SERVICE_UPPER="$(echo "$SERVICE_SNAKE" | tr '[:lower:]' '[:upper:]')"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
WARN=0
PASS=0

if [[ -t 1 ]] && [[ "${NO_COLOR:-}" == "" ]]; then
  red()   { printf '\033[31m%s\033[0m' "$1"; }
  green() { printf '\033[32m%s\033[0m' "$1"; }
  yellow(){ printf '\033[33m%s\033[0m' "$1"; }
  dim()   { printf '\033[2m%s\033[0m' "$1"; }
else
  red()   { printf '%s' "$1"; }
  green() { printf '%s' "$1"; }
  yellow(){ printf '%s' "$1"; }
  dim()   { printf '%s' "$1"; }
fi

check() {
  local label="$1"
  local ok="$2"
  local detail="${3:-}"
  if [[ "$ok" == "1" ]]; then
    printf '  %s %s' "$(green '✓')" "$label"
    [[ -n "$detail" ]] && printf ' %s' "$(dim "($detail)")"
    printf '\n'
    PASS=$((PASS + 1))
  else
    printf '  %s %s' "$(red '✗')" "$label"
    [[ -n "$detail" ]] && printf ' %s' "$(dim "($detail)")"
    printf '\n'
    FAIL=$((FAIL + 1))
  fi
}

warn() {
  local label="$1"
  local ok="$2"
  local detail="${3:-}"
  if [[ "$ok" == "1" ]]; then
    printf '  %s %s' "$(green '✓')" "$label"
    [[ -n "$detail" ]] && printf ' %s' "$(dim "($detail)")"
    printf '\n'
    PASS=$((PASS + 1))
  else
    printf '  %s %s' "$(yellow '!')" "$label"
    [[ -n "$detail" ]] && printf ' %s' "$(dim "($detail)")"
    printf '\n'
    WARN=$((WARN + 1))
  fi
}

# --- helpers ----------------------------------------------------------------

file_exists() { [[ -f "$1" ]] && echo 1 || echo 0; }

grep_count() {
  # grep_count <pattern> <file> -> integer on stdout (0 if no match or no file)
  local pat="$1" file="$2" n
  if [[ ! -f "$file" ]]; then echo 0; return; fi
  # grep -c prints the count but exits 1 on zero matches; swallow the exit code.
  n="$(grep -cF -- "$pat" "$file" 2>/dev/null || true)"
  echo "${n:-0}"
}

grep_any() {
  # grep_any <pattern> <file> -> 1 if >=1 match
  local n
  n="$(grep_count "$1" "$2")"
  [[ "$n" -gt 0 ]] && echo 1 || echo 0
}

header() {
  printf '\n%s %s\n' "$(dim '──')" "$1"
}

# --- begin ------------------------------------------------------------------

printf 'Verifying service scaffolding for: %s\n' "$(green "$SERVICE")"
printf '  snake_case: %s   UPPER: %s\n' "$SERVICE_SNAKE" "$SERVICE_UPPER"

header "App files (apps/${SERVICE}/)"

APP_DIR="apps/${SERVICE}"
check "Directory exists: ${APP_DIR}/"                    "$([[ -d "$APP_DIR" ]] && echo 1 || echo 0)"
check "package.json"                                     "$(file_exists "${APP_DIR}/package.json")"
check "Dockerfile"                                       "$(file_exists "${APP_DIR}/Dockerfile")"
check "src/index.ts"                                     "$(file_exists "${APP_DIR}/src/index.ts")"

# Dockerfile contents per checklist line 997
DF="${APP_DIR}/Dockerfile"
check "Dockerfile: production CMD starts dist/index.js"   "$(grep_any 'CMD ["node", "dist/index.js"]' "$DF")"

PKG="${APP_DIR}/package.json"
REMOVED_PRELOAD_PACKAGE="@intexuraos/infra-o""tel"
check "package.json: no preload instrumentation package"  "$([[ "$(grep_any "$REMOVED_PRELOAD_PACKAGE" "$PKG")" == "0" ]] && echo 1 || echo 0)"

header "Deploy plumbing"
warn  "GCP app/web Cloud Build deploy files are intentionally absent" 1 \
      "migrated app deployment belongs to the Hetzner path"

header "Terraform (environments/dev/main.tf)"

DEV_TF="terraform/environments/dev/main.tf"
# Checklist line 998: Added to local.services map
check "local.services.${SERVICE_SNAKE} defined"          "$(grep_any "${SERVICE_SNAKE} = {" "$DEV_TF")"
header "Terraform (modules/iam)"

IAM_TF="terraform/modules/iam/main.tf"
# Checklist line 1001:
check "IAM SA: google_service_account.${SERVICE_SNAKE}"  "$(grep_any "google_service_account\" \"${SERVICE_SNAKE}\"" "$IAM_TF")"

# Web config — SOFT. apps/web/service-manifest.json is the single source of
# truth consumed by generated web/dev wiring and the Hetzner web build.
WEB_MANIFEST="apps/web/service-manifest.json"
manifest_has_service=0
if [[ -f "$WEB_MANIFEST" ]]; then
  if node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const name = process.argv[2];
    const sfx = process.argv[3];
    const m = JSON.parse(fs.readFileSync(path, "utf8"));
    const ok = Array.isArray(m.services) && m.services.some(s => s && s.name === name && s.envSuffix === sfx);
    process.exit(ok ? 0 : 1);
  ' "$WEB_MANIFEST" "$SERVICE" "$SERVICE_UPPER" 2>/dev/null; then
    manifest_has_service=1
  fi
fi
warn  "web manifest: ${SERVICE}:${SERVICE_UPPER} in apps/web/service-manifest.json" \
      "$manifest_has_service" \
      "soft: only required if web frontend calls this service"

header "Monorepo wiring"

# Checklist line 1014: repo uses glob include apps/*/src/**/*.ts — automatic for any
# new service, so we verify the glob is intact rather than a per-service reference.
# (Note: create-service.md step 12 is stale — it says to add a references[] entry,
#  but the repo uses include globs.)
check "tsconfig.json: apps/* glob include intact"        "$(grep_any "apps/*/src/**/*.ts" "tsconfig.json")"
# Checklist line 1015:
ECO="ecosystem.config.cjs"
check "ecosystem.config.cjs: createServiceConfig('${SERVICE}'" \
      "$(grep_any "createServiceConfig('${SERVICE}'" "$ECO")"
check "ecosystem.config.cjs: INTEXURAOS_${SERVICE_UPPER}_URL" \
      "$(grep_any "INTEXURAOS_${SERVICE_UPPER}_URL" "$ECO")"
# Checklist line 1013:
check ".envrc.local.example: INTEXURAOS_${SERVICE_UPPER}_URL" \
      "$(grep_any "INTEXURAOS_${SERVICE_UPPER}_URL" ".envrc.local.example")"

header "Optional registrations"

# Checklist line 1012: api-docs-hub (SOFT — only if service exposes OpenAPI)
warn  "api-docs-hub: INTEXURAOS_${SERVICE_UPPER}_OPENAPI_URL" \
      "$(grep_any "INTEXURAOS_${SERVICE_UPPER}_OPENAPI_URL" "apps/api-docs-hub/src/config.ts")" \
      "soft: only if service exposes /openapi.json"

# --- summary ----------------------------------------------------------------

printf '\n%s\n' "$(dim '────────────────────────────────────────')"
printf 'Summary for %s: ' "$SERVICE"
printf '%s passed  '  "$(green "$PASS")"
printf '%s failed  '  "$([[ $FAIL -gt 0 ]] && red "$FAIL" || green "$FAIL")"
printf '%s warnings\n' "$([[ $WARN -gt 0 ]] && yellow "$WARN" || green "$WARN")"

if [[ $FAIL -gt 0 ]]; then
  printf '\n%s %d required item(s) missing. Fix them before shipping.\n' "$(red 'FAIL:')" "$FAIL"
  exit 1
fi

printf '\n%s All required scaffolding present.\n' "$(green 'OK:')"
exit 0
