const fs = require('fs');
const path = require('path');
const os = require('os');

const MCP_CONFIG_PATHS = [
  { label: 'Cursor', path: path.join(os.homedir(), '.cursor', 'mcp.json') },
  { label: 'Claude Desktop (Linux/macOS)', path: path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json') },
  { label: 'Claude Desktop (Windows)', path: process.env.APPDATA ? path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : null },
  { label: 'Kiro', path: path.join(os.homedir(), '.kiro', 'settings', 'mcp.json') },
];

function readMcpConfig(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const servers = raw.mcpServers || raw.servers || {};
    return { filePath, servers, raw };
  } catch (_) {
    return null;
  }
}

function detectMcpServers() {
  const found = [];
  for (const entry of MCP_CONFIG_PATHS) {
    const config = readMcpConfig(entry.path);
    if (!config) continue;
    for (const [name, srv] of Object.entries(config.servers)) {
      if (name === 'tokesave' || name.startsWith('tokesave-')) continue;
      found.push({
        name,
        command: srv.command,
        args: srv.args || [],
        env: srv.env,
        source: entry.label,
        sourcePath: entry.path,
      });
    }
  }
  return found;
}

function buildTokesaveConfig(servers, options = {}) {
  const serversBlock = {};
  for (const srv of servers) {
    serversBlock[srv.name] = {
      command: srv.command,
      args: srv.args,
    };
    if (srv.env && Object.keys(srv.env).length > 0) {
      serversBlock[srv.name].env = srv.env;
    }
  }

  return {
    mode: options.mode || 'aggressive',
    maxAdaptiveLevel: options.maxAdaptiveLevel || 'brutal',
    redactPII: true,
    useAstSkeleton: true,
    contextPressure: {
      alertThreshold: options.alertThreshold || 50000,
      criticalThreshold: options.criticalThreshold || 80000,
    },
    servers: serversBlock,
  };
}

function buildMcpInstructions(servers) {
  if (servers.length === 0) {
    return [
      'No other MCP servers detected in known config locations.',
      'Add servers to ~/.cursor/mcp.json first, then re-run generate_proxy_config.',
    ].join('\n');
  }

  const lines = [
    '── MCP CLIENT SETUP INSTRUCTIONS ──',
    '',
    'Replace each original server entry with a TokeSave proxy_wrap entry:',
    '',
  ];

  for (const srv of servers) {
    const argsStr = (srv.args || []).map(a => JSON.stringify(a)).join(', ');
    lines.push(`  "${srv.name}" → remove from mcp.json, add:`);
    lines.push(`    "tokesave-${srv.name}": {`);
    lines.push(`      "command": "tokesave-mcp",`);
    lines.push(`      "args": ["proxy_wrap", ${JSON.stringify(srv.command)}${argsStr ? ', ' + argsStr : ''}]`);
    lines.push(`    }`);
    lines.push('');
    lines.push(`  Or use auto-proxy mode: keep "tokesave" entry + add servers to tokesave.config.json`);
    lines.push(`  (detected from ${srv.source}: ${srv.sourcePath})`);
    lines.push('');
  }

  return lines.join('\n');
}

function getDefaultConfigPath() {
  const homeConfig = path.join(os.homedir(), '.tokesave.config.json');
  const cwdConfig = path.join(process.cwd(), 'tokesave.config.json');
  if (fs.existsSync(cwdConfig)) return cwdConfig;
  return homeConfig;
}

function generateProxyConfig(options = {}) {
  const writeFile = options.writeFile !== false;
  const servers = detectMcpServers();

  const config = buildTokesaveConfig(servers, options);
  const configJson = JSON.stringify(config, null, 2);
  const instructions = buildMcpInstructions(servers);

  let writtenPath = null;
  if (writeFile && servers.length > 0) {
    const targetPath = options.configPath || getDefaultConfigPath();
    fs.writeFileSync(targetPath, configJson + '\n', 'utf8');
    writtenPath = targetPath;
  }

  const summary = [
    `Detected ${servers.length} MCP server(s):`,
    ...servers.map(s => `  • ${s.name} (${s.command} ${(s.args || []).join(' ')}) [${s.source}]`),
    '',
    writtenPath ? `Config written to: ${writtenPath}` : 'Config not written (no servers detected or writeFile=false)',
    '',
    instructions,
    '',
    '── GENERATED tokesave.config.json ──',
    configJson,
  ].join('\n');

  return { servers, config, configJson, writtenPath, summary };
}

module.exports = {
  detectMcpServers,
  buildTokesaveConfig,
  buildMcpInstructions,
  generateProxyConfig,
  MCP_CONFIG_PATHS,
};
