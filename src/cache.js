const crypto = require('crypto');
const { createClient } = require('redis');

const MAX_LOCAL_CACHE = 100; // Bug #14 fix: LRU limit

class CacheLayer {
  constructor() {
    this.localCache = new Map();
    this.redisClient = null;
    this.useRedis = false;
    this.pendingRequests = new Map(); // Bug #3 fix: was missing
  }

  async connectRedis(url) {
    if (!url) return;
    try {
      this.redisClient = createClient({ url });
      this.redisClient.on('error', (err) => console.error('Redis Client Error', err));
      await this.redisClient.connect();
      this.useRedis = true;
      console.error("TokeSave connected to Hive-Mind Global Cache (Redis).");
    } catch (e) {
      console.error("Failed to connect to Redis:", e.message);
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
        // Fallback to local on error
      }
    }
    return this.localCache.get(hash);
  }

  async set(hash, response) {
    if (this.useRedis) {
      try {
        // Expire in 24 hours
        await this.redisClient.set(hash, JSON.stringify(response), { EX: 86400 });
        return;
      } catch (e) {
        // Fallback
      }
    }
    // Bug #14 fix: evict oldest if over limit
    if (this.localCache.size >= MAX_LOCAL_CACHE) {
      const oldestKey = this.localCache.keys().next().value;
      this.localCache.delete(oldestKey);
    }
    this.localCache.set(hash, response);
  }
}

module.exports = new CacheLayer();
