# Node 20 LTS slim — sejalan dengan prasyarat README (Node 18/20+)
FROM node:20-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# Dependensi sistem untuk Google Chrome headless + whatsapp-web.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils \
  && wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
  && rm -f /tmp/google-chrome.deb \
  && rm -rf /var/lib/apt/lists/* \
  && google-chrome-stable --version

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Install dependensi dulu agar layer Docker ter-cache
# (Chrome sistem sudah terinstal di atas, jadi tidak perlu unduh browser Puppeteer)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Salin source aplikasi
COPY server.js ecosystem.config.js logs.sql ./
COPY src ./src

# Folder runtime yang dipersist via volume
RUN mkdir -p .wwebjs_auth .wwebjs_cache logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

# Single instance (session WA tidak bisa paralel) — PM2 tidak dipakai di container
CMD ["node", "server.js"]
