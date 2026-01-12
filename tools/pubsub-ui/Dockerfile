FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN pnpm install --omit=dev

COPY . .

EXPOSE 8105

CMD ["node", "server.mjs"]
