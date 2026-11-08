# ==========================================
# Chatwork Guardian Bot - Production Dockerfile
# ==========================================

# Stage 1: Build Vite Client Assets
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

# Build production bundle for the client UI
RUN npm run build

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for health check
RUN apk add --no-cache curl

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy package files
COPY package*.json ./

# Copy built frontend client assets
COPY --from=builder /app/dist ./dist

# Copy backend server files
COPY server.ts ./
COPY src/server ./src/server
COPY tsconfig.json ./

# Create persistent data directory for fallback JSON database
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

# Container healthcheck using the built-in status API
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/status || exit 1

# Start the full-stack server
CMD ["npm", "start"]
