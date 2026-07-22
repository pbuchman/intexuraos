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

production_matrix_corpus_required() {
  printf '%s\n' 'PRODUCTION_MATRIX_CORPUS_REQUIRED' >&2
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
  matrix-corpus)
    production_matrix_corpus_required
    ;;
  __production-matrix-corpus)
    [[ $# -eq 1 ]] || usage_error
    cli_arguments=('matrix-corpus')
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
  'apps/intex-agent/src/'
  'apps/whatsapp-service/src/'
  'apps/user-service/src/'
  'packages/'
  'tools/intex-agent-evals/'
  'scripts/run-intex-agent-evals-home-dev.sh'
  'scripts/run-intex-agent-evals-prod.sh'
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

if ! frame_id=$(LC_ALL=C od -An -N24 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n'); then
  printf '%s\n' 'remote_execution_failed' >&2
  exit 2
fi
if [[ ! $frame_id =~ ^[0-9a-f]{48}$ ]]; then
  printf '%s\n' 'remote_execution_failed' >&2
  exit 2
fi
readonly frame_id
readonly begin_marker="__INTEX_AGENT_EVAL_${frame_id}_BEGIN__"
readonly end_marker_prefix="__INTEX_AGENT_EVAL_${frame_id}_END_"

remote_program=''
IFS= read -r -d '' remote_program <<'REMOTE_PROGRAM' || :
set -eu
frame_id=$1
shift
case $frame_id in
  (*[!a-f0-9]*|'') exit 2 ;;
esac
if [ ${#frame_id} -ne 48 ]; then
  exit 2
fi
emit() {
  printf '%s\n' "$1" >&3
}
finish() {
  emit "__INTEX_AGENT_EVAL_${frame_id}_END_$1__"
  exit "$1"
}
emit "__INTEX_AGENT_EVAL_${frame_id}_BEGIN__"
if ! cd "$HOME/deploy/intexuraos" >/dev/null 2>&1; then
  emit 'remote_environment_unavailable'
  finish 2
fi
required_sha=$1
shift
if ! deployed_sha=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null); then
  emit 'revision_mismatch'
  finish 2
fi
if [ "$deployed_sha" != "$required_sha" ]; then
  emit 'revision_mismatch'
  finish 2
fi
if [ ${#deployed_sha} -ne 40 ]; then
  emit 'revision_mismatch'
  finish 2
fi
if ! remote_status=$(git status --porcelain=v1 --untracked-files=all -- \
  apps/intex-agent/src/ apps/whatsapp-service/src/ apps/user-service/src/ \
  packages/ \
  tools/intex-agent-evals/ scripts/run-intex-agent-evals-home-dev.sh \
  scripts/run-intex-agent-evals-prod.sh package.json 2>/dev/null); then
  emit 'remote_implementation_paths_dirty'
  finish 2
fi
if [ -n "$remote_status" ]; then
  emit 'remote_implementation_paths_dirty'
  finish 2
fi
if ! command -v direnv >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1 || ! direnv exec . true >/dev/null 2>&1; then
  emit 'remote_environment_unavailable'
  finish 2
fi
set +e
if [ "${1-}" = 'matrix-corpus' ]; then
  direnv exec . env \
    INTEXURAOS_ENVIRONMENT=prod \
    INTEXURAOS_MATRIX_CORPUS_ENABLED=true \
    INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME=hetzner-prod \
    INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE=hetzner-prod \
    INTEXURAOS_EVAL_REQUESTED_REVISION="$required_sha" \
    INTEXURAOS_EVAL_DEPLOYED_REVISION="$deployed_sha" \
    INTEXURAOS_EVAL_WRAPPER_ATTESTED=true \
    INTEXURAOS_EVAL_LOCAL_CRITICAL_PATHS_CLEAN=true \
    INTEXURAOS_EVAL_REMOTE_CRITICAL_PATHS_CLEAN=true \
    node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts "$@" >&3 2>/dev/null
else
  direnv exec . env \
    INTEXURAOS_EVAL_REQUESTED_REVISION="$required_sha" \
    INTEXURAOS_EVAL_DEPLOYED_REVISION="$deployed_sha" \
    INTEXURAOS_EVAL_WRAPPER_ATTESTED=true \
    INTEXURAOS_EVAL_LOCAL_CRITICAL_PATHS_CLEAN=true \
    INTEXURAOS_EVAL_REMOTE_CRITICAL_PATHS_CLEAN=true \
    node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts "$@" >&3 2>/dev/null
fi
cli_status=$?
set -e
finish "$cli_status"
REMOTE_PROGRAM
remote_program=${remote_program%$'\n'}

shell_single_quote() {
  local value=$1
  value=${value//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

remote_command="exec 3>&1; exec zsh -lic $(shell_single_quote "$remote_program")"
for positional_argument in \
  'intex-agent-evals-home-dev' \
  "$frame_id" \
  "$required_sha" \
  "${cli_arguments[@]}"; do
  remote_command+=" $(shell_single_quote "$positional_argument")"
done
remote_command+=' >/dev/null 2>&1'

run_ssh() {
  local tty_mode=$1
  env \
    -u INTEXURAOS_INTERNAL_AUTH_TOKEN \
    -u INTEXURAOS_OPENROUTER_APP_API_KEY \
    -u INTEXURAOS_ENVIRONMENT \
    -u INTEXURAOS_GCP_PROJECT_ID \
    ssh "$tty_mode" -o LogLevel=QUIET -o 'SendEnv=-*' home-dev "$remote_command" 9>&-
}

readonly safe_check_pattern='(runtime|environment|config|matrix_files|intex_agent_health|whatsapp_health|matrix_health|firebase_identity|matrix_identity|whatsapp_delivery|scenario_catalog|minimax_probe)'
readonly safe_failure_pattern='(HOME_DEV_REQUIRED|REQUIRED_ENV_MISSING|SETUP_TTY_REQUIRED|CONFIG_NOT_FOUND|CONFIG_INVALID|CONFIG_PARENT_UNSAFE|CONFIG_FILE_UNSAFE|CONFIG_CONFLICT|CONFIG_WRITE_FAILED|MATRIX_TOKEN_FILE_UNSAFE|MATRIX_TOKEN_INVALID|MATRIX_TARGETS_FILE_UNSAFE|MATRIX_TARGETS_INVALID|INTEX_AGENT_HEALTH_FAILED|WHATSAPP_HEALTH_FAILED|MATRIX_HEALTH_FAILED|FIREBASE_IDENTITY_MISSING|FIREBASE_IDENTITY_DISABLED|FIREBASE_CHECK_FAILED|MATRIX_IDENTITY_MISMATCH|MATRIX_WHOAMI_UNAUTHORIZED|MATRIX_WHOAMI_FAILED|WHATSAPP_DELIVERY_NOT_READY|WHATSAPP_DELIVERY_FAILED|SCENARIO_CATALOG_FAILED|MINIMAX_KEY_MISSING|MINIMAX_PROBE_TIMEOUT|MINIMAX_PROBE_INVALID|MINIMAX_PROBE_FAILED|UNEXPECTED_FAILURE)'
readonly safe_alias_pattern='^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$'
readonly safe_run_id_pattern='[a-z0-9][a-z0-9._-]{0,95}'
readonly matrix_corpus_failure_pattern='(REVISION_INVALID|REVISION_MISMATCH|IMPLEMENTATION_PATHS_DIRTY|PRODUCTION_RUNTIME_REQUIRED|SERVICES_NOT_READY|USER_NOT_READY|ACCOUNT_TUPLE_INVALID|MATRIX_NOT_READY|WHATSAPP_NOT_READY|CAPABILITY_BOUNDARY_NOT_READY|CATALOG_INVALID|MODEL_BINDING_INVALID|RUN_CONFLICT|ARTIFACT_ROOT_NOT_READY|PREFLIGHT_UNEXPECTED_FAILURE)'

is_safe_alias() {
  local candidate=$1
  [[ $candidate =~ $safe_alias_pattern ]] && [[ $candidate =~ [A-Za-z] ]]
}

is_safe_check_line() {
  local prefix=$1
  local line=$2
  local pass_pattern="^${prefix} check ${safe_check_pattern} PASS$"
  local fail_pattern="^${prefix} check ${safe_check_pattern} FAIL ${safe_failure_pattern}$"
  [[ $line =~ $pass_pattern ]] || [[ $line =~ $fail_pattern ]]
}

is_safe_preflight_pass_line() {
  local line=$1
  local pattern='^preflight result PASS host home-dev intex-agent 8134 whatsapp-service 8113 matrix-adapter 8099 judge or:minimax/minimax-m3 scenarios ([0-9]{1,6}) account (.+)$'
  [[ $line =~ $pattern ]] && is_safe_alias "${BASH_REMATCH[2]}"
}

is_safe_preflight_fail_line() {
  local line=$1
  local pattern="^preflight result FAIL ${safe_failure_pattern}$"
  [[ $line =~ $pattern ]]
}

is_safe_setup_pass_line() {
  local line=$1
  local pattern='^setup result PASS (created|already_configured) account (.+)$'
  [[ $line =~ $pattern ]] && is_safe_alias "${BASH_REMATCH[2]}"
}

is_safe_setup_fail_line() {
  local line=$1
  local pattern="^setup result FAIL ${safe_failure_pattern}$"
  [[ $line =~ $pattern ]]
}

filter_setup_stream() {
  local state='before'
  local invalid=0
  local payload_status=''
  local frame_status=''
  local terminal_line=''
  local line=''
  local end_pattern="^${end_marker_prefix}([0-9]+)__$"

  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    case $state in
      before)
        if [[ $line == "$begin_marker" ]]; then
          state='inside'
        else
          invalid=1
        fi
        ;;
      inside)
        if [[ $line =~ $end_pattern ]]; then
          frame_status=${BASH_REMATCH[1]}
          state='after'
          continue
        fi
        if [[ -n $payload_status ]]; then
          invalid=1
          continue
        fi

        case $line in
          '')
            printf '\n'
            ;;
          'setup input account_alias')
            printf '%s\n' "$line"
            ;;
          'setup input canonical_user_id' | 'setup input matrix_user_id' | \
            'setup input matrix_access_token_file' | 'setup input matrix_targets_file')
            printf '%s\n' "$line"
            ;;
          'revision_mismatch' | 'remote_environment_unavailable')
            if [[ -z $payload_status ]]; then
              terminal_line=$line
              payload_status=2
            else
              invalid=1
            fi
            ;;
          'cli result FAIL UNEXPECTED_FAILURE')
            if [[ -z $payload_status ]]; then
              terminal_line=$line
              payload_status=2
            else
              invalid=1
            fi
            ;;
          *)
            if is_safe_check_line 'setup' "$line"; then
              printf '%s\n' "$line"
            elif is_safe_setup_pass_line "$line"; then
              if [[ -z $payload_status ]]; then
                terminal_line=$line
                payload_status=0
              else
                invalid=1
              fi
            elif is_safe_setup_fail_line "$line"; then
              if [[ -z $payload_status ]]; then
                terminal_line=$line
                payload_status=2
              else
                invalid=1
              fi
            else
              invalid=1
            fi
            ;;
        esac
        ;;
      after)
        invalid=1
        ;;
    esac
  done

  if ((invalid != 0)) || [[ $state != 'after' ]] || \
    [[ -z $payload_status || $payload_status != "$frame_status" ]]; then
    return 90
  fi
  printf '%s\n' "$terminal_line"
  case $frame_status in
    0) return 10 ;;
    1) return 11 ;;
    2) return 12 ;;
    *) return 90 ;;
  esac
}

