const { spawn } = require('child_process');
const { Transform } = require('stream');
const compressor = require('./compress');
const cache = require('./cache');
const shield = require('./shield');
const dedup = require('./dedup');
const { estimateTokens } = require('./tokens');

// IMPROVEMENT: configurable per-message buffer size limit (prevent memory bloat)
const MAX_BUFFER_BYTES = 4 * 1024 * 1024; // 4MB

function startProxy(upstreamCmd, upstreamArgs) {
  console.error(`[TokeSave Proxy] Wrapping: ${upstreamCmd} ${upstreamArgs.join(' ')}`);

  const isWin = process.platform === 'win32';
  const upstream = spawn(upstreamCmd, upstreamArgs, {
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: isWin,
  });

  upstream.on('error', err => {
    process.stderr.write(`[TokeSave Proxy] Failed to spawn upstream: ${err.message}\n`);
    process.exit(1);
  });

  upstream.on('exit', (code, signal) => {
    if (signal) process.exit(128 + (signal === 'SIGKILL' ? 9 : signal === 'SIGTERM' ? 15 : 1));
    process.exit(code ?? 0);
  });

  class JSONLinesTransform extends Transform {
    constructor(isUpstreamOutput) {
      super();
      this.buf = '';
      this.isUpstreamOutput = isUpstreamOutput;
    }

    _transform(chunk, _enc, cb) {
      this.buf += chunk.toString();

      // IMPROVEMENT: drop oversized buffers to prevent OOM
      if (this.buf.length > MAX_BUFFER_BYTES) {
        process.stderr.write('[TokeSave Proxy] Buffer overflow — flushing\n');
        this.buf = '';
        cb();
        return;
      }

      const lines = [];
      let idx;
      while ((idx = this.buf.indexOf('\n')) !== -1) {
        lines.push(this.buf.slice(0, idx));
        this.buf = this.buf.slice(idx + 1);
      }

      const process_ = async () => {
        for (const line of lines) {
          if (this.isUpstreamOutput) await this._handleUpstream(line);
          else await this._handleDownstream(line);
        }
      };
      process_().then(() => cb()).catch(cb);
    }

    _flush(cb) {
      // Flush any remaining buffered data without a trailing newline
      if (this.buf.trim()) {
        const target = this.isUpstreamOutput ? process.stdout : upstream.stdin;
        target.write(this.buf + '\n');
      }
      cb();
    }

    // Client → upstream: cache check
    async _handleDownstream(line) {
      if (!line.trim()) { upstream.stdin.write('\n'); return; }
      try {
        const msg = JSON.parse(line);
        if (msg.method && msg.params && msg.id !== undefined) {
          const hash = cache.generateHash(msg.method, msg.params);
          const hit = await cache.get(hash);
          if (hit) {
            hit.id = msg.id;
            process.stdout.write(JSON.stringify(hit) + '\n');
            return;
          }
          cache.pendingRequests.set(msg.id, hash);
        }
      } catch (_) {}
      upstream.stdin.write(line + '\n');
    }

    // Upstream → client: compress + cache store
    async _handleUpstream(line) {
      if (!line.trim()) { process.stdout.write('\n'); return; }
      try {
        const msg = JSON.parse(line);
        await processMessage(msg);
        process.stdout.write(JSON.stringify(msg) + '\n');

        if (msg.id !== undefined && msg.result) {
          const hash = cache.pendingRequests.get(msg.id);
          if (hash) { await cache.set(hash, msg); cache.pendingRequests.delete(msg.id); }
        }
      } catch (_) {
        process.stdout.write(line + '\n');
      }
    }
  }

  process.stdin.pipe(new JSONLinesTransform(false));
  upstream.stdout.pipe(new JSONLinesTransform(true));

  async function processMessage(msg) {
    if (!msg?.result || msg.id === undefined) return;
    const result = msg.result;

    if (result.tools) {
      await compressList(result.tools, ['description']);
      for (const tool of result.tools) {
        if (tool.inputSchema?.properties) {
          for (const prop of Object.values(tool.inputSchema.properties)) {
            if (prop.description?.length > 80) {
              prop.description = await compressor.compressText(prop.description);
            }
          }
        }
      }
    } else if (result.prompts) {
      await compressList(result.prompts, ['description']);
    } else if (result.resources) {
      await compressList(result.resources, ['description', 'name']);
    } else if (Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type !== 'text' || typeof item.text !== 'string') continue;
        if (item.text.length < 200) continue;

        item.text = shield.scan(item.text);

        const dup = dedup.checkDuplicate(item.text);
        if (dup) { item.text = dup; continue; }

        try {
          const parsed = JSON.parse(item.text);
          if (typeof parsed === 'object' && parsed !== null) {
            item.text = item.text.length > 3000 ? JSON.stringify(pruneJsonNoise(parsed)) : JSON.stringify(parsed);
          }
        } catch (_) {
          item.text = await compressor.compressText(item.text);
        }
      }
    }
  }

  async function compressList(items, fields) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      for (const f of fields) {
        if (item[f]?.length > 60) item[f] = await compressor.compressText(item[f]);
      }
    }
  }

  function pruneJsonNoise(obj) {
    if (Array.isArray(obj)) return obj.map(pruneJsonNoise);
    if (typeof obj !== 'object' || obj === null) return obj;
    const NOISE = new Set(['description', 'metadata', 'x-ms-original', '_links',
      'html_url', 'comments_url', 'commits_url', 'statuses_url', 'forks_url']);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!NOISE.has(k)) out[k] = pruneJsonNoise(v);
    }
    return out;
  }
}

module.exports = { startProxy };
