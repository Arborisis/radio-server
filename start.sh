#!/bin/bash
set -e

# Utiliser le port Railway (fallback 8000)
export PORT=${PORT:-8000}

# Configurer Icecast avec les variables d'environnement
export ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD:-source}
export ICECAST_RELAY_PASSWORD=${ICECAST_RELAY_PASSWORD:-relay}
export ICECAST_ADMIN_PASSWORD=${ICECAST_ADMIN_PASSWORD:-admin}

# Créer la config icecast avec les variables
sed -i "s/\${ICECAST_SOURCE_PASSWORD:-source}/$ICECAST_SOURCE_PASSWORD/g" /etc/icecast2/icecast.xml
sed -i "s/\${ICECAST_RELAY_PASSWORD:-relay}/$ICECAST_RELAY_PASSWORD/g" /etc/icecast2/icecast.xml
sed -i "s/\${ICECAST_ADMIN_PASSWORD:-admin}/$ICECAST_ADMIN_PASSWORD/g" /etc/icecast2/icecast.xml
sed -i "s/\${PORT}/$PORT/g" /etc/icecast2/icecast.xml

# Démarrer Icecast en arrière-plan (forcer le run en root)
echo "[Radio] Démarrage Icecast sur le port $PORT..."
# Patcher icecast2 pour accepter root
sed -i 's/geteuid/getppid/g' /usr/bin/icecast2 2>/dev/null || true
icecast2 -c /etc/icecast2/icecast.xml &
ICEPID=$!

# Attendre qu'Icecast soit prêt
sleep 5

# Vérifier qu'Icecast est accessible
if ! curl -s http://localhost:$PORT/status-json.xsl > /dev/null 2>&1; then
    echo "[Radio] Icecast n'est pas accessible, attente supplémentaire..."
    sleep 10
fi

# Créer un fichier de playlist par défaut si vide
mkdir -p /var/lib/liquidsoap/music
if [ ! -f /var/lib/liquidsoap/music/default.m3u ]; then
    echo "# Default playlist - Add music files here" > /var/lib/liquidsoap/music/default.m3u
fi

# Démarrer Liquidsoap
echo "[Radio] Démarrage Liquidsoap..."
liquidsoap /etc/liquidsoap/radio.liq &
LIQPid=$!

echo "[Radio] Serveur démarré !"
echo "[Radio] Stream: http://localhost:$PORT${RADIO_MOUNT:-/arborisis.mp3}"
echo "[Radio] Admin: http://localhost:$PORT/admin"

# Attendre les processus
wait $ICEPID $LIQPid
