#!/usr/bin/env liquidsoap

# Configuration
set("init.daemon", false)
set("log.stdout", true)
set("log.level", 3)

# Port et mount
port = 8000
mount = "/arborisis.mp3"
crossfade_duration = 4.0

# Playlist par défaut (silence si vide)
default_playlist = playlist.safe("/var/lib/liquidsoap/music/default.m3u", reload=3600)

# Fallback
radio = fallback(track_sensitive=false, [default_playlist, blank(duration=2.)])

# Crossfade
radio = crossfade(duration=crossfade_duration, radio)

# Normalisation
radio = normalize(radio)

# Output vers Icecast
output.icecast(
    %mp3(bitrate=128, samplerate=44100),
    host="localhost",
    port=port,
    password="source123",
    mount=mount,
    name="Arborisis Radio",
    description="Radio nature et sons de la forêt",
    genre="Nature, Ambient",
    url="https://arborisis.com",
    radio
)

# Output fallback
output.icecast(
    %mp3(bitrate=128, samplerate=44100),
    host="localhost",
    port=port,
    password="source123",
    mount="/fallback.mp3",
    name="Arborisis Radio Fallback",
    description="Fallback stream",
    genre="Nature, Ambient",
    blank(duration=60.)
)
