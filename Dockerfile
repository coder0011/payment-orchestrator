# Multi-Stage Build on Node.js 26 Active LTS Alpine
FROM node:26-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
COPY tsconfig*.json ./

RUN npm ci

# Copy source code and build
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies for lean production image
RUN npm prune --production

# Production Runner Stage
FROM node:26-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Run as non-root user for security hardening
USER node

# Copy production artifacts
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/src/index.js"]
