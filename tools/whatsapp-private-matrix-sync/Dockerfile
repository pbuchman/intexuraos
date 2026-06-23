FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --prod --ignore-workspace --no-frozen-lockfile
COPY src/ ./src/

ENV PORT=8099
EXPOSE 8099

CMD ["node", "/app/src/server.mjs"]
