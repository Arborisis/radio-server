FROM node:20-slim

# Install ffmpeg pour le streaming
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy app
COPY server.js ./
COPY public/ ./public/

# Expose port
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -fs http://localhost:${PORT:-8000}/health > /dev/null || exit 1

CMD ["node", "server.js"]
