#!/bin/sh
set -e

# Initialize SQLite schema (no Prisma CLI needed)
node init-db.mjs

exec node server.js
