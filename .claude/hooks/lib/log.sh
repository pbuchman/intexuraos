#!/bin/bash
# Shared logging library for Claude hooks
# Provides structured TSV logging format

# Determine log directory - hooks directory (parent of lib)
# Hooks may run from different working directories, so we resolve relative to this file
_LOG_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LOG_HOOKS_DIR="$(cd "$_LOG_LIB_DIR/.." && pwd)"
# Allow override via env var for test isolation
LOG_FILE="${CLAUDE_HOOKS_LOG_FILE:-${_LOG_HOOKS_DIR}/hooks.log}"
SESSION_BLOCKED_FILE="${CLAUDE_HOOKS_SESSION_FILE:-${_LOG_HOOKS_DIR}/session-blocked.log}"

# Get ISO 8601 timestamp in UTC
# Usage: log_timestamp
log_timestamp() {
    if command -v gdate &>/dev/null; then
        gdate -u +%Y-%m-%dT%H:%M:%S.%3NZ
    elif [[ "$(uname)" == "Darwin" ]]; then
        # macOS fallback - no millisecond precision
        date -u +%Y-%m-%dT%H:%M:%S.000Z
    else
        date -u +%Y-%m-%dT%H:%M:%S.%3NZ
    fi
}

# Write structured log entry (TSV format)
# Usage: log_write <level> <hook> <pattern> <file> <message> <suggestion>
# All arguments required (use "-" for empty fields)
log_write() {
    local level="$1"
    local hook="$2"
    local pattern="$3"
    local file="$4"
    local message="$5"
    local suggestion="$6"

    local timestamp
    timestamp=$(log_timestamp)

    # Escape tabs in fields to preserve TSV structure
    message="${message//	/    }"
    suggestion="${suggestion//	/    }"
    file="${file//	/    }"

    # TSV: timestamp | level | hook | pattern | file | message | suggestion
    # Use mkdir -p to ensure log directory exists, write to stderr if log fails
    if ! printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
        "$timestamp" "$level" "$hook" "$pattern" "$file" "$message" "$suggestion" \
        >> "$LOG_FILE" 2>/dev/null; then
        # Log to stderr if file write fails (fallback for debugging)
        echo "[LOG_FALLBACK] $timestamp $level $hook $pattern $file: $message" >&2
    fi
}

# Convenience function for WARNED entries
# Usage: log_warned <hook> <pattern> <file> <message> [<suggestion>]
log_warned() {
    log_write "WARNED" "$@"
}

# Convenience function for BLOCKED entries
# Usage: log_blocked <hook> <pattern> <message> [<suggestion>]
# Also appends to session-blocked.log for session-scoped metrics
log_blocked() {
    log_write "BLOCKED" "$1" "$2" "-" "$3" "${4:--}"
    # Append to session log (atomic append, safe for concurrent hooks)
    echo "$1" >> "$SESSION_BLOCKED_FILE" 2>/dev/null || true
}

# Convenience function for INFO entries
# Usage: log_info <hook> <pattern> <message> [<suggestion>]
log_info() {
    log_write "INFO" "$1" "$2" "-" "$3" "${4:--}"
}
