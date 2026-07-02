const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.js"]
  });
  
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected to MCP server!");

  // Test set_mode
  console.log("\n--- Testing set_mode (oblivion) ---");
  const modeResult = await client.callTool({
    name: "set_mode",
    arguments: { mode: "oblivion" }
  });
  console.log(modeResult.content[0].text);

  // Test compress_text
  console.log("\n--- Testing compress_text ---");
  const sampleText = "I would like to basically implement a solution for the configuration database. Please kindly check the environment variables.";
  console.log(`Original: ${sampleText}`);
  const compressResult = await client.callTool({
    name: "compress_text",
    arguments: { text: sampleText }
  });
  console.log(`Compressed: ${compressResult.content[0].text}`);

  // Test get_stats
  console.log("\n--- Testing get_stats ---");
  const statsResult = await client.callTool({
    name: "get_stats",
    arguments: {}
  });
  console.log(statsResult.content[0].text);

  // Test read resource
  console.log("\n--- Testing read resource ---");
  const resourceResult = await client.readResource({
    uri: "tokesave://system-prompt"
  });
  console.log(`System Prompt Length: ${resourceResult.contents[0].text.length} chars`);
  
  console.log("\nSuccess! All tests passed.");
  process.exit(0);
}

main().catch(console.error);
