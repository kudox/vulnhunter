#!/usr/bin/env node
/**
 * LastCall MCP server — a perishable-inventory promotion marketplace.
 *
 * Merchants post expiring inventory (tonight's empty seats, unsold tickets,
 * open slots) as targeted promotions; AI agents search, claim, and redeem
 * them on behalf of users. Merchants pay only on redemption.
 *
 * Transports:
 *   - stdio (default): for local clients (Claude Desktop, Claude Code)
 *   - streamable HTTP: set TRANSPORT=http (and optionally PORT)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { createServer } from "./server.js";

async function runStdio(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport: stdout is protocol traffic, so log to stderr only.
  console.error("LastCall MCP server running via stdio");
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  // One store shared across requests; a new transport per request keeps the
  // HTTP layer stateless (no sessions), which is the simplest thing to scale.
  const { server } = createServer();

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  // Bind to loopback by default; deployments behind a real ingress set HOST.
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    console.error(`LastCall MCP server running on http://${host}:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT ?? "stdio";
const main = transport === "http" ? runHttp : runStdio;
main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
