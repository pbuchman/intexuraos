FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

ARG SOURCE_SHA
ARG FIXTURE_BUILD=false
RUN printf '%s' "$SOURCE_SHA" | grep -Eq '^[a-f0-9]{40}$'
LABEL org.opencontainers.image.revision=$SOURCE_SHA \
      org.opencontainers.image.source="https://github.com/pbuchman/intexuraos" \
      com.intexuraos.build.fixture=$FIXTURE_BUILD

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node src/ ./src/

ENV PORT=8099
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 CMD ["node", "/app/src/healthcheck.mjs"]

CMD ["node", "/app/src/server.mjs"]
