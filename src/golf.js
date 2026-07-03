const { minify } = require('terser');

class AutoMinifier {
  constructor() {
    this.enabled = false;
  }

  enable() {
    this.enabled = true;
    console.error("Auto-Minifier (Code-Golfing Engine) Enabled.");
  }

  async minifyCode(codeString) {
    if (!this.enabled || !codeString) return codeString;
    
    // Naive check if it looks like JS/JSON code (has braces and keywords)
    if (codeString.includes('{') && (codeString.includes('function') || codeString.includes('const') || codeString.includes('let'))) {
      try {
        const result = await minify(codeString, {
          mangle: true,
          compress: {
            passes: 2,
            dead_code: true,
            drop_console: true
          },
          format: {
            comments: false
          }
        });
        if (result.code) {
          return result.code;
        }
      } catch (e) {
        // Not valid JS or parsing error, return original
      }
    }
    return codeString;
  }
}

module.exports = new AutoMinifier();
