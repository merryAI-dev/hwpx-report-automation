# ---- build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Blob storage volume
RUN mkdir -p /data/blob-storage && chown nextjs:nodejs /data/blob-storage
ENV BLOB_STORAGE_FS_ROOT=/data/blob-storage
VOLUME ["/data/blob-storage"]

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
