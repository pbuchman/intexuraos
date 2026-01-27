#!/bin/bash
# BLOCK: terraform command without env var clearing
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-terraform"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

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
  GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json \
  terraform <command>
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
