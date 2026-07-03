#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  ListResourcesRequestSchema, 
  ReadResourceRequestSchema 
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require('fs');
const path = require('path');
const os = require('os');
const compressor = require('./compress');
const stats = require('./stats');
const proxy = require('./proxy');
const router = require('./router');
const swarm = require('./swarm');
const shield = require('./shield');
const dedup = require('./dedup');
const distill = require('./distill');
const skeleton = require('./skeleton');
const benchmark = require('./benchmark');
const repoAudit = require('./repo_audit');
const repoCleanup = require('./repo_cleanup');
const smartRead = require('./smart_read');
const { fetchUrl } = require('./fetcher');
const htmlShredder = require('./html_shredder');
const adaptive = require('./adaptive');
const cache = require('./cache');
const { startMarketplace } = require('./marketplace');
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

// Load config — priority: cwd → home dir → package default
// FIX #3: user install global, cwd berbeda dari __dirname — harus cari di cwd dulu
const configBase = path.resolve(__dirname, '..');

function findConfig() {
  // 1. cwd (project folder user saat ini)
  const cwdConfig = path.join(process.cwd(), 'tokesave.config.json');
  if (fs.existsSync(cwdConfig)) return cwdConfig;

  // 2. home dir (~/.tokesave.config.json)
  const homeConfig = path.join(os.homedir(), '.tokesave.config.json');
  if (fs.existsSync(homeConfig)) return homeConfig;

  // 3. package dir (bundled default config)
  const pkgConfig = path.join(configBase, 'tokesave.config.json');
  if (fs.existsSync(pkgConfig)) return pkgConfig;

  return null;
}

function loadConfig() {
  try {
    const configPath = findConfig();
    if (!configPath) {
      // FIX #3: auto-apply safe defaults even without config file
      compressor.setRedactPII(true);
      skeleton.enable();
      adaptive.setMaxLevel('brutal');
      console.error('[TokeSave] No config found — using built-in defaults (aggressive mode, redactPII, AST skeleton)');
      return;
    }
    console.error(`[TokeSave] Config: ${configPath}`);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.mode) compressor.setMode(config.mode);
    if (config.customAbbreviations || config.customBrutalReplacements) {
      compressor.loadCustomAbbreviations(config.customAbbreviations, config.customBrutalReplacements);
    }
    if (config.redactPII !== false) compressor.setRedactPII(true); // default ON
    if (config.dedupThreshold) dedup.setThreshold(config.dedupThreshold);
    if (config.useTextRankDistillation) distill.enable();
    if (config.useAstSkeleton !== false) skeleton.enable();       // default ON
    if (config.useAutoMinifier) { const golf = require('./golf'); golf.enable(); }
    if (config.useInfiniteMemory) {
      const memory = require('./memory');
      memory.enable().catch(() => {});
    }
    if (config.distillRatio) distill.setRatio(config.distillRatio);
    if (config.maxAdaptiveLevel) adaptive.setMaxLevel(config.maxAdaptiveLevel);
    if (config.mode) adaptive.setMinLevel(config.mode);
  } catch (e) {
    console.error('[TokeSave] Failed to load config:', e.message);
  }
}
loadConfig();

// Initialize downstream server proxies (auto-proxy MCP)
const downstreamClients = [];
const downstreamToolMap = new Map();
const downstreamTools = [];

