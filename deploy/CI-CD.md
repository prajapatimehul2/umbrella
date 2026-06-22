# CI/CD with GitHub Actions

The pipeline lives in [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml).

| Stage | When | What it does |
| ----- | ---- | ------------ |
| **CI — Build & typecheck** | Every push (any branch) and every PR to `main` | `npm ci` → `npx tsc --noEmit` → `npm run build` |
| **CD — Deploy to EC2** | After a green build on `main`, plus manual `workflow_dispatch` | SSHes to the EC2 box and runs `deploy/redeploy.sh` |

PRs and feature branches run CI only. Deploys never run for pull requests, and
two production deploys can't overlap (a `deploy-production` concurrency group
serializes them).

## One-time setup

### 1. The server must already be running

Do the first deploy by hand with [`setup.sh`](setup.sh) (see
[DEPLOY-EC2.md](DEPLOY-EC2.md)). CD only *redeploys* an existing box — it expects
a git checkout at `/opt/umbrella-app` and the `umbrella` systemd service installed.

The deploy user (e.g. `ubuntu`) needs **passwordless sudo** for the redeploy
script. On the instance:
```bash
echo 'ubuntu ALL=(ALL) NOPASSWD: /usr/bin/bash /opt/umbrella-app/deploy/redeploy.sh' \
  | sudo tee /etc/sudoers.d/umbrella-deploy
sudo chmod 440 /etc/sudoers.d/umbrella-deploy
```

### 2. Create a deploy SSH key

Generate a dedicated key pair (don't reuse your personal key):
```bash
ssh-keygen -t ed25519 -f umbrella_deploy -N "" -C "github-actions-deploy"
# Authorize the PUBLIC key on the instance:
ssh-copy-id -i umbrella_deploy.pub ubuntu@EC2_PUBLIC_IP
# ...or append umbrella_deploy.pub to ~/.ssh/authorized_keys on the box.
```

### 3. Add GitHub repo secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value | Required |
| ------ | ----- | -------- |
| `EC2_HOST` | Public IP or DNS of the instance | yes |
| `EC2_USER` | SSH login user, e.g. `ubuntu` | yes |
| `EC2_SSH_KEY` | Full contents of the **private** key (`umbrella_deploy`) | yes |
| `EC2_PORT` | SSH port if not `22` | optional |

That's it. Push to `main` → CI builds → on success it deploys.

## Triggering a deploy manually

Actions tab → **CI/CD** workflow → **Run workflow** (uses `workflow_dispatch`).
Or just run the script on the box: `sudo bash /opt/umbrella-app/deploy/redeploy.sh`.

## Troubleshooting

- **Permission denied (publickey)** — the private key in `EC2_SSH_KEY` doesn't
  match an `authorized_keys` entry, or `EC2_USER`/`EC2_HOST` is wrong.
- **`sudo: a password is required`** — the sudoers rule in step 1 is missing.
- **`/opt/umbrella-app is not a git checkout`** — the box was set up via rsync,
  not git clone. Re-clone it: `sudo git clone <repo> /opt/umbrella-app` (then
  re-run `setup.sh`), so CD can `git pull`.
- **Build passes in CI but the service won't start** — check the app's `.env` on
  the server (`DATABASE_URL`, `JWT_SECRET`) and `journalctl -u umbrella -n 50`.