if [[ ${cli_arguments[0]} == 'setup' ]]; then
  set +e
  run_ssh '-tt' 2>/dev/null | filter_setup_stream
  pipeline_status=("${PIPESTATUS[@]}")
  set -e
  ssh_status=${pipeline_status[0]:-255}
  filter_status=${pipeline_status[1]:-90}

  case $ssh_status in
    0 | 1 | 2)
      if ((filter_status != ssh_status + 10)); then
        printf '%s\n' 'remote_execution_failed' >&2
        exit 2
      fi
      exit "$ssh_status"
      ;;
    *)
      printf '%s\n' 'remote_execution_failed' >&2
      exit 2
      ;;
  esac
fi

validate_preflight_payload() {
  local payload=$1
  local expected_status=$2
  local remaining=$payload
  local line=''
  local terminal_status=''

  while [[ -n $remaining ]]; do
    [[ $remaining == *$'\n'* ]] || return 1
    line=${remaining%%$'\n'*}
    remaining=${remaining#*$'\n'}
    if is_safe_check_line 'preflight' "$line"; then
      continue
    fi
    if is_safe_preflight_pass_line "$line"; then
      [[ -z $terminal_status ]] || return 1
      terminal_status=0
      continue
    fi
    if is_safe_preflight_fail_line "$line" || [[ $line == 'cli result FAIL UNEXPECTED_FAILURE' ]]; then
      [[ -z $terminal_status ]] || return 1
      terminal_status=2
      continue
    fi
    return 1
  done

  [[ -n $terminal_status && $terminal_status == "$expected_status" ]]
}

validate_evaluation_payload() {
  local payload=$1
  local expected_status=$2
  local expected_command=${cli_arguments[0]}
  local expected_scenario=${cli_arguments[1]-}
  local remaining=$payload
  local line=''
  local run_id=''
  local terminal_status=''
  local report_seen=0
  local preflight_seen=0
  local behavioral_seen=0
  local infrastructure_seen=0
  local cli_failure_seen=0
  local run_pattern="^evaluation run (${safe_run_id_pattern}) command ${expected_command}$"
  local scenario_pattern='^scenario (intex-eval-[0-9]{3}) (PASS|BEHAVIORAL_FAILURE|INFRASTRUCTURE_FAILURE)$'
  local report_pattern="^evaluation report \\.artifacts/intex-agent-evals/(${safe_run_id_pattern})$"

  while [[ -n $remaining ]]; do
    [[ $remaining == *$'\n'* ]] || return 1
    line=${remaining%%$'\n'*}
    remaining=${remaining#*$'\n'}

    if [[ $line =~ $run_pattern ]]; then
      [[ -z $run_id ]] || return 1
      run_id=${BASH_REMATCH[1]}
      continue
    fi
    if is_safe_check_line 'preflight' "$line"; then
      continue
    fi
    if is_safe_preflight_pass_line "$line"; then
      ((preflight_seen == 0)) || return 1
      preflight_seen=1
      continue
    fi
    if is_safe_preflight_fail_line "$line"; then
      ((preflight_seen == 0)) || return 1
      preflight_seen=1
      infrastructure_seen=1
      continue
    fi
    if [[ $line =~ $scenario_pattern ]]; then
      [[ $expected_command == 'endpoint' || $expected_command == 'full' || $expected_command == 'scenario' ]] || return 1
      if [[ $expected_command == 'scenario' && ${BASH_REMATCH[1]} != "$expected_scenario" ]]; then
        return 1
      fi
      case ${BASH_REMATCH[2]} in
        PASS) ;;
        BEHAVIORAL_FAILURE) behavioral_seen=1 ;;
        INFRASTRUCTURE_FAILURE) infrastructure_seen=1 ;;
      esac
      continue
    fi
    case $line in
      'matrix-smoke PASS')
        [[ $expected_command == 'full' || $expected_command == 'matrix-smoke' ]] || return 1
        continue
        ;;
      'matrix-smoke BEHAVIORAL_FAILURE')
        [[ $expected_command == 'full' || $expected_command == 'matrix-smoke' ]] || return 1
        behavioral_seen=1
        continue
        ;;
      'matrix-smoke INFRASTRUCTURE_FAILURE')
        [[ $expected_command == 'full' || $expected_command == 'matrix-smoke' ]] || return 1
        infrastructure_seen=1
        continue
        ;;
      'evaluation result PASS exit 0')
        [[ -z $terminal_status ]] || return 1
        terminal_status=0
        continue
        ;;
      'evaluation result BEHAVIORAL_FAILURE exit 1')
        [[ -z $terminal_status ]] || return 1
        terminal_status=1
        behavioral_seen=1
        continue
        ;;
      'evaluation result INFRASTRUCTURE_FAILURE exit 2')
        [[ -z $terminal_status ]] || return 1
        terminal_status=2
        infrastructure_seen=1
        continue
        ;;
      'evaluation report FAIL REPORTING_FAILED')
        ((report_seen == 0)) || return 1
        report_seen=1
        infrastructure_seen=1
        continue
        ;;
      'cli result FAIL UNEXPECTED_FAILURE')
        [[ -z $terminal_status ]] || return 1
        terminal_status=2
        cli_failure_seen=1
        infrastructure_seen=1
        continue
        ;;
      'cli result FAIL INVALID_SCENARIO')
        [[ $expected_command == 'scenario' && -z $terminal_status ]] || return 1
        terminal_status=2
        cli_failure_seen=1
        infrastructure_seen=1
        continue
        ;;
    esac
    if [[ $line =~ $report_pattern ]]; then
      ((report_seen == 0)) || return 1
      [[ -n $run_id && ${BASH_REMATCH[1]} == "$run_id" ]] || return 1
      report_seen=1
      continue
    fi
    return 1
  done

  [[ -n $terminal_status && $terminal_status == "$expected_status" ]] || return 1
  if ((cli_failure_seen == 1)); then
    [[ -z $run_id && $preflight_seen -eq 0 && $report_seen -eq 0 ]] || return 1
  else
    [[ -n $run_id && $preflight_seen -eq 1 && $report_seen -eq 1 ]] || return 1
  fi
  case $expected_status in
    0) ((behavioral_seen == 0 && infrastructure_seen == 0)) ;;
    1) ((behavioral_seen == 1 && infrastructure_seen == 0)) ;;
    2) ((infrastructure_seen == 1)) ;;
    *) return 1 ;;
  esac
}

