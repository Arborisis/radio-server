const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());

// CORS - Allow Arborisis domain
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'arborisis-radio',
        timestamp: new Date().toISOString()
    });
});

// Status JSON (compatibilité Icecast)
app.get('/status-json.xsl', (req, res) => {
    res.json({
        icestats: {
            admin: 'contact@arborisis.com',
            host: 'localhost',
            location: 'Arborisis Radio',
            server_id: 'Arborisis Radio Server',
            server_start: new Date().toISOString(),
            server_start_iso8601: new Date().toISOString(),
            dummy: null
        }
    });
});

// Stream principal
app.get('/arborisis.mp3', (req, res) => {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('icy-name', 'Arborisis Radio');
    res.setHeader('icy-genre', 'Nature, Ambient');
    res.setHeader('icy-br', '128');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'close');
    
    // Pour l'instant, renvoyer un stream silence ou un fichier audio
    // En production, ceci serait connecté à Liquidsoap ou un vrai stream
    res.status(200).send('Stream placeholder - Radio server running');
});

// Admin endpoint
app.get('/admin', (req, res) => {
    res.json({
        status: 'running',
        mount: '/arborisis.mp3',
        listeners: 0,
        uptime: process.uptime()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
    console.log(`[Radio] Server running on port ${PORT}`);
    console.log(`[Radio] Stream: http://localhost:${PORT}/arborisis.mp3`);
    console.log(`[Radio] Health: http://localhost:${PORT}/health`);
});
