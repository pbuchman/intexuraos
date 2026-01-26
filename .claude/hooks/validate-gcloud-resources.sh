#!/bin/bash
# BLOCK: Direct GCloud resource creation - must use Terraform
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-gcloud-resources"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Check each forbidden pattern and its Terraform equivalent
check_pattern() {
    local pattern="$1"
    local tf_resource="$2"

    if echo "$COMMAND" | grep -qE "$pattern"; then
        cat >&2 << EOF
╔══════════════════════════════════════════════════════════════════════════════╗
║  ❌ TERRAFORM-ONLY RESOURCE CREATION                                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  WHAT'S WRONG:                                                               ║
║  Direct GCloud CLI resource creation is FORBIDDEN.                           ║
║  CLI-created resources are invisible to infrastructure-as-code.              ║
║                                                                              ║
║  DETECTED COMMAND PATTERN: $pattern
║  TERRAFORM RESOURCE TYPE:  $tf_resource
║                                                                              ║
║  CORRECT APPROACH:                                                           ║
║  1. Add resource to terraform/environments/dev/main.tf                       ║
║  2. Run: terraform plan (with env var clearing)                              ║
║  3. Review plan output                                                       ║
║  4. Run: terraform apply                                                     ║
║  5. Commit terraform changes to PR                                           ║
║                                                                              ║
║  REFERENCE: .claude/reference/infrastructure.md                              ║
║  TERRAFORM DIR: terraform/environments/dev/                                  ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
        log_blocked "$COMMAND"
        exit 2
    fi
}

# Check each forbidden pattern
check_pattern 'gsutil\s+mb' 'google_storage_bucket'
check_pattern 'gcloud\s+pubsub\s+topics\s+create' 'google_pubsub_topic'
check_pattern 'gcloud\s+pubsub\s+subscriptions\s+create' 'google_pubsub_subscription'
check_pattern 'gcloud\s+run\s+deploy' 'google_cloud_run_service'
check_pattern 'gcloud\s+run\s+services\s+update' 'google_cloud_run_service'
check_pattern 'gcloud\s+secrets\s+create' 'google_secret_manager_secret'
check_pattern 'gcloud\s+sql\s+instances\s+create' 'google_sql_database_instance'
check_pattern 'gcloud\s+compute\s+instances\s+create' 'google_compute_instance'
check_pattern 'gcloud\s+iam\s+service-accounts\s+create' 'google_service_account'

exit 0