validate_matrix_corpus_payload() {
  local payload=$1
  local expected_status=$2
  local remaining=$payload
  local line=''
  local preflight_seen=0
  local run_id=''
  local terminal_status=''
  local report_seen=0
  local scenario_seen=0
  local run_pattern="^evaluation run (${safe_run_id_pattern}) command matrix-corpus$"
  local scenario_pattern='^scenario intex-eval-([0-9]{3}) (PASS|BEHAVIORAL_FAILURE|INFRASTRUCTURE_FAILURE)$'
  local report_pattern="^evaluation report \\.artifacts/intex-agent-evals/(${safe_run_id_pattern})$"
  local failure_pattern="^preflight result FAIL ${matrix_corpus_failure_pattern}$"

  while [[ -n $remaining ]]; do
    [[ $remaining == *$'\n'* ]] || return 1
    line=${remaining%%$'\n'*}
    remaining=${remaining#*$'\n'}
    if [[ $line == 'preflight result PASS' ]]; then
      ((preflight_seen == 0)) || return 1
      preflight_seen=1
      continue
    fi
    if [[ $line =~ $failure_pattern ]]; then
      [[ $expected_status == 2 && $preflight_seen -eq 0 && -z $run_id && -z $terminal_status ]] || return 1
      terminal_status=2
      continue
    fi
    if [[ $line =~ $run_pattern ]]; then
      [[ $preflight_seen -eq 1 && -z $run_id ]] || return 1
      run_id=${BASH_REMATCH[1]}
      continue
    fi
    if [[ $line =~ $scenario_pattern ]]; then
      [[ -n $run_id && -z $terminal_status ]] || return 1
      scenario_seen=$((scenario_seen + 1))
      ((scenario_seen <= 20)) || return 1
      printf -v expected_scenario_ordinal '%03d' "$scenario_seen"
      [[ ${BASH_REMATCH[1]} == "$expected_scenario_ordinal" ]] || return 1
      continue
    fi
    case $line in
      'evaluation result PASS exit 0')
        [[ -n $run_id && -z $terminal_status ]] || return 1
        terminal_status=0
        ;;
      'evaluation result BEHAVIORAL_FAILURE exit 1')
        [[ -n $run_id && -z $terminal_status ]] || return 1
        terminal_status=1
        ;;
      'evaluation result INFRASTRUCTURE_FAILURE exit 2')
        [[ -n $run_id && -z $terminal_status ]] || return 1
        terminal_status=2
        ;;
      *)
        if [[ $line =~ $report_pattern ]]; then
          ((report_seen == 0)) || return 1
          [[ -n $run_id && ${BASH_REMATCH[1]} == "$run_id" && -n $terminal_status ]] || return 1
          report_seen=1
        else
          return 1
        fi
        ;;
    esac
  done

  [[ -n $terminal_status && $terminal_status == "$expected_status" ]] || return 1
  if [[ -z $run_id ]]; then
    [[ $expected_status == 2 && $preflight_seen -eq 0 && $report_seen -eq 0 ]]
    return
  fi
  [[ $preflight_seen -eq 1 ]] || return 1
  if [[ $expected_status == 0 || $expected_status == 1 ]]; then
    [[ $scenario_seen -eq 20 && $report_seen -eq 1 ]]
  else
    [[ $report_seen -eq 0 || $report_seen -eq 1 ]]
  fi
}

