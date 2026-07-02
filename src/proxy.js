const { spawn } = require('child_process');
const { Transform } = require('stream');
const compressor = require('./compress');
const cache = require('./cache');
const shield = require('./shield');
const dedup = require('./dedup');

function startProxy(upstreamCmd, upstreamArgs, targetFields = ['description']) {
  console.log(`Starting TokeSave Proxy for: ${upstreamCmd} ${upstreamArgs.join(' ')}`);
  
  const isWin = process.platform === 'win32';
  const spawnOpts = {
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: isWin
  };

  const upstream = spawn(upstreamCmd, upstreamArgs, spawnOpts);

  upstream.on('error', err => {
    process.stderr.write(`tokesave-proxy: failed to spawn upstream: ${err.message}\n`);
    process.exit(1);
  });

  upstream.on('exit', (code, signal) => {
    if (signal) process.exit(128 + (signal === 'SIGKILL' ? 9 : signal === 'SIGTERM' ? 15 : 1));
    process.exit(code ?? 0);
  });

  class JSONLinesTransform extends Transform {
    constructor(isStdout) {
      super();
      this.buffer = '';
      this.isStdout = isStdout;
    }
    _transform(chunk, encoding, callback) {
      this.buffer += chunk.toString();
      const pendingLines = [];
      let newlineIdx;
      while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newlineIdx);
        this.buffer = this.buffer.slice(newlineIdx + 1);
        pendingLines.push(line);
      }

      // Process all lines sequentially, then signal done to stream
      const processAll = async () => {
        for (const line of pendingLines) {
          if (this.isStdout) {
            await this.processStdoutLine(line);
          } else {
            await this.processStdinLine(line);
          }
        }
      };

      processAll().then(() => callback()).catch((err) => callback(err));
    }
    
    async processStdinLine(line) {
      try {
        if (line.trim()) {
          const msg = JSON.parse(line);
          if (msg.method && msg.params && msg.id !== undefined) {
            const hash = cache.generateHash(msg.method, msg.params);
            // Bug #11 fix: await the async cache.get()
            const cachedResponse = await cache.get(hash);
            if (cachedResponse) {
              cachedResponse.id = msg.id;
              process.stdout.write(JSON.stringify(cachedResponse) + '\n');
              return; 
            } else {
              cache.pendingRequests.set(msg.id, hash);
            }
          }
        }
      } catch (e) {}
      upstream.stdin.write(line + '\n');
    }

    async processStdoutLine(line) {
      try {
        if (line.trim()) {
          const msg = JSON.parse(line);
          await processMessage(msg);
          const out = JSON.stringify(msg) + '\n';
          process.stdout.write(out);
          
          if (msg.id !== undefined && msg.result) {
             const hash = cache.pendingRequests.get(msg.id);
             if (hash) {
               await cache.set(hash, msg);
               cache.pendingRequests.delete(msg.id);
             }
          }
        } else {
          process.stdout.write('\n');
        }
      } catch (e) {
        process.stdout.write(line + '\n');
      }
    }
  }

  process.stdin.pipe(new JSONLinesTransform(false));
  upstream.stdout.pipe(new JSONLinesTransform(true));

  async function processMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.result && typeof msg.id !== 'undefined') {
      const result = msg.result;

      // Compress tool/prompt/resource descriptions (large savings on tools/list responses)
      if (result.tools) {
        await compressList(result.tools, ['description']);
        // Also compress inputSchema descriptions nested inside properties
        for (const tool of result.tools) {
          if (tool.inputSchema?.properties) {
            for (const prop of Object.values(tool.inputSchema.properties)) {
              if (prop.description && prop.description.length > 60) {
                prop.description = await compressor.compressText(prop.description);
              }
            }
          }
        }
      }
      else if (result.prompts) await compressList(result.prompts, ['description']);
      else if (result.resources) await compressList(result.resources, ['description', 'name']);
      else if (result.content && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === 'text' && typeof item.text === 'string') {
            // Skip tiny responses — compression overhead not worth it
            if (item.text.length < 200) continue;

            // Shield: scan for prompt injections
            item.text = shield.scan(item.text);

            // Dedup: check for duplicate responses
            const dupResult = dedup.checkDuplicate(item.text);
            if (dupResult) {
              item.text = dupResult;
              continue;
            }

            try {
              const parsed = JSON.parse(item.text);
              if (typeof parsed === 'object' && parsed !== null) {
                // For large JSON, strip common noise fields and re-serialize
                if (item.text.length > 3000) {
                  const pruneNoise = (obj) => {
                    if (Array.isArray(obj)) return obj.map(pruneNoise);
                    if (typeof obj === 'object' && obj !== null) {
                      const cleaned = {};
                      for (const [k, v] of Object.entries(obj)) {
                        // Drop known bloat keys
                        if (['description', 'metadata', 'x-ms-original', '_links', 'html_url',
                             'comments_url', 'commits_url', 'statuses_url', 'forks_url'].includes(k)) continue;
                        cleaned[k] = pruneNoise(v);
                      }
                      return cleaned;
                    }
                    return obj;
                  };
                  item.text = JSON.stringify(pruneNoise(parsed));
                } else {
                  item.text = JSON.stringify(parsed);
                }
              }
            } catch (e) {
              // Not JSON — run full text compression
              item.text = await compressor.compressText(item.text);
            }
          }
        }
      }
    }
  }

  async function compressList(items, fields) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      for (const field of fields) {
        if (item[field] && typeof item[field] === 'string' && item[field].length > 60) {
          item[field] = await compressor.compressText(item[field]);
        }
      }
    }
  }
}

module.exports = { startProxy };
