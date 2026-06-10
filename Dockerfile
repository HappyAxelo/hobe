# Hobe — zero npm dependencies, so the image is just Node + ffmpeg + source.
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY . .
RUN node scripts/seed.js
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server/index.js"]
