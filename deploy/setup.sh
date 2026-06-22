#!/usr/bin/env bash
#
# One-shot EC2 bootstrap for the Umbrella App.
# Run this ON the EC2 instance (Ubuntu 24.04 / Debian), from the repo root,
# AFTER the code is present at the target directory.
#
# Usage:
#   # copy the code up first, e.g.:
#   #   rsync -av --exclude node_modules --exclude .next --exclude .env ./ ubuntu@HOST:/opt/umbrella-app/
#   cd /opt/umbrella-app
#   sudo DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/umbrella" bash deploy/setup.sh
#
# Env vars:
#   DATABASE_URL   (required) Postgres connection string for the prod DB (e.g. RDS).
#   JWT_SECRET     (optional) Cookie-signing secret; a fresh one is generated if unset.
#   APP_DIR        (optional) Install dir. Default: /opt/umbrella-app
#   APP_USER       (optional) Service user. Default: umbrella
#   SERVER_NAME    (optional) Nginx server_name (your domain). Default: _
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/umbrella-app}"
APP_USER="${APP_USER:-umbrella}"
SERVER_NAME="${SERVER_NAME:-_}"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo/root (needed for apt, systemd, nginx)."
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is required. Re-run: sudo DATABASE_URL=... bash deploy/setup.sh"

# Resolve the directory this script lives in, so we can find deploy/ files
# regardless of where it's invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
log "Installing Node.js 20, Nginx, git"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx git
node -v

# ---------------------------------------------------------------------------
log "Staging code into $APP_DIR"
mkdir -p "$APP_DIR"
# If we're already running from the target dir, skip the copy.
if [ "$REPO_DIR" != "$APP_DIR" ]; then
  # Copy repo (minus artifacts/secrets) into APP_DIR.
  rsync -a --exclude node_modules --exclude .next --exclude '.env' "$REPO_DIR"/ "$APP_DIR"/
fi
cd "$APP_DIR"

# ---------------------------------------------------------------------------
log "Writing $APP_DIR/.env"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
umask 077
cat > "$APP_DIR/.env" <<EOF
DATABASE_URL="${DATABASE_URL}"
JWT_SECRET="${JWT_SECRET}"
EOF
umask 022

# ---------------------------------------------------------------------------
log "Installing dependencies and building"
npm ci
npm run build

# ---------------------------------------------------------------------------
log "Creating service user '$APP_USER' and setting ownership"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home "$APP_USER"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# ---------------------------------------------------------------------------
log "Installing systemd service"
# Render the unit with the resolved APP_DIR / APP_USER (the committed unit uses
# the defaults; sed keeps it correct if you overrode them).
sed -e "s#/opt/umbrella-app#${APP_DIR}#g" \
    -e "s#^User=.*#User=${APP_USER}#" \
    "$SCRIPT_DIR/umbrella.service" > /etc/systemd/system/umbrella.service
systemctl daemon-reload
systemctl enable --now umbrella
sleep 2
systemctl is-active --quiet umbrella || { journalctl -u umbrella --no-pager -n 30; die "Service failed to start."; }

# ---------------------------------------------------------------------------
log "Configuring Nginx reverse proxy"
sed "s/server_name _;/server_name ${SERVER_NAME};/" \
    "$SCRIPT_DIR/nginx.conf" > /etc/nginx/sites-available/umbrella
ln -sf /etc/nginx/sites-available/umbrella /etc/nginx/sites-enabled/umbrella
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
log "Verifying"
curl -fsS -o /dev/null -w "  app on :3000 -> HTTP %{http_code}\n" http://127.0.0.1:3000 || die "App not responding on :3000"

cat <<DONE

Deploy complete.
  - App service:  systemctl status umbrella   (logs: journalctl -u umbrella -f)
  - Reachable at: http://<EC2_PUBLIC_IP>/
  - Next steps:   point DNS at this box, set SERVER_NAME, then:
                  sudo certbot --nginx -d your-domain.com   (for HTTPS)
DONE
