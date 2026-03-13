FROM node:22-slim
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy app source
COPY . .

# Build
RUN npm run build

EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/main"]
