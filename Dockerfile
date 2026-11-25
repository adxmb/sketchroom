FROM node:22-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
COPY client/package.json client/package-lock.json client/
RUN npm ci --prefix server && npm ci --prefix client
COPY server server
COPY client client
RUN npm run build --prefix client && npm run build --prefix server

FROM node:22-slim AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/client/dist
WORKDIR /app/server
COPY --from=deps /app/server/node_modules node_modules
COPY --from=build /app/server/dist dist
COPY --from=build /app/server/migrations migrations
COPY --from=build /app/server/package.json package.json
COPY --from=build /app/client/dist /app/client/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]