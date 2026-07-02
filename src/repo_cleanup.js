const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const COMMON_GITIGNORE = `
## OS files
Thumbs.db
*.DS_Store
Desktop.ini
*.swp
*.swo
*~

## IDE
.idea/
.vs/
.vscode/
*.sln.iml
*.user
*.suo
`.trim();

const RULES = {
  dotnet: `
## .NET
bin/
obj/
*.dll
*.exe
*.pdb
*.so
*.dylib
packages/
*.nupkg
[Dd]ebug/
[Rr]elease/
.vs/
`.trim(),

  node: `
## Node
node_modules/
package-lock.json
yarn.lock
pnpm-lock.yaml
*.tgz
npm-debug.log*
yarn-error.log*
`.trim(),

  python: `
## Python
__pycache__/
*.py[cod]
*.egg-info/
dist/
build/
*.egg
.venv/
venv/
`.trim(),

  swift: `
## Swift/Xcode
*.png
*.jpg
*.jpeg
*.dylib
*.ipa
*.dSYM.zip
*.dSYM
DerivedData/
build/
`.trim(),

  rust: `
## Rust
target/
Cargo.lock
`.trim(),

  ruby: `
## Ruby
vendor/bundle/
.bundle
Gemfile.lock
`.trim(),
};

function detectProjectType(files) {
  const types = [];
  if (files.some(f => f.endsWith('.sln') || f.endsWith('.csproj'))) types.push('dotnet');
  if (files.some(f => f === 'package.json')) types.push('node');
  if (files.some(f => f.endsWith('.py'))) types.push('python');
  if (files.some(f => f.endsWith('.swift') || f.endsWith('.xcodeproj'))) types.push('swift');
  if (files.some(f => f === 'Cargo.toml')) types.push('rust');
  if (files.some(f => f === 'Gemfile')) types.push('ruby');
  return types;
}

function generateGitignore(files) {
  const types = detectProjectType(files);
  const rules = [COMMON_GITIGNORE];
  for (const t of types) {
    if (RULES[t]) rules.push(RULES[t]);
  }

  // Detect large binary patterns from tracked files
  const binaryExts = new Set();
  const duplicatePatterns = new Set();
  const largeDirs = new Set();

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.dylib', '.dll', '.exe', '.pdb', '.so'].includes(ext)) {
      binaryExts.add(ext);
    }
    const dir = path.dirname(f).split(path.sep)[0];
    if (['bin', 'obj', 'build', 'target', 'node_modules', 'packages', '__pycache__'].includes(dir)) {
      largeDirs.add(dir);
    }
  }

  // Add detected binary extensions
  if (binaryExts.size > 0) {
    const extPatterns = [...binaryExts].map(e => `*${e}`).join('\n');
    rules.push(`\n## Binary files (auto-detected)\n${extPatterns}`);
  }

  // Add detected large dirs
  if (largeDirs.size > 0) {
    const dirPatterns = [...largeDirs].map(d => `${d}/`).join('\n');
    rules.push(`\n## Build/generated dirs (auto-detected)\n${dirPatterns}`);
  }

  return rules.join('\n\n');
}

function analyze() {
  const repoRoot = process.cwd();
  const files = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).split('\n').filter(Boolean);
  if (files.length === 0) return { error: 'Not a git repo or no tracked files.' };

  const gitignore = generateGitignore(files);

  // Find removable files
  const removable = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const basename = path.basename(f).toLowerCase();
    const dir = f.split(/[\\/]/)[0];
    const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.dylib', '.dll', '.exe', '.pdb', '.so', '.ico'].includes(ext);
    const isGenerated = ['bin/', 'obj/', 'node_modules/', 'target/', '__pycache__/', 'packages/'].some(d => f.startsWith(d));
    const isLock = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'gemfile.lock'].includes(basename);
    if (isBinary || isGenerated || isLock) {
      const stat = fs.statSync(f, { throwIfNoEntry: false });
      removable.push({ file: f, size: stat ? stat.size : 0 });
    }
  }
  removable.sort((a, b) => b.size - a.size);

  return { files, gitignore, removable, types: detectProjectType(files) };
}

function cleanup() {
  const result = analyze();
  if (result.error) return result.error;

  let output = `╔══════════════════════════════════════╗\n`;
  output += `║     🧹 TokeSave Repo Cleanup        ║\n`;
  output += `╚══════════════════════════════════════╝\n\n`;

  output += `Proyek: ${path.basename(process.cwd())}\n`;
  output += `Type:   ${result.types.join(', ') || 'Unknown'}\n`;
  output += `Tracked: ${result.files.length} files\n\n`;

  if (result.removable.length > 0) {
    output += `─── Files to remove from tracking (${result.removable.length}) ───\n`;
    const totalWaste = result.removable.reduce((s, f) => s + f.size, 0);
    output += `Total waste: ~${Math.ceil(totalWaste / 4)} tokens (${(totalWaste / 1024 / 1024).toFixed(1)} MB)\n\n`;
    const shown = result.removable.slice(0, 15);
    for (const f of shown) {
      output += `  ${(f.size / 1024).toFixed(1).padStart(8)} KB  ${f.file}\n`;
    }
    if (result.removable.length > 15) {
      output += `  ...and ${result.removable.length - 15} more\n`;
    }
  } else {
    output += `✅ No removable waste found.\n`;
  }

  output += `\n─── Recommended .gitignore ───\n\n${result.gitignore}\n\n`;
  output += `═══════════════════════════════════════\n`;

  if (result.removable.length > 0) {
    output += `To remove from tracking, run:\n`;
    output += `  repo_cleanup_apply\n`;
  }

  return output;
}

function applyCleanup() {
  const result = analyze();
  if (result.error) return result.error;

  // Generate .gitignore
  fs.writeFileSync('.gitignore', result.gitignore + '\n', 'utf8');
  let removed = 0;
  let removedBytes = 0;

  // Group removable by dir for efficient rm
  for (const f of result.removable) {
    try {
      // Check if file is still tracked (might already be removed)
      const tracked = execSync(`git ls-files "${f}"`, { encoding: 'utf8' }).trim();
      if (tracked) {
        execSync(`git rm --cached "${f}" 2>nul`, { encoding: 'utf8', stdio: 'pipe' });
        removed++;
        removedBytes += f.size;
      }
    } catch { }
  }

  // Add .gitignore
  execSync('git add .gitignore', { encoding: 'utf8' });

  const savedTokens = Math.ceil(removedBytes / 4);
  const afterFiles = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean).length;

  return `🧹 Cleanup applied:\n`;
  return `  Files removed:  ${removed}\n` +
         `  Tokens saved:  ~${savedTokens}\n` +
         `  Files now:     ${result.files.length} → ${afterFiles}\n` +
         `  .gitignore:    generated\n\n` +
         `Run commit & push when ready.`;
}

module.exports = { analyze, cleanup, applyCleanup };
