<div align="center">
  <h1>TokeSave MCP</h1>
  <p><b>Token-Saving Middleware for MCP — Smart Tool Selection + Compression</b></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
</div>

---

TokeSave saves tokens via **two layers**: (1) smart tool selection — read only what's needed, (2) aggressive text compression with caching and deduplication. Works with any MCP client: Cursor, Claude Desktop, Claude Code, Windsurf.

## Quick Start

```bash
npm install -g tokesave-mcp
```

Add to your MCP client config (`mcp.json` / Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tokesave": {
      "command": "tokesave-mcp",
      "args": []
    }
  }
}
```

Then call `auto_setup` tool at the start of every session — it prints the routing rules and confirms config.

## How Proxy Mode Works (Optional — for wrapping other servers)

TokeSave has two proxy modes. Neither is required for basic token saving.

### Mode 1: Wrap a single server (stdin/stdout proxy)

```bash
# In mcp.json: replace target server with TokeSave wrapping it
tokesave-mcp proxy_wrap npx -y @modelcontextprotocol/server-filesystem /path
```

TokeSave sits between your AI client and the upstream server, compressing all responses transparently. The AI client sees only one server.

### Mode 2: Multi-server router

Add downstream servers to `tokesave.config.json`:

```json
{
  "mode": "aggressive",
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

Then run as router: `tokesave-mcp router`

All tools from all downstream servers are exposed through one endpoint, with compression applied automatically.

## Philosophy

Most token-saving tools compress blindly. TokeSave's primary savings come from **not reading data in the first place**:
- Auto-skip generated files (`package-lock.json` → 1-line summary)
- Extract only the function you need, not the whole file
- Diff-only on repeat reads of the same file
- Cache identical inputs — zero cost for repeats
- Grep with context instead of reading entire files

Compression is the secondary layer.

## Compression Levels (Default: `aggressive`)

Code blocks, URLs, and inline code are always preserved at all levels.

| Level | What it does | Avg savings |
|-------|-------------|-------------|
| `lite` | Remove filler words (just, really, basically) | ~5% |
| `standard` | + Remove articles (a, an, the) | ~12% |
| `aggressive` | + Abbreviations (config→cfg, function→fn) | ~25% |
| `brutal` | + Symbol replacements (and→&, with→w/) | ~35% |
| `oblivion` | + Vowel stripping. Opt-in only via `set_mode`. | ~45% |

Adaptive engine auto-escalates mode when savings are low, caps at `maxAdaptiveLevel`.

## Smart Tools

| Tool | What it does | Token savings |
|------|-------------|--------------|
| `auto_setup` | Session init + routing rules | — |
| `compress_file` | Read + compress, auto-skip generated, cached | 30–95% |
| `compress_batch` | Read + compress multiple files concurrently | 30–95% |
| `read_function_body` | Extract single function/class by name | 80–99% |
| `grep_files` | Search pattern + N lines context | 90%+ |
| `read_file_range` | Read specific line range | 70–99% |
| `file_mtree` | Directory tree with sizes/token estimates | 100% (no content) |
| `diff_files` | Line-level diff only | 90%+ on repeat reads |
| `summarize_file` | Compress to fit token budget | Variable |
| `compress_url` | Fetch + HTML strip + inject scan + compress | 60–90% |
| `compress_text` | Compress arbitrary text | 20–45% |
| `compress_file_chunked` | Large file in token-budget chunks | Variable |

## Cache & Dedup

- **LRU Cache** (100 entries, optional Redis) — identical inputs return cached result instantly
- **Exact dedup** (O(1) hash) — duplicate responses detected immediately
- **Jaccard dedup** (near-duplicate, 85% threshold) — catches rephrased duplicates
- **Diff-only** — repeat file reads return only changed lines

## Extreme Safe Transforms

Applied to unprotected text only (code blocks / URLs are extracted first):
- **Base64 Stripper** — `[BASE64:Nchars]`
- **UUID/Token Redactor** — `[UUID]`, `[GH_TOKEN]`, `[JWT]`
- **Path Compactor** — long paths → `...filename.js`
- **Stack Trace Slimmer** — first 3 + last 2 frames, middle omitted
- **Separator Collapse** — repeated `---`/`===` blocks

## Repo Cleanup

| Tool | What it does |
|------|-------------|
| `repo_audit` | Scan git repo for token waste: binaries, generated files, large files |
| `repo_cleanup` | Analyze + generate `.gitignore` by project type (Node, Python, .NET, Rust, Ruby, Swift) |
| `repo_cleanup_apply` | Apply: write `.gitignore` + `git rm --cached` for waste files |

Real-world results:

| Repo | Before | After | Reduction |
|------|--------|-------|-----------|
| Better Disk Cleanup (.NET) | 3.17M tokens | 151K tokens | **95%** |
| DSPloit (Swift/Xcode) | 2.32M tokens | ~480K tokens | **79%** |
| IOS Daemon Tweaker (Python) | 188K tokens | ~51K tokens | **73%** |

## Configuration

`tokesave.config.json` in working directory:

```json
{
  "mode": "aggressive",
  "maxAdaptiveLevel": "brutal",
  "redactPII": true,
  "dedupThreshold": 0.85,
  "useAstSkeleton": true,
  "useAutoMinifier": false,
  "useTextRankDistillation": false,
  "useInfiniteMemory": false
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `aggressive` | Starting compression level |
| `maxAdaptiveLevel` | `brutal` | Adaptive ceiling (never auto-reaches `oblivion`) |
| `redactPII` | `true` | Redact emails, phones, API keys |
| `dedupThreshold` | `0.85` | Jaccard similarity threshold for near-dedup |
| `useAstSkeleton` | `true` | Show only function signatures for code files |
| `useAutoMinifier` | `false` | Terser minification (JS only, aggressive) |
| `useTextRankDistillation` | `false` | Extractive sentence ranking for prose |
| `useInfiniteMemory` | `false` | Vector RAG memory (requires ~22MB model download) |
| `customAbbreviations` | `{}` | Add your own word→abbrev mappings |
| `customBrutalReplacements` | `{}` | Add brutal-mode replacements |
| `redisUrl` | — | Redis URL for shared distributed cache |
| `servers` | `{}` | Downstream MCP servers for router/proxy mode |

## Marketplace API (optional)

```bash
tokesave-mcp marketplace 3000
```

Exposes `/api/compress` (POST) and `/api/stats` (GET) over HTTP.
Set `TOKESAVE_API_KEYS` env var for API key auth (comma-separated). Rate limit: 60 req/min.

## License

MIT
