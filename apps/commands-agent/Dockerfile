# IntexuraOS Commands Agent Dockerfile
# Multi-stage build with esbuild bundling.

# Stage 1: Build
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config, lockfile, and ALL package.json files first
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package*.json ./
COPY apps/commands-agent/package*.json ./apps/commands-agent/
COPY packages/ ./packages/

# Install dependencies (workspace symlinks now point to copied source)
RUN pnpm install --frozen-lockfile

# Copy remaining source files (tsconfig, scripts, app source)
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY apps/commands-agent/ ./apps/commands-agent/

# Build service (esbuild bundles everything into one file)
RUN pnpm run --filter @intexuraos/commands-agent build

# Stage 2: Production
FROM node:22-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/commands-agent/dist/package.json ./
RUN CI=true pnpm install --prod --no-frozen-lockfile

# Copy built file
COPY --from=builder /app/apps/commands-agent/dist/index.js ./dist/
COPY --from=builder /app/apps/commands-agent/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
