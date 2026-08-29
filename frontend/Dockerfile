# Self-hosted / staging Angular image.
# Vercel production is unchanged (vercel.json). This file is only used by docker compose.

# Stage 1: Build Angular (Node 22)
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Written to frontend/.env, then generate-env.mjs bakes it into env.generated.ts
ARG NG_APP_API_BASE_URL=https://api-demo-hvac.pcmazing.com
ENV NG_APP_API_BASE_URL=$NG_APP_API_BASE_URL \
    NG_BUILD_MAX_WORKERS=1 \
    UV_THREADPOOL_SIZE=1 \
    NODE_OPTIONS=--max-old-space-size=4096

RUN printf 'NG_APP_API_BASE_URL=%s\n' "$NG_APP_API_BASE_URL" > .env \
  && npm run build -- --configuration=production

# Stage 2: Nginx on port 80 (Cloudflare tunnel → hvac-frontend:80)
FROM nginx:alpine

COPY --from=builder /app/dist/ng-tailadmin/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
