const { minify } = require('terser');

class AutoMinifier {
  constructor() {
    this.enabled = false;
  }

  enable() {
    this.enabled = true;
    console.error('Auto-Minifier (Code-Golfing Engine) Enabled.');
  }

  async minifyCode(codeString) {
    if (!this.enabled || !codeString) return codeString;

    // Only attempt if looks like JS (has braces + keywords)
    if (!codeString.includes('{') ||
        !(codeString.includes('function') || codeString.includes('const') || codeString.includes('let'))) {
      return codeString;
    }

    try {
      const result = await minify(codeString, {
        // FIX: mangle:false — keep variable names readable for AI
        // FIX: drop_console:false — console output is meaningful context for AI
        mangle: false,
        compress: {
          passes: 1,
          dead_code: true,
          drop_console: false,   // preserve console.log — AI needs to read them
          drop_debugger: true,
          pure_getters: false,
          unsafe: false,
        },
        format: {
          comments: false,
          beautify: false,
        },
      });
      // Only return minified if actually shorter AND not mangled to unreadable
      if (result.code && result.code.length < codeString.length) {
        return result.code;
      }
    } catch (_) {
      // Not valid JS — return original
    }
    return codeString;
  }
}

module.exports = new AutoMinifier();
