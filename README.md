# Arborisis Radio Server

Serveur de streaming radio autonome qui scanne automatiquement les MP3 dans Cloudflare R2 et les diffuse en continu.

## Fonctionnalités

- **Scan auto R2** : Découverte automatique des MP3 dans le bucket R2 toutes les 60 secondes (configurable)
- **Streaming continu** : Lecture en boucle des MP3 trouvés
- **Métadonnées ICY** : Compatible avec les lecteurs audio (titre, artiste)
- **Compatibilité Icecast** : Endpoints `/status-json.xsl` et `/admin`
- **Playlist dynamique** : Mise à jour à chaud sans redémarrage

## Variables d'environnement

```env
# Obligatoires - R2
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET=arborisis

# Optionnelles
R2_PREFIX=                    # Préfixe pour filtrer (ex: "sounds/" ou laisser vide)
R2_FILTER_PATTERN=.mp3        # Filtre: ".mp3" pour tous, "_radio.mp3" pour les traités
SCAN_INTERVAL_MS=60000        # Intervalle de scan (ms)
ICY_METAINT=8192             # Intervalle métadonnées ICY
RADIO_SHUFFLE=true           # Mélanger la playlist (déterministe par jour)
PORT=8000
```

## Endpoints

- `GET /arborisis.mp3` - Stream principal (audio/mpeg)
- `GET /health` - Health check + taille playlist
- `GET /status-json.xsl` - Stats compatibilité Icecast
- `GET /admin` - Stats admin
- `GET /playlist` - Liste des tracks découvertes
- `POST /rescan` - Forcer un rescan immédiat

## Déploiement Railway

```bash
cd radio-server
railway login
railway link
railway up
```

## Développement local

```bash
npm install
cp .env.example .env  # Éditer avec vos credentials R2
npm start
```

## Architecture

```
R2 Bucket (arborisis)
  └── sounds/preview/7/preview.mp3
  └── sounds/preview/8/preview.mp3
  └── sounds/original/1/xxx_radio.mp3  <-- MP3 traités pour radio

Radio Server
  └── Scan auto toutes les 60s
  └── Playlist dynamique
  └── Stream /arborisis.mp3 (ICY metadata)
```

## Intégration avec Laravel

Dans `.env` Laravel :
```env
RADIO_PUBLIC_STREAM_URL=https://radio-server-production-xxxxx.up.railway.app/arborisis.mp3
```

Ou utiliser le streaming interne Laravel (`/radio/stream`) comme fallback.
