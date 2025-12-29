# IntexuraOS API Docs Hub Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files for dependency resolution
COPY package*.json ./
COPY apps/api-docs-hub/package*.json ./apps/api-docs-hub/
COPY packages/common-core/package*.json ./packages/common-core/
COPY packages/common-http/package*.json ./packages/common-http/
COPY packages/http-contracts/package*.json ./packages/http-contracts/
COPY packages/http-server/package*.json ./packages/http-server/
COPY packages/infra-firestore/package*.json ./packages/infra-firestore/

# Install ALL dependencies including root devDependencies (typescript)
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/common-core/ ./packages/common-core/
COPY packages/common-http/ ./packages/common-http/
COPY packages/http-contracts/ ./packages/http-contracts/
COPY packages/http-server/ ./packages/http-server/
COPY packages/infra-firestore/ ./packages/infra-firestore/
COPY apps/api-docs-hub/ ./apps/api-docs-hub/

# Build packages in dependency order, then service
RUN npm run build -w @intexuraos/common-core \
    && npm run build -w @intexuraos/http-contracts \
    && npm run build -w @intexuraos/infra-firestore \
    && npm run build -w @intexuraos/common-http \
    && npm run build -w @intexuraos/http-server \
    && npm run build -w @intexuraos/api-docs-hub

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api-docs-hub/package*.json ./apps/api-docs-hub/
COPY packages/common-core/package*.json ./packages/common-core/
COPY packages/common-http/package*.json ./packages/common-http/
COPY packages/http-contracts/package*.json ./packages/http-contracts/
COPY packages/http-server/package*.json ./packages/http-server/
COPY packages/infra-firestore/package*.json ./packages/infra-firestore/

# Install production dependencies only
RUN npm ci --omit=dev \
    -w @intexuraos/common-core \
    -w @intexuraos/common-http \
    -w @intexuraos/http-contracts \
    -w @intexuraos/http-server \
    -w @intexuraos/infra-firestore \
    -w @intexuraos/api-docs-hub

# Copy built files
COPY --from=builder /app/packages/common-core/dist ./packages/common-core/dist
COPY --from=builder /app/packages/common-http/dist ./packages/common-http/dist
COPY --from=builder /app/packages/http-contracts/dist ./packages/http-contracts/dist
COPY --from=builder /app/packages/http-server/dist ./packages/http-server/dist
COPY --from=builder /app/packages/infra-firestore/dist ./packages/infra-firestore/dist
COPY --from=builder /app/apps/api-docs-hub/dist ./apps/api-docs-hub/dist

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the service
CMD ["node", "apps/api-docs-hub/dist/index.js"]
