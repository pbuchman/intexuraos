#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 || ${1-} != 'matrix-corpus' ]]; then
  printf '%s\n' 'usage: run-intex-agent-evals-prod.sh matrix-corpus' >&2
  exit 2
fi

script_directory=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec "${script_directory}/run-intex-agent-evals-home-dev.sh" __production-matrix-corpus
