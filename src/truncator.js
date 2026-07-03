class LogTruncator {
  constructor() {
    this.enabled = true;
    this.maxLength = 20000; // ~5000 tokens — large enough for legitimate responses
    this.keepLines = 50;    // Keep top 50 and bottom 50 lines
  }

  truncate(text) {
    if (!this.enabled || !text || text.length <= this.maxLength) return text;
    
    // Strong heuristic: must look like a real log/stack trace, not just text that
    // happens to mention "error". Require at least one of:
    //   - stack frame pattern:  "  at functionName (file.js:10:5)"
    //   - repeated timestamp:   "2024-01-01T00:00:00"
    //   - log level prefix:     "[ERROR]", "[WARN]", "[INFO]" at line start
    const stackFramePattern = /^\s+at\s+\S+\s+\(\S+:\d+:\d+\)/m;
    const timestampPattern = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
    const logLevelPattern = /^\[(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\]/m;

    const isRealLog = stackFramePattern.test(text) || 
                      timestampPattern.test(text) || 
                      logLevelPattern.test(text);
    
    if (isRealLog) {
      const lines = text.split('\n');
      if (lines.length > this.keepLines * 2) {
        const top = lines.slice(0, this.keepLines).join('\n');
        const bottom = lines.slice(-this.keepLines).join('\n');
        const removedLines = lines.length - (this.keepLines * 2);
        const removedChars = text.length - (top.length + bottom.length);
        
        return `${top}\n\n... [${removedChars} chars / ${removedLines} lines TRUNCATED BY TOKESAVE] ...\n\n${bottom}`;
      }
    }

    return text;
  }
}

module.exports = new LogTruncator();
