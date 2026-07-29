# Multi-stage build for vinext (Next.js on Vite) production
FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .openai/hosting.json ./.openai/hosting.json

# Install all dependencies (including devDependencies for build)
# pnpm v11+ requires explicit build script approval
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN pnpm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8000
ENV HOST=0.0.0.0
ENV TZ=Asia/Shanghai

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 vinext

# Copy package files
COPY --from=builder --chown=vinext:nodejs /app/package.json ./
COPY --from=builder --chown=vinext:nodejs /app/pnpm-lock.yaml ./
COPY --from=builder --chown=vinext:nodejs /app/pnpm-workspace.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built application
COPY --from=builder --chown=vinext:nodejs /app/.next ./.next
COPY --from=builder --chown=vinext:nodejs /app/.vinext ./.vinext
COPY --from=builder --chown=vinext:nodejs /app/public ./public
COPY --from=builder --chown=vinext:nodejs /app/worker ./worker
COPY --from=builder --chown=vinext:nodejs /app/next.config.ts ./
COPY --from=builder --chown=vinext:nodejs /app/vite.config.ts ./
COPY --from=builder --chown=vinext:nodejs /app/tsconfig.json ./
COPY --from=builder --chown=vinext:nodejs /app/.openai ./.openai

USER vinext

EXPOSE 8000

CMD ["pnpm", "exec", "vinext", "start", "-p", "8000", "-H", "0.0.0.0"]
