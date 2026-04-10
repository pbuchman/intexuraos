#!/usr/bin/env bash
#
# Install missing Lua runtime dependencies for lua-resty-openidc on an
# already-provisioned Hetzner VM (INT-750 Phase 7 fix).
#
# Background: provision.sh initially installed `lua5.1 luarocks` and then
# `luarocks install lua-resty-openidc`. luarocks doesn't pull `cjson` as a
# transitive dep because the rockspec assumes it's provided by the host
# distribution. On Ubuntu 24.04 with libnginx-mod-http-lua, cjson must come
# from the `lua-cjson` apt package. Without it, the first request hitting
# /internal/* crashes with "module 'cjson' not found" and returns HTTP 500.
#
# This script is a one-off catch-up for VMs provisioned before lua-cjson
# was added to provision.sh's apt list. Safe to run multiple times
# (apt install is a no-op if already present).
#
# Usage (via deploy+sudo):
#   ssh deploy@<ip> 'sudo -n bash /opt/intexuraos/scripts/hetzner/install-lua-deps.sh'

set -euo pipefail
IFS=$'\n\t'

log() { printf '=== %s ===\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  fail "must run as root (got uid $EUID)"
fi

log "[1/4] Installing lua-cjson via apt"
DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y lua-cjson

log "[2/4] Verifying cjson.so is on the nginx-lua search path"
CJSON_PATH="/usr/lib/x86_64-linux-gnu/lua/5.1/cjson.so"
if [[ -f "$CJSON_PATH" ]]; then
  printf '    found: %s\n' "$CJSON_PATH"
else
  fail "cjson.so not found at $CJSON_PATH after apt install (package layout change?)"
fi

log "[3/4] Installing lua-resty-core + lua-resty-lrucache via luarocks"
# lua-resty-http (transitively required by lua-resty-openidc) imports
# resty.string which is part of lua-resty-core. OpenResty bundles these;
# Ubuntu's stock libnginx-mod-http-lua does not. Install via luarocks.
# lua-resty-lrucache is also used by several lua-resty-* modules for
# in-process caching; install it too to avoid a second catch-up round.
luarocks install --force lua-resty-core
luarocks install --force lua-resty-lrucache

log "[4/4] Reloading nginx so it picks up the new Lua module paths"
# Note: technically the nginx-lua module re-evaluates `require` on every
# request (it doesn't cache module file paths at nginx-start time), so a
# reload may not be strictly necessary. Doing it anyway for consistency
# with other deploy flows.
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
  log "    nginx reloaded"
else
  systemctl restart nginx
  log "    nginx restarted (was inactive)"
fi

log "Lua deps install complete"
