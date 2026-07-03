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

class InjectionShield {
  constructor() {
    this.blocked = 0;
  }

  scan(text) {
    if (!text || typeof text !== 'string') return text;

    let cleaned = text;
    for (const pattern of INJECTION_PATTERNS) {
      cleaned = cleaned.replace(pattern, '[BLOCKED_INJECTION]');
    }

    if (cleaned !== text) {
      this.blocked++;
    }
    return cleaned;
  }

  getStats() {
    return `Shield blocked ${this.blocked} injection attempt(s) this session.`;
  }
}

module.exports = new InjectionShield();
