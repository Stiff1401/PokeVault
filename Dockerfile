# syntax=docker/dockerfile:1
# Optional self-hosted PokéVault: Next.js standalone server + sync API.
# The zero-backend community edition does not need this file – it is a static export.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dependencies ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV BUILD_TARGET=selfhost
RUN npx prisma generate && npx next build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 pokevault && useradd --system --uid 1001 --gid pokevault pokevault

COPY --from=builder /app/public ./public
COPY --from=builder --chown=pokevault:pokevault /app/.next/standalone ./
COPY --from=builder --chown=pokevault:pokevault /app/.next/static ./.next/static
# Prisma CLI + engines for `prisma db push` at container start.
COPY --from=builder /app/prisma ./prisma
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=pokevault:pokevault docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER pokevault
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
