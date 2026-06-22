# Deploying Umbrella App to AWS EC2

A full-stack Next.js app (server-side API routes + Postgres). This guide runs it
on a single EC2 instance behind Nginx, with the database on **Amazon RDS**
(recommended) or on the same instance.

The app needs two env vars: `DATABASE_URL` and `JWT_SECRET`. The DB schema
auto-creates on first request (see `src/lib/db.ts`), so there is no migration step.

---

## 1. Provision the database (RDS — recommended)

1. RDS → Create database → **PostgreSQL** → Free tier (db.t3.micro is fine to start).
2. Set a master username/password and an initial DB name (e.g. `umbrella`).
3. **Network:** put it in the **same VPC** as the EC2 instance. Do **not** make it
   publicly accessible.
4. Security group: allow inbound **5432** only from the **EC2 instance's security
   group** (not `0.0.0.0/0`).
5. Connection string:
   `postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/umbrella`
   RDS uses SSL; `src/lib/db.ts` already enables SSL for non-localhost hosts, so no
   code change is needed.

> Cheaper/simpler alternative: install Postgres on the EC2 box itself and use
> `postgresql://USER:PASS@localhost:5432/umbrella`. See the appendix.

---

## 2. Launch the EC2 instance

1. EC2 → Launch instance → **Ubuntu 24.04 LTS** (or Amazon Linux 2023), t3.small.
2. Create/choose a key pair so you can SSH in.
3. Security group inbound rules:
   - **22** (SSH) from *your IP only*
   - **80** (HTTP) from anywhere
   - **443** (HTTPS) from anywhere
4. Launch, then SSH in:
   ```bash
   ssh -i your-key.pem ubuntu@EC2_PUBLIC_IP
   ```

---

## 3. Install Node.js + Nginx on the instance

```bash
# Node 20 LTS (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
node -v   # expect v20.x
```

---

## 4. Get the code onto the instance

**Option A — git (set up the repo first; see step 6 below):**
```bash
sudo mkdir -p /opt/umbrella-app && sudo chown $USER /opt/umbrella-app
git clone YOUR_REPO_URL /opt/umbrella-app
```

**Option B — copy from your laptop (no git needed):**
```bash
# run on your laptop, excluding build artifacts and secrets
rsync -av --exclude node_modules --exclude .next --exclude .env \
  ./ ubuntu@EC2_PUBLIC_IP:/opt/umbrella-app/
```

---

## 5. Configure, build, and run

```bash
cd /opt/umbrella-app

# Create the production .env (NOT copied from your laptop — different DB + secret)
cat > .env <<'EOF'
DATABASE_URL="postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/umbrella"
JWT_SECRET="PASTE_A_NEW_SECRET_HERE"
EOF
chmod 600 .env
# Generate a fresh secret: openssl rand -base64 32

npm ci
npm run build

# Create a dedicated service user and hand it the directory
sudo useradd --system --no-create-home umbrella || true
sudo chown -R umbrella:umbrella /opt/umbrella-app

# Install the systemd service (file is in deploy/)
sudo cp deploy/umbrella.service /etc/systemd/system/umbrella.service
sudo systemctl daemon-reload
sudo systemctl enable --now umbrella
sudo systemctl status umbrella       # should be active (running)
curl -I http://127.0.0.1:3000        # should return HTTP 200
```

### Nginx reverse proxy
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/umbrella
sudo ln -sf /etc/nginx/sites-available/umbrella /etc/nginx/sites-enabled/umbrella
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
Visit `http://EC2_PUBLIC_IP` — the app should load.

### HTTPS (recommended, needs a domain)
Point a DNS A record at the instance, set `server_name` in the Nginx config to your
domain, then:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 6. (If using git) initialize and push the repo

This project isn't a git repo yet. From your laptop:
```bash
git init
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_REPO_URL   # GitHub/CodeCommit
git push -u origin main
```
`.env` is already in `.gitignore`, so secrets won't be committed.

---

## Redeploying after code changes
```bash
cd /opt/umbrella-app
git pull            # or rsync again
npm ci
npm run build
sudo systemctl restart umbrella
```

## Logs / troubleshooting
```bash
journalctl -u umbrella -f      # app logs
sudo tail -f /var/log/nginx/error.log
```
- 502 from Nginx → the app isn't running on :3000 (`systemctl status umbrella`).
- DB connection errors → check the RDS security group allows the EC2 SG on 5432.

---

## Appendix: Postgres on the same EC2 instance (instead of RDS)
```bash
sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE USER umbrella WITH PASSWORD 'a_strong_password';"
sudo -u postgres psql -c "CREATE DATABASE umbrella OWNER umbrella;"
# Then in .env:
# DATABASE_URL="postgresql://umbrella:a_strong_password@localhost:5432/umbrella"
```
Cheaper but you own backups/maintenance, and data lives on one box.
