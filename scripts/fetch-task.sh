#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
skill_wrapper="$repo_root/.codex/skills/debug-code-task/scripts/fetch-task.sh"

if [ ! -f "$skill_wrapper" ]; then
  echo "Could not find $skill_wrapper." >&2
  exit 1
fi

bash "$skill_wrapper" "$@"
