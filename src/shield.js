const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+/gi,
  /you\s+are\s+now\s+(?:a|an|the)\s+/gi,
  /new\s+system\s+prompt/gi,
  /\bsystem\s*prompt\s*:/gi,
  /IMPORTANT:\s*(?:disregard|ignore|forget)/gi,
  /forget\s+(?:everything|all|your)\s+/gi,
  /override\s+(?:your|all|the)\s+/gi,
  /\bdo\s+not\s+follow\s+(?:your|the|any)\s+(?:rules|instructions|guidelines)/gi,
  /\bact\s+as\s+(?:if|though)\s+you\s+(?:have|had)\s+no\s+(?:rules|restrictions)/gi,
  /\bjailbreak/gi,
  /\bDAN\s+mode/gi,
];

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;

function fullwidthToAscii(text) {
  return text.replace(/[\uFF01-\uFF5E]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).replace(/\u3000/g, ' ');
}

function normalizeForScan(text) {
  let cleaned = text.normalize('NFKC');
  cleaned = cleaned.replace(ZERO_WIDTH_RE, '');
  cleaned = fullwidthToAscii(cleaned);
  return cleaned;
}

class InjectionShield {
  constructor() {
    this.blocked = 0;
  }

  scan(text) {
    if (!text || typeof text !== 'string') return text;

    const normalized = normalizeForScan(text);
    let cleaned = normalized;
    for (const pattern of INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      cleaned = cleaned.replace(pattern, '[BLOCKED_INJECTION]');
    }

    if (cleaned !== normalized) {
      this.blocked++;
    }
    return cleaned;
  }

  getStats() {
    return `Shield blocked ${this.blocked} injection attempt(s) this session.`;
  }
}

module.exports = new InjectionShield();
module.exports.normalizeForScan = normalizeForScan;
