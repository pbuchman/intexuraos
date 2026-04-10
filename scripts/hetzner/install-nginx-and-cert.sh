#!/usr/bin/env bash
#
# One-time Phase 6 bootstrap for the Hetzner prod VM (INT-750).
#
# Runs as ROOT. Must be invoked via Hetzner Cloud Console VNC because
# Phase 3 hardened sshd to block root SSH and deploy's current sudoers
# only allows nginx reload. This script is the ONE root-privileged
# operation we need for the rest of the migration — it:
#
#   1. Extracts INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN from
#      /home/deploy/.env.prod (which load-secrets.sh populated in
#      Phase 4) and writes /etc/letsencrypt/cloudflare.ini.
#   2. Runs certbot certonly with DNS-01 via Cloudflare to get a real
#      Let's Encrypt cert for intexuraos.cloud. Needs an email address
#      passed as the first arg (Let's Encrypt registration).
#   3. Installs the renewal hook that reloads nginx on cert rotation.
#   4. Copies scripts/hetzner/nginx/intexuraos.conf → sites-available
#      and symlinks it into sites-enabled. Removes the default site.
#   5. Runs `nginx -t` and `systemctl reload nginx` to activate.
#   6. Writes /etc/sudoers.d/deploy-hetzner-scripts allowing the deploy
#      user to sudo-run any script under /opt/intexuraos/scripts/hetzner/
#      as root. This closes the chicken-and-egg for Phases 7-9: future
#      root operations can go through scripts committed to the repo,
#      invoked by deploy via passwordless sudo.
#
# SECURITY TRADE-OFF (documented): the deploy user owns /opt/intexuraos
# (git clone was as deploy), so deploy can technically modify scripts
# in /opt/intexuraos/scripts/hetzner/ before sudo-running them. That
# is a privilege escalation path. For a solo-operator production VM
# where the only actor is the git workflow, this is equivalent in
# blast radius to "deploy has passwordless sudo ALL" — but scoped to
# a specific directory so accidental sudo is contained. Tighten
# post-migration by copying scripts to /usr/local/sbin under root
# ownership if deploy-user compromise becomes a concern.
#
# Usage (as root, in Hetzner Cloud Console VNC):
#   cd /opt/intexuraos
#   bash scripts/hetzner/install-nginx-and-cert.sh <your-email@example.com>

set -euo pipefail
IFS=$'\n\t'

readonly DOMAIN="intexuraos.cloud"
readonly ENV_FILE="/home/deploy/.env.prod"
readonly NGINX_SRC="/opt/intexuraos/scripts/hetzner/nginx/intexuraos.conf"
readonly NGINX_DST="/etc/nginx/sites-available/intexuraos.conf"
readonly NGINX_LINK="/etc/nginx/sites-enabled/intexuraos.conf"
readonly CF_CREDS="/etc/letsencrypt/cloudflare.ini"
readonly SUDOERS_FILE="/etc/sudoers.d/deploy-hetzner-scripts"

log() { printf '=== %s ===\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  fail "must run as root (got uid $EUID)"
fi

if [[ $# -lt 1 ]]; then
  fail "usage: $0 <email-for-letsencrypt-registration>"
fi
readonly EMAIL="$1"

# ---- 1. Extract Cloudflare DNS API token from .env.prod ------------------
log "[1/6] Reading INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN from $ENV_FILE"
[[ -r "$ENV_FILE" ]] || fail "$ENV_FILE not readable"

# Source the env file to load every INTEXURAOS_* var into this shell.
# /home/deploy/.env.prod is bash-compatible (single-quoted values).
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN:?not set after sourcing $ENV_FILE}"

# ---- 2. Write Cloudflare credentials file for certbot --------------------
log "[2/6] Writing $CF_CREDS"
install -d -m 755 /etc/letsencrypt
umask 077
cat > "$CF_CREDS" <<CFCREDS
# Managed by install-nginx-and-cert.sh (INT-750)
dns_cloudflare_api_token = $INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN
CFCREDS
chmod 600 "$CF_CREDS"
umask 022

# ---- 3. Obtain the certificate via DNS-01 --------------------------------
log "[3/6] Requesting Let's Encrypt cert for $DOMAIN (DNS-01 via Cloudflare)"
if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  log "    cert already exists at /etc/letsencrypt/live/$DOMAIN — skipping certbot"
else
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$CF_CREDS" \
    --dns-cloudflare-propagation-seconds 30 \
    -d "$DOMAIN" \
    --agree-tos \
    --email "$EMAIL" \
    --non-interactive
fi

# Renewal hook: reload nginx when cert rotates
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh <<'HOOK'
#!/usr/bin/env bash
systemctl reload nginx
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh

# ---- 4. Install nginx config ---------------------------------------------
log "[4/6] Installing nginx config to $NGINX_DST"
[[ -r "$NGINX_SRC" ]] || fail "$NGINX_SRC not found — git pull in /opt/intexuraos?"

install -m 644 -o root -g root "$NGINX_SRC" "$NGINX_DST"

# Symlink into sites-enabled; remove Ubuntu default
ln -sf "$NGINX_DST" "$NGINX_LINK"
rm -f /etc/nginx/sites-enabled/default

# Create the web app static root (populated in Phase 9)
install -d -o deploy -g deploy -m 755 /var/www/intexuraos/web/dist

# ---- 5. Validate and reload nginx ----------------------------------------
log "[5/6] Validating nginx config and reloading"
nginx -t || fail "nginx -t failed — check $NGINX_DST"
systemctl reload nginx

# ---- 6. Extend deploy sudoers for future Hetzner scripts -----------------
log "[6/6] Writing $SUDOERS_FILE to unlock Phases 7-9 from deploy"
# We want deploy to be able to run any script under
# /opt/intexuraos/scripts/hetzner/ as root without further VNC sessions.
# The path must be absolute in sudoers. Use `/bin/bash <path>` rather
# than just <path> so sudoers can match the invocation pattern cleanly.
cat > "$SUDOERS_FILE" <<'SUDOERS'
# INT-750 Phase 6 — allow deploy user to sudo-run Hetzner migration
# scripts as root. Scripts must live under /opt/intexuraos/scripts/hetzner/
# and are committed to the repo (auditable via PR history).
deploy ALL=(root) NOPASSWD: /bin/bash /opt/intexuraos/scripts/hetzner/*.sh
SUDOERS
chmod 440 "$SUDOERS_FILE"
visudo -c -f "$SUDOERS_FILE" || fail "sudoers syntax check failed for $SUDOERS_FILE"

log "Phase 6 bootstrap complete"
printf '\n'
printf 'Verification:\n'
# shellcheck disable=SC2016  # intentional literal — we want the user to see the unexpanded command
printf '  curl --resolve %s:443:$(hostname -I | awk "{print \\$1}") https://%s/healthz\n' "$DOMAIN" "$DOMAIN"
printf '\n'
printf 'From now on deploy can run Hetzner scripts as root via:\n'
printf '  sudo bash /opt/intexuraos/scripts/hetzner/<name>.sh\n'
printf 'No more Hetzner VNC sessions needed for Phases 7-9.\n'
