FROM node:22-alpine AS dependencies
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Public URLs are inlined by Next at build time, so they must be present here,
# not only at runtime. Coolify passes environment variables marked as
# build-time variables as build args.
ARG NEXT_PUBLIC_OPENLIVERY_URL="https://agents.merqato.digital"
ARG NEXT_PUBLIC_INVOICESHELF_URL="https://billing.merqato.digital"
ARG NEXT_PUBLIC_COOLIFY_URL="https://studio.merqato.digital"
ARG NEXT_PUBLIC_CLOUDFLARE_URL="https://dash.cloudflare.com/account/home"
ARG NEXT_PUBLIC_GIT_URL="https://git.merqato.digital/"
ENV NEXT_PUBLIC_OPENLIVERY_URL=$NEXT_PUBLIC_OPENLIVERY_URL \
    NEXT_PUBLIC_INVOICESHELF_URL=$NEXT_PUBLIC_INVOICESHELF_URL \
    NEXT_PUBLIC_COOLIFY_URL=$NEXT_PUBLIC_COOLIFY_URL \
    NEXT_PUBLIC_CLOUDFLARE_URL=$NEXT_PUBLIC_CLOUDFLARE_URL \
    NEXT_PUBLIC_GIT_URL=$NEXT_PUBLIC_GIT_URL
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
