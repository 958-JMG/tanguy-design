# syntax=docker/dockerfile:1.7
# ================================================================
# Tanguy Design — Cockpit cuisines · production image
# Stack : Express 4 + Airtable + Anthropic Claude
# ================================================================

# ----- Stage 1 : dependencies --------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline --no-audit --no-fund --omit=dev

# ----- Stage 2 : runtime -------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# Libs pour bcrypt natif
RUN apk add --no-cache libc6-compat ca-certificates \
    && addgroup -g 1001 -S nodejs \
    && adduser -S tanguy -u 1001

COPY --from=deps --chown=tanguy:nodejs /app/node_modules ./node_modules
COPY --chown=tanguy:nodejs . .

USER tanguy

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
