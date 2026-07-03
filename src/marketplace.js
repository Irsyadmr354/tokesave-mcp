const compressor = require('./compress');
const stats = require('./stats');

let app = null;

function startMarketplace(port = 3000) {
  // FIX #2: express is optional
  let express;
  try {
    express = require('express');
  } catch (_) {
    console.error('[TokeSave] Marketplace requires express: npm install express');
    process.exit(1);
  }
  app = express();
  app.use(express.json({ limit: '1mb' }));

  // BUG FIX #12: API keys loaded from env var, with demo-key fallback for local dev only
  const rawKeys = process.env.TOKESAVE_API_KEYS || 'demo-key-123';
  const API_KEYS = new Set(rawKeys.split(',').map(k => k.trim()).filter(Boolean));

  // BUG FIX #12: rate limiting — max 60 req/min per key
  const rateLimitMap = new Map(); // key → { count, windowStart }
  const RATE_LIMIT = 60;
  const RATE_WINDOW_MS = 60 * 1000;

  function authMiddleware(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || !API_KEYS.has(key)) {
      return res.status(401).json({ error: 'Invalid or missing API key' });
    }

    // Rate limit check
    const now = Date.now();
    const rl = rateLimitMap.get(key) || { count: 0, windowStart: now };
    if (now - rl.windowStart > RATE_WINDOW_MS) {
      rl.count = 0;
      rl.windowStart = now;
    }
    rl.count++;
    rateLimitMap.set(key, rl);

    if (rl.count > RATE_LIMIT) {
      return res.status(429).json({ error: 'Rate limit exceeded (60 req/min)' });
    }

    next();
  }

  app.post('/api/compress', authMiddleware, async (req, res) => {
    const { text, mode } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid text field' });
    }
    if (text.length > 500000) {
      return res.status(413).json({ error: 'Text too large (max 500KB)' });
    }

    const previousMode = compressor.mode;
    try {
      if (mode) compressor.setMode(mode);
      const compressed = await compressor.compressText(text);
      res.json({
        compressed,
        stats: {
          originalLength: text.length,
          compressedLength: compressed.length,
          savedPercent: ((1 - compressed.length / text.length) * 100).toFixed(1) + '%',
        },
      });
    } finally {
      // Restore mode even on error
      if (mode) compressor.setMode(previousMode);
    }
  });

  app.get('/api/stats', authMiddleware, (req, res) => {
    res.json({
      session: stats.getSessionRatio() + '% savings',
      lifetime: stats.getStats(),
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });

  app.listen(port, () => {
    console.error(`TokeSave Marketplace API running on http://localhost:${port}`);
    if (rawKeys === 'demo-key-123') {
      console.error('[WARN] Using default demo API key. Set TOKESAVE_API_KEYS env var for production.');
    }
  });
}

module.exports = { startMarketplace };
