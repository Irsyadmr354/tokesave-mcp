const crypto = require('crypto');

const MAX_RESPONSE_HISTORY = 50;
const MAX_FILE_HISTORY = 100;

class DedupEngine {
  constructor() {
    this.responseHistory = new Map();   // id → text
    this.responseHashes = new Map();    // hash → id (for O(1) exact dedup)
    this.fileHistory = new Map();
    this.responseCounter = 0;
    this.dedupThreshold = 0.8;
  }

  setThreshold(threshold) {
    this.dedupThreshold = threshold;
  }

  hash(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  jaccardSimilarity(a, b) {
    // BUG FIX #8: only run Jaccard if texts are reasonably short to avoid blocking event loop
    // For very long texts, fall back to hash-only comparison
    if (a.length > 50000 || b.length > 50000) return 0;
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  _evictOldest(map) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }

  checkDuplicate(text) {
    this.responseCounter++;
    const textHash = this.hash(text);

    // BUG FIX #8: O(1) exact dedup first — avoids Jaccard for identical responses
    if (this.responseHashes.has(textHash)) {
      const id = this.responseHashes.get(textHash);
      return `[DUPLICATE: exact match response #${id}]`;
    }

    // Jaccard similarity for near-duplicates (only for short-to-medium texts)
    for (const [id, stored] of this.responseHistory.entries()) {
      const similarity = this.jaccardSimilarity(text, stored);
      if (similarity >= this.dedupThreshold) {
        return `[DUPLICATE: ~${(similarity * 100).toFixed(0)}% similar to response #${id}]`;
      }
    }

    // Evict oldest if at limit
    if (this.responseHistory.size >= MAX_RESPONSE_HISTORY) {
      const oldestId = this.responseHistory.keys().next().value;
      const oldestText = this.responseHistory.get(oldestId);
      this.responseHistory.delete(oldestId);
      // Remove from hash index too
      this.responseHashes.delete(this.hash(oldestText));
    }

    this.responseHistory.set(this.responseCounter, text);
    this.responseHashes.set(textHash, this.responseCounter);
    return null;
  }

  trackFileRead(filePath, content) {
    const key = this.hash(filePath);
    const previous = this.fileHistory.get(key);

    if (!previous && this.fileHistory.size >= MAX_FILE_HISTORY) {
      this._evictOldest(this.fileHistory);
    }
    this.fileHistory.set(key, content);

    if (!previous) return null;
    if (previous === content) return '[FILE UNCHANGED]';

    const oldLines = previous.split('\n');
    const newLines = content.split('\n');
    const diff = [];
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] ?? '';
      const newLine = newLines[i] ?? '';
      if (oldLine !== newLine) {
        if (oldLines[i] !== undefined) diff.push(`- L${i + 1}: ${oldLine}`);
        if (newLines[i] !== undefined) diff.push(`+ L${i + 1}: ${newLine}`);
      }
    }

    if (diff.length === 0) return '[FILE UNCHANGED]';
    return `[DIFF-ONLY: ${diff.length} changes]\n${diff.join('\n')}`;
  }
}

module.exports = new DedupEngine();
