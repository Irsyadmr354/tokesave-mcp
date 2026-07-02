const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const compressor = require('./compress');
const cache = require('./cache');
const fs = require('fs');
const path = require('path');

async function startRouter() {
  const configPath = path.join(process.cwd(), 'tokesave.config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const serversConfig = config.servers || {};
  const mockMode = config.mockMode === true;
  const autoInject = config.autoInject || {};
  const redactPII = config.redactPII === true;

  if (config.redisUrl) {
    await cache.connectRedis(config.redisUrl);
  }

  if (redactPII) {
    compressor.setRedactPII(true);
  }

  const toolRegistry = new Map();
  const clients = [];

  // Initialize downstream clients
  for (const [serverName, serverConf] of Object.entries(serversConfig)) {
    try {
      const transport = new StdioClientTransport({
        command: serverConf.command,
        args: serverConf.args,
        stderr: 'inherit'
      });

      const client = new Client({ name: "tokesave-router", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);
      clients.push(client);

      const toolsResponse = await client.request({ method: "tools/list" }, ListToolsRequestSchema);
      for (const tool of toolsResponse.tools) {
        toolRegistry.set(tool.name, client);
      }
      console.error(`Connected to downstream server: ${serverName}`);
    } catch (e) {
      console.error(`Failed to connect to ${serverName}:`, e.message);
    }
  }

  const server = new Server({ name: "tokesave-router", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let allTools = [];
    for (const client of clients) {
      try {
        const res = await client.request({ method: "tools/list" }, ListToolsRequestSchema);
        allTools = allTools.concat(res.tools);
      } catch (e) {}
    }
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const client = toolRegistry.get(toolName);

    if (!client) {
      throw new Error(`Tool ${toolName} not found in any routed server.`);
    }

    // Auto Inject
    let args = request.params.arguments || {};
    if (autoInject[toolName]) {
      args = { ...autoInject[toolName], ...args };
    }

    // Mock Mode
    if (mockMode) {
      return {
        content: [{ type: "text", text: `[MOCKED RESPONSE for ${toolName}]` }]
      };
    }

    // Cache Check
    const hash = cache.generateHash("tools/call", { name: toolName, arguments: args });
    const cachedResponse = await cache.get(hash);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Forward Request
    const response = await client.request({
      method: "tools/call",
      params: { name: toolName, arguments: args }
    }, CallToolRequestSchema);

    // Compress
    if (response.content && Array.isArray(response.content)) {
      for (const item of response.content) {
        if (item.type === 'text' && typeof item.text === 'string') {
          try {
            const parsed = JSON.parse(item.text);
            if (item.text.length > 5000 && typeof parsed === 'object') {
              delete parsed.description;
              delete parsed.metadata;
            }
            item.text = JSON.stringify(parsed);
          } catch (e) {
            item.text = await compressor.compressText(item.text);
          }
        }
      }
    }

    await cache.set(hash, response);
    return response;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TokeSave Multi-Server Router running on stdio");
}

module.exports = { startRouter };
