const express = require('express');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 8000;

// ── Config ────────────────────────────────────────────────────────────────
const R2_ENDPOINT = process.env.R2_ENDPOINT || process.env.RAILWAY_R2_ENDPOINT || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.RAILWAY_R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.RAILWAY_R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || process.env.RAILWAY_R2_BUCKET || 'arborisis';
const R2_REGION = process.env.R2_DEFAULT_REGION || process.env.RAILWAY_R2_DEFAULT_REGION || 'auto';
const R2_PREFIX = process.env.R2_PREFIX || '';
const R2_FILTER_PATTERN = process.env.R2_FILTER_PATTERN || '.mp3'; // ex: '_radio.mp3' pour filtrer les traités
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10);
const ICY_METAINT = parseInt(process.env.ICY_METAINT || '8192', 10);

// ── S3 Client (Cloudflare R2) ─────────────────────────────────────────────
const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

// ── State ─────────────────────────────────────────────────────────────────
let playlist = [];       // Array of { key, size, lastModified }
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

    // Sort by last modified (newest first) or shuffle if configured
    const shuffle = process.env.RADIO_SHUFFLE === 'true';
    if (shuffle) {
      // Deterministic shuffle based on date
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

async function streamTrack(track, res, injectIcy) {
  try {
    const cmd = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: track.key,
    });

    const s3res = await s3.send(cmd);

    if (!s3res.Body) {
      console.warn(`[Radio] Empty body for ${track.key}`);
      return 0;
    }

    const title = track.key.split('/').pop().replace(/\.mp3$/i, '').replace(/[_-]/g, ' ');
    const artist = 'Arborisis';

    let totalBytes = 0;
    let bytesSinceMeta = 0;
    const chunkSize = 8192;

    const stream = s3res.Body;
    const reader = stream instanceof Readable ? stream : Readable.from(stream);

    for await (const chunk of reader) {
      if (res.destroyed) break;

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      res.write(buffer);
      totalBytes += buffer.length;

      if (injectIcy) {
        bytesSinceMeta += buffer.length;
        if (bytesSinceMeta >= ICY_METAINT) {
          res.write(generateIcyMetadata(title, artist));
          bytesSinceMeta = 0;
        }
      }
    }

    console.log(`[Radio] Streamed: ${title} (${totalBytes} bytes)`);
    return totalBytes;
  } catch (err) {
    console.error(`[Radio] Stream error for ${track.key}:`, err.message);
    return 0;
  }
}

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
app.get('/arborisis.mp3', async (req, res) => {
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

  listeners++;
  console.log(`[Radio] Listener connected. Total: ${listeners}`);

  try {
    while (!res.destroyed) {
      if (playlist.length === 0) {
        console.warn('[Radio] No tracks in playlist, waiting...');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const track = playlist[currentTrackIndex];
      await streamTrack(track, res, icyRequested);

      currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
    }
  } catch (err) {
    console.error('[Radio] Stream loop error:', err.message);
  } finally {
    listeners--;
    console.log(`[Radio] Listener disconnected. Total: ${listeners}`);
    if (!res.destroyed) {
      try { res.end(); } catch (_) {}
    }
  }
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
