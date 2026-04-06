FROM node:24-bookworm

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=5173 \
    HOST=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN npm ci \
    && npx playwright install --with-deps chromium

COPY . .

RUN npm run build:webapp \
    && npm prune --omit=dev \
    && npm cache clean --force

ENV NODE_ENV=production

EXPOSE 5173

CMD ["node", "server/index.js"]
