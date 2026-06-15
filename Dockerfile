# Hobe — Node + ffmpeg + source, plus Litestream for durable SQLite on hosts
# with ephemeral disks (e.g. Koyeb's free tier).
FROM node:22-alpine
RUN apk add --no-cache ffmpeg

# Litestream: streams the SQLite ledger to R2 and restores it on boot.
# The linux-amd64 build is a static binary and runs fine on Alpine/musl.
ARG LITESTREAM_VERSION=v0.3.13
RUN apk add --no-cache --virtual .fetch wget \
 && wget -O /tmp/litestream.tar.gz \
      "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-amd64.tar.gz" \
 && tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz litestream \
 && rm /tmp/litestream.tar.gz \
 && apk del .fetch

WORKDIR /app
COPY . .
RUN chmod +x docker-entrypoint.sh

# The database is seeded at runtime by the entrypoint (after attempting a
# restore from R2), not baked into the image — otherwise a stale DB would block
# the restore of the real ledger.

EXPOSE 3000
ENV PORT=3000
CMD ["./docker-entrypoint.sh"]
