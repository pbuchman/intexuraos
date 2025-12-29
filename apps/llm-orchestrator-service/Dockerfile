# IntexuraOS LLM Orchestrator Service Dockerfile
# Multi-stage build for minimal production image.

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files for dependency resolution
COPY package*.json ./
COPY apps/llm-orchestrator-service/package*.json ./apps/llm-orchestrator-service/
COPY packages/common-core/package*.json ./packages/common-core/
COPY packages/common-http/package*.json ./packages/common-http/
COPY packages/http-contracts/package*.json ./packages/http-contracts/
COPY packages/http-server/package*.json ./packages/http-server/
COPY packages/infra-firestore/package*.json ./packages/infra-firestore/
COPY packages/infra-claude/package*.json ./packages/infra-claude/
COPY packages/infra-gemini/package*.json ./packages/infra-gemini/
COPY packages/infra-gpt/package*.json ./packages/infra-gpt/
COPY packages/infra-whatsapp/package*.json ./packages/infra-whatsapp/

# Install ALL dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/common-core/ ./packages/common-core/
COPY packages/common-http/ ./packages/common-http/
COPY packages/http-contracts/ ./packages/http-contracts/
COPY packages/http-server/ ./packages/http-server/
COPY packages/infra-firestore/ ./packages/infra-firestore/
COPY packages/infra-claude/ ./packages/infra-claude/
COPY packages/infra-gemini/ ./packages/infra-gemini/
COPY packages/infra-gpt/ ./packages/infra-gpt/
COPY packages/infra-whatsapp/ ./packages/infra-whatsapp/
COPY apps/llm-orchestrator-service/ ./apps/llm-orchestrator-service/

# Build packages in dependency order, then service
RUN npm run build -w @intexuraos/common-core \
    && npm run build -w @intexuraos/common-http \
    && npm run build -w @intexuraos/http-contracts \
    && npm run build -w @intexuraos/infra-firestore \
    && npm run build -w @intexuraos/infra-claude \
    && npm run build -w @intexuraos/infra-gemini \
    && npm run build -w @intexuraos/infra-gpt \
    && npm run build -w @intexuraos/infra-whatsapp \
    && npm run build -w @intexuraos/http-server \
    && npm run build -w @intexuraos/llm-orchestrator-service

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/llm-orchestrator-service/package*.json ./apps/llm-orchestrator-service/
COPY packages/common-core/package*.json ./packages/common-core/
COPY packages/common-http/package*.json ./packages/common-http/
COPY packages/http-contracts/package*.json ./packages/http-contracts/
COPY packages/http-server/package*.json ./packages/http-server/
COPY packages/infra-firestore/package*.json ./packages/infra-firestore/
COPY packages/infra-claude/package*.json ./packages/infra-claude/
COPY packages/infra-gemini/package*.json ./packages/infra-gemini/
COPY packages/infra-gpt/package*.json ./packages/infra-gpt/
COPY packages/infra-whatsapp/package*.json ./packages/infra-whatsapp/

# Install production dependencies
RUN npm ci --omit=dev \
    -w @intexuraos/common-core \
    -w @intexuraos/common-http \
    -w @intexuraos/http-contracts \
    -w @intexuraos/http-server \
    -w @intexuraos/infra-firestore \
    -w @intexuraos/infra-claude \
    -w @intexuraos/infra-gemini \
    -w @intexuraos/infra-gpt \
    -w @intexuraos/infra-whatsapp \
    -w @intexuraos/llm-orchestrator-service

# Copy built files
COPY --from=builder /app/packages/common-core/dist ./packages/common-core/dist
COPY --from=builder /app/packages/common-http/dist ./packages/common-http/dist
COPY --from=builder /app/packages/http-contracts/dist ./packages/http-contracts/dist
COPY --from=builder /app/packages/http-server/dist ./packages/http-server/dist
COPY --from=builder /app/packages/infra-firestore/dist ./packages/infra-firestore/dist
COPY --from=builder /app/packages/infra-claude/dist ./packages/infra-claude/dist
COPY --from=builder /app/packages/infra-gemini/dist ./packages/infra-gemini/dist
COPY --from=builder /app/packages/infra-gpt/dist ./packages/infra-gpt/dist
COPY --from=builder /app/packages/infra-whatsapp/dist ./packages/infra-whatsapp/dist
COPY --from=builder /app/apps/llm-orchestrator-service/dist ./apps/llm-orchestrator-service/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "apps/llm-orchestrator-service/dist/index.js"]
