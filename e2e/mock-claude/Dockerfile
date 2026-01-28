# Multi-stage build for E2E Mock Claude
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY ../../package.json ../../pnpm-workspace.yaml ../../pnpm-lock.yaml* ./

# Install pnpm
RUN npm install -g pnpm@8

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY index.ts ./

# Build using tsx (no compilation needed for E2E)
FROM node:20-alpine

RUN apk add --no-cache git bash

# Install gh CLI
RUN apk add --no-cache curl \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "https://cli.github.com/packages" | tee /etc/apk/repositories.d/github-cli.list \
    && apk add --no-cache github-cli

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/index.ts ./

# Copy tsx from builder for ESM execution
COPY --from=builder /app/node_modules/.pnpm/tsx@* ./node_modules/.pnpm/

# Configure git for GitHub operations
RUN git config --global user.email "e2e-tests@intexuraos.local" && \
    git config --global user.name "E2E Test Runner"

ENV NODE_ENV=production
ENV PORT=8090

EXPOSE 8090

CMD ["node", "--import", "tsx/dist/loader.mjs", "--conditions=tsx", "index.ts"]
