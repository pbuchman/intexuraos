# PraxOS WhatsApp Service Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/whatsapp-service/package*.json ./apps/whatsapp-service/
COPY packages/common/package*.json ./packages/common/
COPY packages/domain/identity/package*.json ./packages/domain/identity/
COPY packages/domain/inbox/package*.json ./packages/domain/inbox/
COPY packages/domain/promptvault/package*.json ./packages/domain/promptvault/
COPY packages/infra/firestore/package*.json ./packages/infra/firestore/
COPY packages/infra/notion/package*.json ./packages/infra/notion/

# Install ALL dependencies including root devDependencies (typescript)
# Workspace filter doesn't install root devDeps, so we install everything for build
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/common/ ./packages/common/
COPY packages/domain/identity/ ./packages/domain/identity/
COPY packages/domain/inbox/ ./packages/domain/inbox/
COPY packages/domain/promptvault/ ./packages/domain/promptvault/
COPY packages/infra/firestore/ ./packages/infra/firestore/
COPY packages/infra/notion/ ./packages/infra/notion/
COPY apps/whatsapp-service/ ./apps/whatsapp-service/

# Build all packages in dependency order
RUN npm run build --workspace=@praxos/common
RUN npm run build --workspace=@praxos/domain-identity
RUN npm run build --workspace=@praxos/domain-inbox
RUN npm run build --workspace=@praxos/domain-promptvault
RUN npm run build --workspace=@praxos/infra-notion
RUN npm run build --workspace=@praxos/infra-firestore
RUN npm run build --workspace=apps/whatsapp-service

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/whatsapp-service/package*.json ./apps/whatsapp-service/
COPY packages/common/package*.json ./packages/common/
COPY packages/domain/identity/package*.json ./packages/domain/identity/
COPY packages/domain/inbox/package*.json ./packages/domain/inbox/
COPY packages/domain/promptvault/package*.json ./packages/domain/promptvault/
COPY packages/infra/firestore/package*.json ./packages/infra/firestore/
COPY packages/infra/notion/package*.json ./packages/infra/notion/

# Install production dependencies only
RUN npm ci --omit=dev \
    --workspace=@praxos/common \
    --workspace=@praxos/domain-identity \
    --workspace=@praxos/domain-inbox \
    --workspace=@praxos/domain-promptvault \
    --workspace=@praxos/infra-firestore \
    --workspace=@praxos/infra-notion \
    --workspace=apps/whatsapp-service

# Copy built files
COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/packages/domain/identity/dist ./packages/domain/identity/dist
COPY --from=builder /app/packages/domain/inbox/dist ./packages/domain/inbox/dist
COPY --from=builder /app/packages/domain/promptvault/dist ./packages/domain/promptvault/dist
COPY --from=builder /app/packages/infra/firestore/dist ./packages/infra/firestore/dist
COPY --from=builder /app/packages/infra/notion/dist ./packages/infra/notion/dist
COPY --from=builder /app/apps/whatsapp-service/dist ./apps/whatsapp-service/dist

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the service
CMD ["node", "apps/whatsapp-service/dist/index.js"]
