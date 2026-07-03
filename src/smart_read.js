const fs = require('fs');
const path = require('path');

// BUG FIX #5: proper glob matching supporting *.js, *.test.js, **/*.js, *
function matchesGlob(filename, glob) {
  if (!glob || glob === '*') return true;

  // Strip leading **/ or */ from glob — we only match filename, not full path here
  const base = glob.replace(/^\*+\//, '');

  // Convert glob pattern to regex
  // Escape all regex special chars except * and ?
  const escaped = base.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped
    .replace(/\*/g, '.*')   // * → match anything
    .replace(/\?/g, '.');   // ? → match single char

  try {
    return new RegExp('^' + regexStr + '$', 'i').test(filename);
  } catch {
    // Fallback: substring match
    return filename.includes(base.replace('*', ''));
  }
}

function grepFiles(pattern, fileGlob, contextLines = 2) {
  const cwd = process.cwd();
  const files = listFiles(cwd, fileGlob);

  let output = '';
  let totalMatches = 0;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const matches = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
        const from = Math.max(0, i - contextLines);
        const to = Math.min(lines.length - 1, i + contextLines);
        let block = `\n--- ${path.relative(cwd, file)}:${i + 1} ---\n`;
        for (let j = from; j <= to; j++) {
          const prefix = j === i ? '>' : ' ';
          block += `${prefix} L${j + 1}: ${lines[j]}\n`;
        }
        matches.push(block);
        totalMatches++;
      }
    }

    if (matches.length > 0) output += matches.join('');
  }

  if (totalMatches === 0) return `[GREP: no matches for "${pattern}" in ${fileGlob || '*'}]`;
  return `[GREP: ${totalMatches} matches in ${files.length} files for "${pattern}"]\n${output}`;
}

function listFiles(dir, glob) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...listFiles(full, glob));
      }
    } else if (entry.isFile()) {
      // BUG FIX #5: use proper glob matching
      if (matchesGlob(entry.name, glob)) {
        results.push(full);
      }
    }
  }
  return results;
}

function readFileRange(filePath, startLine, endLine) {
  if (!fs.existsSync(filePath)) return `[ERROR: file not found: ${filePath}]`;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const total = lines.length;

  startLine = Math.max(1, startLine);
  endLine = Math.min(total, endLine || startLine);
  if (startLine > endLine) return `[ERROR: startLine (${startLine}) > endLine (${endLine})]`;

  const range = lines.slice(startLine - 1, endLine);
  const header = `[FILE: ${path.basename(filePath)} | Lines ${startLine}-${endLine} of ${total} | ${range.length} lines]\n`;
  return header + range.map((l, i) => `L${startLine + i}: ${l}`).join('\n');
}

function fileMtree(dirPath, maxDepth = 3) {
  const root = dirPath || process.cwd();
  const result = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const indent = '  '.repeat(depth);

      if (entry.isDirectory()) {
        result.push(`${indent}📁 ${entry.name}/`);
        walk(full, depth + 1);
      } else {
        try {
          const stat = fs.statSync(full);
          const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
          const tokens = Math.ceil(stat.size / 4);
          result.push(`${indent}📄 ${entry.name} (${size}, ~${tokens} tok)`);
        } catch {
          result.push(`${indent}📄 ${entry.name} (unreadable)`);
        }
      }
    }
  }

  result.push(`📁 ${path.basename(root)}/`);
  walk(root, 1);
  return result.join('\n');
}

module.exports = { grepFiles, readFileRange, fileMtree };
