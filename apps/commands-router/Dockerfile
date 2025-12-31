FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common-core/package.json ./packages/common-core/
COPY packages/common-http/package.json ./packages/common-http/
COPY packages/http-contracts/package.json ./packages/http-contracts/
COPY packages/http-server/package.json ./packages/http-server/
COPY packages/infra-firestore/package.json ./packages/infra-firestore/
COPY apps/commands-router/package.json ./apps/commands-router/

RUN npm ci --workspace=@intexuraos/commands-router

COPY packages/common-core ./packages/common-core
COPY packages/common-http ./packages/common-http
COPY packages/http-contracts ./packages/http-contracts
COPY packages/http-server ./packages/http-server
COPY packages/infra-firestore ./packages/infra-firestore
COPY apps/commands-router ./apps/commands-router
COPY scripts ./scripts
COPY tsconfig.json ./

RUN npm run build --workspace=@intexuraos/commands-router

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/apps/commands-router/dist ./dist
COPY --from=builder /app/apps/commands-router/package.json ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "dist/index.js"]
