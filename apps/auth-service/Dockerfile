# IntexuraOS Auth Service Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/auth-service/package*.json ./apps/auth-service/
COPY packages/common/package*.json ./packages/common/

# Install ALL dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/common/ ./packages/common/
COPY apps/auth-service/ ./apps/auth-service/

# Build
RUN npm run build --workspace=@intexuraos/common
RUN npm run build --workspace=@intexuraos/auth-service

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/auth-service/package*.json ./apps/auth-service/
COPY packages/common/package*.json ./packages/common/

# Install production dependencies
RUN npm ci --omit=dev \
    --workspace=@intexuraos/common \
    --workspace=@intexuraos/auth-service

# Copy built files
COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/apps/auth-service/dist ./apps/auth-service/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "apps/auth-service/dist/index.js"]

