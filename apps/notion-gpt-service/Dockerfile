# PraxOS Notion GPT Service Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/notion-gpt-service/package*.json ./apps/notion-gpt-service/
COPY packages/common/package*.json ./packages/common/

# Install dependencies
RUN npm ci --workspace=@praxos/common --workspace=apps/notion-gpt-service

# Copy source files
COPY tsconfig*.json ./
COPY packages/common/ ./packages/common/
COPY apps/notion-gpt-service/ ./apps/notion-gpt-service/

# Build
RUN npm run build --workspace=@praxos/common
RUN npm run build --workspace=apps/notion-gpt-service

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/notion-gpt-service/package*.json ./apps/notion-gpt-service/
COPY packages/common/package*.json ./packages/common/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=@praxos/common --workspace=apps/notion-gpt-service

# Copy built files
COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/apps/notion-gpt-service/dist ./apps/notion-gpt-service/dist

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the service
CMD ["node", "apps/notion-gpt-service/dist/index.js"]
