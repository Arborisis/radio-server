# Arborisis Radio Server

Serveur de streaming radio Icecast + Liquidsoap pour Arborisis.

## Architecture

- **Icecast** : Serveur de streaming (port 8000)
- **Liquidsoap** : Automation et gestion des playlists
- **Healthcheck** : Endpoint `/health`

## Endpoints

- `https://radio-server-production-xxxxx.up.railway.app:8000/arborisis.mp3` - Stream principal
- `https://radio-server-production-xxxxx.up.railway.app/health` - Health check

## Variables d'environnement

```env
ICECAST_ADMIN_PASSWORD=your_admin_password
ICECAST_SOURCE_PASSWORD=your_source_password
ICECAST_RELAY_PASSWORD=your_relay_password
RADIO_MOUNT=/arborisis.mp3
RADIO_CROSSFADE=4
```

## Déploiement Railway

```bash
cd radio-server
railway login
railway link
railway up
```
