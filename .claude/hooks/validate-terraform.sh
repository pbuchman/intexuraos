#!/bin/bash
# BLOCK: terraform command without env var clearing
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-terraform"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern: terraform without FIRESTORE_EMULATOR_HOST= prefix
if echo "$COMMAND" | grep -qE '\bterraform\s+(init|plan|apply|destroy|import|state|output|refresh)' && \
   ! echo "$COMMAND" | grep -qE 'FIRESTORE_EMULATOR_HOST='; then
    cat >&2 << 'EOF'

BLOCKED: Terraform without clearing emulator env vars will connect to emulators, not GCP.

CORRECT:
  STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
  GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
  terraform <command>
EOF
    log_blocked "$HOOK_NAME" "missing-emulator-env-clear" \
        "Terraform command without clearing emulator vars" \
        "Prefix with FIRESTORE_EMULATOR_HOST= etc."
    exit 2
fi

exit 0
