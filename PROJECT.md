# ☂️ Umbrella Alert — Project Documentation

> **"Do I need an umbrella today?"** — a minimal web app that tells you, per saved city,
> whether to take an umbrella, based on the hourly rain forecast.

This document is the single source of truth for the project: what it does, how it's
built, how it looks, how authentication works, and how it ships to **AWS EC2** through a
**CI/CD pipeline**.

---

## 1. Overview

| | |
|---|---|
| **Problem** | People get caught in the rain because checking a full weather app is friction. |
| **Solution** | One screen, one clear verdict per city: ☂️ *Bring an umbrella* or ☀️ *You're fine*. |
| **Scope** | Intentionally minimal — accounts, saved cities, a verdict, and a daily-relevant forecast. |
| **Free API** | [Open-Meteo](https://open-meteo.com) — geocoding + forecast, **no API key required**. |

---

## 2. Features

- 🔐 **Sign up / Sign in** — email + password accounts; each user has their own saved cities.
- 🌍 **Add cities by name** — geocoded automatically (e.g. "Mumbai" → lat/lon).
- ☂️ **Clear daily verdict** — umbrella or not, with the peak rain chance for the rest of the day.
- 📊 **Hourly rain-chance bars** — a tiny sparkline of precipitation probability.
- 🎨 **Blue & white aesthetic** — clean, calm, weather-appropriate palette.
- 🌗 **Dark / light mode** — toggle persisted in `localStorage`, no flash on reload.
- 📱 **Responsive** — works on phone and desktop.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | One codebase for UI + API routes. |
| Database | **PostgreSQL** | Relational, free-tier friendly (Neon / RDS / self-hosted). |
| DB driver | **`pg`** (node-postgres) | Lightweight, no heavy ORM for a minimal app. |
| Auth | **Email + password**, hashed with **bcrypt**, **JWT** session cookie | Simple, dependency-light, stateless. |
| Weather | **Open-Meteo** | Free, key-less, generous limits. |
| Hosting | **AWS EC2** (Ubuntu) behind **Nginx**, run with **PM2** | Full control, cheap, classic Node deploy. |
| CI/CD | **GitHub Actions** → SSH deploy to EC2 | Push to `main` → auto build & restart. |

---

## 4. Architecture

```
                ┌────────────────────────────────────────────┐
   Browser ───▶ │  Nginx (:80/:443, TLS)                      │
                │        │ reverse proxy                       │
                │        ▼                                     │
                │  Next.js server (PM2, :3000)                │
                │   • Pages / UI (React)                       │
                │   • API routes  /api/auth/*  /api/locations │
                └───────┬───────────────────────┬─────────────┘
                        │                        │
                        ▼                        ▼
               PostgreSQL (RDS or         Open-Meteo API
               same EC2 instance)        (geocode + forecast)
```

**Request flow for the dashboard**
1. Browser loads the page → client calls `GET /api/locations`.
2. API verifies the JWT cookie → looks up the user's saved cities in Postgres.
3. For each city, the server calls Open-Meteo (cached ~10 min) and computes the verdict.
4. JSON returns to the client, which renders the cards.

---

## 5. UI / UX Design

### 5.1 Theme — Blue & White

The palette is driven by **CSS custom properties** in `src/app/globals.css`, so light/dark
is a single `data-theme` attribute switch on `<html>`.

**Light mode (default)**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f5f8ff` | App background (soft blue-white) |
| `--surface` | `#ffffff` | Cards, inputs |
| `--text` | `#0f1c33` | Primary text |
| `--muted` | `#5a6b86` | Secondary text |
| `--primary` | `#2563eb` | Buttons, accents (brand blue) |
| `--border` | `#dbe6fb` | Hairlines |

**Dark mode**

| Token | Value |
|---|---|
| `--bg` | `#0a1224` |
| `--surface` | `#121d36` |
| `--text` | `#e8eefc` |
| `--primary` | `#3b82f6` |

### 5.2 Dark / Light toggle (no flash)

- The toggle button writes `light`/`dark` to `localStorage` and sets
  `document.documentElement.setAttribute("data-theme", …)`.
- A tiny inline script in `layout.tsx` applies the saved theme **before first paint**, so
  there is no white flash when loading in dark mode.

### 5.3 Screens

| Screen | Path | Contents |
|---|---|---|
| **Sign up** | `/signup` | Email, password, confirm → creates account, sets session. |
| **Sign in** | `/signin` | Email, password → sets session, redirects to dashboard. |
| **Dashboard** | `/` | Add-city bar, theme toggle, one card per saved city. |

### 5.4 Verdict card (dashboard)

```
┌──────────────────────────────────────────┐
│ London, United Kingdom                  × │
│ ☂️ Bring an umbrella                      │
│ Up to 70% chance of rain today.           │
│ ▁▂▅▇▆▃▂▁▁▂▃  (hourly rain-chance bars)     │
└──────────────────────────────────────────┘
```

---

## 6. Authentication

> ✅ **Status: implemented.** Sign-up/sign-in pages, `/api/auth/*` routes, the `users`
> table, and user-scoped locations are all wired up (see `src/lib/auth.ts`).

### 6.1 Approach

- **Email + password**, password hashed with **scrypt** via Node's built-in `crypto`
  (no native `bcrypt` dependency to compile — stored as `salt:hash`).
- On successful sign-in/sign-up, issue an **HMAC-SHA256-signed session token** (a compact,
  JWT-like `payload.signature`) signed with `JWT_SECRET`, stored in an **HttpOnly, Secure,
  SameSite=Lax** cookie (`session`). No client-readable token, no `jsonwebtoken` dependency.
- Protected API routes read the cookie, verify the signature + expiry, and scope all
  queries to `user_id`.

### 6.2 Flows

**Sign up**
```
POST /api/auth/signup   { email, password }
  → validate email + password strength
  → reject if email already exists
  → hash = bcrypt(password)
  → INSERT user → sign JWT → set `session` cookie → 201
```

**Sign in**
```
POST /api/auth/signin   { email, password }
  → look up user by email
  → bcrypt.compare(password, hash)
  → on match: sign JWT → set cookie → 200
  → on mismatch: 401 (generic "invalid credentials")
```

**Sign out**
```
POST /api/auth/signout  → clear `session` cookie → 200
```

### 6.3 Security checklist

- [x] Passwords never logged or returned in any response.
- [x] `JWT_SECRET` only in server env, never shipped to client.
- [x] Cookie flags: `HttpOnly`, `Secure` (prod), `SameSite=Lax`, 7-day `Max-Age`.
- [x] Parameterized SQL only (the pattern in `lib/db.ts`).
- [x] Generic auth errors (don't reveal whether email exists).
- [x] Timing-safe comparison for password hash and token signature.
- [ ] Rate-limit `/api/auth/*` (e.g. 5 attempts / 15 min / IP) — *future work*.

---

## 7. Database Schema

```sql
-- Users
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved cities (scoped to a user once auth lands)
CREATE TABLE IF NOT EXISTS locations (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> The current `locations` table is created lazily on first DB access (see `src/lib/db.ts`).
> Adding `users` + the `user_id` foreign key is the first migration when wiring auth.

---

## 8. API Reference

| Method | Route | Auth | Body / Query | Returns |
|---|---|---|---|---|
| `POST` | `/api/auth/signup` | – | `{ email, password }` | sets cookie, `201` |
| `POST` | `/api/auth/signin` | – | `{ email, password }` | sets cookie, `200` |
| `POST` | `/api/auth/signout` | ✓ | – | `200` |
| `GET` | `/api/locations` | ✓ | – | `{ locations: [...with verdict] }` |
| `POST` | `/api/locations` | ✓ | `{ name }` | `{ location }`, `201` |
| `DELETE` | `/api/locations?id=` | ✓ | `?id=123` | `{ ok: true }` |

---

## 9. Project Structure

```
umbrella-app/
├── PROJECT.md              ← this file
├── package.json
├── tsconfig.json
├── next.config.mjs
├── .env.example
├── src/
│   ├── components/
│   │   └── AuthForm.tsx    ← shared sign-in/sign-up form
│   ├── lib/
│   │   ├── db.ts           ← pg pool + lazy schema (users + locations)
│   │   ├── auth.ts         ← scrypt hashing + signed session cookie
│   │   └── weather.ts      ← Open-Meteo geocode + verdict
│   └── app/
│       ├── layout.tsx      ← theme bootstrap
│       ├── globals.css     ← blue/white + dark tokens
│       ├── page.tsx        ← dashboard (auth-guarded)
│       ├── signin/page.tsx
│       ├── signup/page.tsx
│       └── api/
│           ├── locations/route.ts
│           └── auth/
│               ├── signup/route.ts
│               ├── signin/route.ts
│               ├── signout/route.ts
│               └── me/route.ts
└── .github/workflows/deploy.yml  ← CI/CD (see §12)
```

---

## 10. Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure the database
cp .env.example .env
#    → paste a Postgres connection string into DATABASE_URL
#    Easiest free option: create a project at https://neon.tech

# 3. Run
npm run dev
#    → http://localhost:3000
```

The `locations` table is created automatically on first request — no manual migration.

---

## 11. Environment Variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ | `postgresql://u:p@host/db?sslmode=require` | Neon / RDS / local. |
| `JWT_SECRET` | ✓ (with auth) | `openssl rand -base64 32` | Signs session cookies. |
| `NODE_ENV` | auto | `production` | Set by hosting. |

Store these in EC2 via an `.env` file (not committed) or as GitHub Actions secrets injected
at deploy time.

---

## 12. AWS EC2 Deployment

### 12.1 Provision the instance

1. Launch an **EC2** instance — Ubuntu 22.04 LTS, `t3.micro` (free-tier eligible).
2. **Security group** inbound rules: `22` (SSH, your IP), `80` (HTTP), `443` (HTTPS).
3. Allocate an **Elastic IP** and associate it (stable address for DNS).

### 12.2 One-time server setup

```bash
ssh ubuntu@<EC2_PUBLIC_IP>

# Node + PM2 + Nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2

# App directory
sudo mkdir -p /var/www/umbrella-app && sudo chown -R ubuntu:ubuntu /var/www/umbrella-app
```

### 12.3 Nginx reverse proxy

`/etc/nginx/sites-available/umbrella`:

```nginx
server {
    listen 80;
    server_name your-domain.com;   # or the Elastic IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/umbrella /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# Optional TLS:
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 12.4 Database options

- **Quick:** managed Postgres (Neon / Supabase / **AWS RDS**) — set `DATABASE_URL`.
- **Self-hosted:** install Postgres on the same EC2 box (`sudo apt-get install postgresql`).
  Cheapest, but you own backups.

### 12.5 Run with PM2

```bash
cd /var/www/umbrella-app
npm ci && npm run build
pm2 start "npm run start" --name umbrella
pm2 save && pm2 startup     # restart on reboot
```

---

## 13. CI/CD Pipeline (GitHub Actions)

**Trigger:** push to `main` → run checks → build → SSH into EC2 → pull, build, restart.

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to EC2

on:
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm run build        # fail the pipeline if the build breaks

  deploy:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /var/www/umbrella-app
            git pull origin main
            npm ci
            npm run build
            pm2 restart umbrella
```

**Required GitHub repo secrets**

| Secret | Value |
|---|---|
| `EC2_HOST` | EC2 public IP / domain |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Private key matching the instance's key pair |

**Pipeline stages**
1. **CI** — checkout → install → lint → `next build` (blocks bad builds).
2. **Deploy** — SSH to EC2 → `git pull` → `npm ci` → `npm run build` → `pm2 restart`.

> First time: clone the repo into `/var/www/umbrella-app` and create the `.env` on the
> server. Subsequent pushes deploy automatically.

---

## 14. Roadmap

- [x] Dashboard, saved cities, Open-Meteo verdict, blue/white theme, dark/light toggle.
- [x] Sign-up / sign-in pages + `/api/auth/*` (§6).
- [x] Scope `locations` to `user_id`.
- [ ] Rate-limit auth routes.
- [ ] Daily push / email "umbrella?" reminder.
- [ ] Per-user rain-chance threshold setting.
- [ ] Tests (Vitest) + preview deploys per PR.

---

*Built with Next.js · PostgreSQL · Open-Meteo · deployed on AWS EC2 via GitHub Actions.*
