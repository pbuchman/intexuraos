# IntexuraOS Research Agent Dockerfile
# Multi-stage build - esbuild bundles code, we only need runtime deps

# ==========================================
# Stage 1: Builder
# ==========================================
FROM node:22-alpine AS builder

# Enable pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# 1. CACHE LAYER: Copy ONLY config files first
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json ./

# 2. COPY MANIFESTS: Copy package.json files to resolve workspace
COPY apps/research-agent/package.json ./apps/research-agent/
COPY packages/ ./packages/

# 3. INSTALL DEPENDENCIES (Frozen lockfile)
RUN pnpm install --frozen-lockfile

# 4. BUILD SOURCE
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY apps/research-agent/ ./apps/research-agent/

# Build service (esbuild bundles everything into one file)
RUN pnpm run --filter @intexuraos/research-agent build

# 5. INSTALL PROD DEPS in dist folder
# Use the esbuild-generated package.json which has transitive dependencies
# Copy lockfile for resolution, install without workspace checks
WORKDIR /app/apps/research-agent/dist
COPY pnpm-lock.yaml ./
RUN CI=true pnpm install --prod --no-frozen-lockfile

# ==========================================
# Stage 2: Production
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy node_modules from dist
COPY --from=builder /app/apps/research-agent/dist/node_modules ./node_modules

# Copy the built artifact
COPY --from=builder /app/apps/research-agent/dist/index.js ./dist/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
