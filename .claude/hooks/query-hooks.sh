#!/bin/bash
# Query hook logs with filters
# Usage: ./query-hooks.sh [--level LEVEL] [--hook HOOK] [--pattern PATTERN] [--file FILE] [--since TIME] [--tail N] [--summary]

set -euo pipefail

# Determine log directory - same logic as lib/log.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/hooks.log"

# Default values
LEVEL=""
HOOK=""
PATTERN=""
FILE=""
SINCE=""
TAIL=""
SHOW_SUMMARY=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --level)
            LEVEL="$2"
            shift 2
            ;;
        --hook)
            HOOK="$2"
            shift 2
            ;;
        --pattern)
            PATTERN="$2"
            shift 2
            ;;
        --file)
            FILE="$2"
            shift 2
            ;;
        --since)
            SINCE="$2"
            shift 2
            ;;
        --tail)
            TAIL="$2"
            shift 2
            ;;
        --summary)
            SHOW_SUMMARY="1"
            shift
            ;;
        --help|-h)
            cat << EOF
Usage: $0 [OPTIONS]

Query hook logs with filters.

Options:
  --level LEVEL    Filter by level (WARNED, BLOCKED, INFO)
  --hook HOOK      Filter by hook name (e.g., detect-common-patterns)
  --pattern PATTERN Filter by pattern name (e.g., missing-js-extension)
  --file FILE      Filter by file path (supports partial match)
  --since TIME     Show entries since TIME (GNU date format: '1 hour ago', '2026-01-31')
  --tail N         Show only last N entries
  --summary        Show aggregated summary instead of raw entries
  --help, -h       Show this help

Examples:
  # All warnings for a specific file
  $0 --file migrations/__tests__/040-create-doc-embeddings.test.ts

  # All blocked commands from CI output capture hook
  $0 --hook validate-ci-output-capture --level BLOCKED

  # Most recent 10 entries
  $0 --tail 10

  # Entries from the last hour
  $0 --since '1 hour ago'

  # Summary of all patterns by frequency
  $0 --summary
EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Use --help for usage" >&2
            exit 1
            ;;
    esac
done

# Check if log file exists
if [[ ! -f "$LOG_FILE" ]]; then
    echo "No hook log found at $LOG_FILE"
    echo "Logs will be created as hooks trigger."
    exit 0
fi

# Convert --since to timestamp for filtering
if [[ -n "$SINCE" ]]; then
    if date --version &>/dev/null 2>&1; then
        # GNU date
        SINCE_TIMESTAMP=$(date -d "$SINCE" +%s 2>/dev/null || echo "")
    else
        # BSD date (macOS)
        SINCE_TIMESTAMP=$(date -j -f "%Y-%m-%d %H:%M:%S" "$SINCE" +%s 2>/dev/null || echo "")
    fi

    if [[ -z "$SINCE_TIMESTAMP" ]]; then
        echo "Invalid --since value: $SINCE" >&2
        exit 1
    fi
fi

# Build grep pattern
GREP_PATTERN=""

if [[ -n "$LEVEL" ]]; then
    GREP_PATTERN="$LEVEL"
fi

if [[ -n "$HOOK" ]]; then
    if [[ -n "$GREP_PATTERN" ]]; then
        GREP_PATTERN="$GREP_PATTERN.*$HOOK"
    else
        GREP_PATTERN="$HOOK"
    fi
fi

if [[ -n "$PATTERN" ]]; then
    if [[ -n "$GREP_PATTERN" ]]; then
        GREP_PATTERN="$GREP_PATTERN.*$PATTERN"
    else
        GREP_PATTERN="$PATTERN"
    fi
fi

if [[ -n "$FILE" ]]; then
    if [[ -n "$GREP_PATTERN" ]]; then
        GREP_PATTERN="$GREP_PATTERN.*$FILE"
    else
        GREP_PATTERN="$FILE"
    fi
fi

# Apply filters
if [[ -n "$GREP_PATTERN" ]]; then
    FILTERED_LOG=$(grep -E "$GREP_PATTERN" "$LOG_FILE" || true)
else
    FILTERED_LOG=$(cat "$LOG_FILE")
