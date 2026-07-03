class GitOptimizer {
  constructor() {
    this.enabled = true;
  }

  optimize(text) {
    if (!this.enabled || !text) return text;

    // Detect if text is a git diff output
    const isGitDiff = text.includes('diff --git a/') || (text.includes('--- a/') && text.includes('+++ b/'));
    
    if (isGitDiff) {
      const lines = text.split('\n');
      const optimized = [];
      let inDiff = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Keep file headers
        if (line.startsWith('diff --git') || line.startsWith('--- a/') || line.startsWith('+++ b/')) {
          optimized.push(line);
          inDiff = true;
          continue;
        }
        
        // Skip git index metadata
        if (line.startsWith('index ') || line.startsWith('new file ') || line.startsWith('deleted file ')) {
          continue; // AI doesn't need commit hashes
        }
        
        // Skip chunk headers completely or replace with a tiny marker
        if (line.startsWith('@@ ')) {
          optimized.push('@@'); // Tiny marker instead of @@ -10,5 +10,6 @@ functionName() {
          continue;
        }
        
        if (inDiff) {
          // If it starts with + or -, it's a change, KEEP IT
          if (line.startsWith('+') || line.startsWith('-')) {
            optimized.push(line);
          }
          // If it starts with space (context line), DROP IT, it wastes tokens
          else if (line.startsWith(' ')) {
            // Drop it
          }
          else if (line === '\\ No newline at end of file') {
             // Drop it
          }
          else {
            // Might be a new diff file or random text
            optimized.push(line);
          }
        } else {
          // Keep pre-diff text (commit message, etc)
          optimized.push(line);
        }
      }
      
      return optimized.join('\n');
    }

    return text;
  }
}

module.exports = new GitOptimizer();
