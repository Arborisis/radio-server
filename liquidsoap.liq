#!/usr/bin/env liquidsoap

# Configuration
set("init.daemon", false)
set("log.stdout", true)
set("log.level", 3)

# Port pour le stream sortant
port = 8000
mount = getenv("RADIO_MOUNT", "/arborisis.mp3")
crossfade_duration = int_of_float(getenv("RADIO_CROSSFADE", "4"))

# Playlist par défaut (silence si aucune musique)
default_playlist = playlist.safe("/var/lib/liquidsoap/music/default.m3u", reload=3600)

# Stream d'entrée depuis Laravel (live DJ)
live = input.http("http://localhost:8000/live.ogg")

# Fallback : Live > Playlist > Silence
radio = fallback(track_sensitive=false, [live, default_playlist, blank(duration=2.)])

# Crossfade
radio = crossfade(duration=crossfade_duration, radio)

# Normalisation du volume
radio = normalize(radio)

# Output vers Icecast
output.icecast(
    %mp3(bitrate=128, samplerate=44100),
    host="localhost",
    port=port,
    password=getenv("ICECAST_SOURCE_PASSWORD", "source"),
    mount=mount,
    name="Arborisis Radio",
    description="Radio nature et sons de la forêt",
    genre="Nature, Ambient",
    url="https://arborisis.com",
    radio
)

# Output fallback (fichier silence)
output.icecast(
    %mp3(bitrate=128, samplerate=44100),
    host="localhost",
    port=port,
    password=getenv("ICECAST_SOURCE_PASSWORD", "source"),
    mount="/fallback.mp3",
    name="Arborisis Radio Fallback",
    description="Fallback stream",
    genre="Nature, Ambient",
    blank(duration=60.)
)
