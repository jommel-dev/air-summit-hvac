FROM node:22-slim
WORKDIR /app

# Install PostgreSQL 17 client (pg_dump) to match production server version
RUN apt-get update && \
    apt-get install -y --no-install-recommends gnupg curl ca-certificates && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-17 && \
    apt-get purge -y gnupg curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Install all dependencies (including dev for build)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy app source
COPY . .

# Build
RUN npm run build

# Remove dev dependencies to slim image
RUN npm prune --production

EXPOSE 3000
CMD ["node", "dist/main"]
