const fs = require('fs');
const path = require('path');

class StatsTracker {
  constructor() {
    this.sessionOriginalTokens = 0;
    this.sessionCompressedTokens = 0;
    this.cacheHits = 0;
    this.dedupHits = 0;
    this.charToTokenRatio = 4;
    this.statsFilePath = path.join(__dirname, '..', '.tokesave-stats.json');
    this.writeCounter = 0;
    this.loadLifetimeStats();
  }

  loadLifetimeStats() {
    try {
      if (fs.existsSync(this.statsFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.statsFilePath, 'utf8'));
        this.lifetimeOriginalTokens = data.original || 0;
        this.lifetimeCompressedTokens = data.compressed || 0;
      } else {
        this.lifetimeOriginalTokens = 0;
        this.lifetimeCompressedTokens = 0;
      }
    } catch (e) {
      this.lifetimeOriginalTokens = 0;
      this.lifetimeCompressedTokens = 0;
    }
  }

  saveLifetimeStats() {
    try {
      fs.writeFileSync(this.statsFilePath, JSON.stringify({
        original: this.lifetimeOriginalTokens,
        compressed: this.lifetimeCompressedTokens
      }));
    } catch (e) {
      // Ignore errors saving stats
    }
  }

  recordCompression(originalText, compressedText) {
    const originalTokens = Math.ceil(originalText.length / this.charToTokenRatio);
    const compressedTokens = Math.ceil(compressedText.length / this.charToTokenRatio);
    
    this.sessionOriginalTokens += originalTokens;
    this.sessionCompressedTokens += compressedTokens;
    
    this.lifetimeOriginalTokens += originalTokens;
    this.lifetimeCompressedTokens += compressedTokens;
    
    // Bug #17 fix: only write to disk every 10 compressions
    this.writeCounter++;
    if (this.writeCounter % 10 === 0) {
      this.saveLifetimeStats();
    }
    
    return {
      originalTokens,
      compressedTokens,
      saved: originalTokens - compressedTokens,
      ratio: ((1 - (compressedTokens / originalTokens)) * 100).toFixed(1) + '%'
    };
  }

  getSessionRatio() {
    if (this.sessionOriginalTokens === 0) return 0;
    return parseFloat(((1 - (this.sessionCompressedTokens / this.sessionOriginalTokens)) * 100).toFixed(1));
  }

  recordCacheHit() {
    this.cacheHits++;
  }

  recordDedupHit() {
    this.dedupHits++;
  }

  getStats() {
    const sessionSaved = this.sessionOriginalTokens - this.sessionCompressedTokens;
    const sessionRatio = this.sessionOriginalTokens > 0 
      ? ((1 - (this.sessionCompressedTokens / this.sessionOriginalTokens)) * 100).toFixed(1) + '%' 
      : '0%';
      
    const lifetimeSaved = this.lifetimeOriginalTokens - this.lifetimeCompressedTokens;
    const lifetimeRatio = this.lifetimeOriginalTokens > 0 
      ? ((1 - (this.lifetimeCompressedTokens / this.lifetimeOriginalTokens)) * 100).toFixed(1) + '%' 
      : '0%';

    let result = `Stats:
Session: Saved ~${sessionSaved} tokens (${sessionRatio} reduction)
Lifetime: Saved ~${lifetimeSaved} tokens (${lifetimeRatio} reduction)
Total original: ${this.lifetimeOriginalTokens} -> Compressed: ${this.lifetimeCompressedTokens}`;

    if (this.cacheHits > 0) result += `\nCache hits: ${this.cacheHits}`;
    if (this.dedupHits > 0) result += `\nDedup hits: ${this.dedupHits}`;

    return result;
  }
}

module.exports = new StatsTracker();

// Ensure lifetime stats are persisted on clean shutdown
const _statsInstance = module.exports;
process.on('exit', () => _statsInstance.saveLifetimeStats());
process.on('SIGINT', () => { _statsInstance.saveLifetimeStats(); process.exit(0); });
process.on('SIGTERM', () => { _statsInstance.saveLifetimeStats(); process.exit(0); });