async function initDownstreamServers() {
  try {
    const configPath = findConfig();
    if (!configPath) return;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const serversConfig = config.servers || {};
    if (Object.keys(serversConfig).length === 0) return;

    for (const [name, srv] of Object.entries(serversConfig)) {
      try {
        const transport = new StdioClientTransport({ command: srv.command, args: srv.args, stderr: 'inherit' });
        const client = new Client({ name: "tokesave-proxy", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);
        downstreamClients.push(client);
        const tools = await client.request({ method: "tools/list" }, ListToolsRequestSchema);
        for (const t of tools.tools) {
          downstreamToolMap.set(t.name, client);
          downstreamTools.push(t);
        }
        console.error(`[TokeSave] Auto-proxying: ${name}`);
      } catch (e) {
        console.error(`[TokeSave] Failed to proxy ${name}: ${e.message}`);
      }
    }
    if (downstreamClients.length > 0) {
      console.error(`[TokeSave] Auto-proxy active — ${downstreamClients.length} server(s), ${downstreamTools.length} tool(s)`);
    }
  } catch (e) {
    console.error(`[TokeSave] Auto-proxy init error: ${e.message}`);
  }
}

// BUG FIX #1: no top-level return — use process.exit() or early dispatch
const args = process.argv.slice(2);

if (args[0] === 'proxy_wrap' && args.length >= 2) {
  const upstreamCmd = args[1];
  const upstreamArgs = args.slice(2);
  proxy.startProxy(upstreamCmd, upstreamArgs);
  // proxy takes over stdio, do not fall through
} else if (args[0] === 'router') {
  router.startRouter().catch(e => { console.error(e); process.exit(1); });
} else if (args[0] === 'marketplace') {
  const port = parseInt(args[1]) || 3000;
  startMarketplace(port);
} else {
  // Normal MCP server mode — run below
  startMcpServer();
}

function startMcpServer() {

const server = new Server(
  {
    name: "tokesave-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Register Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "tokesave://system-prompt",
        name: "TokeSave System Prompt",
        description: "Tool-use policy for token-efficient MCP usage: which TokeSave tool/mode to use per content type, and safety limits on lossy compression.",
        mimeType: "text/markdown",
      }
    ]
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "tokesave://system-prompt") {
    const promptPath = path.join(__dirname, '..', 'SKILL.md');
    try {
      const content = fs.readFileSync(promptPath, 'utf8');
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "text/markdown",
            text: content
          }
        ]
      };
    } catch (e) {
      throw new Error("Failed to read system prompt file");
    }
  }
  throw new Error("Resource not found");
});

