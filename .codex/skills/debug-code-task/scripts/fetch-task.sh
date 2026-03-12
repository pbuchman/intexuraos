#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: fetch-task.sh <taskId> [--logs|--logs-only]" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
fetch_script="$repo_root/.claude/skills/debug-code-task/scripts/fetch-task.cjs"

if [ ! -f "$fetch_script" ]; then
  echo "Could not find $fetch_script." >&2
  exit 1
fi

cd "$repo_root"
node "$fetch_script" "$@"
