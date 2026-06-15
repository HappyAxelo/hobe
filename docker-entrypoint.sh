#!/bin/sh
# Boot sequence for the deployed container:
#   1. Try to restore the SQLite ledger from R2 (the durable copy).
#   2. If there's no replica yet (first ever deploy), seed a fresh demo DB.
#   3. Hand off to Litestream, which runs the app and streams every write to R2.
#
# In local/dev mode (no R2_* env vars) none of this applies — you just run
# `node server/index.js` directly, as before.
set -e

DB=/app/data/hobe.db
mkdir -p /app/data/videos /app/data/avatars /app/data/tmp

if [ -z "$R2_BUCKET" ]; then
  echo "No R2 config — running without Litestream (data is NOT durable)."
  exec node server/index.js
fi

if [ ! -f "$DB" ]; then
  echo "Restoring ledger from R2 (if a replica exists)…"
  litestream restore -if-replica-exists -config /app/litestream.yml "$DB" || true
fi

if [ ! -f "$DB" ]; then
  echo "No replica found — seeding a fresh database."
  node scripts/seed.js
fi

echo "Starting app under Litestream replication."
exec litestream replicate -config /app/litestream.yml -exec "node server/index.js"
