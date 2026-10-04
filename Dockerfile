FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
EXPOSE 3000
# localhost는 alpine에서 ::1로 해석되어 IPv4(0.0.0.0)에만 열린 서버에 연결 실패하므로 127.0.0.1 사용
HEALTHCHECK --interval=15s --start-period=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/dist/index.js"]
