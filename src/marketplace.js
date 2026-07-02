const compressor = require('./compress');
const stats = require('./stats');

let app = null;

function startMarketplace(port = 3000) {
  const express = require('express');
  app = express();
  app.use(express.json());

  const API_KEYS = new Set(['demo-key-123']);

  function authMiddleware(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || !API_KEYS.has(key)) {
      return res.status(401).json({ error: 'Invalid or missing API key' });
    }
    next();
  }

  // Bug #2, #12 fix: make handler async and await compressText
  app.post('/api/compress', authMiddleware, async (req, res) => {
    const { text, mode } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text field' });

    if (mode) compressor.setMode(mode);
    const compressed = await compressor.compressText(text);

    res.json({
      compressed,
      stats: {
        originalLength: text.length,
        compressedLength: compressed.length,
        savedPercent: ((1 - compressed.length / text.length) * 100).toFixed(1) + '%'
      }
    });
  });

  app.get('/api/stats', authMiddleware, (req, res) => {
    res.json({
      session: stats.getSessionRatio() + '% savings',
      lifetime: stats.getStats()
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });

  app.listen(port, () => {
    console.error(`TokeSave Marketplace API running on http://localhost:${port}`);
  });
}

module.exports = { startMarketplace };
