# IntexuraOS Research Agent Dockerfile
# Multi-stage build with esbuild bundling.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy all package.json files
COPY package*.json ./
COPY apps/research-agent/package*.json ./apps/research-agent/
COPY packages/*/package*.json ./packages/

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/research-agent/ ./apps/research-agent/

# Build service (esbuild bundles everything into one file)
RUN npm run build -w @intexuraos/research-agent

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/research-agent/package*.json ./apps/research-agent/

# Install production dependencies only
RUN npm ci --omit=dev -w @intexuraos/research-agent

# Copy built file
COPY --from=builder /app/apps/research-agent/dist ./apps/research-agent/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "apps/research-agent/dist/index.js"]
