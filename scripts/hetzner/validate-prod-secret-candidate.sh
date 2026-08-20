#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
RUNTIME_CREDENTIAL_CANARY_BUCKET="${RUNTIME_CREDENTIAL_CANARY_BUCKET:-intexuraos-images-dev}"
RUNTIME_CREDENTIAL_CANARY_TOPIC="${RUNTIME_CREDENTIAL_CANARY_TOPIC:-intexuraos-runtime-credential-canary-dev}"
CLOUDFLARE_ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-intexuraos.cloud}"
EXPECTED_CLOUDFLARE_ACCOUNT_ID="${EXPECTED_CLOUDFLARE_ACCOUNT_ID:-}"
CLOUDFLARE_DNS_EDIT_ATTESTATION_DIR="${CLOUDFLARE_DNS_EDIT_ATTESTATION_DIR:-/etc/intexuraos/cloudflare-dns-attestations}"
SKIP_RUNTIME_CREDENTIAL_SMOKE="${SKIP_RUNTIME_CREDENTIAL_SMOKE:-0}"
SKIP_CLOUDFLARE_CREDENTIAL_SMOKE="${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE:-0}"
SKIP_OWNERSHIP="${SKIP_OWNERSHIP:-0}"
CURL_CONNECT_TIMEOUT_SECONDS="${CURL_CONNECT_TIMEOUT_SECONDS:-5}"
CURL_MAX_TIME_SECONDS="${CURL_MAX_TIME_SECONDS:-20}"
GCLOUD_TOKEN_TIMEOUT_SECONDS="${GCLOUD_TOKEN_TIMEOUT_SECONDS:-15}"
RUNTIME_CREDENTIAL_PATH=""
CLOUDFLARE_CREDENTIALS_PATH=""
PACKAGE_VERSION=""
ATTESTATION_PATH=""
TEMP_FILES=()

