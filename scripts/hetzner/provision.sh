#!/usr/bin/env bash
#
# IntexuraOS Hetzner VM provisioning script (INT-750).
#
# Turns a bare Ubuntu 24.04 VM into an IntexuraOS host:
#   - Node 22 (via fnm, symlinked into /usr/local/bin)
#   - pnpm 9, PM2 latest
#   - nginx with lua module, lua-resty-openidc
#   - certbot + cloudflare DNS plugin
#   - unprivileged `deploy` user with scoped nginx-reload sudoers
#   - hardened sshd (key-only, AllowUsers deploy, PermitRootLogin no)
#   - ufw + fail2ban
#
# Idempotent: safe to re-run on an already-provisioned VM.
#
# Run as root:
#   scp scripts/hetzner/provision.sh root@<ip>:/tmp/
#   ssh root@<ip> 'bash /tmp/provision.sh'
#
# CRITICAL: Step 8 hardens sshd to reject root logins. BEFORE running this
# script on a production VM, the operator MUST have a second terminal with
# `ssh -i <key> deploy@<ip>` already established OR have a rollback plan
# (Hetzner rescue mode). The script itself verifies the deploy user's
# authorized_keys BEFORE reloading sshd, and verifies the effective sshd
# config AFTER reload via `sshd -T`. If either check fails, the script
# exits non-zero and sshd is not reloaded.

set -euo pipefail
IFS=$'\n\t'

readonly NODE_VERSION="22"
readonly DEPLOY_USER="deploy"
readonly APP_DIR="/opt/intexuraos"
readonly ETC_DIR="/etc/intexuraos"
readonly WEB_DIR="/var/www/intexuraos/web/dist"

