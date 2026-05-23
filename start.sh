#!/bin/bash
set -e

# Configurer Icecast avec les variables d'environnement
export ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD:-source}
export ICECAST_RELAY_PASSWORD=${ICECAST_RELAY_PASSWORD:-relay}
export ICECAST_ADMIN_PASSWORD=${ICECAST_ADMIN_PASSWORD:-admin}

# Créer la config icecast avec les variables
sed -i "s/\${ICECAST_SOURCE_PASSWORD:-source}/$ICECAST_SOURCE_PASSWORD/g" /etc/icecast2/icecast.xml
sed -i "s/\${ICECAST_RELAY_PASSWORD:-relay}/$ICECAST_RELAY_PASSWORD/g" /etc/icecast2/icecast.xml
sed -i "s/\${ICECAST_ADMIN_PASSWORD:-admin}/$ICECAST_ADMIN_PASSWORD/g" /etc/icecast2/icecast.xml

# Démarrer Icecast en arrière-plan
echo "[Radio] Démarrage Icecast..."
icecast2 -c /etc/icecast2/icecast.xml &
ICEPID=$!

# Attendre qu'Icecast soit prêt
sleep 3

# Vérifier qu'Icecast est accessible
if ! curl -s http://localhost:8000/status-json.xsl > /dev/null 2>&1; then
    echo "[Radio] Icecast n'est pas accessible, attente..."
    sleep 5
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
echo "[Radio] Stream: http://localhost:8000${RADIO_MOUNT:-/arborisis.mp3}"
echo "[Radio] Admin: http://localhost:8000/admin"

# Attendre les processus
wait $ICEPID $LIQPid
