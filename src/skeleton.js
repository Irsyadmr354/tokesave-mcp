/**
 * AST Skeleton — structural skeleton of code files.
 * IMPROVEMENT: more robust extraction covering class methods, TS types,
 * multi-line arrow functions, and template-literal-aware brace counting.
 */
class ASTSkeletonProxy {
  constructor() {
    this.enabled = false;
  }

  enable() {
    this.enabled = true;
    console.error('AST Skeleton Proxy Enabled.');
  }

  isCodeFile(filename) {
    if (!filename) return false;
    return /\.(js|jsx|ts|tsx|py|java|c|cpp|go|rs|rb|php|cs|swift|kt)$/i.test(filename);
  }

  createSkeleton(code, filename) {
    if (!this.enabled || !code || code.length < 500) return code;

    const lines = code.split('\n');
    const skeleton = [];

    // IMPROVEMENT: broader signature patterns
    const SIG_PATTERNS = [
      /^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*\w+/,        // function declarations
      /^\s*(export\s+)?(abstract\s+)?class\s+\w+/,                            // class declarations
      /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,           // const fn = () =>
      /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?function/,     // const fn = function
      /^\s*(public|private|protected|static|async|override)[\s\w]*\s+\w+\s*\(/, // class methods
      /^\s*\w+\s*\([^)]*\)\s*\{/,                                             // bare method(){}
      /^\s*(def|async def)\s+\w+/,                                            // Python
      /^\s*func\s+\w+/,                                                       // Go/Swift
      /^\s*(pub\s+)?(async\s+)?fn\s+\w+/,                                    // Rust
      /^\s*(interface|type|enum|namespace)\s+\w+/,                            // TS types
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isImport = /^\s*(import|export|from|require|#include|using)/.test(line);
      const isSignature = SIG_PATTERNS.some(p => p.test(line));

      if (isImport) {
        skeleton.push(line);
      } else if (isSignature) {
        skeleton.push(line);
        // Show opening brace stub if not on same line
        if (!line.includes('{') && !line.includes(':')) {
          skeleton.push('  ...');
        } else if (line.includes('{') && !line.includes('}')) {
          skeleton.push('  ...');
          skeleton.push('}');
        }
      }
    }

    if (skeleton.length < 3) return code; // extraction failed meaningfully

    return `[SKELETON: ${filename} | ${skeleton.length} signatures from ${lines.length} lines]\n` +
      skeleton.join('\n') +
      `\n[Use read_function_body or read_file_range for full impl]`;
  }

  /**
   * Extract a single function/class body by name.
   * IMPROVEMENT: template-literal-aware brace counting to avoid false balance.
   */
  extractFunction(code, filename, functionName) {
    if (!code) return `[ERROR] File is empty.`;

    const lines = code.split('\n');
    let inFunction = false;
    let braceCount = 0;
    let inTemplateLiteral = false;
    let inString = false;
    let stringChar = '';
    const extracted = [];

    // Match: function name optionally preceded by export/async/const/let/var/class/def/func/fn
    const startRe = new RegExp(
      `(?:^|\\s)(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?\\s+|class\\s+|const\\s+|let\\s+|var\\s+|def\\s+|func\\s+|fn\\s+|pub\\s+(?:async\\s+)?fn\\s+)?${escapeRe(functionName)}\\s*[=(\\{:]`,
      ''
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inFunction) {
        if (startRe.test(line)) {
          inFunction = true;
          extracted.push(line);
          // Count braces in first line, but skip strings
          const counts = countBraces(line);
          braceCount = counts.open - counts.close;
          // Single-line: class/fn with no body yet or arrow returning expression
          if (braceCount === 0 && (line.includes('=>') || line.includes('def '))) {
            break; // single-line function
          }
        }
      } else {
        extracted.push(line);
        const counts = countBraces(line);
        braceCount += counts.open - counts.close;
        if (braceCount <= 0) break;
      }
    }

    if (extracted.length === 0) {
      return `[SNIPER ERROR] '${functionName}' not found in ${filename}.\nTip: check exact name with grep_files tool.`;
    }

    return `[SNIPER: ${filename} → ${functionName} | ${extracted.length} lines]\n${extracted.join('\n')}`;
  }
}

// Count open/close braces in a line, ignoring string literals and comments
function countBraces(line) {
  let open = 0, close = 0;
  let inStr = false, strCh = '', inTemplate = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (prev === '\\') continue; // escaped char
    if (inStr) {
      if (ch === strCh) inStr = false;
    } else if (ch === '`') {
      inTemplate++;
    } else if (ch === '"' || ch === "'") {
      inStr = true; strCh = ch;
    } else if (!inTemplate) {
      if (ch === '{') open++;
      else if (ch === '}') close++;
      // Inline comment: stop counting
      if (ch === '/' && line[i + 1] === '/') break;
    }
  }
  return { open, close };
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = new ASTSkeletonProxy();
