# PraxOS WhatsApp Service Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/whatsapp-service/package*.json ./apps/whatsapp-service/
COPY packages/common/package*.json ./packages/common/

# Install ALL dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/common/ ./packages/common/
COPY apps/whatsapp-service/ ./apps/whatsapp-service/

# Build
RUN npm run build --workspace=@praxos/common
RUN npm run build --workspace=apps/whatsapp-service

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/whatsapp-service/package*.json ./apps/whatsapp-service/
COPY packages/common/package*.json ./packages/common/

# Install production dependencies
RUN npm ci --omit=dev \
    --workspace=@praxos/common \
    --workspace=apps/whatsapp-service

# Copy built files
COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/apps/whatsapp-service/dist ./apps/whatsapp-service/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "apps/whatsapp-service/dist/index.js"]