usage() {
  cat <<EOF
Usage: INTEXURAOS_ENVIRONMENT=prod $(basename "$0") \\
  --runtime-credential <mode-0600-json> \\
  --cloudflare-credentials <mode-0600-ini> \\
  --package-version <n>

Runs non-printing candidate proofs for the packaged PROD runtime credential and
Cloudflare DNS token. Mutable package versions are rejected.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

curl_canary() {
  curl \
    --connect-timeout "${CURL_CONNECT_TIMEOUT_SECONDS}" \
    --max-time "${CURL_MAX_TIME_SECONDS}" \
    "$@"
}

cleanup() {
  local path=""
  for path in "${TEMP_FILES[@]}"; do
    [[ -f "${path}" || -L "${path}" ]] && rm -f -- "${path}"
  done
}

trap cleanup EXIT

new_private_temp_file() {
  local output_variable="$1"
  local path=""
  path="$(mktemp "${TMPDIR:-/tmp}/.candidate-canary-XXXXXX")" \
    || fail 'Unable to allocate private candidate canary workspace'
  chmod 600 "${path}"
  TEMP_FILES+=("${path}")
  printf -v "${output_variable}" '%s' "${path}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --runtime-credential)
        shift
        [[ $# -gt 0 ]] || fail '--runtime-credential requires a value'
        RUNTIME_CREDENTIAL_PATH="$1"
        shift
        ;;
      --runtime-credential=*) RUNTIME_CREDENTIAL_PATH="${1#*=}"; shift ;;
      --cloudflare-credentials)
        shift
        [[ $# -gt 0 ]] || fail '--cloudflare-credentials requires a value'
        CLOUDFLARE_CREDENTIALS_PATH="$1"
        shift
        ;;
      --cloudflare-credentials=*) CLOUDFLARE_CREDENTIALS_PATH="${1#*=}"; shift ;;
      --package-version)
        shift
        [[ $# -gt 0 ]] || fail '--package-version requires a value'
        PACKAGE_VERSION="$1"
        shift
        ;;
      --package-version=*) PACKAGE_VERSION="${1#*=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done
}

load_expected_cloudflare_account_id() {
  [[ -n "${EXPECTED_CLOUDFLARE_ACCOUNT_ID}" ]] && return 0
  EXPECTED_CLOUDFLARE_ACCOUNT_ID="$(node --input-type=module - \
    "${REPO_ROOT}/config/environments/common.json" <<'NODE'
import { readFileSync } from 'node:fs';
const [path] = process.argv.slice(2);
let value;
try { value = JSON.parse(readFileSync(path, 'utf8')).INTEXURAOS_CLOUDFLARE_ACCOUNT_ID; }
catch { process.exit(1); }
if (typeof value !== 'string') process.exit(1);
process.stdout.write(value);
NODE
  )" || fail 'Expected Cloudflare account ID is unavailable'
}

validate_cloudflare_dns_edit_attestation() {
  ATTESTATION_PATH="${CLOUDFLARE_DNS_EDIT_ATTESTATION_DIR}/prod-v${PACKAGE_VERSION}.json"
  node --input-type=module - \
    "${CLOUDFLARE_DNS_EDIT_ATTESTATION_DIR}" \
    "${ATTESTATION_PATH}" \
    "${PACKAGE_VERSION}" \
    "${EXPECTED_CLOUDFLARE_ACCOUNT_ID}" \
    "${CLOUDFLARE_ZONE_NAME}" \
    "${SKIP_OWNERSHIP}" <<'NODE' \
    || fail 'Cloudflare DNS Edit attestation is invalid'
import { lstatSync, readFileSync } from 'node:fs';
const [directoryPath, path, packageVersion, expectedAccountId, expectedZoneName, skipOwnership] =
  process.argv.slice(2);
let directoryStatus;
let status;
let document;
try {
  directoryStatus = lstatSync(directoryPath);
  status = lstatSync(path);
  document = JSON.parse(readFileSync(path, 'utf8'));
} catch {
  process.exit(1);
}
const verifiedAt = Date.parse(document?.verifiedAt);
if (
  !directoryStatus.isDirectory() ||
  directoryStatus.isSymbolicLink() ||
  (directoryStatus.mode & 0o7777) !== 0o700 ||
  (skipOwnership !== '1' && (directoryStatus.uid !== 0 || directoryStatus.gid !== 0)) ||
  !status.isFile() ||
  status.isSymbolicLink() ||
  (status.mode & 0o7777) !== 0o600 ||
  (skipOwnership !== '1' && (status.uid !== 0 || status.gid !== 0)) ||
  document?.schemaVersion !== 1 ||
  document?.environment !== 'prod' ||
  document?.packageVersion !== packageVersion ||
  document?.accountId !== expectedAccountId ||
  document?.zoneName !== expectedZoneName ||
  document?.permission !== 'Zone DNS Edit' ||
  document?.resourceScope !== 'exact-zone' ||
  typeof document?.tokenId !== 'string' ||
  !/^[0-9a-f]{32}$/u.test(document.tokenId) ||
  !Number.isFinite(verifiedAt) ||
  verifiedAt > Date.now() + 5 * 60 * 1000 ||
  verifiedAt < Date.now() - 24 * 60 * 60 * 1000 ||
  typeof document?.verifiedBy !== 'string' ||
  document.verifiedBy.length === 0 ||
  document.verifiedBy.length > 256 ||
  typeof document?.evidenceReference !== 'string' ||
  document.evidenceReference.length === 0 ||
  document.evidenceReference.length > 256
) process.exit(1);
NODE
}

validate_runtime_credential_file() {
  node --input-type=module - "${RUNTIME_CREDENTIAL_PATH}" <<'NODE' \
    || fail 'Runtime credential is invalid or not mode 600'
import { lstatSync, readFileSync } from 'node:fs';
const [path] = process.argv.slice(2);
let status;
let document;
try {
  status = lstatSync(path);
  document = JSON.parse(readFileSync(path, 'utf8'));
} catch {
  process.exit(1);
}
if (
  !status.isFile() ||
  status.isSymbolicLink() ||
  (status.mode & 0o7777) !== 0o600 ||
  document?.type !== 'service_account' ||
  typeof document?.private_key !== 'string' ||
  document.private_key.length === 0
) process.exit(1);
NODE
}

require_preconditions() {
  [[ "${INTEXURAOS_ENVIRONMENT:-}" == 'prod' ]] \
    || fail 'Refusing candidate credential validation unless INTEXURAOS_ENVIRONMENT=prod'
  [[ "${PROJECT_ID}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail 'Invalid GCP project ID'
  [[ "${PACKAGE_VERSION}" =~ ^[1-9][0-9]*$ ]] \
    || fail 'Package version must be an exact positive numeric version'
  [[ "${SKIP_RUNTIME_CREDENTIAL_SMOKE}" =~ ^[01]$ ]] \
    || fail 'SKIP_RUNTIME_CREDENTIAL_SMOKE must be 0 or 1'
  [[ "${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE}" =~ ^[01]$ ]] \
    || fail 'SKIP_CLOUDFLARE_CREDENTIAL_SMOKE must be 0 or 1'
  [[ "${SKIP_OWNERSHIP}" =~ ^[01]$ ]] || fail 'SKIP_OWNERSHIP must be 0 or 1'
  if ! [[ "${CURL_CONNECT_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]{0,2}$ ]] \
    || (( CURL_CONNECT_TIMEOUT_SECONDS > 60 )) \
    || ! [[ "${CURL_MAX_TIME_SECONDS}" =~ ^[1-9][0-9]{0,2}$ ]] \
    || (( CURL_MAX_TIME_SECONDS > 300 )) \
    || (( CURL_MAX_TIME_SECONDS < CURL_CONNECT_TIMEOUT_SECONDS )); then
    fail 'Candidate curl timeout values are invalid'
  fi
  command -v node >/dev/null 2>&1 || fail 'node is required'

  if [[ "${SKIP_RUNTIME_CREDENTIAL_SMOKE}" != '1' ]]; then
    [[ -r "${RUNTIME_CREDENTIAL_PATH}" ]] || fail 'Runtime credential is unavailable'
    validate_runtime_credential_file
    [[ "${RUNTIME_CREDENTIAL_CANARY_BUCKET}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] \
      || fail 'Runtime credential canary bucket is invalid'
    [[ "${RUNTIME_CREDENTIAL_CANARY_TOPIC}" =~ ^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$ ]] \
      || fail 'Runtime credential canary topic is invalid'
    command -v gcloud >/dev/null 2>&1 || fail 'gcloud is required for runtime credential proof'
    command -v timeout >/dev/null 2>&1 || fail 'timeout is required for runtime credential proof'
    command -v curl >/dev/null 2>&1 || fail 'curl is required for runtime credential proof'
    if ! [[ "${GCLOUD_TOKEN_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]{0,2}$ ]] \
      || (( GCLOUD_TOKEN_TIMEOUT_SECONDS > 60 )); then
      fail 'Runtime credential token timeout must be between 1 and 60 seconds'
    fi
  fi

  if [[ "${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE}" != '1' ]]; then
    [[ -r "${CLOUDFLARE_CREDENTIALS_PATH}" ]] \
      || fail 'Cloudflare credentials are unavailable'
    [[ "${CLOUDFLARE_ZONE_NAME}" =~ ^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$ ]] \
      || fail 'Cloudflare zone name is invalid'
    command -v curl >/dev/null 2>&1 || fail 'curl is required for Cloudflare credential proof'
    load_expected_cloudflare_account_id
    [[ "${EXPECTED_CLOUDFLARE_ACCOUNT_ID}" =~ ^[0-9a-f]{32}$ ]] \
      || fail 'Expected Cloudflare account ID is invalid'
    validate_cloudflare_dns_edit_attestation
  fi
}

validate_runtime_credential() {
  [[ "${SKIP_RUNTIME_CREDENTIAL_SMOKE}" == '1' ]] && return 0
  local access_token=""
  local authorization_header_file=""
  local pubsub_response_file=""
  local token_status=0

  access_token="$(CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${RUNTIME_CREDENTIAL_PATH}" \
    timeout --signal=TERM --kill-after=5 \
      "${GCLOUD_TOKEN_TIMEOUT_SECONDS}" \
      gcloud auth print-access-token --quiet 2>/dev/null)" \
    || token_status=$?
  if [[ "${token_status}" -eq 124 || "${token_status}" -eq 137 ]]; then
    fail 'Runtime service-account token proof timed out'
  fi
  [[ "${token_status}" -eq 0 ]] || fail 'Runtime service-account token proof failed'
  [[ -n "${access_token}" && ! "${access_token}" =~ [[:space:][:cntrl:]] ]] \
    || fail 'Runtime service-account token proof returned an invalid token'
  new_private_temp_file authorization_header_file
  printf 'Authorization: Bearer %s\n' "${access_token}" > "${authorization_header_file}"
  unset access_token

  curl_canary --fail --silent --show-error --output /dev/null \
    --request POST \
    --header "@${authorization_header_file}" \
    --header 'Content-Type: application/json' \
    --data-binary '{"pageSize":1}' \
    "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:listCollectionIds" \
    || fail 'Runtime service-account Firestore read proof failed'

  curl_canary --fail --silent --show-error --output /dev/null \
    --request GET \
    --header "@${authorization_header_file}" \
    "https://storage.googleapis.com/storage/v1/b/${RUNTIME_CREDENTIAL_CANARY_BUCKET}/o?maxResults=1&fields=kind" \
    || fail 'Runtime service-account Cloud Storage list proof failed'

  curl_canary --fail --silent --show-error --output /dev/null \
    --request POST \
    --header "@${authorization_header_file}" \
    --header 'Content-Type: application/json' \
    --data-binary '{"returnUserInfo":false}' \
    "https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query" \
    || fail 'Runtime service-account Firebase Auth query proof failed'

  new_private_temp_file pubsub_response_file
  curl_canary --fail --silent --show-error --output "${pubsub_response_file}" \
    --request POST \
    --header "@${authorization_header_file}" \
    --header 'Content-Type: application/json' \
    --data-binary '{"messages":[{"data":"e30=","attributes":{"canary":"runtime-credential"}}]}' \
    "https://pubsub.googleapis.com/v1/projects/${PROJECT_ID}/topics/${RUNTIME_CREDENTIAL_CANARY_TOPIC}:publish" \
    || fail 'Runtime service-account Pub/Sub publish proof failed'
  node --input-type=module - "${pubsub_response_file}" <<'NODE' \
    || fail 'Runtime service-account Pub/Sub publish proof failed'
import { readFileSync } from 'node:fs';
const [path] = process.argv.slice(2);
let response;
try { response = JSON.parse(readFileSync(path, 'utf8')); } catch { process.exit(1); }
if (
  !Array.isArray(response?.messageIds) ||
  response.messageIds.length !== 1 ||
  typeof response.messageIds[0] !== 'string' ||
  response.messageIds[0].length === 0
) process.exit(1);
NODE
}

write_cloudflare_authorization_header() {
  local target="$1"
  node --input-type=module - "${CLOUDFLARE_CREDENTIALS_PATH}" "${target}" <<'NODE' \
    || fail 'Cloudflare credentials are invalid or not mode 600'
import { chmodSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
const [source, target] = process.argv.slice(2);
let status;
let contents;
try {
  status = lstatSync(source);
  contents = readFileSync(source, 'utf8');
} catch {
  process.exit(1);
}
const match = /^dns_cloudflare_api_token = ([^\r\n\0]+)\n$/u.exec(contents);
if (
  !status.isFile() ||
  status.isSymbolicLink() ||
  (status.mode & 0o7777) !== 0o600 ||
  match === null
) process.exit(1);
writeFileSync(target, `Authorization: Bearer ${match[1]}\n`, { mode: 0o600 });
chmodSync(target, 0o600);
NODE
}

validate_cloudflare_credentials() {
  [[ "${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE}" == '1' ]] && return 0
  local authorization_header_file=""
  local verify_response_file=""
  local zone_response_file=""
  local zone_id_file=""
  local dns_response_file=""
  local zone_id=""

  new_private_temp_file authorization_header_file
  new_private_temp_file verify_response_file
  new_private_temp_file zone_response_file
  new_private_temp_file zone_id_file
  new_private_temp_file dns_response_file
  write_cloudflare_authorization_header "${authorization_header_file}"

  curl_canary --fail --silent --show-error --output "${verify_response_file}" \
    --request GET \
    --header "@${authorization_header_file}" \
    'https://api.cloudflare.com/client/v4/user/tokens/verify' \
    || fail 'Cloudflare token verification proof failed'
  node --input-type=module - "${verify_response_file}" "${ATTESTATION_PATH}" <<'NODE' \
    || fail 'Cloudflare token verification proof failed'
import { readFileSync } from 'node:fs';
const [responsePath, attestationPath] = process.argv.slice(2);
let response;
let attestation;
try {
  response = JSON.parse(readFileSync(responsePath, 'utf8'));
  attestation = JSON.parse(readFileSync(attestationPath, 'utf8'));
} catch {
  process.exit(1);
}
if (
  response?.success !== true ||
  response?.result?.status !== 'active' ||
  response?.result?.id !== attestation?.tokenId
) process.exit(1);
NODE

  curl_canary --fail --silent --show-error --output "${zone_response_file}" \
    --request GET \
    --get \
    --data-urlencode "name=${CLOUDFLARE_ZONE_NAME}" \
    --data-urlencode 'status=active' \
    --data-urlencode 'per_page=2' \
    --header "@${authorization_header_file}" \
    'https://api.cloudflare.com/client/v4/zones' \
    || fail 'Cloudflare exact-zone scope proof failed'
  node --input-type=module - \
    "${zone_response_file}" \
    "${zone_id_file}" \
    "${EXPECTED_CLOUDFLARE_ACCOUNT_ID}" \
    "${CLOUDFLARE_ZONE_NAME}" <<'NODE' \
    || fail 'Cloudflare exact-zone scope proof failed'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
const [responsePath, outputPath, expectedAccountId, expectedZoneName] = process.argv.slice(2);
let response;
try { response = JSON.parse(readFileSync(responsePath, 'utf8')); } catch { process.exit(1); }
const zone = Array.isArray(response?.result) && response.result.length === 1
  ? response.result[0]
  : undefined;
if (
  response?.success !== true ||
  typeof zone?.id !== 'string' ||
  !/^[0-9a-f]{32}$/u.test(zone.id) ||
  zone?.name !== expectedZoneName ||
  zone?.status !== 'active' ||
  zone?.account?.id !== expectedAccountId
) process.exit(1);
writeFileSync(outputPath, zone.id, { mode: 0o600 });
chmodSync(outputPath, 0o600);
NODE
  zone_id="$(<"${zone_id_file}")"

  curl_canary --fail --silent --show-error --output "${dns_response_file}" \
    --request GET \
    --header "@${authorization_header_file}" \
    "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records?per_page=1" \
    || fail 'Cloudflare exact-zone DNS read proof failed'
  node --input-type=module - "${dns_response_file}" <<'NODE' \
    || fail 'Cloudflare exact-zone DNS read proof failed'
import { readFileSync } from 'node:fs';
const [path] = process.argv.slice(2);
let response;
try { response = JSON.parse(readFileSync(path, 'utf8')); } catch { process.exit(1); }
if (response?.success !== true || !Array.isArray(response?.result)) process.exit(1);
NODE
}

main() {
  parse_args "$@"
  require_preconditions
  umask 077
  validate_runtime_credential
  validate_cloudflare_credentials
  printf 'PROD secret candidate credential canary passed\n'
}

main "$@"
