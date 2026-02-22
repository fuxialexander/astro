# Astro Backend + Relay Server
# Multi-stage build: build everything, ship only what's needed

# --------------- Build Stage ---------------
FROM node:22-alpine AS builder

WORKDIR /app

# Native module build tools (better-sqlite3 needs these)
RUN apk add --no-cache python3 make g++ git

# Install ALL dependencies (devDeps needed for tsc + vite)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Server runs via tsx (runtime transpilation), so tsc is not required.
# Frontend is deployed separately to Cloudflare Pages — skip vite build.
# Only install production-relevant native modules (better-sqlite3, etc.)
RUN npm rebuild

# --------------- Production Stage ---------------
FROM node:22-alpine AS production

WORKDIR /app

RUN apk add --no-cache dumb-init curl

# Non-root user
RUN addgroup -g 1001 astro && \
    adduser -D -u 1001 -G astro astro

# Runtime artifacts from builder
COPY --from=builder --chown=astro:astro /app/node_modules ./node_modules
COPY --from=builder --chown=astro:astro /app/package*.json ./

# Server source (runs via tsx at runtime)
COPY --from=builder --chown=astro:astro /app/server ./server

# Frontend types imported by server (src/types/*.ts)
COPY --from=builder --chown=astro:astro /app/src/types ./src/types

# tsconfig files needed by tsx for path resolution
COPY --from=builder --chown=astro:astro /app/tsconfig*.json ./

# Landing page HTML files
COPY --from=builder --chown=astro:astro /app/astro-landing.html ./astro-landing.html
COPY --from=builder --chown=astro:astro /app/astro-about.html ./astro-about.html

# Supabase migrations (for reference / future use)
COPY --from=builder --chown=astro:astro /app/supabase ./supabase

ENV NODE_ENV=production \
    PORT=3001 \
    RELAY_PORT=3002

EXPOSE 3001 3002

USER astro

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
