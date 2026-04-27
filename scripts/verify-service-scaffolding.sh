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
# Checklist line 1003:
check "Per-service apps/${SERVICE}/cloudbuild.yaml"      "$(file_exists "${APP_DIR}/cloudbuild.yaml")"

# Dockerfile contents per checklist line 997
DF="${APP_DIR}/Dockerfile"
check "Dockerfile: COPY otel-register.js"                "$(grep_any "otel-register.js" "$DF")"
check "Dockerfile: ENV OTEL_SERVICE_NAME"                "$(grep_any "OTEL_SERVICE_NAME" "$DF")"
check "Dockerfile: CMD uses --import"                    "$(grep_any "\"--import\"" "$DF")"

# package.json infra-otel dependency (checklist line 996)
PKG="${APP_DIR}/package.json"
check "package.json: @intexuraos/infra-otel dependency"  "$(grep_any "@intexuraos/infra-otel" "$PKG")"

header "Deploy plumbing"

# Checklist line 1004:
DEPLOY_SH="cloudbuild/scripts/deploy-${SERVICE}.sh"
check "Deploy script: ${DEPLOY_SH}"                      "$(file_exists "$DEPLOY_SH")"
if [[ -f "$DEPLOY_SH" ]]; then
  check "  deploy.sh: has --cpu-throttling"              "$(grep_any "cpu-throttling" "$DEPLOY_SH")"
  check "  deploy.sh: does NOT use --allow-unauthenticated" \
        "$([[ $(grep_count "allow-unauthenticated" "$DEPLOY_SH") == 0 ]] && echo 1 || echo 0)"
fi

header "Terraform (environments/dev/main.tf)"

DEV_TF="terraform/environments/dev/main.tf"
# Checklist line 998: Added to local.services map
check "local.services.${SERVICE_SNAKE} defined"          "$(grep_any "${SERVICE_SNAKE} = {" "$DEV_TF")"
# Checklist line 1000: module with common_service_secrets/env_vars
check "module \"${SERVICE_SNAKE}\" block"                "$(grep_any "module \"${SERVICE_SNAKE}\"" "$DEV_TF")"
# Scope this to within the service's module block (awk picks the block, grep checks for the local).
MODULE_USES_SECRETS=0
if grep -qF "module \"${SERVICE_SNAKE}\"" "$DEV_TF" 2>/dev/null; then
  if awk -v mod="module \"${SERVICE_SNAKE}\"" '
        index($0, mod) > 0 {in_block=1; brace=0}
        in_block {
          for (i=1;i<=length($0);i++) {
            c=substr($0,i,1)
            if (c=="{") brace++
            else if (c=="}") { brace--; if (brace==0) { in_block=0; exit } }
          }
          print
        }
      ' "$DEV_TF" | grep -qF "local.common_service_secrets"; then
    MODULE_USES_SECRETS=1
  fi
fi
check "  module uses common_service_secrets"             "$MODULE_USES_SECRETS"
# Checklist line 999: service URL in common_service_env_vars
check "INTEXURAOS_${SERVICE_UPPER}_URL in env_vars"      "$(grep_any "INTEXURAOS_${SERVICE_UPPER}_URL" "$DEV_TF")"

header "Terraform (modules/iam + modules/cloud-build)"

IAM_TF="terraform/modules/iam/main.tf"
# Checklist line 1001:
check "IAM SA: google_service_account.${SERVICE_SNAKE}"  "$(grep_any "google_service_account\" \"${SERVICE_SNAKE}\"" "$IAM_TF")"

CB_TF="terraform/modules/cloud-build/main.tf"
# Checklist line 1005:
check "docker_services list includes \"${SERVICE}\""     "$(grep_any "\"${SERVICE}\"" "$CB_TF")"

header "cloudbuild/cloudbuild.yaml"

CB_YAML="cloudbuild/cloudbuild.yaml"
# Checklist line 1002:
check "Build step: build-push-${SERVICE}"                "$(grep_any "build-push-${SERVICE}" "$CB_YAML")"
check "Deploy step: deploy-${SERVICE}"                   "$(grep_any "deploy-${SERVICE}" "$CB_YAML")"
# Web config — SOFT, in two locations after the apps/web manifest refactor (INT-1544):
#   1. apps/web/service-manifest.json — single source of truth consumed by
#      apps/web/cloudbuild.yaml at build time.
#   2. cloudbuild/cloudbuild.yaml CLOUD_RUN_SERVICES literal — still in use by the
#      monolith pipeline; will be migrated to read the manifest in a follow-up PR.
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
warn  "web CLOUD_RUN_SERVICES: ${SERVICE}:${SERVICE_UPPER} in cloudbuild/cloudbuild.yaml" \
      "$(grep_any "\"${SERVICE}:${SERVICE_UPPER}\"" "$CB_YAML")" \
      "soft: only required if web frontend calls this service (legacy literal — to be migrated to manifest)"

header ".github/workflows/deploy.yml (4 required places)"

# Checklist lines 1006-1011:
DEPLOY_YML=".github/workflows/deploy.yml"
check "1/4 Docker build line"                            "$(grep_any "build-push-monitored.sh ${SERVICE} apps/${SERVICE}" "$DEPLOY_YML")"
check "2/4 SERVICES array contains ${SERVICE}"           "$(grep -qE "(^|[[:space:]])${SERVICE}([[:space:]]|$)" "$DEPLOY_YML" && echo 1 || echo 0)"
# CLOUD_RUN_SERVICES appears in 2 places in deploy.yml per checklist 1009/1010
RUN_N="$(grep_count "\"${SERVICE}:${SERVICE_UPPER}\"" "$DEPLOY_YML")"
check "3/4 + 4/4 CLOUD_RUN_SERVICES (2 entries)"         "$([[ "$RUN_N" -ge 2 ]] && echo 1 || echo 0)" \
      "found ${RUN_N} / 2 expected"

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
