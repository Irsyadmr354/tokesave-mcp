const crypto = require('crypto');

const MAX_RESPONSE_HISTORY = 50; // Bug #13 fix: LRU limit
const MAX_FILE_HISTORY = 100;

class DedupEngine {
  constructor() {
    this.responseHistory = new Map();
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
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  checkDuplicate(text) {
    this.responseCounter++;

    // Bug #16 fix: Only compare against last MAX_RESPONSE_HISTORY entries
    for (const [id, stored] of this.responseHistory.entries()) {
      const similarity = this.jaccardSimilarity(text, stored);
      if (similarity >= this.dedupThreshold) {
        return `[DUPLICATE: ~${(similarity * 100).toFixed(0)}% similar to response #${id}]`;
      }
    }

    // Bug #13 fix: Evict oldest if over limit
    if (this.responseHistory.size >= MAX_RESPONSE_HISTORY) {
      const oldestKey = this.responseHistory.keys().next().value;
      this.responseHistory.delete(oldestKey);
    }
    this.responseHistory.set(this.responseCounter, text);
    return null;
  }

  // Diff-Only: track file reads and return diff on repeat
  trackFileRead(filePath, content) {
    const key = this.hash(filePath);
    const previous = this.fileHistory.get(key);

    // Bug #13 fix: Evict oldest file history if over limit
    if (!previous && this.fileHistory.size >= MAX_FILE_HISTORY) {
      const oldestKey = this.fileHistory.keys().next().value;
      this.fileHistory.delete(oldestKey);
    }
    this.fileHistory.set(key, content);

    if (!previous) return null;
    if (previous === content) return '[FILE UNCHANGED]';

    const oldLines = previous.split('\n');
    const newLines = content.split('\n');
    const diff = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';
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
