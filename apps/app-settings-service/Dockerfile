# IntexuraOS App Settings Service Dockerfile
# Multi-stage build with esbuild bundling.

# Stage 1: Build
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package*.json ./
COPY apps/app-settings-service/package*.json ./apps/app-settings-service/

COPY packages/ ./packages/
# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/app-settings-service/ ./apps/app-settings-service/

# Build service (esbuild bundles everything into one file)
RUN pnpm run --filter @intexuraos/app-settings-service build

# Stage 2: Production
FROM node:22-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/app-settings-service/dist/package.json ./
RUN CI=true pnpm install --prod --no-frozen-lockfile

# Copy built file
COPY --from=builder /app/apps/app-settings-service/dist/index.js ./dist/
COPY --from=builder /app/apps/app-settings-service/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]

