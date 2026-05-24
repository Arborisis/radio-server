const express = require('express');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8000;

// ── Config ────────────────────────────────────────────────────────────────
const R2_ENDPOINT = process.env.R2_ENDPOINT || process.env.RAILWAY_R2_ENDPOINT || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.RAILWAY_R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.RAILWAY_R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || process.env.RAILWAY_R2_BUCKET || 'arborisis';
const R2_REGION = process.env.R2_DEFAULT_REGION || process.env.RAILWAY_R2_DEFAULT_REGION || 'auto';
const R2_PREFIX = process.env.R2_PREFIX || '';
const R2_FILTER_PATTERN = process.env.R2_FILTER_PATTERN || '.mp3';
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10);
const ICY_METAINT = parseInt(process.env.ICY_METAINT || '8192', 10);

// ── HTTP Agents (high socket limit) ───────────────────────────────────────
const httpAgent = new http.Agent({ maxSockets: 500, keepAlive: true });
const httpsAgent = new https.Agent({ maxSockets: 500, keepAlive: true });

// ── S3 Client (Cloudflare R2) ─────────────────────────────────────────────
const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({
    httpAgent,
    httpsAgent,
  }),
});

// ── State ─────────────────────────────────────────────────────────────────
let playlist = [];
let currentTrackIndex = 0;
let isScanning = false;
let listeners = 0;
let streamStartTime = Date.now();

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────
function generateIcyMetadata(title, artist) {
  const meta = `StreamTitle='${title} - ${artist}';`;
  const length = Math.ceil(meta.length / 16);
  const padded = meta.padEnd(length * 16, '\x00');
  return Buffer.from(String.fromCharCode(length) + padded, 'binary');
}

async function scanR2() {
  if (isScanning) return;
  isScanning = true;

  try {
    const mp3Keys = [];
    let continuationToken = undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: R2_PREFIX,
        ContinuationToken: continuationToken,
      });

      const response = await s3.send(cmd);

      for (const obj of response.Contents || []) {
        if (obj.Key && obj.Key.endsWith('.mp3') && obj.Key.includes(R2_FILTER_PATTERN)) {
          mp3Keys.push({
            key: obj.Key,
            size: obj.Size,
            lastModified: obj.LastModified,
          });
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    const shuffle = process.env.RADIO_SHUFFLE === 'true';
    if (shuffle) {
      const seed = new Date().toISOString().split('T')[0];
      mp3Keys.sort((a, b) => {
        const hashA = require('crypto').createHash('md5').update(seed + a.key).digest('hex');
        const hashB = require('crypto').createHash('md5').update(seed + b.key).digest('hex');
        return hashA.localeCompare(hashB);
      });
    } else {
      mp3Keys.sort((a, b) => a.lastModified - b.lastModified);
    }

    const oldCount = playlist.length;
    playlist = mp3Keys;

    if (playlist.length !== oldCount) {
      console.log(`[Radio] Playlist updated: ${playlist.length} tracks found in R2 (${R2_PREFIX})`);
    }
  } catch (err) {
    console.error('[Radio] R2 scan failed:', err.message);
  } finally {
    isScanning = false;
  }
}

// ── Radio Broadcaster (load track to memory, broadcast at constant bitrate) ─
class RadioBroadcaster {
  constructor() {
    this.listeners = new Set();
    this.icyListeners = new Set();
    this.isRunning = false;
    this.intervalId = null;
    this.currentBuffer = null;
    this.currentOffset = 0;
  }

  addListener(res, icy = false) {
    this.listeners.add(res);
    if (icy) this.icyListeners.add(res);
    listeners++;
    console.log(`[Radio] Listener connected. Total: ${listeners}`);
    if (!this.isRunning) {
      this.start();
    }
  }

  removeListener(res) {
    if (this.listeners.has(res)) {
      this.listeners.delete(res);
      this.icyListeners.delete(res);
      listeners--;
      console.log(`[Radio] Listener disconnected. Total: ${listeners}`);
    }
  }

