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

// Protected patterns: preserve things that MUST not be altered
// Deliberately minimal — over-protecting prevents all compression
const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,          // fenced code blocks (content handled separately)
  /`[^`\n]+`/g,               // inline code
  /\[[^\]]+\]\([^)]+\)/g,     // Markdown links [text](url)
  /\bhttps?:\/\/\S+/gi,       // URLs
];

class Compressor {
  constructor() {
    this.mode = 'aggressive'; // Default mode — best savings/safety balance
    this.abbreviations = JSON.parse(JSON.stringify(abbreviations));
    this.redactPII = false;
    this.totalInputTokens = 0; // Bug #6 fix
  }

  async checkCache(input, key) {
    const hash = cache.generateHash("compress", { text: typeof input === "string" ? input.slice(0, 500) : key, key });
    const cached = await cache.get(hash);
    if (cached) {
      stats.recordCacheHit();
    }
    return cached || null;
  }

  async storeCache(input, output) {
    const hash = cache.generateHash("compress", { text: typeof input === "string" ? input.slice(0, 500) : "file", key: "output" });
    await cache.set(hash, output);
  }

  setRedactPII(enabled) {
    this.redactPII = enabled;
  }

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
    let placeholderIdx = 0;
    let modifiedText = text;

    for (const pattern of PROTECTED_PATTERNS) {
      modifiedText = modifiedText.replace(pattern, (match) => {
        const placeholder = `__TOKESAVE_PROTECTED_${placeholderIdx}__`;
        blocks[placeholderIdx] = match;
        placeholderIdx++;
        return placeholder;
      });
    }

    return { modifiedText, blocks };
  }

  restoreProtectedBlocks(text, blocks) {
    let restored = text;
    for (let i = blocks.length - 1; i >= 0; i--) {
      restored = restored.replace(`__TOKESAVE_PROTECTED_${i}__`, () => blocks[i]);
    }
    return restored;
  }

  stripCodeComments(text) {
    return text.replace(/```[\s\S]*?```/g, (match) => {
      let stripped = match.replace(/^[ \t]*\/\/[^\n]*\n/gm, '');
      stripped = stripped.replace(/^[ \t]*#[^\n]*\n/gm, '');
      stripped = stripped.replace(/^[ \t]*\n/gm, '');
      return stripped;
    });
  }

  /**
   * Strip excess whitespace/indentation from code blocks.
   * Saves 10-25% on heavily indented code without changing semantics.
   */
  stripCodeWhitespace(text) {
    return text.replace(/```([\w]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      // Detect common indent and strip it (de-indent)
      const lines = code.split('\n').filter(l => l.trim().length > 0);
      if (lines.length === 0) return match;
      const minIndent = Math.min(...lines.map(l => l.match(/^(\s*)/)[1].length));
      const dedented = lines.map(l => l.slice(minIndent)).join('\n');
      // Collapse multiple blank lines inside code to single blank
      const collapsed = dedented.replace(/\n{3,}/g, '\n\n');
      return '```' + lang + '\n' + collapsed + '\n```';
    });
  }

  /**
   * Heuristic: does this text look like raw source code (not inside fences)?
   * Used to decide whether to apply code-specific compression even without a filename.
   */
  isLikelyCode(text) {
    if (text.length < 100) return false;
    const lines = text.split('\n');
    let codeLines = 0;
    for (const line of lines) {
      if (/^\s*(function|class|const|let|var|import|export|if|for|while|return|async|await|def|public|private|static)\b/.test(line)) {
        codeLines++;
      }
    }
    // If >30% of lines are code keywords, treat as code
    return (codeLines / lines.length) > 0.30;
  }

  redactData(text) {
    if (!this.redactPII) return text;
    let redacted = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[X]');
    redacted = redacted.replace(/\bsk-[a-zA-Z0-9]{32,}\b/g, '[X]');
    redacted = redacted.replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[X]');
    return redacted;
  }

  // ------ EXTREME BUT SAFE FEATURES ------

  stripBase64(text) {
    // Long base64 strings (>=80 chars, typical base64 chars + padding)
    // These are common in tool responses (images, tokens, file dumps)
    // and useless for AI reasoning
    let stripped = text.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, (match) => {
      return `[BASE64:${match.length}chars]`;
    });
    return stripped;
  }

  redactTokens(text) {
    // UUIDs
    let r = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]');
    // GitHub tokens
    r = r.replace(/\bgh[opsu]_[A-Za-z0-9]{36,}\b/g, '[GH_TOKEN]');
    // npm tokens
    r = r.replace(/\bnpm_[A-Za-z0-9]{36,}\b/g, '[NPM_TOKEN]');
    // JWT-like tokens
    r = r.replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]');
    // Long hex strings (>=32 chars) — likely hashes/tokens
    r = r.replace(/\b[0-9a-f]{32,}\b/gi, '[HEX]');
    return r;
  }

  compactPaths(text) {
    // Windows & Unix paths with drive/project prefix → keep only tail
    return text.replace(/(?:[A-Z]:\\(?:[^\\\s]+\\)+|(?:\/(?:[^\s\/]+\/)+))([^\s\/\\]+(?:\.[^\s\\\/]+)?)/g, (match, tail) => {
      if (match.length > 30) {
        return `...${tail}`;
      }
      return match;
    });
  }

  slimStackTrace(text) {
    const lines = text.split('\n');
    let result = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if ((/^\s+at\s/.test(line) || /^\s+--- /.test(line)) && i > 0) {
        const frameStart = i;
        let frameCount = 0;
        while (i < lines.length && (/^\s+at\s/.test(lines[i]) || /^\s+--- /.test(lines[i]))) {
          frameCount++;
          i++;
        }
        if (frameCount >= 6) {
          const keepFirst = 3;
          const keepLast = 2;
          for (let j = 0; j < keepFirst; j++) {
            result.push(lines[frameStart + j]);
          }
          result.push(`  [${frameCount - keepFirst - keepLast} stack frames omitted]`);
          for (let j = frameCount - keepLast; j < frameCount; j++) {
            result.push(lines[frameStart + j]);
          }
        } else {
          for (let j = frameStart; j < i; j++) {
            result.push(lines[j]);
          }
        }
      } else {
        result.push(line);
        i++;
      }
    }
    return result.join('\n');
  }

  stripSeparators(text) {
    // Repeated separator lines (---, ===, ***, ___)
    // Keep max 2 consecutive
    return text.replace(/([=\-*_]){3,}(?:\s*\1{3,}){2,}/g, '$1$1$1\n[$1 lines collapsed]');
  }

  async compressText(text, filename) {
    if (!text) return text;
    this.totalInputTokens += Math.ceil(text.length / 4);

    // Phase 1: Pre-processing — format-specific shredders (order matters for PII safety)
    // Redact PII FIRST before any transformation that could obscure sensitive data
    let workingText = this.redactData(text);

    // Format-specific shredders (after PII redaction)
    workingText = truncator.truncate(workingText);
    workingText = htmlShredder.shred(workingText);
    workingText = gitOptimizer.optimize(workingText);
    try { workingText = await vision.shrink(workingText); } catch (e) { /* vision non-critical */ }
    workingText = jsonShredder.shred(workingText);

    // Phase 1b: Extreme safe transforms (BEFORE protected blocks)
    // Base64, tokens, paths — strip early so they don't flood protected blocks
    workingText = this.stripBase64(workingText);
    workingText = this.redactTokens(workingText);
    workingText = this.compactPaths(workingText);

    // Phase 2: Structural compression
    // Strip code comments from fenced blocks
    workingText = this.stripCodeComments(workingText);
    // Strip excess whitespace/indentation from fenced code blocks
    workingText = this.stripCodeWhitespace(workingText);

    // Determine if content is code — either by filename or heuristic detection
    const isCode = (filename && skeleton.isCodeFile(filename)) || this.isLikelyCode(workingText);

    // Skeleton OR distill — mutually exclusive, skeleton takes priority for code files
    if (isCode) {
      if (filename && skeleton.isCodeFile(filename)) {
        workingText = skeleton.createSkeleton(workingText, filename);
      }
      // For inline code without filename: don't skeleton (no structure info),
      // but also skip distill — code sentences don't score well in TextRank
    } else {
      // TextRank distillation only for prose (non-code)
      try { workingText = distill.extract(workingText); } catch (e) { /* distill non-critical */ }
    }

    // Phase 3: Extract protected blocks BEFORE any text manipulation
    const { modifiedText, blocks } = this.extractProtectedBlocks(workingText);
    let result = modifiedText;

    // Phase 3b: For raw code (no fences), strip excess indentation + blank lines
    if (isCode && !text.includes('```')) {
      result = result
        .replace(/^[ \t]+/gm, m => {
          // Reduce indentation: keep half the spaces (round down to nearest 2)
          const spaces = Math.floor(m.length / 2);
          return ' '.repeat(spaces);
        })
        .replace(/\n{3,}/g, '\n\n');
    }

    // Phase 3c: Stack trace slimming + separator collapse
    result = this.slimStackTrace(result);
    result = this.stripSeparators(result);

    // Phase 4: Code golfing (minification) — runs AFTER protected blocks extracted
    result = await golf.minifyCode(result);

    // Phase 5: Store to vector memory (fire-and-forget)
    if (memory.enabled) memory.store(result).catch(() => {});

    // Phase 6: Lexical compression passes
    const fillers = /\b(?:just|really|basically|actually|simply|quite|very|essentially|literally)\b/gi;
    const pleasantries = /\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to|i'?d be happy)\b[,.]?\s*/gi;
    const hedges = /\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion|it seems|it appears)\b\s*/gi;
    const leaders = /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s)\s+/gim;
    
    result = result.replace(fillers, '');
    result = result.replace(pleasantries, '');

    // Hedges/leaders change epistemic meaning — only strip from 'standard' up, never in 'lite'
    if (this.mode !== 'lite') {
      result = result.replace(hedges, '');
      result = result.replace(leaders, '');
    }

    // Level 2: Standard
    if (this.mode !== 'lite') {
      const articles = /\b(?:a|an|the)\s+(?=[a-z])/gi;
      result = result.replace(articles, '');
    }

    // Level 3: Aggressive (Abbreviations)
    if (['aggressive', 'brutal', 'oblivion'].includes(this.mode)) {
      for (const [word, abbr] of Object.entries(this.abbreviations)) {
        if (word === 'brutal_replacements') continue;
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        result = result.replace(regex, abbr);
      }
    }

    // Level 4: Brutal (Extreme replacements, symbols)
    if (['brutal', 'oblivion'].includes(this.mode)) {
      for (const [word, abbr] of Object.entries(this.abbreviations.brutal_replacements || {})) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        result = result.replace(regex, abbr);
      }
    }

    // Level 5: Oblivion (Vowel removal in non-critical words)
    if (this.mode === 'oblivion') {
        result = result.replace(/\b([a-zA-Z])([a-zA-Z]{3,})\b/g, (match, first, rest) => {
            return first + rest.replace(/[aeiou]/gi, '');
        });
    }

    // Cleanup whitespace
    result = result.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    // Phase 7: Restore protected blocks
    const finalResult = this.restoreProtectedBlocks(result, blocks);

    // Phase 8: Multi-language compression pass
    const multiLangResult = compressMultiLang(finalResult);

    // Record stats against original input text (before any transformation)
    stats.recordCompression(text, multiLangResult);

    // Adaptive self-tuning
    adaptive.evaluate(this);

    // Store to cache (fire-and-forget)
    this.storeCache(text, multiLangResult).catch(() => {});

    return multiLangResult;
  }
}

module.exports = new Compressor();
