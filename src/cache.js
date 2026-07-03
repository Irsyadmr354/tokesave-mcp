const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

let createClient;
try {
  createClient = require('redis').createClient;
} catch (_) {
  createClient = null;
}

const MAX_LOCAL_CACHE = 100;
const MAX_PERSIST_BYTES = 10 * 1024 * 1024;
const DEFAULT_CACHE_FILE = path.join(os.homedir(), '.tokesave-cache.json');

class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      this.map.delete(this.map.keys().next().value);
    }
    this.map.set(key, value);
  }

  entries() {
    return this.map.entries();
  }

  get size() { return this.map.size; }
}

class CacheLayer {
  constructor() {
    this.localCache = new LRUCache(MAX_LOCAL_CACHE);
    this.redisClient = null;
    this.useRedis = false;
    this.pendingRequests = new Map();
    this.persistEnabled = false;
    this.cacheFilePath = DEFAULT_CACHE_FILE;
  }

  enablePersistence(filePath) {
    this.persistEnabled = true;
    if (filePath) this.cacheFilePath = filePath;
    this.loadFromDisk();
  }

  loadFromDisk() {
    if (!this.persistEnabled || !fs.existsSync(this.cacheFilePath)) return;
    try {
      const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
      if (raw.length > MAX_PERSIST_BYTES) {
        console.error('[TokeSave] Cache file exceeds 10MB limit — skipping load');
        return;
      }
      const data = JSON.parse(raw);
      const entries = data.entries || [];
      for (const [key, value] of entries) {
        this.localCache.set(key, value);
      }
      console.error(`[TokeSave] Loaded ${entries.length} cache entries from disk`);
    } catch (e) {
      console.error('[TokeSave] Failed to load cache from disk:', e.message);
    }
  }

  saveToDisk() {
    if (!this.persistEnabled) return;
    try {
      const entries = [...this.localCache.entries()];
      const payload = JSON.stringify({ entries, savedAt: new Date().toISOString() });
      if (payload.length > MAX_PERSIST_BYTES) {
        const trimmed = entries.slice(-Math.floor(entries.length / 2));
        fs.writeFileSync(this.cacheFilePath, JSON.stringify({ entries: trimmed, savedAt: new Date().toISOString() }), 'utf8');
      } else {
        fs.writeFileSync(this.cacheFilePath, payload, 'utf8');
      }
    } catch (e) {
      console.error('[TokeSave] Failed to save cache to disk:', e.message);
    }
  }

  async connectRedis(url) {
    if (!url) return;
    if (!createClient) {
      console.error('[TokeSave] Redis requested but "redis" package not installed. Run: npm install redis');
      return;
    }
    try {
      this.redisClient = createClient({ url });
      this.redisClient.on('error', (err) => console.error('Redis Client Error', err));
      await this.redisClient.connect();
      this.useRedis = true;
      console.error('TokeSave connected to Redis cache.');
    } catch (e) {
      console.error('Failed to connect to Redis:', e.message);
      this.useRedis = false;
    }
  }

  generateHash(method, params) {
    const data = JSON.stringify({ method, params });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async get(hash) {
    if (this.useRedis) {
      try {
        const data = await this.redisClient.get(hash);
        if (data) return JSON.parse(data);
      } catch (_) {}
    }
    return this.localCache.get(hash) ?? null;
  }

  async set(hash, response) {
    if (this.useRedis) {
      try {
        await this.redisClient.set(hash, JSON.stringify(response), { EX: 86400 });
        return;
      } catch (_) {}
    }
    this.localCache.set(hash, response);
  }
}

const instance = new CacheLayer();
module.exports = instance;

process.on('exit', () => instance.saveToDisk());
process.on('SIGINT', () => { instance.saveToDisk(); });
process.on('SIGTERM', () => { instance.saveToDisk(); });
