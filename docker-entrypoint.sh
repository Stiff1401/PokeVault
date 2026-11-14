#!/bin/sh
set -e

# Create/upgrade the PostgreSQL schema before the server starts.
echo "PokéVault: applying database schema …"
node node_modules/prisma/build/index.js db push --skip-generate --schema prisma/schema.prisma

exec "$@"
