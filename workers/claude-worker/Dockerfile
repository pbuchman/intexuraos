FROM node:22-alpine

# Install required tools
# Based on command usage analysis (1,935 commands across 6 worktrees):
#   - git: 317 uses (16.4%)
#   - pnpm: 248 uses (12.8%) - CRITICAL for CI
#   - grep/rg: 160 uses (8.3%) - rg preferred per CLAUDE.md
#   - gh: 51 uses (2.6%) - PR creation
#   - jq: 101 uses - JSON processing
#   - bat: 0 uses but CLAUDE.md mandates it for CI analysis
#   - python3: Required for gcloud CLI and some development scripts
#   - py3-pip: Required for MCP server dependencies
RUN apk add --no-cache \
    git \
    openssh-client \
    curl \
    bash \
    jq \
    file \
    strace \
    gdb \
    python3 \
    py3-pip \
    && rm -rf /var/cache/apk/*

# Install ripgrep, fd, bat from edge/community (not in main repos)
# chromium: required for @playwright/mcp (can't download browsers at runtime)
RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    ripgrep \
    fd \
    bat \
    github-cli \
    chromium \
    direnv

# Create gh wrapper that reads fresh token from file on every invocation.
# apk installs gh at /usr/bin/gh; /usr/local/bin precedes /usr/bin in PATH,
# so this wrapper shadows the real binary. Ensures gh always uses the latest
# token from the orchestrator's TokenRefresher bind mount.
RUN printf '#!/bin/sh\nif [ -f "/secrets/github-token" ]; then\n  export GITHUB_TOKEN="$(cat /secrets/github-token)"\n  export GH_TOKEN="$GITHUB_TOKEN"\nfi\nexec /usr/bin/gh "$@"\n' > /usr/local/bin/gh \
    && chmod +x /usr/local/bin/gh

# Install terraform from hashicorp (TARGETARCH is set automatically by BuildKit)
ARG TARGETARCH
RUN curl -fsSL "https://releases.hashicorp.com/terraform/1.7.0/terraform_1.7.0_linux_${TARGETARCH}.zip" -o /tmp/terraform.zip \
    && unzip /tmp/terraform.zip -d /usr/local/bin/ \
    && rm /tmp/terraform.zip \
    && chmod +x /usr/local/bin/terraform

# Install pnpm (CRITICAL - 248 uses, can't run CI without it)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install gcloud CLI (369 uses - most used tool)
RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir=/opt
ENV PATH="/opt/google-cloud-sdk/bin:${PATH}"

# Cache-busting: CACHE_BUST is set to COMMIT_SHA by the build script, ensuring
# the Claude CLI (and everything after) is re-downloaded on each rebuild rather
# than served from Docker layer cache with a stale version.
ARG CACHE_BUST

# Install Claude CLI
# The installer puts claude in ~/.local/bin/claude
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && cp /root/.local/bin/claude /usr/local/bin/claude \
    && chmod +x /usr/local/bin/claude

# Install Codex CLI (OpenAI) — intentionally included for testing and comparison
# of alternative AI coding agent backends within the same worker infrastructure.
# Not used in production workflows; kept for A/B evaluation purposes.
RUN npm install -g @openai/codex

# Pre-install MCP server packages globally.
# Claude plugins invoke these via `npx -y <package>`. On Alpine, npx downloads to a
# temp cache with noexec-restricted permissions, causing "Permission denied" at startup.
# Global install puts binaries in /usr/local/bin with proper execute permissions;
# npx finds the global install and skips the download entirely.
RUN npm install -g \
    @upstash/context7-mcp \
    @sentry/mcp-server \
    @playwright/mcp

# Pre-install Claude Code plugins into staging directory.
# At runtime, /home/claude is tmpfs (wiped) and /home/claude/.claude is a bind mount
# from a per-task session dir (initially empty). The entrypoint copies plugin cache
# from /opt/claude-plugins/ into the bind mount so plugins resolve immediately.
# HOME is set to /opt/claude-plugins so plugin files land in the staging directory.
RUN mkdir -p /opt/claude-plugins/.claude \
    && HOME=/opt/claude-plugins claude plugin marketplace add anthropics/claude-plugins-official \
    && HOME=/opt/claude-plugins claude plugin marketplace add obra/superpowers-marketplace \
    && HOME=/opt/claude-plugins claude plugin install superpowers@superpowers-marketplace --scope user \
    && HOME=/opt/claude-plugins claude plugin install context7@claude-plugins-official --scope user \
    && HOME=/opt/claude-plugins claude plugin install commit-commands@claude-plugins-official --scope user \
    && HOME=/opt/claude-plugins claude plugin install pr-review-toolkit@claude-plugins-official --scope user \
    && HOME=/opt/claude-plugins claude plugin install playwright@claude-plugins-official --scope user \
    && HOME=/opt/claude-plugins claude plugin install frontend-design@claude-plugins-official --scope user

# Create non-root user (use UID 1001 since 1000 is taken by 'node' in base image)
RUN addgroup -S claude && adduser -S claude -G claude -u 1001

# Set up directories (including .config/gcloud for gcloud auth)
RUN mkdir -p /repo /secrets /tmp /home/claude/.claude /home/claude/.config/gcloud \
    && chown -R claude:claude /repo /secrets /tmp /home/claude /opt/claude-plugins

# Bake Claude default config to skip onboarding on fresh tmpfs
# /home/claude is tmpfs so image contents are wiped — entrypoint.sh copies these at startup
# NOTE: Build context is workspace root (.), so paths are root-relative
COPY --chown=claude:claude workers/claude-worker/config-defaults/claude.json /opt/claude-defaults/.claude.json

# Hook direnv into bash so env vars auto-load when entering /repo
RUN echo 'eval "$(direnv hook bash)"' >> /opt/claude-defaults/.bashrc

# Copy entrypoint
COPY --chown=claude:claude workers/claude-worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Security: Remove unnecessary tools
RUN rm -f /usr/bin/wget /usr/bin/nc 2>/dev/null || true

# Set environment
ENV HOME=/home/claude
ENV NODE_ENV=production
ENV GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Playwright: use system Chromium installed via apk, skip browser download
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Switch to non-root user
USER claude
WORKDIR /repo

ENTRYPOINT ["/entrypoint.sh"]
