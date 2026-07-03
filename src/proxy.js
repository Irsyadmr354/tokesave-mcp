const { spawn } = require('child_process');
const { Transform } = require('stream');
const compressor = require('./compress');
const cache = require('./cache');
const shield = require('./shield');
const dedup = require('./dedup');
const { estimateTokens } = require('./tokens');

const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_WRITES = 32;
const MIN_ARG_LENGTH = 200;

const upstreamStats = new Map();

function getUpstreamStats(name) {
  if (!upstreamStats.has(name)) {
    upstreamStats.set(name, { requests: 0, responseTokensSaved: 0, requestTokensSaved: 0 });
  }
  return upstreamStats.get(name);
}

function getAllUpstreamStats() {
  const out = {};
  for (const [name, s] of upstreamStats) {
    out[name] = { ...s };
  }
  return out;
}

function startProxy(upstreamCmd, upstreamArgs, options = {}) {
  const upstreamName = options.name || `${upstreamCmd}:${upstreamArgs.join(' ')}`;
  console.error(`[TokeSave Proxy] Wrapping: ${upstreamCmd} ${upstreamArgs.join(' ')}`);

  const isWin = process.platform === 'win32';
  let upstreamCrashed = false;

  const upstream = spawn(upstreamCmd, upstreamArgs, {
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: isWin,
  });

  function sendMcpError(id, message) {
    const errMsg = {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32000, message: `[TokeSave Proxy] Upstream error: ${message}` },
    };
    process.stdout.write(JSON.stringify(errMsg) + '\n');
  }

  upstream.on('error', err => {
    upstreamCrashed = true;
    process.stderr.write(`[TokeSave Proxy] Failed to spawn upstream: ${err.message}\n`);
    sendMcpError(null, err.message);
    setTimeout(() => process.exit(1), 100);
  });

  upstream.stdin.on('error', () => {});

  upstream.on('exit', (code, signal) => {
    upstreamCrashed = true;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    process.stderr.write(`[TokeSave Proxy] Upstream exited (${reason})\n`);
    sendMcpError(null, `Upstream process terminated (${reason})`);
    setTimeout(() => {
      if (signal) process.exit(128 + (signal === 'SIGKILL' ? 9 : signal === 'SIGTERM' ? 15 : 1));
      else process.exit(code ?? 1);
    }, 100);
  });

  class JSONLinesTransform extends Transform {
    constructor(isUpstreamOutput) {
      super({ highWaterMark: 64 * 1024 });
      this.buf = '';
      this.isUpstreamOutput = isUpstreamOutput;
      this.pendingWrites = 0;
      this.paused = false;
    }

    _maybePause() {
      if (this.pendingWrites >= MAX_PENDING_WRITES && !this.paused) {
        this.paused = true;
        if (this.isUpstreamOutput) upstream.stdout.pause();
        else process.stdin.pause();
      }
    }

    _maybeResume() {
      if (this.pendingWrites < MAX_PENDING_WRITES / 2 && this.paused) {
        this.paused = false;
        if (this.isUpstreamOutput) upstream.stdout.resume();
        else process.stdin.resume();
      }
    }

    _transform(chunk, _enc, cb) {
      this.buf += chunk.toString();

      if (this.buf.length > MAX_BUFFER_BYTES) {
        process.stderr.write('[TokeSave Proxy] Buffer overflow — dropping partial buffer\n');
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

      this.pendingWrites += lines.length;
      this._maybePause();

      const process_ = async () => {
        for (const line of lines) {
          try {
            if (upstreamCrashed) {
              try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined) sendMcpError(msg.id, 'Upstream unavailable');
              } catch (_) {}
              continue;
            }
            if (this.isUpstreamOutput) await this._handleUpstream(line);
            else await this._handleDownstream(line);
          } catch (err) {
            process.stderr.write(`[TokeSave Proxy] Line error: ${err.message}\n`);
          } finally {
            this.pendingWrites--;
            this._maybeResume();
          }
        }
      };
      process_().then(() => cb()).catch(cb);
    }

    _flush(cb) {
      if (this.buf.trim() && !upstreamCrashed) {
        const target = this.isUpstreamOutput ? process.stdout : upstream.stdin;
        target.write(this.buf + '\n');
      }
      cb();
    }

    async _handleDownstream(line) {
      if (!line.trim()) {
        if (!upstreamCrashed) upstream.stdin.write('\n');
        return;
      }
      let outLine = line;
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

        await compressRequestArguments(msg, upstreamName);
        outLine = JSON.stringify(msg);
      } catch (_) {}

      if (!upstreamCrashed && upstream.stdin.writable) {
        upstream.stdin.write(outLine + '\n');
      }
    }

    async _handleUpstream(line) {
      if (!line.trim()) { process.stdout.write('\n'); return; }
      try {
        const msg = JSON.parse(line);
        await processMessage(msg, upstreamName);
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

  async function compressRequestArguments(msg, name) {
    if (msg.method !== 'tools/call' || !msg.params?.arguments) return;
    const stats = getUpstreamStats(name);
    stats.requests++;

    const args = msg.params.arguments;
    for (const [key, val] of Object.entries(args)) {
      if (typeof val !== 'string' || val.length < MIN_ARG_LENGTH) continue;
      const origTokens = estimateTokens(val);
      const compressed = await compressor.compressText(val);
      const saved = origTokens - estimateTokens(compressed);
      if (saved > 0) {
        args[key] = compressed;
        stats.requestTokensSaved += saved;
      }
    }
  }

  async function processMessage(msg, name) {
    if (!msg?.result || msg.id === undefined) return;
    const stats = getUpstreamStats(name);
    const result = msg.result;

    if (result.tools) {
      await compressList(result.tools, ['description']);
      for (const tool of result.tools) {
        if (tool.inputSchema?.properties) {
          for (const prop of Object.values(tool.inputSchema.properties)) {
            if (prop.description?.length > 80) {
              const orig = prop.description;
              prop.description = await compressor.compressText(prop.description);
              stats.responseTokensSaved += estimateTokens(orig) - estimateTokens(prop.description);
            }
          }
        }
      }
    } else if (result.prompts) {
      await compressList(result.prompts, ['description'], stats);
    } else if (result.resources) {
      await compressList(result.resources, ['description', 'name'], stats);
    } else if (Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type !== 'text' || typeof item.text !== 'string') continue;
        if (item.text.length < 200) continue;

        const origTokens = estimateTokens(item.text);
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
        stats.responseTokensSaved += Math.max(0, origTokens - estimateTokens(item.text));
      }
    }
  }

  async function compressList(items, fields, stats) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      for (const f of fields) {
        if (item[f]?.length > 60) {
          const orig = item[f];
          item[f] = await compressor.compressText(item[f]);
          if (stats) stats.responseTokensSaved += estimateTokens(orig) - estimateTokens(item[f]);
        }
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

module.exports = { startProxy, getAllUpstreamStats, getUpstreamStats };
