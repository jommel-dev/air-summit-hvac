# Deployment Guide

## Target Setup
- Frontend: Vercel
- Backend: Render (Web Service)

## 1. Backend Deployment (Render)

### 1.1 Prepare backend env
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

### 1.2 Create Render service
In Render dashboard:

1. Create `New +` -> `Web Service`.
2. Connect your repository.
3. Configure:
   - Root Directory: `backend`
   - Runtime: `Node`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start:prod`
4. Add all production env vars from step 1.1.
5. Deploy.

Backend will be available at your Render URL, for example `https://hvac-backend.onrender.com`.

## 2. Frontend Deployment (Vercel)

### 2.1 Vercel project settings
- Root directory: `frontend`
- `frontend/vercel.json` is already configured.

### 2.2 Set environment variable in Vercel
In Vercel Project Settings -> Environment Variables:

- `NG_APP_API_BASE_URL` = your backend public URL
  - Example: `https://hvac-backend.onrender.com`

Redeploy after setting env vars.

### 2.3 SPA routing
`frontend/vercel.json` includes rewrite to `index.html`, so Angular routes work.

## 3. Post-deploy checklist
- Frontend loads successfully from Vercel URL.
- Login works (validates API base URL + CORS).
- Dashboard data loads from `/dashboard/overview`.
- API endpoints respond from browser without CORS errors.
- Inventory reports (including Land Costing exports) still work.