fi

# Filter by --since
if [[ -n "${SINCE_TIMESTAMP:-}" ]]; then
    RESULT=""
    while IFS=$'\t' read -r timestamp level hook pattern file message suggestion; do
        # Parse ISO timestamp to seconds since epoch
        if date --version &>/dev/null 2>&1; then
            # GNU date
            ENTRY_TIMESTAMP=$(date -d "${timestamp/T/ }" +%s 2>/dev/null || echo "0")
        else
            # BSD date (macOS)
            ENTRY_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${timestamp:0:19}" +%s 2>/dev/null || echo "0")
        fi

        if [[ "$ENTRY_TIMESTAMP" -ge "$SINCE_TIMESTAMP" ]]; then
            RESULT+="$timestamp\t$level\t$hook\t$pattern\t$file\t$message\t$suggestion\n"
        fi
    done <<< "$FILTERED_LOG"
    FILTERED_LOG="$RESULT"
fi

# Handle --tail
if [[ -n "$TAIL" ]]; then
    FILTERED_LOG=$(echo "$FILTERED_LOG" | tail -n "$TAIL")
fi

# Show summary or formatted output
if [[ -n "$SHOW_SUMMARY" ]]; then
    echo "=== Hook Log Summary ==="
    echo ""

    # Count by level
    echo "By Level:"
    echo "$FILTERED_LOG" | cut -f2 | sort | uniq -c | sort -rn | while read -r count level; do
        [[ -n "$level" ]] && echo "  $count  $level"
    done || true
    echo ""

    # Count by hook
    echo "By Hook:"
    echo "$FILTERED_LOG" | cut -f3 | sort | uniq -c | sort -rn | head -10 | while read -r count hook; do
        [[ -n "$hook" ]] && echo "  $count  $hook"
    done || true
    echo ""

    # Count by pattern
    echo "By Pattern (top 10):"
    echo "$FILTERED_LOG" | cut -f4 | sort | uniq -c | sort -rn | head -10 | while read -r count pattern; do
        [[ -n "$pattern" ]] && echo "  $count  $pattern"
    done || true
    echo ""

    # Count by file (top 10)
    echo "Most Warned Files (top 10):"
    echo "$FILTERED_LOG" | cut -f5 | sort | uniq -c | sort -rn | head -10 | while read -r count file; do
        [[ -n "$file" && "$file" != "-" ]] && echo "  $count  $file"
    done || true

elif [[ -n "$FILTERED_LOG" ]]; then
    # Print formatted table header
    printf "%-23s %-8s %-30s %-25s %s\n" "TIMESTAMP" "LEVEL" "HOOK" "PATTERN" "DETAILS"
    printf "%s\n" "$(printf '%.0s-' {1..100})"

    # Print each entry
    while IFS=$'\t' read -r timestamp level hook pattern file message suggestion; do
        # Format details column
        if [[ "$file" != "-" ]]; then
            DETAILS="$file: $message"
        else
            DETAILS="$message"
        fi

        # Truncate details if too long
        if [[ ${#DETAILS} -gt 40 ]]; then
            DETAILS="${DETAILS:0:40}..."
        fi

        # Format level with color indicators (using symbols)
        case "$level" in
            BLOCKED) LEVEL_ICON="🚫" ;;
            WARNED)  LEVEL_ICON="⚠️ " ;;
            INFO)    LEVEL_ICON="ℹ️ " ;;
            *)       LEVEL_ICON="" ;;
        esac

        printf "%-23s %-8s %-30s %-25s %s\n" \
            "${timestamp:0:23}" \
            "$LEVEL_ICON$level" \
            "${hook:0:30}" \
            "${pattern:0:25}" \
            "$DETAILS"

        # Show suggestion on next line if present
        if [[ "$suggestion" != "-" ]]; then
            printf "%s %s\n" "" "→ $suggestion"
        fi
    done <<< "$FILTERED_LOG"

    # Count total
    TOTAL=$(echo "$FILTERED_LOG" | wc -l | tr -d ' ')
    echo ""
    echo "Total: $TOTAL entries"
else
    echo "No matching log entries found."
fi
