#!/usr/bin/env bash

set -euo pipefail

if [[ ${1-} != 'matrix-corpus' || $# -lt 1 || $# -gt 2 ]]; then
  printf '%s\n' 'usage: run-intex-agent-evals-prod.sh matrix-corpus [--agent-model=or:minimax/minimax-m3]' >&2
  exit 2
fi
if [[ $# -eq 2 && ${2-} != '--agent-model=or:minimax/minimax-m3' && ${2-} != '--agent-model=or:deepseek/deepseek-v4-flash' ]]; then
  printf '%s\n' 'usage: run-intex-agent-evals-prod.sh matrix-corpus [--agent-model=or:minimax/minimax-m3]' >&2
  exit 2
fi

script_directory=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ $# -eq 2 ]]; then
  exec "${script_directory}/run-intex-agent-evals-home-dev.sh" __production-matrix-corpus "$2"
fi
exec "${script_directory}/run-intex-agent-evals-home-dev.sh" __production-matrix-corpus