  async start() {
    this.isRunning = true;
    console.log('[Radio] Broadcaster started');

    while (this.isRunning && this.listeners.size > 0) {
      if (playlist.length === 0) {
        console.warn('[Radio] No tracks in playlist, waiting...');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const track = playlist[currentTrackIndex];
      await this.loadAndStreamTrack(track);
      currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
    }

    this.isRunning = false;
    console.log('[Radio] Broadcaster stopped');
  }

  async loadAndStreamTrack(track) {
    try {
      const cmd = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: track.key,
      });

      const s3res = await s3.send(cmd);

      if (!s3res.Body) {
        console.warn(`[Radio] Empty body for ${track.key}`);
        return;
      }

      // Load entire small MP3 into memory (typically ~2-3MB)
      const chunks = [];
      for await (const chunk of s3res.Body) {
        chunks.push(chunk);
      }
      this.currentBuffer = Buffer.concat(chunks);
      this.currentOffset = 0;

      const title = track.key.split('/').pop().replace(/\.mp3$/i, '').replace(/[_-]/g, ' ');
      console.log(`[Radio] Loaded track: ${title} (${this.currentBuffer.length} bytes)`);

      await this.streamBuffer(title);

    } catch (err) {
      console.error(`[Radio] Error loading track ${track.key}:`, err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  streamBuffer(title) {
    return new Promise((resolve) => {
      const chunkSize = 8192;
      const bitrate = 128 * 1024 / 8; // 128 kbps = 16384 bytes/sec
      const intervalMs = Math.round((chunkSize / bitrate) * 1000); // ~500ms

      let bytesSinceMeta = 0;

      this.intervalId = setInterval(() => {
        if (this.listeners.size === 0) {
          clearInterval(this.intervalId);
          resolve();
          return;
        }

        const end = Math.min(this.currentOffset + chunkSize, this.currentBuffer.length);
        const chunk = this.currentBuffer.slice(this.currentOffset, end);

        if (chunk.length === 0) {
          clearInterval(this.intervalId);
          console.log(`[Radio] Finished track: ${title}`);
          resolve();
          return;
        }

        // Remove destroyed listeners
        for (const listener of Array.from(this.listeners)) {
          if (listener.destroyed || listener.finished || listener.writableEnded) {
            this.removeListener(listener);
          }
        }

        // Broadcast audio chunk to all active listeners
        for (const listener of this.listeners) {
          try {
            listener.write(chunk);
          } catch (err) {
            this.removeListener(listener);
          }
        }

        // Inject ICY metadata for listeners that requested it
        if (this.icyListeners.size > 0) {
          bytesSinceMeta += chunk.length;
          if (bytesSinceMeta >= ICY_METAINT) {
            const meta = generateIcyMetadata(title, 'Arborisis');
            for (const listener of this.icyListeners) {
              if (!listener.destroyed && !listener.finished) {
                try {
                  listener.write(meta);
                } catch (err) {
                  this.removeListener(listener);
                }
              }
            }
            bytesSinceMeta = 0;
          }
        }

        this.currentOffset = end;

      }, intervalMs);
    });
  }
}

const broadcaster = new RadioBroadcaster();

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'arborisis-radio',
    playlist_size: playlist.length,
    listeners,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── Status JSON (compatibilité Icecast) ───────────────────────────────────
app.get('/status-json.xsl', (req, res) => {
  const nowPlaying = playlist[currentTrackIndex];
  res.json({
    icestats: {
      admin: 'contact@arborisis.com',
      host: 'localhost',
      location: 'Arborisis Radio',
      server_id: 'Arborisis Radio Server',
      server_start: new Date(streamStartTime).toISOString(),
      server_start_iso8601: new Date(streamStartTime).toISOString(),
      source: {
        mount: '/arborisis.mp3',
        listeners,
        listener_peak: listeners,
        audio_info: 'ice-bitrate=128;ice-channels=2;ice-samplerate=44100',
        title: nowPlaying ? nowPlaying.key.split('/').pop().replace(/\.mp3$/i, '') : 'Arborisis Radio',
      },
    },
  });
});

// ── Admin endpoint ────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.json({
    status: 'running',
    mount: '/arborisis.mp3',
    listeners,
    playlist_size: playlist.length,
    current_track: currentTrackIndex,
    uptime: process.uptime(),
  });
});

// ── Playlist endpoint ─────────────────────────────────────────────────────
app.get('/playlist', (req, res) => {
  res.json({
    tracks: playlist.map((t, i) => ({
      index: i,
      key: t.key,
      size: t.size,
      last_modified: t.lastModified,
      title: t.key.split('/').pop().replace(/\.mp3$/i, '').replace(/[_-]/g, ' '),
    })),
    current_index: currentTrackIndex,
  });
});

// ── Force rescan endpoint ─────────────────────────────────────────────────
app.post('/rescan', (req, res) => {
  scanR2();
  res.json({ status: 'scanning', playlist_size: playlist.length });
});

// ── Stream principal ──────────────────────────────────────────────────────
app.get('/arborisis.mp3', (req, res) => {
  const icyRequested = req.headers['icy-metadata'] === '1';

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('icy-name', 'Arborisis Radio');
  res.setHeader('icy-genre', 'Nature, Ambient');
  res.setHeader('icy-br', '128');
  res.setHeader('icy-url', 'https://arborisis.com');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'close');

  if (icyRequested) {
    res.setHeader('icy-metaint', String(ICY_METAINT));
  }

  broadcaster.addListener(res, icyRequested);

  req.on('close', () => {
    broadcaster.removeListener(res);
    if (!res.destroyed) {
      try { res.end(); } catch (_) {}
    }
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Radio] Server running on port ${PORT}`);
  console.log(`[Radio] Stream: http://localhost:${PORT}/arborisis.mp3`);
  console.log(`[Radio] Health: http://localhost:${PORT}/health`);
  console.log(`[Radio] R2 Bucket: ${R2_BUCKET}, Prefix: ${R2_PREFIX}`);

  // Initial scan
  scanR2();

  // Periodic scan for new tracks
  setInterval(scanR2, SCAN_INTERVAL_MS);
});
