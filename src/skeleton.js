// Creates a structural skeleton of code files (Lossless structure compression)

class ASTSkeletonProxy {
  constructor() {
    this.enabled = false;
  }

  enable() {
    this.enabled = true;
    console.error("AST Skeleton Proxy Enabled.");
  }

  isCodeFile(filename) {
    if (!filename) return false;
    return /\.(js|py|ts|java|c|cpp|go|rs)$/i.test(filename);
  }

  createSkeleton(code, filename) {
    if (!this.enabled || !code || code.length < 1000) return code;
    
    // Very naive regex based "AST" extraction for JS/TS/Python
    const lines = code.split('\n');
    const skeleton = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match class, def, function, const x = () =>
      if (/^\s*(class|def|function|async function)\s+\w+/.test(line) || 
          /^\s*(const|let|var)\s+\w+\s*=\s*(\([^)]*\)|[^=]+)\s*=>/.test(line) ||
          /^\s*\w+\s*\([^)]*\)\s*\{/.test(line)) {
        skeleton.push(line);
        if (line.includes('{') && !line.includes('}')) {
          skeleton.push('  // ...');
        }
      }
      // Also keep imports
      else if (/^\s*(import|export|from|require)/.test(line)) {
        skeleton.push(line);
      }
    }

    if (skeleton.length < 5) return code; // Failed to parse meaningfully

    return `[AST SKELETON PROXY: ${filename}]\n` + skeleton.join('\n') + `\n\n[NOTE: Full code is hidden. Use 'read_function_body' tool to read specific lines if needed.]`;
  }

  // Sniper Mode: Extracts only the specified function body
  // NOTE: Does NOT require skeleton to be enabled — sniper mode is always available
  extractFunction(code, filename, functionName) {
    if (!code) return `File is empty.`;
    
    const lines = code.split('\n');
    let inFunction = false;
    let braceCount = 0;
    const extracted = [];

    // Very naive extraction: find function name, then balance braces
    const startRegex = new RegExp(`^\\s*(?:(?:export\\s+|async\\s+)?(?:function|class|def|const|let|var)\\s+)?${functionName}\\s*[=(]`);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inFunction) {
        if (startRegex.test(line)) {
          inFunction = true;
          extracted.push(line);
          braceCount += (line.match(/\{/g) || []).length;
          braceCount -= (line.match(/\}/g) || []).length;
          
          if (braceCount === 0 && line.includes('{') && line.includes('}')) {
             return `[SNIPER MODE: ${filename} -> ${functionName}]\n${extracted.join('\n')}`;
          }
        }
      } else {
        extracted.push(line);
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;
        
        if (braceCount <= 0) {
          break; // Function ended
        }
      }
    }

    if (extracted.length === 0) {
      return `[SNIPER ERROR] Function '${functionName}' not found in ${filename}.`;
    }

    return `[SNIPER MODE: ${filename} -> ${functionName}]\n${extracted.join('\n')}`;
  }
}

module.exports = new ASTSkeletonProxy();
