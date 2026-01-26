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
╔══════════════════════════════════════════════════════════════════════════════╗
║  ❌ TERRAFORM ENVIRONMENT VIOLATION                                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  WHAT'S WRONG:                                                               ║
║  Running 'terraform' without clearing emulator environment variables.        ║
║  This will cause terraform to connect to local emulators instead of GCP.     ║
║                                                                              ║
║  CORRECT COMMAND:                                                            ║
║  STORAGE_EMULATOR_HOST= \                                                    ║
║  FIRESTORE_EMULATOR_HOST= \                                                  ║
║  PUBSUB_EMULATOR_HOST= \                                                     ║
║  GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json \ ║
║  terraform <command>                                                         ║
║                                                                              ║
║  EXAMPLE - Plan:                                                             ║
║    STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \   ║
║    GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json ║
║    terraform plan                                                            ║
║                                                                              ║
║  EXAMPLE - Apply:                                                            ║
║    STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \   ║
║    GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json ║
║    terraform apply                                                           ║
║                                                                              ║
║  REFERENCE: .claude/reference/infrastructure.md                              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
