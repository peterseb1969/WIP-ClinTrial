# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install WIP libraries from tarballs
COPY .docker-libs/ /tmp/libs/
COPY package.json ./
RUN WCLIENT=$(ls /tmp/libs/wip-client-*.tgz 2>/dev/null | head -1) && \
    WREACT=$(ls /tmp/libs/wip-react-*.tgz 2>/dev/null | head -1) && \
    WPROXY=$(ls /tmp/libs/wip-proxy-*.tgz 2>/dev/null | head -1) && \
    sed -i "s|\"file:../libs/wip-client-0.1.0.tgz\"|\"file:${WCLIENT}\"|" package.json && \
    sed -i "s|\"file:../../WorldInPie/libs/wip-proxy\"|\"file:${WPROXY}\"|" package.json && \
    sed -i "s|\"file:../libs/wip-react-0.1.0.tgz\"|\"file:${WREACT}\"|" package.json && \
    npm install --ignore-scripts

COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3013
CMD ["npx", "tsx", "server/index.ts"]
