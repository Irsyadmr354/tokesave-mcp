<div align="center">
  <h1>TokeSave MCP</h1>
  <p><b>Token-Saving Middleware for MCP — Smart Tool Selection + Compression</b></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
</div>

---

TokeSave is an MCP server that saves tokens via **two layers**: (1) smart tool selection (read only what's needed), (2) aggressive text compression with **intelligent caching & deduplication**. Works with any MCP client — Cursor, Claude Desktop, Claude Code, GPT CLI.

## Philosophy

Most token-saving tools just compress blindly. TokeSave's primary savings come from **not reading or processing data in the first place**:
- Auto-skip generated files (`package-lock.json` → 1-line summary)
- Extract only needed functions/line ranges
- Diff-only on repeat file reads
- **Cache identical inputs** — skip re-compression entirely
- **Dedup response history** — detect 85%+ similar responses
- Grep with context instead of reading entire files

Compression is the **secondary** layer.

## Features

### 5-Level Compression (Default: `aggressive`)
All modes are safe — code blocks, URLs, and inline code are preserved.
- `lite` — Removes filler words (just, really, basically, actually)
- `standard` — Removes articles (a, an, the). Hedges preserved.
- `aggressive` — Custom abbreviations (config→cfg, function→fn, because→cuz)
- `brutal` — Symbol replacements (and→&, with→w/). Max safe level.
- `oblivion` — Vowel-stripping (~35-50%). Opt-in only via `set_mode`.

Adaptive auto-escalation caps at `brutal` to prevent info loss.

### Smart Tools
| Tool | What it does | Token savings |
|------|-------------|--------------|
| `grep_files` | Search pattern + N lines context | 90%+ vs reading full files |
| `read_file_range` | Read specific line range | 70-99% vs full file |
| `file_mtree` | Directory tree with sizes/token estimates | 100% (no content read) |
| `compress_file` | Read + compress, auto-skips generated files, cached | 30-95% per file |
| `read_function_body` | Extract single function/class | 80-99% vs full file |
| `summarize_file` | Compress to fit token budget | Variable |
| `diff_files` | Line-level diff only | 90%+ on repeat reads |

### Cache & Dedup (NEW)
- **Compression Cache** — Identical text/file re-uses previous result. 0 token cost for repeats.
- **Local LRU** cache (100 entries). Optional Redis for distributed caching.
- **Response Dedup** — Jaccard similarity >85% → `[DUPLICATE: ~90% similar]`. No need to re-read near-identical responses.
- **Diff-Only** — Repeat file reads return only changed lines.

### Extreme Safe Transforms
Applied after protected block extraction — cannot corrupt code/URLs:
- **Base64 Stripper** — Long base64 → `[BASE64:Nchars]`
- **UUID/Token Redactor** — UUIDs, GH tokens, JWTs → `[UUID]`, `[GH_TOKEN]`
- **Path Compactor** — Long paths → `...filename.js`
- **Stack Trace Slimmer** — First 3 + last 2 frames, `[N omitted]` middle
- **Separator Collapse** — Repeated `---`/`===` lines

### Repo Cleanup
`repo_cleanup` analyzes any git repo and detects token waste by project type:
- Auto-detects .NET, Node.js, Python, Swift/Xcode, Rust, Ruby
- Generates `.gitignore` with appropriate patterns
- `repo_cleanup_apply` removes waste from tracking + writes `.gitignore`

Real-world results:

| Repo | Before | After | Waste |
|------|--------|-------|-------|
| Better Disk Cleanup (.NET) | 693 files (3.17M tokens) | 185 files (151K) | **95%** |
| DSPloit (Swift/Xcode) | 228 files (2.32M tokens) | 216 files (~480K) | **79.4%** |
| IOS Daemon Tweaker (Python) | 53 files (188K tokens) | 37 files (~51K) | **72.7%** |

### Injection Shield
Scans external content for prompt injection patterns. Replaces with `[BLOCKED_INJECTION]`. Auto-runs on all `compress_url` fetches.

### Benchmark
`benchmark` tool — tests all 5 modes on text or file. Shows: chars saved, tokens saved, readability score, info loss detection, mode recommendation.

## Installation

```bash
npm install -g tokesave-mcp
```

Or run locally:
```bash
node src/index.js
```

## Configuration

Create `tokesave.config.json` in your working directory:

```json
{
  "mode": "aggressive",
  "maxAdaptiveLevel": "brutal",
  "redactPII": true,
  "dedupThreshold": 0.85,
  "useAstSkeleton": true,
  "useAutoMinifier": true
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | string | `aggressive` | Compression level |
| `maxAdaptiveLevel` | string | `brutal` | Max auto-escalation (never `oblivion`) |
| `redactPII` | bool | `true` | Redact emails, phones, API keys |
| `dedupThreshold` | number | `0.85` | Jaccard similarity threshold |
| `useAstSkeleton` | bool | `false` | Enable AST skeleton compression |
| `useAutoMinifier` | bool | `false` | Enable terser JS minification |
| `useInfiniteMemory` | bool | `false` | Enable vector RAG memory |
| `useTextRankDistillation` | bool | `false` | Enable TextRank sentence extraction |
| `customAbbreviations` | object | `{}` | Custom word→abbrev mappings |
| `customBrutalReplacements` | object | `{}` | Custom brutal replacements |

## Available Tools

| Tool | Description |
|------|-------------|
| `compress_text` | Compress text with cache + dedup |
| `compress_file` | Read + compress file, auto-chunk, auto-skip generated, cached |
| `compress_batch` | Compress multiple files at once |
| `compress_url` | Fetch URL + injection scan + HTML strip + compress |
| `compress_file_chunked` | Split large compressed output into token-budget chunks |
| `summarize_file` | Compress to fit token budget |
| `read_function_body` | Extract single function/class by name |
| `diff_files` | Line-level diff of two files |
| `grep_files` | Search pattern + N lines context |
| `read_file_range` | Read specific line range |
| `file_mtree` | Directory tree with sizes + token estimates |
| `set_mode` | Change compression mode |
| `get_status` | Current mode, features, cache status, stats |
| `get_stats` | Session & lifetime token savings, cache/dedup hits |
| `benchmark` | Test all modes, compare, recommend |
| `scan_injection` | Check text for injection patterns |
| `recall_memory` | Semantic search over previously compressed content |
| `repo_audit` | Scan repo for token waste |
| `repo_cleanup` | Analyze repo + generate `.gitignore` by project type |
| `repo_cleanup_apply` | Apply cleanup: `.gitignore` + `git rm --cached` |

## License

MIT
