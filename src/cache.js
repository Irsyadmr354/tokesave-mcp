const crypto = require('crypto');

// FIX #2: redis is optional — graceful fallback if not installed
let createClient;
try {
  createClient = require('redis').createClient;
} catch (_) {
  createClient = null;
}

const MAX_LOCAL_CACHE = 100;

class LRUCache {
  // BUG FIX #21: proper LRU — move entry to end on access, evict from front
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      // Evict least recently used (first entry)
      this.map.delete(this.map.keys().next().value);
    }
    this.map.set(key, value);
  }

  get size() { return this.map.size; }
}

class CacheLayer {
  constructor() {
    this.localCache = new LRUCache(MAX_LOCAL_CACHE);
    this.redisClient = null;
    this.useRedis = false;
    this.pendingRequests = new Map();
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
      } catch (e) {
        // Fallback to local on Redis error
      }
    }
    return this.localCache.get(hash) ?? null;
  }

  async set(hash, response) {
    if (this.useRedis) {
      try {
        await this.redisClient.set(hash, JSON.stringify(response), { EX: 86400 });
        return;
      } catch (e) {
        // Fallback to local
      }
    }
    this.localCache.set(hash, response);
  }
}

module.exports = new CacheLayer();
