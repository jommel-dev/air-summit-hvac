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

# Written to frontend/.env and process.env, then generate-env.mjs bakes it into env.generated.ts
ARG NG_APP_API_BASE_URL=https://api.example.com
ARG PUBLIC_SITE_URL=
ARG BUILD_ID=

ENV NG_APP_API_BASE_URL=$NG_APP_API_BASE_URL \
    NG_BUILD_MAX_WORKERS=1 \
    UV_THREADPOOL_SIZE=1 \
    NODE_OPTIONS=--max-old-space-size=4096

RUN set -eux; \
  API_URL="${NG_APP_API_BASE_URL:-}"; \
  SITE_URL="${PUBLIC_SITE_URL:-}"; \
  echo "build-arg NG_APP_API_BASE_URL=${API_URL}"; \
  echo "build-arg PUBLIC_SITE_URL=${SITE_URL}"; \
  if [ -z "$API_URL" ] || printf '%s' "$API_URL" | grep -qiE 'localhost|127\.0\.0\.1|api\.example\.com'; then \
    echo "ERROR: NG_APP_API_BASE_URL must be the public API URL (e.g. https://api-demo-hvac.pcmazing.com)"; \
    exit 1; \
  fi; \
  if [ -n "$SITE_URL" ] && [ "$API_URL" = "$SITE_URL" ]; then \
    echo "ERROR: NG_APP_API_BASE_URL cannot be the frontend URL. Use the API host."; \
    exit 1; \
  fi; \
  printf 'NG_APP_API_BASE_URL=%s\n' "$API_URL" > .env; \
  export NG_APP_API_BASE_URL="$API_URL"; \
  echo "env bake → NG_APP_API_BASE_URL=${API_URL}"; \
  npm run build -- --configuration=production; \
  if ! grep -R -F -q "$API_URL" dist/ng-tailadmin/browser/; then \
    echo "ERROR: ${API_URL} was not found in the built JS — generate-env did not inject NG_APP_API_BASE_URL"; \
    exit 1; \
  fi

# Stage 2: Nginx on port 80 (Cloudflare tunnel → hvac-frontend:80)
FROM nginx:alpine

COPY --from=builder /app/dist/ng-tailadmin/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
