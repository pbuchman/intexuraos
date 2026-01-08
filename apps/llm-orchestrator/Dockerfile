# syntax=docker/dockerfile:1.6
# IntexuraOS LLM Orchestrator Dockerfile
# Multi-stage build with esbuild bundling.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy all package.json files
COPY package*.json ./
COPY apps/llm-orchestrator/package*.json ./apps/llm-orchestrator/
COPY packages/*/package*.json ./packages/

# Install dependencies (cache npm directory between builds)
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/llm-orchestrator/ ./apps/llm-orchestrator/

# Build service (esbuild bundles everything into one file)
RUN npm run build -w @intexuraos/llm-orchestrator

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/llm-orchestrator/dist/package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --prefer-offline

# Copy built file
COPY --from=builder /app/apps/llm-orchestrator/dist/index.js ./dist/
COPY --from=builder /app/apps/llm-orchestrator/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
