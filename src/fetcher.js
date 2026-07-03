const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_REDIRECTS = 5;

/**
 * Minimal HTTP fetcher — no external dependencies.
 * BUG FIX #7: redirect loop protection via MAX_REDIRECTS counter.
 */
function fetchUrl(urlStr, timeoutMs = 10000, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (_redirectCount > MAX_REDIRECTS) {
      return reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
    }

    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${urlStr}`));
    }

    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'TokeSave-MCP/1.0 (token-saving AI middleware)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
      },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      // BUG FIX #7: follow redirects with counter
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        // Consume response body to free socket
        res.resume();
        return fetchUrl(res.headers.location, timeoutMs, _redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}: ${parsed.href}`));
      }

      // Limit response size to 2MB to prevent memory bloat
      const MAX_BYTES = 2 * 1024 * 1024;
      const chunks = [];
      let totalBytes = 0;

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          req.destroy();
          reject(new Error(`Response too large (>${MAX_BYTES} bytes)`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { fetchUrl };
