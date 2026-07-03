let abbreviations = require('./abbreviations');
const stats = require('./stats');
const { compressMultiLang } = require('./lang');
const adaptive = require('./adaptive');
const golf = require('./golf');
const memory = require('./memory');
const distill = require('./distill');
const skeleton = require('./skeleton');
const vision = require('./vision');
const jsonShredder = require('./json_shredder');
const truncator = require('./truncator');
const htmlShredder = require('./html_shredder');
const gitOptimizer = require('./git_optimizer');
const cache = require('./cache');
const crypto = require('crypto');
const { estimateTokens } = require('./tokens');

// Protected patterns: content that MUST survive all transforms unchanged
const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,          // fenced code blocks
  /`[^`\n]+`/g,               // inline code
  /\[[^\]]+\]\([^)]+\)/g,     // Markdown links [text](url)
  /\bhttps?:\/\/\S+/gi,       // URLs
];

class Compressor {
  constructor() {
    this.mode = 'aggressive';
    this.abbreviations = JSON.parse(JSON.stringify(abbreviations));
    this.redactPII = false;
    this.totalInputTokens = 0;
  }

  // Consistent hash: full content SHA-256, not 500-char slice
  _cacheKey(input, context) {
    const contentHash = crypto.createHash('sha256')
      .update(typeof input === 'string' ? input : context)
      .digest('hex');
    return cache.generateHash('compress_v2', { h: contentHash, ctx: context });
  }

  async checkCache(input, context) {
    const hash = this._cacheKey(input, context);
    const cached = await cache.get(hash);
    if (cached) stats.recordCacheHit();
    return cached || null;
  }

  async storeCache(input, context, output) {
    const hash = this._cacheKey(input, context);
    await cache.set(hash, output);
  }

  setRedactPII(enabled) { this.redactPII = enabled; }

  loadCustomAbbreviations(custom, brutalCustom) {
    if (custom) Object.assign(this.abbreviations, custom);
    if (brutalCustom) {
      this.abbreviations.brutal_replacements = this.abbreviations.brutal_replacements || {};
      Object.assign(this.abbreviations.brutal_replacements, brutalCustom);
    }
  }

  setMode(mode) {
    const validModes = ['lite', 'standard', 'aggressive', 'brutal', 'oblivion'];
    if (validModes.includes(mode)) {
      this.mode = mode;
      return `Mode set: ${mode}`;
    }
    return `Invalid mode. Use: ${validModes.join(', ')}`;
  }

  extractProtectedBlocks(text) {
    const blocks = [];
    let idx = 0;
    let result = text;
    for (const pattern of PROTECTED_PATTERNS) {
      pattern.lastIndex = 0; // reset stateful regex
      result = result.replace(pattern, (match) => {
        const ph = `\x00PROT${idx}\x00`;
        blocks[idx] = match;
        idx++;
        return ph;
      });
    }
    return { modifiedText: result, blocks };
  }

  restoreProtectedBlocks(text, blocks) {
    let restored = text;
    for (let i = blocks.length - 1; i >= 0; i--) {
      restored = restored.replace(`\x00PROT${i}\x00`, () => blocks[i]);
    }
    return restored;
  }

  stripCodeComments(text) {
    return text.replace(/```[\s\S]*?```/g, (match) => {
      let s = match.replace(/^[ \t]*\/\/[^\n]*\n/gm, '');
      s = s.replace(/^[ \t]*#[^\n]*\n/gm, '');
      s = s.replace(/^[ \t]*\n/gm, '');
      return s;
    });
  }

  stripCodeWhitespace(text) {
    return text.replace(/```([\w]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const lines = code.split('\n').filter(l => l.trim());
      if (!lines.length) return match;
      const minIndent = Math.min(...lines.map(l => l.match(/^(\s*)/)[1].length));
      const dedented = lines.map(l => l.slice(minIndent)).join('\n');
      return '```' + lang + '\n' + dedented.replace(/\n{3,}/g, '\n\n') + '\n```';
    });
  }

  isLikelyCode(text) {
    if (text.length < 100) return false;
    const lines = text.split('\n');
    let codeLines = 0;
    for (const line of lines) {
      if (/^\s*(function|class|const|let|var|import|export|if|for|while|return|async|await|def|public|private|static)\b/.test(line))
        codeLines++;
    }
    return (codeLines / lines.length) > 0.30;
  }

  redactData(text) {
    if (!this.redactPII) return text;
    let r = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]');
    r = r.replace(/\bsk-[a-zA-Z0-9]{32,}\b/g, '[API_KEY]');
    r = r.replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]');
    return r;
  }

  stripBase64(text) {
    return text.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, m => `[BASE64:${m.length}ch]`);
  }

  redactTokens(text) {
    let r = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]');
    r = r.replace(/\bgh[opsu]_[A-Za-z0-9]{36,}\b/g, '[GH_TOKEN]');
    r = r.replace(/\bnpm_[A-Za-z0-9]{36,}\b/g, '[NPM_TOKEN]');
    r = r.replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]');
    r = r.replace(/\b[0-9a-f]{32,}\b/gi, '[HEX]');
    return r;
  }

  compactPaths(text) {
    return text.replace(/(?:[A-Z]:\\(?:[^\\\s]+\\)+|(?:\/(?:[^\s/]+\/)+))([^\s/\\]+(?:\.[^\s\\/]+)?)/g, (match, tail) =>
      match.length > 30 ? `...${tail}` : match
    );
  }

  slimStackTrace(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if ((/^\s+at\s/.test(line) || /^\s+--- /.test(line)) && i > 0) {
        const start = i;
        let count = 0;
        while (i < lines.length && (/^\s+at\s/.test(lines[i]) || /^\s+--- /.test(lines[i]))) { count++; i++; }
        if (count >= 6) {
          for (let j = 0; j < 3; j++) result.push(lines[start + j]);
          result.push(`  [${count - 5} frames omitted]`);
          for (let j = count - 2; j < count; j++) result.push(lines[start + j]);
        } else {
          for (let j = start; j < i; j++) result.push(lines[j]);
        }
      } else { result.push(line); i++; }
    }
    return result.join('\n');
  }

  stripSeparators(text) {
    return text.replace(/([=\-*_]){3,}(?:\s*\1{3,}){2,}/g, '$1$1$1\n[$1 lines collapsed]');
  }

  // IMPROVEMENT B: smarter whitespace-only dedup — skip compression for trivially short results
  _isWorthCompressing(text) {
    return text && text.length >= 50;
  }

  async compressText(text, filename) {
    if (!this._isWorthCompressing(text)) return text || '';
    this.totalInputTokens += estimateTokens(text);

    // Phase 1: PII redaction first
    let w = this.redactData(text);

    // Phase 2: format-specific shredders
    w = truncator.truncate(w);
    w = htmlShredder.shred(w);
    w = gitOptimizer.optimize(w);
    try { w = await vision.shrink(w); } catch (_) {}
    w = jsonShredder.shred(w);

    // Phase 3: extract protected blocks BEFORE any token/path transforms
    const { modifiedText, blocks } = this.extractProtectedBlocks(w);
    let result = modifiedText;

    // Phase 4: safe transforms on unprotected text only
    result = this.stripBase64(result);
    result = this.redactTokens(result);
    result = this.compactPaths(result);

    // Phase 5: structural compression
    result = this.stripCodeComments(result);
    result = this.stripCodeWhitespace(result);

    const isCode = (filename && skeleton.isCodeFile(filename)) || this.isLikelyCode(result);
    if (isCode) {
      if (filename && skeleton.isCodeFile(filename)) result = skeleton.createSkeleton(result, filename);
    } else {
      try { result = distill.extract(result); } catch (_) {}
    }

    // Phase 6: raw code indent reduction
    if (isCode && !text.includes('```')) {
      result = result
        .replace(/^[ \t]+/gm, m => ' '.repeat(Math.floor(m.length / 2)))
        .replace(/\n{3,}/g, '\n\n');
    }

    // Phase 7: stack slim + separator collapse
    result = this.slimStackTrace(result);
    result = this.stripSeparators(result);

    // Phase 8: golf (runs on unprotected text — placeholders won't parse as JS)
    result = await golf.minifyCode(result);

    // Phase 9: vector memory (fire-and-forget)
    if (memory.enabled) memory.store(result).catch(() => {});

    // Phase 10: lexical passes
    result = result.replace(/\b(?:just|really|basically|actually|simply|quite|very|essentially|literally)\b/gi, '');
    result = result.replace(/\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to|i'?d be happy)\b[,.]?\s*/gi, '');
    if (this.mode !== 'lite') {
      result = result.replace(/\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion|it seems|it appears)\b\s*/gi, '');
      result = result.replace(/^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s)\s+/gim, '');
      result = result.replace(/\b(?:a|an|the)\s+(?=[a-z])/gi, '');
    }
    if (['aggressive', 'brutal', 'oblivion'].includes(this.mode)) {
      for (const [word, abbr] of Object.entries(this.abbreviations)) {
        if (word === 'brutal_replacements') continue;
        result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), abbr);
      }
    }
    if (['brutal', 'oblivion'].includes(this.mode)) {
      for (const [word, abbr] of Object.entries(this.abbreviations.brutal_replacements || {})) {
        result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), abbr);
      }
    }
    if (this.mode === 'oblivion') {
      result = result.replace(/\b([a-zA-Z])([a-zA-Z]{3,})\b/g, (_, f, rest) => f + rest.replace(/[aeiou]/gi, ''));
    }

    result = result.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    // Phase 11: restore protected blocks
    const restored = this.restoreProtectedBlocks(result, blocks);

    // Phase 12: multi-language pass
    const final = compressMultiLang(restored);

    // IMPROVEMENT C: only record stats + cache if compression actually helped
    stats.recordCompression(text, final);
    adaptive.evaluate(this);
    this.storeCache(text, filename || 'text', final).catch(() => {});

    return final;
  }

  // IMPROVEMENT D: expose token estimator for use by other modules
  estimateTokens(text) { return estimateTokens(text); }
}

module.exports = new Compressor();
