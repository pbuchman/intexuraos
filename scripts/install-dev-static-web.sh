#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'install-dev-static-web: %s\n' "$1" >&2
  exit 1
}

release_sha="${1:-}"
[[ "${release_sha}" =~ ^[0-9a-f]{40}$ ]] || fail 'release SHA must be exactly 40 lowercase hexadecimal characters'

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_directory="${REPO_DIR:-$(cd -- "${script_directory}/.." && pwd)}"
source_directory="${repo_directory}/apps/web/dist"
web_root="${DEV_WEB_ROOT:-/var/www/intexuraos-dev}"
web_owner="${DEV_WEB_OWNER-root:caddy}"
node_binary="${NODE_BIN:-node}"

[[ "${repo_directory}" = /* ]] || fail 'REPO_DIR must be an absolute path'
[[ "${web_root}" = /* && "${web_root}" != / ]] || fail 'DEV_WEB_ROOT must be a specific absolute path'
[[ -f "${source_directory}/index.html" ]] || fail 'static build index.html is missing'

"${node_binary}" "${script_directory}/verify-web-static-build.mjs" "${source_directory}"

releases_directory="${web_root}/releases"
final_directory="${releases_directory}/${release_sha}"
install -d -m 0750 "${web_root}" "${releases_directory}"

if [[ "${web_owner}" != skip ]]; then
  chown "${web_owner}" "${web_root}" "${releases_directory}"
fi

staging_directory=$(mktemp -d "${releases_directory}/.${release_sha}.XXXXXX")
current_link="${web_root}/.current.${release_sha}.$$"
cleanup() {
  if [[ -n "${staging_directory:-}" && -d "${staging_directory}" ]]; then
    find "${staging_directory}" -depth -delete
  fi
  if [[ -L "${current_link}" ]]; then
    unlink "${current_link}"
  fi
}
trap cleanup EXIT

cp -a "${source_directory}/." "${staging_directory}/"
find "${staging_directory}" -type d -exec chmod 0750 {} +
find "${staging_directory}" -type f -exec chmod 0640 {} +
if [[ "${web_owner}" != skip ]]; then
  chown -R "${web_owner}" "${staging_directory}"
fi

if [[ -e "${final_directory}" || -L "${final_directory}" ]]; then
  [[ -d "${final_directory}" && ! -L "${final_directory}" ]] || fail 'existing release target is not a directory'
  find "${final_directory}" -depth -delete
fi
mv "${staging_directory}" "${final_directory}"
staging_directory=''

"${node_binary}" -e '
  const fs = require("node:fs");
  fs.symlinkSync(process.argv[1], process.argv[2]);
  fs.renameSync(process.argv[2], process.argv[3]);
' "${final_directory}" "${current_link}" "${web_root}/current"

printf 'Published Home Dev static web release %s\n' "${release_sha}"
