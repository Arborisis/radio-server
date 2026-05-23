FROM debian:bullseye-slim

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
    liquidsoap \
    liquidsoap-plugin-all \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p /var/log/icecast2 /etc/icecast2 /etc/liquidsoap /var/lib/liquidsoap/music

# Copy configs
COPY icecast.xml /etc/icecast2/icecast.xml
COPY liquidsoap.liq /etc/liquidsoap/radio.liq
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose ports
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fs http://localhost:8000/status-json.xsl > /dev/null || exit 1

CMD ["/start.sh"]
