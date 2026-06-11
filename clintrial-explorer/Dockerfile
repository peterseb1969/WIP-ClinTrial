# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies. The @wip/* tarballs live in libs/ inside the build
# context, pinned by package.json as file:libs/<name>-<version>.tgz
# (CASE-442 single source of truth) — no path rewriting needed.
COPY package.json package-lock.json ./
COPY libs/ ./libs/
RUN npm ci --ignore-scripts

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