log() { printf '=== %s ===\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  fail "must run as root (got uid $EUID)"
fi

log "[1/10] System update"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

log "[2/10] Install base packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl ca-certificates git build-essential unzip \
  ufw fail2ban \
  nginx libnginx-mod-http-lua \
  lua5.1 luarocks \
  certbot python3-certbot-nginx python3-certbot-dns-cloudflare \
  jq

log "[3/10] Install Node ${NODE_VERSION} via fnm"
# FNM_DIR controls where fnm stores installed Node versions. Without this,
# fnm defaults to $HOME/.local/share/fnm = /root/.local/share/fnm when run
# as root, which is mode 700 and unreachable by the deploy user. Forcing
# /opt/fnm co-locates the fnm binary and its data under a world-readable
# path (chmod a+rX below makes traversal explicit).
export FNM_DIR="/opt/fnm"

if [[ ! -x /opt/fnm/fnm ]]; then
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /opt/fnm --skip-shell
fi
export PATH="/opt/fnm:$PATH"
/opt/fnm/fnm install "$NODE_VERSION"
/opt/fnm/fnm default "$NODE_VERSION"

# Resolve the absolute path to node's bin directory under fnm.
# `command -v node` run inside `fnm exec` is more portable than hardcoding
# fnm's internal directory layout.
NODE_BIN="$(/opt/fnm/fnm exec --using="$NODE_VERSION" -- bash -c 'command -v node')"
if [[ -z "${NODE_BIN:-}" || ! -x "$NODE_BIN" ]]; then
  fail "failed to resolve node binary path from fnm"
fi
NODE_DIR="$(dirname "$NODE_BIN")"
log "    node installed at $NODE_BIN"

# Sanity check: node path must live under /opt/fnm — if it landed anywhere
# under /root the deploy user cannot traverse to it. Fail loudly rather
# than create dangling symlinks.
case "$NODE_BIN" in
  /opt/fnm/*) ;;
  *) fail "node installed outside /opt/fnm ($NODE_BIN) — check FNM_DIR export above" ;;
esac

# Symlink node, npm, npx into /usr/local/bin for system-wide PATH
for binname in node npm npx; do
  ln -sf "$NODE_DIR/$binname" "/usr/local/bin/$binname"
done

log "[4/10] Install pnpm and PM2"
/usr/local/bin/npm install -g pnpm@9 pm2@latest

# pnpm + pm2 land in $NODE_DIR because that's where fnm's npm prefix points.
for binname in pnpm pm2; do
  if [[ -x "$NODE_DIR/$binname" ]]; then
    ln -sf "$NODE_DIR/$binname" "/usr/local/bin/$binname"
  else
    fail "$binname not found at $NODE_DIR/$binname after npm install -g"
  fi
done

# Make the entire fnm tree world-readable/traversable so deploy can exec
# node via the /usr/local/bin symlinks. /opt itself is already 755 on
# Ubuntu, but fnm's subdirs are created 755 by default for files and 700
# for some intermediate dirs — `a+rX` adds read to files and exec-if-dir
# without touching existing perms on regular files.
chmod -R a+rX /opt/fnm

log "[5/10] Install lua-resty-openidc (JWT verification)"
# lua-resty-openidc pulls in lua-resty-jwt, lua-resty-http, lua-resty-session,
# and lua-cjson as transitive deps.
luarocks install lua-resty-openidc

log "[6/10] Create deploy user and directories"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$APP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$WEB_DIR"
install -d -o root          -g "$DEPLOY_USER" -m 750 "$ETC_DIR"

# Scoped sudoers: deploy user can reload nginx but nothing else.
cat >/etc/sudoers.d/deploy-nginx <<SUDOERS
# Allow the deploy user to reload nginx only (INT-750)
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload, /usr/sbin/nginx -t, /bin/systemctl reload nginx
SUDOERS
chmod 440 /etc/sudoers.d/deploy-nginx
visudo -c -f /etc/sudoers.d/deploy-nginx >/dev/null || fail "sudoers syntax check failed"

log "[7/10] Seed deploy user SSH authorized_keys from root"
# Hetzner cloud-init writes the hcloud_ssh_key public key to
# /root/.ssh/authorized_keys on first boot. The hardened sshd config below
# (AllowUsers deploy) means this file MUST also exist under deploy's home,
# or every future SSH connection is refused.
#
# UNCONDITIONAL copy (idempotent via `install`): overwrites any stale file,
# sets ownership and mode atomically. This is the correctness fix for the
# lockout bug in the original plan, which used `[ ! -f ]` guard and would
# silently skip if a zero-byte placeholder existed.
if [[ ! -s /root/.ssh/authorized_keys ]]; then
  fail "/root/.ssh/authorized_keys is missing or empty — cannot seed deploy user"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "/home/$DEPLOY_USER/.ssh"
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 600 \
  /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"

log "[8/10] Configure ufw (defense in depth behind hcloud_firewall)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment 'SSH'
ufw allow 80/tcp  comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

log "[9/10] Setup PM2 startup for deploy user"
# Running pm2 startup as root with -u / --hp installs the systemd unit
# directly (no stdout-to-bash piping needed).
env PATH="/usr/local/bin:$PATH" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER"

log "[10/10] Harden sshd + pre-reload and post-reload assertions"
# NOTE: sshd hardening is intentionally the LAST step. Every earlier step
# needs full root over SSH; this step flips root login off. If it were run
# before ufw/pm2-startup, a failure partway through would leave the VM
# locked down with no way to finish provisioning short of a script re-run
# from the root session still in flight.

# --- PRE-RELOAD ASSERTION ---
# Refuse to reload sshd unless the deploy user's authorized_keys is usable.
# Running this BEFORE touching sshd means a failure leaves the current
# session (and future root logins) alive, so the operator can fix the
# cause and re-run.
DEPLOY_KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
log "    pre-reload assertion: $DEPLOY_KEYS"

[[ -f "$DEPLOY_KEYS" ]]                                   || fail "deploy keys file missing: $DEPLOY_KEYS"
[[ -s "$DEPLOY_KEYS" ]]                                   || fail "deploy keys file empty: $DEPLOY_KEYS"

# mode exactly 600 (sshd refuses world/group-readable key files)
DEPLOY_KEYS_MODE="$(stat -c '%a' "$DEPLOY_KEYS")"
[[ "$DEPLOY_KEYS_MODE" == "600" ]]                        || fail "deploy keys mode is $DEPLOY_KEYS_MODE, want 600"

# owner:group must be deploy:deploy
DEPLOY_KEYS_OWN="$(stat -c '%U:%G' "$DEPLOY_KEYS")"
[[ "$DEPLOY_KEYS_OWN" == "$DEPLOY_USER:$DEPLOY_USER" ]]   || fail "deploy keys owner is $DEPLOY_KEYS_OWN, want $DEPLOY_USER:$DEPLOY_USER"

# at least one ssh-ed25519 or ssh-rsa line (ecdsa-sha2-* also accepted)
grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9]+) ' "$DEPLOY_KEYS" \
  || fail "deploy keys file contains no recognised SSH public key line"

log "    pre-reload assertion passed"

# Write the drop-in hardening config. Quoted heredoc (<<'EOF') prevents
# shell interpolation of $ variables — sshd_config is literal.
cat >/etc/ssh/sshd_config.d/00-intexuraos-hardening.conf <<'SSHDCFG'
# IntexuraOS prod SSH hardening (INT-750)
#
# Security model: SSH port 22 is open to the world in the Hetzner cloud
# firewall, and this drop-in is what makes that safe. Brute-force attempts
# are pointless because:
#   - PasswordAuthentication no     (no passwords ever)
#   - PubkeyAuthentication yes      (only SSH keys)
#   - AllowUsers deploy             (no root, no bot accounts)
#   - AuthenticationMethods publickey (belt-and-braces)
#
# Drop-in files in /etc/ssh/sshd_config.d/ are read by the default
# Ubuntu 24.04 sshd_config via an `Include` directive and override the
# main file on any key=value directive. This survives `apt upgrade` of
# openssh-server because the package does not own the drop-in directory.
Port 22
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PubkeyAuthentication yes
AllowUsers deploy
AuthenticationMethods publickey
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
SSHDCFG
chmod 644 /etc/ssh/sshd_config.d/00-intexuraos-hardening.conf

# Syntax check the whole sshd config (main + all drop-ins).
# Fails fast on typos — the current session stays alive.
sshd -t || fail "sshd -t syntax check failed"

# Reload sshd. Ubuntu 24.04 uses `ssh.service` as the unit name; older
# distros use `sshd.service`. Try both. Established connections survive
# the reload; only new connections pick up the new policy.
if ! systemctl reload ssh 2>/dev/null; then
  systemctl reload sshd || fail "failed to reload sshd via either ssh.service or sshd.service"
fi

# --- POST-RELOAD VERIFICATION ---
# `sshd -T` prints the fully resolved effective config (re-parsed from
# files — not the running daemon's live state, but equivalent after a
# successful reload). This catches:
#   - typos that sshd -t accepted (e.g., `AllowUser deploy` singular)
#   - other drop-ins overriding ours (cloud-init 50-cloud-init.conf)
#   - precedence surprises from the main sshd_config
log "    post-reload assertion: verifying effective sshd config"

EFFECTIVE="$(sshd -T 2>/dev/null)"
if ! grep -qE '^permitrootlogin no$' <<<"$EFFECTIVE"; then
  fail "effective sshd config: permitrootlogin is NOT 'no' after reload"
fi
if ! grep -qE '^allowusers deploy( |$)' <<<"$EFFECTIVE"; then
  fail "effective sshd config: allowusers does NOT contain 'deploy' after reload"
fi
if ! grep -qE '^passwordauthentication no$' <<<"$EFFECTIVE"; then
  fail "effective sshd config: passwordauthentication is NOT 'no' after reload"
fi

log "    sshd is hardened and effective — root login is now blocked"

# Enable fail2ban (default jail includes sshd)
systemctl enable fail2ban
systemctl restart fail2ban

log "Provisioning complete"
printf '\n'
printf 'Next steps:\n'
printf '  1. Verify deploy user login:  ssh deploy@<ip> whoami\n'
printf '  2. Run load-secrets.sh (Phase 4)\n'
printf '  3. Deploy code (Phase 5)\n'
