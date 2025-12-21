# PraxOS API Docs Hub Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api-docs-hub/package*.json ./apps/api-docs-hub/
COPY packages/common/package*.json ./packages/common/

# Install ALL dependencies including root devDependencies (typescript)
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/common/ ./packages/common/
COPY apps/api-docs-hub/ ./apps/api-docs-hub/

# Build all packages in dependency order
RUN npm run build --workspace=@praxos/common
RUN npm run build --workspace=@praxos/api-docs-hub

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api-docs-hub/package*.json ./apps/api-docs-hub/
COPY packages/common/package*.json ./packages/common/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=@praxos/common --workspace=apps/api-docs-hub

# Copy built files
COPY --from=builder /app/packages/common/dist ./packages/common/dist
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