// Register Tools
const tokesaveTools = [
      {
        name: "auto_setup",
        description: "CALL THIS FIRST on every new session. Prints optimal tool routing rules for this session + current config status. Ensures TokeSave is active and correctly configured.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "compress_text",
        description: "USE THIS before sending any long text (>200 words) to save tokens. Strips filler words, abbreviates common terms, removes articles. Pass filename for code files to enable AST skeleton mode.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to compress" },
            filename: { type: "string", description: "Filename hint e.g. 'app.js' — enables code-specific compression" },
          },
          required: ["text"],
        },
      },
      {
        name: "compress_file",
        description: "USE THIS instead of reading files directly when you need file content. Reads + compresses in one step. Returns diff-only on second read of same file (massive token savings on repeated reads). Auto-chunks large files. Supports optional smart params: functionName (extract only that function), pattern (return only matching lines), lines (line range).",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to file" },
            functionName: { type: "string", description: "Optional: extract only this function/class (skips full file read)" },
            pattern: { type: "string", description: "Optional: only return lines matching this pattern + context" },
            startLine: { type: "number", description: "Optional: first line to read (with endLine)" },
            endLine: { type: "number", description: "Optional: last line to read (with startLine)" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "compress_batch",
        description: "USE THIS when you need to read multiple files at once. Single tool call instead of N calls. Compresses all files concurrently and returns results together.",
        inputSchema: {
          type: "object",
          properties: {
            filePaths: { type: "array", items: { type: "string" }, description: "Array of absolute file paths" },
            maxConcurrent: { type: "number", description: "Concurrency limit (default 5)" },
          },
          required: ["filePaths"],
        },
      },
      {
        name: "summarize_file",
        description: "USE THIS when you only need to understand a file, not quote it verbatim. Returns file content within a token budget — auto-escalates compression mode to fit. Ideal for large files where full content is not needed.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to file" },
            maxTokens: { type: "number", description: "Token budget (default 500)" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "read_function_body",
        description: "USE THIS instead of reading an entire file when you only need one function or class. Extracts just the target function — saves 90%+ tokens on large files.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to file" },
            functionName: { type: "string", description: "Exact function or class name to extract" },
          },
          required: ["filePath", "functionName"],
        },
      },
      {
        name: "diff_files",
        description: "USE THIS when comparing file versions. Returns only changed lines instead of both full files — saves tokens proportional to file size.",
        inputSchema: {
          type: "object",
          properties: {
            fileA: { type: "string", description: "Original file path" },
            fileB: { type: "string", description: "New/modified file path" },
          },
          required: ["fileA", "fileB"],
        },
      },
      {
        name: "compress_url",
        description: "USE THIS instead of fetching URLs directly. Fetches + strips HTML boilerplate (scripts, styles, nav, ads) + compresses. Returns clean readable text at fraction of original token cost.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to fetch and compress (http/https)" },
            timeoutMs: { type: "number", description: "Timeout ms (default 10000)" },
          },
          required: ["url"],
        },
      },
      {
        name: "compress_file_chunked",
        description: "USE THIS for very large files (>50KB) that need to be processed in parts. Splits compressed content into chunks of specified token size.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to file" },
            chunkSize: { type: "number", description: "Tokens per chunk (default 4000)" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "recall_memory",
        description: "Search previously read/compressed content by semantic similarity. USE THIS before re-reading files — if content was compressed before, this returns it instantly without disk I/O or re-compression.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Semantic search query" },
            topK: { type: "number", description: "Number of results (default 3)" },
          },
          required: ["query"],
        },
      },
      {
        name: "scan_injection",
        description: "Scan external content (web pages, tool outputs, user input) for prompt injection attempts before processing. Returns sanitized text.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to scan" },
          },
          required: ["text"],
        },
      },
      {
        name: "set_mode",
        description: "Change compression intensity. lite=minimal, standard=no articles, aggressive=abbreviations (default), brutal=symbols, oblivion=vowel removal. Higher = more savings but less readable.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["lite", "standard", "aggressive", "brutal", "oblivion"] },
          },
          required: ["mode"],
        },
      },
      {
        name: "get_stats",
        description: "Get token savings statistics for current session and lifetime.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_status",
        description: "Get current TokeSave state: active compression mode, which features are enabled, session stats.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "swarm_create_agent",
        description: "Create a named virtual agent with a role for task delegation tracking. NOTE: multi-agent delegation increases total token usage — do not use this for token-saving purposes.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
          },
          required: ["name", "role"],
        },
      },
      {
        name: "swarm_assign_task",
        description: "Assign a task to an existing swarm agent. NOTE: this triggers additional model calls per agent — not a token-saving tool.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            task: { type: "string" },
          },
          required: ["name", "task"],
        },
      },
      {
        name: "swarm_get_status",
        description: "Get status of all swarm agents and their current tasks.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "benchmark",
        description: "Test all 5 compression modes on text/file and compare savings, readability, info loss. Returns recommended mode.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to benchmark (mutually exclusive with filePath)" },
            filePath: { type: "string", description: "File to benchmark (mutually exclusive with text)" },
          },
        },
      },
      {
        name: "repo_audit",
        description: "Scan git repo for token waste: large files, binaries, generated code. Estimates potential token savings.",
        inputSchema: { type: "object", properties: { repoPath: { type: "string", description: "Optional: path to git repo (default: cwd)" } } },
      },
      {
        name: "repo_cleanup",
        description: "Analyze repo + generate .gitignore + list files to remove from tracking. Detects project type automatically.",
        inputSchema: { type: "object", properties: { repoPath: { type: "string", description: "Optional: path to git repo (default: cwd)" } } },
      },
      {
        name: "repo_cleanup_apply",
        description: "Apply the cleanup: generate .gitignore + git rm --cached for binaries/generated files. Must commit separately.",
        inputSchema: { type: "object", properties: { repoPath: { type: "string", description: "Optional: path to git repo (default: cwd)" } } },
      },
      {
        name: "grep_files",
        description: "Search files for pattern, return only matching lines with context. Avoids reading full files. Huge token save vs grep+compress.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Search pattern (case-insensitive)" },
            fileGlob: { type: "string", description: "File filter e.g. '*.js', '*.md' (default: '*')" },
            contextLines: { type: "number", description: "Lines of context around match (default: 2)" },
          },
          required: ["pattern"],
        },
      },
      {
        name: "read_file_range",
        description: "Read specific line range from a file. Avoids reading huge files entirely just for a few lines.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to file" },
            startLine: { type: "number", description: "First line to read (1-indexed)" },
            endLine: { type: "number", description: "Last line to read (default: startLine)" },
          },
          required: ["filePath", "startLine"],
        },
      },
      {
        name: "file_mtree",
        description: "Lightweight directory tree with file sizes and token estimates. No file content read.",
        inputSchema: {
          type: "object",
          properties: {
            dirPath: { type: "string", description: "Directory path (default: cwd)" },
            maxDepth: { type: "number", description: "Max depth (default: 3)" },
          },
        },
      },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [...tokesaveTools, ...downstreamTools] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "auto_setup": {
      const golf = require('./golf');
      const memory = require('./memory');
      const lines = [
        `╔══════════════════════════════════════════════╗`,
        `║         TokeSave — Session Ready             ║`,
        `╚══════════════════════════════════════════════╝`,
        ``,
        `Mode: ${compressor.mode} | Adaptive: on (cap: ${adaptive.maxLevel})`,
        `Cache: LRU-100${cache.useRedis ? ' + Redis' : ''} | Dedup: on | PII Redact: ${compressor.redactPII ? 'on' : 'off'}`,
        `AST Skeleton: ${skeleton.enabled ? 'on' : 'off'} | Minifier: ${golf.enabled ? 'on' : 'off'} | Memory: ${memory.enabled ? 'on' : 'off'}`,
        ``,
        `── TOOL ROUTING RULES (apply every response) ──`,
        `  read file      → compress_file`,
        `  read 2+ files  → compress_batch`,
        `  need 1 fn only → read_function_body`,
        `  search code    → grep_files`,
        `  list dir       → file_mtree`,
        `  line range     → read_file_range`,
        `  diff 2 files   → diff_files`,
        `  fetch URL      → compress_url`,
        `  text >200 words→ compress_text`,
        `  understand file→ summarize_file (not full read)`,
        ``,
        `── NEVER USE ──`,
        `  ❌ native read_file — use compress_file instead`,
        `  ❌ native fetch URL — use compress_url instead`,
        ``,
        stats.getStats(),
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    case "compress_text": {
      const { text, filename } = request.params.arguments;
      const cached = await compressor.checkCache(text, "compress_text");
      if (cached) {
        return { content: [{ type: "text", text: cached }] };
      }
      const dedupResult = dedup.checkDuplicate(text);
      if (dedupResult) {
        return { content: [{ type: "text", text: dedupResult }] };
      }
      const compressed = await compressor.compressText(text, filename);
      return {
        content: [
          {
            type: "text",
            text: compressed,
          },
        ],
      };
    }
    
    case "set_mode": {
      const { mode } = request.params.arguments;
      const result = compressor.setMode(mode);
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    }
    
    case "get_stats": {
      return {
        content: [
          {
            type: "text",
            text: stats.getStats(),
          },
        ],
      };
    }
    
    case "compress_file": {
      const { filePath, functionName, pattern, startLine, endLine } = request.params.arguments;
      try {
        // Smart redirect: functionName -> extract only that function
        if (functionName) {
          const functionBody = skeleton.extractFunction(fs.readFileSync(filePath, 'utf8'), filePath, functionName);
          if (functionBody && !functionBody.startsWith('[ERROR')) {
            return { content: [{ type: "text", text: functionBody }] };
          }
        }

        // Smart redirect: pattern -> grep-like with context
        if (pattern) {
          const grepResult = smartRead.grepFiles(pattern, filePath.split('/').pop().split('\\').pop(), 2);
          return { content: [{ type: "text", text: grepResult }] };
        }

        // Smart redirect: line range
        if (startLine) {
          const rangeResult = smartRead.readFileRange(filePath, startLine, endLine || startLine);
          return { content: [{ type: "text", text: rangeResult }] };
        }

        // Normal flow
        const content = fs.readFileSync(filePath, 'utf8');

        // Auto-skip generated/lock files — massive token waste
        const basename = require('path').basename(filePath);
        if (/^package-lock\.|^yarn\.lock|^pnpm-lock|composer\.lock|\.min\.(js|css)$/.test(basename)) {
          const lines = content.split('\n').length;
          return { content: [{ type: "text", text: `[SKIPPED: ${basename} — auto-generated (${content.length} chars, ${lines} lines). Dependencies: ${content.match(/"\S+":\s*"[^"]+"/g)?.length || 0} packages. Use "npm ls" or read package.json instead.]` }] };
        }
        
        // Auto-chunk large files (>30KB)
        if (content.length > 30000) {
          return { content: [{ type: "text", text: `[FILE TOO LARGE: ${filePath} is ${content.length} chars. Use read_file_range, grep_files, or functionName param instead.]\n\n${smartRead.fileMtree(require('path').dirname(filePath), 2)}` }] };
        }

        // Cache check: return cached result if available
        const cached = await compressor.checkCache(content, filePath);
        if (cached) {
          return { content: [{ type: "text", text: cached }] };
        }

        // Diff-Only: return only changes if file was read before
        const diffResult = dedup.trackFileRead(filePath, content);
        if (diffResult) {
          return { content: [{ type: "text", text: diffResult }] };
        }

        const compressed = await compressor.compressText(content, filePath);
        return {
          content: [
            {
              type: "text",
              text: compressed,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading file: ${e.message}`,
            },
          ],
          isError: true,
        };
      }
    }
    
    case "compress_file_chunked": {
      const { filePath, chunkSize = 4000 } = request.params.arguments;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const compressed = await compressor.compressText(content, filePath);
        const charChunkSize = chunkSize * 4;
        const chunks = [];
        for (let i = 0; i < compressed.length; i += charChunkSize) {
          chunks.push(compressed.slice(i, i + charChunkSize));
        }
        
        let resultText = '';
        chunks.forEach((chunk, idx) => {
          resultText += `\n--- CHUNK ${idx + 1}/${chunks.length} ---\n${chunk}\n`;
        });

        return {
          content: [{ type: "text", text: resultText }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
    
    case "read_function_body": {
      const { filePath, functionName } = request.params.arguments;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        // Return raw extracted code — minifying defeats the purpose of sniper mode
        const extracted = skeleton.extractFunction(content, filePath, functionName);
        return {
          content: [{ type: "text", text: extracted }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error reading function: ${e.message}` }],
          isError: true,
        };
      }
    }
    
    case "swarm_create_agent": {
      const { name, role } = request.params.arguments;
      try {
        return { content: [{ type: "text", text: swarm.createAgent(name, role) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
    
    case "swarm_assign_task": {
      const { name, task } = request.params.arguments;
      try {
        return { content: [{ type: "text", text: swarm.assignTask(name, task) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
    
    case "swarm_get_status": {
      return { content: [{ type: "text", text: swarm.getStatus() }] };
    }
    
    case "get_status": {
      const golf = require('./golf');
      const memory = require('./memory');
      const proxyInfo = downstreamClients.length > 0
        ? `Auto-Proxy: active (${downstreamClients.length} server(s), ${downstreamTools.length} tool(s))`
        : 'Auto-Proxy: inactive (no servers configured)';
      const statusLines = [
        `TokeSave Status`,
        `Mode: ${compressor.mode}`,
        `Adaptive: enabled (checks every 10 calls)`,
        `Cache:   active (local LRU: 100 entries)` + (cache.useRedis ? ' + Redis' : ''),
        `Total input tokens processed: ${compressor.totalInputTokens}`,
        proxyInfo,
        ``,
        `Features:`,
        `  AST Skeleton:      ${skeleton.enabled ? 'on' : 'off'}`,
        `  TextRank Distill:  ${distill.enabled  ? 'on' : 'off'}`,
        `  Auto-Minifier:     ${golf.enabled     ? 'on' : 'off'}`,
        `  Vector Memory:     ${memory.enabled   ? 'on' : 'off'}`,
        `  Compress Cache:    on`,
        `  Response Dedup:    on`,
        `  Diff Tracking:     on`,
        `  Base64 Stripper:   on`,
        `  Token/UUID Redact: on`,
        `  Path Compactor:    on`,
        `  Stack Slimmer:     on`,
        `  Separator Collapse: on`,
        ``,
        stats.getStats(),
      ];
      return { content: [{ type: "text", text: statusLines.join('\n') }] };
    }
    
    case "compress_url": {
      const { url, timeoutMs = 10000 } = request.params.arguments;
      try {
        const raw = await fetchUrl(url, timeoutMs);
        const scanned = shield.scan(raw);
        const shredded = htmlShredder.shred(scanned);
        const compressed = await compressor.compressText(shredded);
        const savedPct = (((raw.length - compressed.length) / raw.length) * 100).toFixed(1);
        const injectionNote = scanned !== raw ? ' | ⚠ injection pattern(s) blocked' : '';
        return {
          content: [{
            type: "text",
            text: `[URL: ${url} | Original: ${raw.length} chars → Compressed: ${compressed.length} chars | Saved: ${savedPct}%${injectionNote}]\n\n${compressed}`,
          }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error fetching URL: ${e.message}` }],
          isError: true,
        };
      }
    }

    case "summarize_file": {
      const { filePath, maxTokens = 500 } = request.params.arguments;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const targetChars = maxTokens * 4; // ~4 chars per token

        // If already fits, return as-is
        if (content.length <= targetChars) {
          return { content: [{ type: "text", text: content }] };
        }

        // Progressive compression: escalate mode until we fit within budget
        const modes = ['lite', 'standard', 'aggressive', 'brutal', 'oblivion'];
        const originalMode = compressor.mode;
        let result = content;

        for (const mode of modes) {
          compressor.setMode(mode);
          result = await compressor.compressText(content, filePath);
          if (result.length <= targetChars) break;
        }

        // Restore original mode
        compressor.setMode(originalMode);

        // If still over budget after all modes, hard-truncate with notice
        if (result.length > targetChars) {
          result = result.slice(0, targetChars) + `\n\n[TRUNCATED: content exceeded ${maxTokens} token budget]`;
        }

        const usedTokens = Math.ceil(result.length / 4);
        return {
          content: [{
            type: "text",
            text: `[SUMMARY: ~${usedTokens}/${maxTokens} tokens | File: ${path.basename(filePath)}]\n\n${result}`,
          }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }

    case "diff_files": {
      const { fileA, fileB } = request.params.arguments;
      try {
        const contentA = fs.readFileSync(fileA, 'utf8');
        const contentB = fs.readFileSync(fileB, 'utf8');

        if (contentA === contentB) {
          return { content: [{ type: "text", text: "[FILES IDENTICAL — no diff to show]" }] };
        }

        const linesA = contentA.split('\n');
        const linesB = contentB.split('\n');
        const diff = [];
        const maxLen = Math.max(linesA.length, linesB.length);

        for (let i = 0; i < maxLen; i++) {
          const lineA = linesA[i];
          const lineB = linesB[i];
          if (lineA === lineB) continue;
          if (lineA !== undefined) diff.push(`- L${i + 1}: ${lineA}`);
          if (lineB !== undefined) diff.push(`+ L${i + 1}: ${lineB}`);
        }

        const header = [
          `[DIFF: ${path.basename(fileA)} → ${path.basename(fileB)}]`,
          `[${linesA.length} lines → ${linesB.length} lines | ${diff.length} changed lines | ${diff.length} shown vs ${maxLen} total]`,
        ].join('\n');

        return {
          content: [{ type: "text", text: `${header}\n\n${diff.join('\n')}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }

    case "scan_injection": {
      const { text } = request.params.arguments;
      const scanned = shield.scan(text);
      const wasClean = scanned === text;
      const injectionCount = (scanned.match(/\[BLOCKED_INJECTION\]/g) || []).length;
      const summary = wasClean
        ? `[CLEAN — no injection patterns detected]`
        : `[BLOCKED ${injectionCount} injection pattern(s)]`;
      return {
        content: [{
          type: "text",
          text: `${summary}\n\n${scanned}`,
        }],
      };
    }

    case "compress_batch": {
      const { filePaths, maxConcurrent = 5 } = request.params.arguments;
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { content: [{ type: "text", text: "Error: filePaths must be a non-empty array" }], isError: true };
      }

      // Process in chunks to respect maxConcurrent
      const results = [];
      for (let i = 0; i < filePaths.length; i += maxConcurrent) {
        const batch = filePaths.slice(i, i + maxConcurrent);
        const batchResults = await Promise.all(
          batch.map(async (filePath) => {
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              const compressed = await compressor.compressText(content, filePath);
              const savedPct = (((content.length - compressed.length) / content.length) * 100).toFixed(1);
              return `\n--- ${path.basename(filePath)} [${content.length}→${compressed.length} chars, ${savedPct}% saved] ---\n${compressed}`;
            } catch (e) {
              return `\n--- ${path.basename(filePath)} [ERROR: ${e.message}] ---`;
            }
          })
        );
        results.push(...batchResults);
      }

      const header = `[BATCH: ${filePaths.length} files compressed]`;
      return {
        content: [{ type: "text", text: header + results.join('\n') }],
      };
    }

    case "recall_memory": {
      const memory = require('./memory');
      const { query, topK = 3 } = request.params.arguments;
      if (!memory.enabled) {
        return {
          content: [{ type: "text", text: "Vector memory is disabled. Enable it with useInfiniteMemory: true in tokesave.config.json" }],
        };
      }
      try {
        const result = await memory.recall(query, topK);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Memory recall error: ${e.message}` }], isError: true };
      }
    }

    case "benchmark": {
      const { text, filePath } = request.params.arguments;
      try {
        let inputText;
        if (filePath) {
          inputText = fs.readFileSync(filePath, 'utf8');
        } else if (text) {
          inputText = text;
        } else {
          return { content: [{ type: "text", text: "Provide either text or filePath" }], isError: true };
        }
        const result = await benchmark.runBenchmark(inputText);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Benchmark error: ${e.message}` }], isError: true };
      }
    }

    case "repo_audit": {
      try {
        const { repoPath } = request.params.arguments || {};
        const result = repoAudit.auditRepo(repoPath);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Audit error: ${e.message}` }], isError: true };
      }
    }

    case "repo_cleanup": {
      try {
        const { repoPath } = request.params.arguments || {};
        const result = repoCleanup.cleanup(repoPath);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Cleanup error: ${e.message}` }], isError: true };
      }
    }

    case "repo_cleanup_apply": {
      try {
        const { repoPath } = request.params.arguments || {};
        const result = repoCleanup.applyCleanup(repoPath);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Apply error: ${e.message}` }], isError: true };
      }
    }

    case "grep_files": {
      const { pattern, fileGlob = '*', contextLines = 2 } = request.params.arguments;
      try {
        const result = smartRead.grepFiles(pattern, fileGlob, contextLines);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `grep error: ${e.message}` }], isError: true };
      }
    }

    case "read_file_range": {
      const { filePath, startLine, endLine } = request.params.arguments;
      try {
        const result = smartRead.readFileRange(filePath, startLine, endLine);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `read range error: ${e.message}` }], isError: true };
      }
    }

    case "file_mtree": {
      const { dirPath, maxDepth } = request.params.arguments;
      try {
        const result = smartRead.fileMtree(dirPath, maxDepth);
        return { content: [{ type: "text", text: result }] };
      } catch (e) {
        return { content: [{ type: "text", text: `mtree error: ${e.message}` }], isError: true };
      }
    }

    default: {
      const toolName = request.params.name;
      const downstreamClient = downstreamToolMap.get(toolName);
      if (!downstreamClient) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      try {
        const response = await downstreamClient.request({
          method: "tools/call",
          params: { name: toolName, arguments: request.params.arguments || {} }
        }, CallToolRequestSchema);
        if (response.content && Array.isArray(response.content)) {
          for (const item of response.content) {
            if (item.type === 'text' && typeof item.text === 'string') {
              if (item.text.length < 200) continue;
              item.text = shield.scan(item.text);
              const dupResult = dedup.checkDuplicate(item.text);
              if (dupResult) { item.text = dupResult; continue; }
              try {
                JSON.parse(item.text);
              } catch {
                item.text = await compressor.compressText(item.text);
              }
            }
          }
        }
        return response;
      } catch (e) {
        return { content: [{ type: "text", text: `Downstream error (${toolName}): ${e.message}` }], isError: true };
      }
    }
  }
});

// Start server
async function run() {
  await initDownstreamServers();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const proxyActive = downstreamClients.length > 0;
  console.error(`TokeSave MCP server running on stdio${proxyActive ? ` [proxy: ${downstreamClients.length} server(s), ${downstreamTools.length} tool(s)]` : ''}`);
}

run().catch(console.error);
} // end startMcpServer
