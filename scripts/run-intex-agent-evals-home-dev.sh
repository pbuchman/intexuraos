#!/usr/bin/env bash

set -euo pipefail
umask 077
exec 9>&2

handle_signal() {
  trap - HUP INT TERM
  printf '%s\n' 'remote_execution_failed' >&9
  exit 2
}
trap handle_signal HUP INT TERM

usage_error() {
  printf '%s\n' 'usage: run-intex-agent-evals-home-dev.sh {setup|preflight|endpoint|full|scenario intex-eval-NNN|matrix-smoke}' >&2
  exit 2
}

cli_arguments=()
case "${1-}" in
  setup)
    [[ $# -eq 1 ]] || usage_error
    cli_arguments=('setup')
    ;;
  preflight)
    [[ $# -eq 1 ]] || usage_error
    cli_arguments=('preflight')
    ;;
  endpoint)
    [[ $# -eq 1 ]] || usage_error
    cli_arguments=('endpoint')
    ;;
  full)
    [[ $# -eq 1 ]] || usage_error
    cli_arguments=('full')
    ;;
  scenario)
    [[ $# -eq 2 ]] || usage_error
    [[ $2 =~ ^intex-eval-[0-9]{3}$ ]] || usage_error
    cli_arguments=('scenario' "$2")
    ;;
  matrix-smoke)
    [[ $# -eq 1 ]] || usage_error
    cli_arguments=('matrix-smoke')
    ;;
  *)
    usage_error
    ;;
esac

if ! repository_root=$(
  CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P
); then
  printf '%s\n' 'implementation_revision_unavailable' >&2
  exit 2
fi
readonly repository_root

implementation_paths=(
  'apps/intex-agent/src/routes/testConversationRoutes.ts'
  'apps/intex-agent/src/domain/testConversation/'
  'tools/intex-agent-evals/'
  'scripts/run-intex-agent-evals-home-dev.sh'
  'scripts/cleanup-intex-agent-test-conversations.mjs'
  'package.json'
  'pnpm-lock.yaml'
  'pnpm-workspace.yaml'
  '.gitignore'
  'eslint.config.js'
  'tsconfig.tests-check.json'
  'scripts/lint-parallel.mjs'
  'scripts/typecheck-parallel.mjs'
  'scripts/verify-workspace-deps.mjs'
  'scripts/lib/workspace-discovery.mjs'
  'packages/llm-contract/src/types.ts'
  'packages/infra-openrouter/src/client.ts'
)

if ! implementation_status=$(
  git -C "$repository_root" status --porcelain=v1 --untracked-files=all -- \
    "${implementation_paths[@]}" 2>/dev/null
); then
  printf '%s\n' 'implementation_paths_dirty' >&2
  exit 2
fi
if [[ -n $implementation_status ]]; then
  printf '%s\n' 'implementation_paths_dirty' >&2
  exit 2
fi

if ! required_sha=$(
  git -C "$repository_root" rev-parse --verify 'HEAD^{commit}' 2>/dev/null
); then
  printf '%s\n' 'implementation_revision_unavailable' >&2
  exit 2
fi
if [[ ! $required_sha =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' 'implementation_revision_unavailable' >&2
  exit 2
fi

remote_program=''
IFS= read -r -d '' remote_program <<'REMOTE_PROGRAM' || :
set -eu
if ! cd "$HOME/deploy/intexuraos" >/dev/null 2>&1; then
  printf '%s\n' 'remote_environment_unavailable' >&2
  exit 2
fi
required_sha=$1
shift
if ! git merge-base --is-ancestor "$required_sha" HEAD >/dev/null 2>&1; then
  printf '%s\n' 'revision_mismatch' >&2
  exit 2
fi
if ! command -v direnv >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1 || ! direnv exec . true >/dev/null 2>&1; then
  printf '%s\n' 'remote_environment_unavailable' >&2
  exit 2
fi
exec direnv exec . pnpm --filter @intexuraos/intex-agent-evals run cli -- "$@"
REMOTE_PROGRAM
remote_program=${remote_program%$'\n'}

shell_single_quote() {
  local value=$1
  value=${value//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

remote_command="zsh -lic $(shell_single_quote "$remote_program")"
for positional_argument in \
  'intex-agent-evals-home-dev' \
  "$required_sha" \
  "${cli_arguments[@]}"; do
  remote_command+=" $(shell_single_quote "$positional_argument")"
done

run_ssh() {
  local tty_mode=$1
  env \
    -u INTEXURAOS_INTERNAL_AUTH_TOKEN \
    -u INTEXURAOS_OPENROUTER_APP_API_KEY \
    -u INTEXURAOS_ENVIRONMENT \
    -u INTEXURAOS_GCP_PROJECT_ID \
    ssh "$tty_mode" -o LogLevel=QUIET -o 'SendEnv=-*' home-dev "$remote_command" 9>&-
}

if [[ ${cli_arguments[0]} == 'setup' ]]; then
  if run_ssh '-tt'; then
    ssh_status=0
  else
    ssh_status=$?
  fi

  case $ssh_status in
    0 | 1 | 2)
      exit "$ssh_status"
      ;;
    *)
      printf '%s\n' 'remote_execution_failed' >&2
      exit 2
      ;;
  esac
fi

temporary_directory=''
cleanup_temporary_directory() {
  if [[ -n $temporary_directory ]]; then
    rm -rf -- "$temporary_directory" >/dev/null 2>&1 || :
  fi
}
trap cleanup_temporary_directory EXIT

if ! temporary_directory=$(
  mktemp -d "${TMPDIR:-/tmp}/intex-agent-evals-home-dev.XXXXXX" 2>/dev/null
); then
  printf '%s\n' 'remote_execution_failed' >&2
  exit 2
fi
if ! chmod 0700 "$temporary_directory" 2>/dev/null; then
  printf '%s\n' 'remote_execution_failed' >&2
  exit 2
fi

stdout_file="$temporary_directory/stdout"
stderr_file="$temporary_directory/stderr"
if ! { : >"$stdout_file"; } 2>/dev/null || ! { : >"$stderr_file"; } 2>/dev/null; then
  printf '%s\n' 'remote_execution_failed' >&2
  exit 2
fi
if ! chmod 0600 "$stdout_file" "$stderr_file" 2>/dev/null; then
  printf '%s\n' 'remote_execution_failed' >&2
  exit 2
fi

if run_ssh '-T' >"$stdout_file" 2>"$stderr_file"; then
  ssh_status=0
else
  ssh_status=$?
fi

case $ssh_status in
  0 | 1 | 2)
    read_capture_file() {
      local source_file=$1
      local destination_name=$2
      local captured_contents=''

      if ! captured_contents=$(cat -- "$source_file" 2>/dev/null && printf '\x1f'); then
        return 1
      fi
      captured_contents=${captured_contents%$'\x1f'}
      printf -v "$destination_name" '%s' "$captured_contents"
    }

    captured_stdout=''
    captured_stderr=''
    if ! read_capture_file "$stdout_file" captured_stdout || \
      ! read_capture_file "$stderr_file" captured_stderr; then
      printf '%s\n' 'remote_execution_failed' >&2
      exit 2
    fi
    printf '%s' "$captured_stdout"
    printf '%s' "$captured_stderr" >&2
    exit "$ssh_status"
    ;;
  *)
    printf '%s\n' 'remote_execution_failed' >&2
    exit 2
    ;;
esac
