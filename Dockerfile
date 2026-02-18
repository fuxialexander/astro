# Dockerfile for Astro Application
# Multi-stage build for optimized production image

# Stage 1: Build
FROM node:25.6.1-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ git

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production
FROM node:25.6.1-alpine AS production

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 astro && \
    adduser -D -u 1001 -G astro astro

# Copy built artifacts and dependencies
COPY --from=builder --chown=astro:astro /app/dist ./dist
COPY --from=builder --chown=astro:astro /app/node_modules ./node_modules
COPY --from=builder --chown=astro:astro /app/package*.json ./
COPY --from=builder --chown=astro:astro /app/server ./server

# Set environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    RELAY_PORT=3002

# Expose ports
EXPOSE 3001 3002

# Switch to non-root user
USER astro

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server/index.ts"]
