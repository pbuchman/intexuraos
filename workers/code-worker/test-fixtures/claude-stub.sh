#!/bin/bash
# ==============================================================================
# Claude CLI Stub for E2E Testing
# ==============================================================================
# Simulates Claude CLI for E2E tests without making real API calls.
# Supports both interactive mode and --print mode (argument-based).

set -euo pipefail

echo "[claude-stub] Started"
echo "[claude-stub] Working directory: $(pwd)"
echo "[claude-stub] Git branch: $(git branch --show-current 2>/dev/null || echo 'no-git')"

# Log environment for debugging
echo "[claude-stub] TASK_ID: ${TASK_ID:-unset}"
echo "[claude-stub] ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL:-unset}"

# Verify /repo mount (supports both git directories and worktree files)
if [ -d "/repo/.git" ] || [ -f "/repo/.git" ]; then
  echo "[claude-stub] /repo mount verified (git repository present)"
else
  echo "[claude-stub] WARNING: /repo is not a git repository"
fi

# Verify /secrets mount
if [ -d "/secrets" ]; then
  echo "[claude-stub] /secrets mount verified"
  if [ -f "/secrets/gcp-sa.json" ]; then
    echo "[claude-stub] GCP SA key present"
  fi
  if [ -f "/secrets/github-token" ]; then
    echo "[claude-stub] GitHub token present"
  fi
else
  echo "[claude-stub] WARNING: /secrets not mounted"
fi

# ------------------------------------------------------------------------------
# Process a single command (used by both interactive and print modes)
# ------------------------------------------------------------------------------
process_command() {
  local clean_line="$1"

  case "$clean_line" in
    "exit"|"quit"|"/exit"|"/quit")
      echo "[claude-stub] Exit command received, shutting down..."
      exit 0
      ;;
    "error"|"/error")
      echo "[claude-stub] Simulating error exit..."
      exit 1
      ;;
    "timeout"|"/timeout")
      echo "[claude-stub] Simulating long-running task (will timeout)..."
      sleep 3600
      ;;
    "network-test"|"/network-test")
      echo "[claude-stub] Testing network connectivity..."
      if curl -s --max-time 5 https://api.github.com > /dev/null 2>&1; then
        echo "[claude-stub] Public internet: OK"
      else
        echo "[claude-stub] Public internet: BLOCKED"
      fi
      if curl -s --max-time 2 http://169.254.169.254/ > /dev/null 2>&1; then
        echo "[claude-stub] Metadata server: ACCESSIBLE (SECURITY ISSUE!)"
        exit 1
      else
        echo "[claude-stub] Metadata server: BLOCKED (good)"
      fi
      if curl -s --max-time 2 http://127.0.0.1:8080/ > /dev/null 2>&1; then
        echo "[claude-stub] Localhost: ACCESSIBLE"
      else
        echo "[claude-stub] Localhost: BLOCKED/UNREACHABLE (expected)"
      fi
      echo "[claude-stub] Network test complete"
      ;;
    "resource-test"|"/resource-test")
      echo "[claude-stub] Testing resource limits..."
      if [ -f /sys/fs/cgroup/memory.max ]; then
        echo "[claude-stub] Memory limit: $(cat /sys/fs/cgroup/memory.max)"
      fi
      if [ -f /sys/fs/cgroup/memory.current ]; then
        echo "[claude-stub] Memory current: $(cat /sys/fs/cgroup/memory.current)"
      fi
      if [ -f /sys/fs/cgroup/cpu.max ]; then
        echo "[claude-stub] CPU limit: $(cat /sys/fs/cgroup/cpu.max)"
      fi
      echo "[claude-stub] Resource test complete"
      # Keep container running for E2E tests to query docker stats
      echo "[claude-stub] Waiting for stats collection (5s)..."
      sleep 5
      ;;
    "file-test"|"/file-test")
      echo "[claude-stub] Testing file system..."
      if touch /repo/.test-file 2>/dev/null; then
        rm /repo/.test-file
        echo "[claude-stub] /repo: WRITABLE"
      else
        echo "[claude-stub] /repo: READ-ONLY"
      fi
      if touch /secrets/.test-file 2>/dev/null; then
        rm /secrets/.test-file
        echo "[claude-stub] /secrets: WRITABLE (SECURITY ISSUE!)"
        exit 1
      else
        echo "[claude-stub] /secrets: READ-ONLY (good)"
      fi
      if touch /tmp/.test-file 2>/dev/null; then
        rm /tmp/.test-file
        echo "[claude-stub] /tmp: WRITABLE"
      else
        echo "[claude-stub] /tmp: READ-ONLY"
      fi
      echo "[claude-stub] File system test complete"
      ;;
    *)
      if [ -n "$clean_line" ]; then
        echo "[claude-stub] Acknowledged: $clean_line"
        echo "[claude-stub] Response: Task completed successfully"
      fi
      ;;
  esac
}

# ------------------------------------------------------------------------------
# Check for --print mode (prompt passed as argument)
# ------------------------------------------------------------------------------
PRINT_MODE=false
PROMPT=""

for arg in "$@"; do
  if [[ "$arg" == "--print" ]]; then
    PRINT_MODE=true
  elif [[ "$arg" != "--dangerously-skip-permissions" && "$arg" != -* ]]; then
    PROMPT="$arg"
  fi
done

if $PRINT_MODE && [ -n "$PROMPT" ]; then
  echo "[claude-stub] Running in print mode with prompt"
  # Process each line of the prompt looking for commands
  while IFS= read -r line; do
    clean_line=$(echo "$line" | sed 's/^{[^}]*}//g' | xargs)
    if [ -n "$clean_line" ]; then
      process_command "$clean_line"
    fi
  done <<< "$PROMPT"
  echo "[claude-stub] Print mode complete"
  exit 0
fi

# ------------------------------------------------------------------------------
# Interactive mode: Read and process input from stdin
# ------------------------------------------------------------------------------
while IFS= read -r line || [ -n "$line" ]; do
  # Strip any Docker attach metadata prefix (JSON that sometimes appears)
  clean_line=$(echo "$line" | sed 's/^{[^}]*}//g')
  echo "[claude-stub] Received: $clean_line"
  process_command "$clean_line"
done

echo "[claude-stub] stdin closed, exiting gracefully"
exit 0