extract_validated_payload() {
  local captured=$1
  local expected_status=$2
  local destination_name=$3
  local prefix="${begin_marker}"$'\n'
  local suffix="${end_marker_prefix}${expected_status}__"$'\n'
  local payload=''

  [[ $captured == "$prefix"* ]] || return 1
  [[ $captured == *"$suffix" ]] || return 1
  payload=${captured#"$prefix"}
  payload=${payload%"$suffix"}
  [[ -n $payload && $payload == *$'\n' ]] || return 1

  if [[ $expected_status == 2 && \
    ($payload == $'revision_mismatch\n' || $payload == $'remote_environment_unavailable\n' || $payload == $'remote_implementation_paths_dirty\n') ]]; then
    printf -v "$destination_name" '%s' "$payload"
    return 0
  fi

  case ${cli_arguments[0]} in
    preflight)
      validate_preflight_payload "$payload" "$expected_status" || return 1
      ;;
    matrix-corpus)
      validate_matrix_corpus_payload "$payload" "$expected_status" || return 1
      ;;
    endpoint | full | scenario | matrix-smoke)
      validate_evaluation_payload "$payload" "$expected_status" || return 1
      ;;
    *)
      return 1
      ;;
  esac
  printf -v "$destination_name" '%s' "$payload"
}

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
    if [[ -n $captured_stderr || -z $captured_stdout ]]; then
      printf '%s\n' 'remote_execution_failed' >&2
      exit 2
    fi
    validated_payload=''
    if ! extract_validated_payload "$captured_stdout" "$ssh_status" validated_payload; then
      printf '%s\n' 'remote_execution_failed' >&2
      exit 2
    fi
    printf '%s' "$validated_payload"
    exit "$ssh_status"
    ;;
  *)
    printf '%s\n' 'remote_execution_failed' >&2
    exit 2
    ;;
esac
