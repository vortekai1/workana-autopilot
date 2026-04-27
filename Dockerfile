FROM node:20-slim

# Build args que Easypanel inyecta automáticamente (necesarios para que buildx no falle)
ARG WORKANA_EMAIL
ARG WORKANA_PASSWORD
ARG PORT
ARG HEADLESS
ARG USER_DATA_DIR
ARG GIT_SHA

# Dependencias de Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Variable para que Puppeteer use el Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# Directorio para datos del navegador (persistir con volumen)
RUN mkdir -p /app/chrome-data

EXPOSE 3500

CMD ["node", "src/server.js"]
