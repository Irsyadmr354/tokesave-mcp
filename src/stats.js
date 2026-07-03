const fs = require('fs');
const path = require('path');
const { estimateTokens } = require('./tokens');

class StatsTracker {
  constructor() {
    this.sessionOriginalTokens = 0;
    this.sessionCompressedTokens = 0;
    this.cacheHits = 0;
    this.dedupHits = 0;
    this.statsFilePath = path.join(__dirname, '..', '.tokesave-stats.json');
    this.writeCounter = 0;
    this.lifetimeOriginalTokens = 0;
    this.lifetimeCompressedTokens = 0;
    this.loadLifetimeStats();
  }

  loadLifetimeStats() {
    try {
      if (fs.existsSync(this.statsFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.statsFilePath, 'utf8'));
        this.lifetimeOriginalTokens = data.original || 0;
        this.lifetimeCompressedTokens = data.compressed || 0;
      }
    } catch (_) {}
  }

  saveLifetimeStats() {
    try {
      fs.writeFileSync(this.statsFilePath, JSON.stringify({
        original: this.lifetimeOriginalTokens,
        compressed: this.lifetimeCompressedTokens,
      }));
    } catch (_) {}
  }

  recordCompression(originalText, compressedText) {
    // IMPROVEMENT: accurate token estimation via tokens.js (not naive /4)
    const originalTokens = estimateTokens(originalText);
    const compressedTokens = estimateTokens(compressedText);

    this.sessionOriginalTokens += originalTokens;
    this.sessionCompressedTokens += compressedTokens;
    this.lifetimeOriginalTokens += originalTokens;
    this.lifetimeCompressedTokens += compressedTokens;

    this.writeCounter++;
    if (this.writeCounter % 10 === 0) this.saveLifetimeStats();

    return {
      originalTokens,
      compressedTokens,
      saved: originalTokens - compressedTokens,
      ratio: ((1 - compressedTokens / Math.max(originalTokens, 1)) * 100).toFixed(1) + '%',
    };
  }

  getSessionRatio() {
    if (this.sessionOriginalTokens === 0) return 0;
    return parseFloat(((1 - this.sessionCompressedTokens / this.sessionOriginalTokens) * 100).toFixed(1));
  }

  recordCacheHit() { this.cacheHits++; }
  recordDedupHit() { this.dedupHits++; }

  getStats() {
    const sessionSaved = this.sessionOriginalTokens - this.sessionCompressedTokens;
    const sessionRatio = this.sessionOriginalTokens > 0
      ? ((1 - this.sessionCompressedTokens / this.sessionOriginalTokens) * 100).toFixed(1) + '%'
      : '0%';
    const lifetimeSaved = this.lifetimeOriginalTokens - this.lifetimeCompressedTokens;
    const lifetimeRatio = this.lifetimeOriginalTokens > 0
      ? ((1 - this.lifetimeCompressedTokens / this.lifetimeOriginalTokens) * 100).toFixed(1) + '%'
      : '0%';

    let result = `Stats:\nSession: Saved ~${sessionSaved} tokens (${sessionRatio} reduction)\nLifetime: Saved ~${lifetimeSaved} tokens (${lifetimeRatio} reduction)\nTotal original: ${this.lifetimeOriginalTokens} -> Compressed: ${this.lifetimeCompressedTokens}`;
    if (this.cacheHits > 0) result += `\nCache hits: ${this.cacheHits}`;
    if (this.dedupHits > 0) result += `\nDedup hits: ${this.dedupHits}`;
    return result;
  }
}

const instance = new StatsTracker();
module.exports = instance;

// Persist on clean shutdown
process.on('exit', () => instance.saveLifetimeStats());
process.on('SIGINT', () => { instance.saveLifetimeStats(); process.exit(0); });
process.on('SIGTERM', () => { instance.saveLifetimeStats(); process.exit(0); });
