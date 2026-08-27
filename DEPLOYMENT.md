# Deployment Guide

## Target Setup
- **Self-hosted Docker** (Cloudflare tunnel): frontend + backend containers on `app-tier`
- Frontend (current production): Vercel
- Backend (current production): DigitalOcean App Platform using `backend/Dockerfile`

DigitalOcean and Vercel stay as they are. The compose stack is the same layout as STS Car Expert / WebKodex POS.

---

## 1. Self-hosted Docker (Cloudflare tunnel)

This compose file uses:

- `backend/Dockerfile.server`
- `frontend/Dockerfile`

Tunnel routes:

- app / www → `http://hvac-frontend:80`
- api → `http://hvac-backend:3000`

### 1.1 Prepare env on the server

```bash
cd ~/apps/hvac-warehouse-and-sales
cp .env.docker.example .env.docker
nano .env.docker
```

Set real values for:

- `PUBLIC_SITE_URL` (frontend hostname users open, e.g. `https://demo-hvac.pcmazing.com`)
- `NG_APP_API_BASE_URL` / `API_PUBLIC_URL` (API hostname, e.g. `https://api-demo-hvac.pcmazing.com`)
- `CORS_ORIGINS` (must include the frontend origin, not the API origin)
- `DATABASE_URL` (or `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`)
- `JWT_SECRET`
- `DOCKER_NETWORK` (this server uses `app-tier`)

Confirm the tunnel/Postgres network:

```bash
docker inspect postgres-stack-webkodex-tunnel-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Never commit `.env.docker`.

### 1.2 Deploy

```bash
docker compose --env-file .env.docker up -d --build
```

Login in the browser stays on the frontend (`https://demo-hvac.pcmazing.com`). The login **request** must go to `https://api-demo-hvac.pcmazing.com/login`. If DevTools shows `https://demo-hvac.pcmazing.com/login`, `NG_APP_API_BASE_URL` is wrong (empty or set to the frontend URL).

After changing `NG_APP_API_BASE_URL`, rebuild the frontend image (`dotenv` bakes the URL at build time):

```bash
docker compose --env-file .env.docker build --no-cache hvac-frontend
docker compose --env-file .env.docker up -d
```

### 1.3 Local debug ports

In `docker-compose.yml`, uncomment:

- frontend: `8080:80`
- backend: `3000:3000`

---

## 2. Backend Deployment (DigitalOcean / Render)

### 2.1 Prepare backend env
For local development, keep using `backend/.env`.

For production, use values from `backend/.env.production` (or `.env.production.example`) and set real secrets:

- `DATABASE_URL` (or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD)
- `DB_SSL=true`
- `DB_SSL_REJECT_UNAUTHORIZED=false` (for Supabase pooler setups)
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `CORS_ORIGINS` (include your Vercel domain)

Production example:

```env
DATABASE_URL=postgresql://postgres.badhwkvofjzyoeuhpkhp:<YOUR-PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
JWT_SECRET=use-a-strong-secret
JWT_EXPIRES_IN=1h
CORS_ORIGINS=https://your-frontend.vercel.app
```

### 2.2 DigitalOcean App Platform
DigitalOcean builds `backend/Dockerfile` (Node 22 + PostgreSQL 17 client), same pattern as webkodex-carrepair.

- Root directory: `backend`
- Dockerfile path: `Dockerfile`
- HTTP port: `3000`
- Add all production env vars from step 2.1.

### 2.3 Render (optional)
In Render dashboard:

1. Create `New +` -> `Web Service`.
2. Connect your repository.
3. Configure:
   - Root Directory: `backend`
   - Runtime: `Node`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start:prod`
4. Add all production env vars from step 2.1.
5. Deploy.

Backend will be available at your public URL, for example `https://air-summit-backend-ewbho.ondigitalocean.app`.

## 3. Frontend Deployment (Vercel)

### 3.1 Vercel project settings
- Root directory: `frontend`
- `frontend/vercel.json` is already configured.

### 3.2 Set environment variable in Vercel
In Vercel Project Settings -> Environment Variables:

- `NG_APP_API_BASE_URL` = your backend public URL
  - Example: `https://air-summit-backend-ewbho.ondigitalocean.app`

Redeploy after setting env vars. `npm run build` bakes this value into `env.generated.ts`.

### 3.3 SPA routing
`frontend/vercel.json` includes rewrite to `index.html`, so Angular routes work.

## 4. Post-deploy checklist
- Frontend loads successfully from the public URL (Vercel or tunnel).
- Login works (validates API base URL + CORS).
- Dashboard data loads from `/dashboard/overview`.
- API endpoints respond from browser without CORS errors.
- Inventory reports (including Land Costing exports) still work.
- Backend health check responds at `/health`.
