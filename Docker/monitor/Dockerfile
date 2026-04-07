FROM node:20-alpine
WORKDIR /app

COPY Docker/monitor/package.json Docker/monitor/package-lock.json ./
RUN npm ci --omit=dev

COPY Docker/monitor/ ./

EXPOSE 8090
CMD ["node", "server.mjs"]
