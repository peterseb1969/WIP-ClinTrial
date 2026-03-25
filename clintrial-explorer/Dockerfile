# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Copy WIP client libraries (referenced via file: in package.json)
COPY libs/ ./libs/
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
COPY app-manifest.json /app/app-manifest.json
EXPOSE 3001
