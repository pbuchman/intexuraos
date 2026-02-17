#!/bin/bash
# BLOCK: gcloud builds commands without --region flag
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-gcloud-builds"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern: gcloud builds (list|log|describe) without --region
# Use POSIX-compatible regex (macOS grep doesn't support \s)
if echo "$COMMAND" | grep -qE 'gcloud[[:space:]]+builds[[:space:]]+(list|log|describe)' && \
   ! echo "$COMMAND" | grep -q -- '--region'; then
    cat >&2 << 'EOF'

BLOCKED: gcloud builds commands require --region flag.

This project uses regional Cloud Build in europe-central2.
Without --region, you'll query the wrong regional pool.

CORRECT:
  gcloud builds list --region=europe-central2 --project=intexuraos-dev-pbuchman
  gcloud builds log BUILD_ID --region=europe-central2 --project=intexuraos-dev-pbuchman
  gcloud builds describe BUILD_ID --region=europe-central2 --project=intexuraos-dev-pbuchman
EOF
    log_blocked "$HOOK_NAME" "missing-region-flag" \
        "gcloud builds command without --region" \
        "Add --region=europe-central2"
    exit 2
fi

exit 0
