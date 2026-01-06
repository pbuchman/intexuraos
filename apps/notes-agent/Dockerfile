# IntexuraOS Notes Service Dockerfile
# Multi-stage build with esbuild bundling.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy all package.json files
COPY package*.json ./
COPY apps/notes-agent/package*.json ./apps/notes-agent/
COPY packages/*/package*.json ./packages/

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/notes-agent/ ./apps/notes-agent/

# Build service (esbuild bundles everything into one file)
RUN npm run build -w @intexuraos/notes-agent

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/notes-agent/dist/package.json ./
RUN npm install --omit=dev

# Copy built file
COPY --from=builder /app/apps/notes-agent/dist/index.js ./dist/
COPY --from=builder /app/apps/notes-agent/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
