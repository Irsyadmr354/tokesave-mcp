const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.eot', '.ttf', '.otf', '.pdf', '.zip', '.gz', '.tar', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat']);
const GENERATED_EXTS = new Set(['.lock', '.min.js', '.min.css', '.bundle.js', '.chunk.js']);
const LARGE_THRESHOLD = 100 * 1024; // 100KB

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, cwd: process.cwd() }).trim();
  } catch {
    return '';
  }
}

function auditRepo() {
  const repoRoot = process.cwd();
  const files = run('git ls-files').split('\n').filter(Boolean);
  if (files.length === 0) return 'Not a git repo or no tracked files.';

  const commitCount = run('git log --oneline').split('\n').filter(Boolean).length;
  const totalSize = files.reduce((sum, f) => sum + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0);
  const totalTokens = Math.ceil(totalSize / 4);

  let wasteTokens = 0;
  let binaryFiles = [];
  let largeFiles = [];
  let generatedFiles = [];
  let fileDetails = [];

  for (const f of files) {
    const fullPath = path.join(repoRoot, f);
    if (!fs.existsSync(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    const ext = path.extname(f).toLowerCase();
    const isBinary = BINARY_EXTS.has(ext);
    const isGenerated = GENERATED_EXTS.has(ext) || f.includes('lock') || f.includes('bundle') || f.includes('chunk');

    fileDetails.push({ file: f, size: stat.size, isBinary, isGenerated });

    if (isBinary) {
      binaryFiles.push(f);
      wasteTokens += Math.ceil(stat.size / 4);
    }
    if (stat.size > LARGE_THRESHOLD) {
      largeFiles.push({ file: f, size: stat.size });
    }
    if (isGenerated) {
      generatedFiles.push(f);
      wasteTokens += Math.ceil(stat.size / 4) / 2; // half penalty
    }
  }

  // Sort large files
  largeFiles.sort((a, b) => b.size - a.size);

  let output = `╔══════════════════════════════════════╗\n`;
  output += `║     📊 TokeSave Repo Token Audit     ║\n`;
  output += `╚══════════════════════════════════════╝\n\n`;

  output += `Repo:     ${path.basename(repoRoot)}\n`;
  output += `Commits:  ${commitCount}\n`;
  output += `Tracked:  ${files.length} files\n`;
  output += `Total:    ${(totalSize / 1024).toFixed(1)} KB / ~${totalTokens} tokens\n\n`;

  output += `─── Waste Analysis ───\n`;
  if (binaryFiles.length > 0) {
    output += `⚠ Binary files (${binaryFiles.length}): ~${Math.ceil(wasteTokens)} tokens wasted\n`;
    const shown = binaryFiles.slice(0, 10);
    for (const f of shown) {
      const sz = fs.existsSync(f) ? fs.statSync(f).size : 0;
      output += `  - ${f} (${(sz / 1024).toFixed(1)} KB)\n`;
    }
    if (binaryFiles.length > 10) output += `  ...and ${binaryFiles.length - 10} more\n`;
  }

  if (largeFiles.length > 0) {
    output += `\n⚠ Large files >100KB (${largeFiles.length}): ~${Math.ceil(largeFiles.reduce((s, f) => s + f.size, 0) / 4)} tokens\n`;
    const shown = largeFiles.slice(0, 10);
    for (const f of shown) {
      output += `  - ${f.file} (${(f.size / 1024).toFixed(1)} KB / ~${Math.ceil(f.size / 4)} tokens)\n`;
    }
    if (largeFiles.length > 10) output += `  ...and ${largeFiles.length - 10} more\n`;
  }

  if (generatedFiles.length > 0) {
    output += `\n⚠ Generated/lock files (${generatedFiles.length}): ~${Math.ceil(generatedFiles.reduce((s, f) => s + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0) / 8)} tokens\n`;
    const shown = generatedFiles.slice(0, 10);
    for (const f of shown) {
      const sz = fs.existsSync(f) ? fs.statSync(f).size : 0;
      output += `  - ${f} (${(sz / 1024).toFixed(1)} KB)\n`;
    }
    if (generatedFiles.length > 10) output += `  ...and ${generatedFiles.length - 10} more\n`;
  }

  // Top token consumers
  const textFiles = fileDetails.filter(f => !f.isBinary).sort((a, b) => b.size - a.size).slice(0, 10);
  if (textFiles.length > 0) {
    output += `\n─── Top 10 Token Consumers (text) ───\n`;
    for (const f of textFiles) {
      const tokens = Math.ceil(f.size / 4);
      output += `  ${tokens.toString().padStart(6)} tok  ${f.file}\n`;
    }
  }

  const totalWaste = Math.ceil(wasteTokens + generatedFiles.reduce((s, f) => s + (fs.existsSync(f) ? fs.statSync(f).size : 0) / 8, 0));
  const wastePct = totalTokens > 0 ? ((totalWaste / totalTokens) * 100).toFixed(1) : '0.0';

  output += `\n═══════════════════════════════════════\n`;
  output += `Total waste: ~${totalWaste} tokens (${wastePct}% of repo)\n`;
  output += `Suggestion: ${totalWaste > 500 ? 'Add large/generated files to .gitignore or use TokeSave dedup' : 'Repo is clean'}\n`;

  return output;
}

module.exports = { auditRepo };
