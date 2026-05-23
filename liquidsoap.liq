#!/usr/bin/env liquidsoap

# Configuration
set("init.daemon", false)
set("log.stdout", true)
set("log.level", 3)

# Port et mount
port = 8000
mount = "/arborisis.mp3"

# Playlist par défaut
radio = playlist(mode="normal", "/var/lib/liquidsoap/music/default.m3u")

# Fallback sur silence si playlist vide
radio = mksafe(radio)

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
