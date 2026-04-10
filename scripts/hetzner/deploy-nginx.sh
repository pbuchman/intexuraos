#!/usr/bin/env bash
#
# Redeploy the Hetzner nginx config + any Lua modules, and reload/restart
# nginx. Reusable for Phase 7 (JWT verifier install) and any future
# config change that doesn't touch certs or sudoers.
#
# Runs as ROOT via deploy+sudo (sudoers rule in
# /etc/sudoers.d/deploy-hetzner-scripts). Invoked from my Mac as:
#   ssh deploy@<ip> 'sudo -n bash /opt/intexuraos/scripts/hetzner/deploy-nginx.sh'
#
# What it does:
#   1. Fix /opt/intexuraos ownership back to deploy (in case anything in the
#      clone tree ended up root-owned from prior sudo runs).
#   2. Install scripts/hetzner/nginx/intexuraos.conf into
#      /etc/nginx/sites-available/ (root-owned, 644).
#   3. Install any scripts/hetzner/nginx/*.lua files into /etc/nginx/lua/.
#   4. nginx -t. On failure, exit without reloading.
#   5. If nginx active, reload gracefully; else restart to clear failed state.

set -euo pipefail
IFS=$'\n\t'

readonly REPO_NGINX_DIR="/opt/intexuraos/scripts/hetzner/nginx"
readonly NGINX_CONF_SRC="${REPO_NGINX_DIR}/intexuraos.conf"
readonly NGINX_CONF_DST="/etc/nginx/sites-available/intexuraos.conf"
readonly NGINX_LUA_DIR="/etc/nginx/lua"

log() { printf '=== %s ===\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  fail "must run as root (got uid $EUID)"
fi

log "[1/5] Restoring /opt/intexuraos ownership to deploy:deploy"
chown -R deploy:deploy /opt/intexuraos

log "[2/5] Installing nginx site config"
[[ -r "$NGINX_CONF_SRC" ]] || fail "$NGINX_CONF_SRC not found"
install -m 644 -o root -g root "$NGINX_CONF_SRC" "$NGINX_CONF_DST"

log "[3/5] Installing Lua modules into $NGINX_LUA_DIR"
install -d -o root -g root -m 755 "$NGINX_LUA_DIR"

# Enumerate all .lua files in the repo's nginx dir. Using `-prune` on
# non-.lua files keeps us from recursing into any subdirectories the repo
# might grow later.
lua_count=0
shopt -s nullglob
for lua_src in "${REPO_NGINX_DIR}"/*.lua; do
  lua_name="$(basename "$lua_src")"
  install -m 644 -o root -g root "$lua_src" "${NGINX_LUA_DIR}/${lua_name}"
  printf '    installed: %s\n' "${NGINX_LUA_DIR}/${lua_name}"
  lua_count=$((lua_count + 1))
done
shopt -u nullglob

if [[ "$lua_count" -eq 0 ]]; then
  printf '    (no *.lua files in %s — nothing to install)\n' "$REPO_NGINX_DIR"
fi

log "[4/5] Validating nginx config"
nginx -t || fail "nginx -t failed — check $NGINX_CONF_DST"

log "[5/5] Reloading/starting nginx"
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
  log "    nginx reloaded (was active)"
else
  systemctl restart nginx
  log "    nginx restarted (was inactive — likely failed state from a prior broken config)"
fi

log "Deploy complete — $lua_count Lua module(s) + 1 site config installed"
