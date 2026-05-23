FROM debian:bullseye-slim

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
    liquidsoap \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create user and directories
RUN useradd -m -s /bin/bash icecast && \
    mkdir -p /var/log/icecast2 /etc/icecast2 /etc/liquidsoap /var/lib/liquidsoap/music && \
    chown -R icecast:icecast /var/log/icecast2 /etc/icecast2 /var/lib/liquidsoap

# Copy configs
COPY icecast.xml /etc/icecast2/icecast.xml
COPY liquidsoap.liq /etc/liquidsoap/radio.liq
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose ports
EXPOSE 8000

# Switch to icecast user
USER icecast

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries-3 \
    CMD curl -fs http://localhost:8000/status-json.xsl > /dev/null || exit 1

CMD ["/start.sh"]
