#!/usr/bin/env bash
#
# Idempotent redeploy for the Umbrella App. Pulls the latest code, rebuilds,
# and restarts the systemd service. Safe to run by hand or from CI (CD).
#
# Run ON the EC2 instance, with sudo (needs to chown the app dir and restart
# the service):
#   sudo bash /opt/umbrella-app/deploy/redeploy.sh
#
# Env vars:
#   APP_DIR    (optional) Install dir.   Default: /opt/umbrella-app
#   APP_USER   (optional) Service user.  Default: umbrella
#   BRANCH     (optional) Branch to deploy. Default: main
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/umbrella-app}"
APP_USER="${APP_USER:-umbrella}"
BRANCH="${BRANCH:-main}"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo (needed to chown the app dir and restart the service)."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout. Do the first deploy with deploy/setup.sh."

cd "$APP_DIR"

# Root operating on a dir owned by the service user trips git's ownership guard.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

log "Fetching $BRANCH"
git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

log "Installing dependencies"
npm ci

log "Building"
npm run build

log "Restoring ownership to $APP_USER"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

log "Restarting service"
systemctl restart umbrella
sleep 2
systemctl is-active --quiet umbrella || { journalctl -u umbrella --no-pager -n 30; die "Service failed to start."; }

log "Verifying"
curl -fsS -o /dev/null -w "  app on :3000 -> HTTP %{http_code}\n" http://127.0.0.1:3000 \
  || die "App not responding on :3000"

log "Redeploy complete."
