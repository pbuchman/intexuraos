#!/usr/bin/env bash
set -euo pipefail
# This entry point only stages configuration. The operator owns the cutover.
exec node "$(dirname "$0")/prepare.mjs" "$@"
