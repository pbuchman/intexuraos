# IntexuraOS Notion Service Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files for dependency resolution
COPY package*.json ./
COPY apps/notion-service/package*.json ./apps/notion-service/
COPY packages/common-core/package*.json ./packages/common-core/
COPY packages/common-http/package*.json ./packages/common-http/
COPY packages/http-contracts/package*.json ./packages/http-contracts/
COPY packages/http-server/package*.json ./packages/http-server/
COPY packages/infra-firestore/package*.json ./packages/infra-firestore/
COPY packages/infra-notion/package*.json ./packages/infra-notion/

# Install ALL dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/common-core/ ./packages/common-core/
COPY packages/common-http/ ./packages/common-http/
COPY packages/http-contracts/ ./packages/http-contracts/
COPY packages/http-server/ ./packages/http-server/
COPY packages/infra-firestore/ ./packages/infra-firestore/
COPY packages/infra-notion/ ./packages/infra-notion/
COPY apps/notion-service/ ./apps/notion-service/

# Build packages in dependency order, then service
RUN npm run build -w @intexuraos/common-core \
    && npm run build -w @intexuraos/http-contracts \
    && npm run build -w @intexuraos/infra-firestore \
    && npm run build -w @intexuraos/common-http \
    && npm run build -w @intexuraos/http-server \
    && npm run build -w @intexuraos/infra-notion \
    && npm run build -w @intexuraos/notion-service

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/notion-service/package*.json ./apps/notion-service/
COPY packages/common-core/package*.json ./packages/common-core/
COPY packages/common-http/package*.json ./packages/common-http/
COPY packages/http-contracts/package*.json ./packages/http-contracts/
COPY packages/http-server/package*.json ./packages/http-server/
COPY packages/infra-firestore/package*.json ./packages/infra-firestore/
COPY packages/infra-notion/package*.json ./packages/infra-notion/

# Install production dependencies
RUN npm ci --omit=dev \
    -w @intexuraos/common-core \
    -w @intexuraos/common-http \
    -w @intexuraos/http-contracts \
    -w @intexuraos/http-server \
    -w @intexuraos/infra-firestore \
    -w @intexuraos/infra-notion \
    -w @intexuraos/notion-service

# Copy built files
COPY --from=builder /app/packages/common-core/dist ./packages/common-core/dist
COPY --from=builder /app/packages/common-http/dist ./packages/common-http/dist
COPY --from=builder /app/packages/http-contracts/dist ./packages/http-contracts/dist
COPY --from=builder /app/packages/http-server/dist ./packages/http-server/dist
COPY --from=builder /app/packages/infra-firestore/dist ./packages/infra-firestore/dist
COPY --from=builder /app/packages/infra-notion/dist ./packages/infra-notion/dist
COPY --from=builder /app/apps/notion-service/dist ./apps/notion-service/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "apps/notion-service/dist/index.js"]

