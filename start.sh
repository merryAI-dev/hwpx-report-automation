#!/bin/sh
set -e

# Run Prisma migrations against PostgreSQL before starting the app.
# DATABASE_URL must be set via fly secrets (fly secrets set DATABASE_URL="postgresql://...")
npx prisma migrate deploy

exec node server.js
