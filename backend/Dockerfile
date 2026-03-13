FROM node:22-slim
WORKDIR /app

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
ENV PORT=3000
CMD ["node", "dist/main"]
