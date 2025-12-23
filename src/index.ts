import "dotenv/config";
import { startServer } from "./server.js";
import { serverLog } from "./logger.js";

const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
const logLevel = process.env.LOG_LEVEL ?? "info";

serverLog.info("Starting Anthropic-Cerebras shim", {
  logLevel,
  nodeVersion: process.version,
});

if (!cerebrasApiKey) {
  serverLog.error("Missing required environment variable", {
    variable: "CEREBRAS_API_KEY",
  });
  process.exit(1);
}

serverLog.debug("Configuration loaded", {
  apiKeyPrefix: cerebrasApiKey.slice(0, 8) + "...",
  apiKeyLength: cerebrasApiKey.length,
});

const port = parseInt(process.env.PORT ?? "3000", 10);

startServer({
  cerebrasApiKey,
  port,
}).then(() => {
  serverLog.info("Startup complete - ready to accept requests", { port });
}).catch((error) => {
  serverLog.error("Failed to start server", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

export { createServer, startServer } from "./server.js";
export { CerebrasClient } from "./cerebras-client.js";
export * from "./translators/index.js";
export * as Anthropic from "./types/anthropic.js";
export * as Cerebras from "./types/cerebras.js";
export { createLogger } from "./logger.js";
export type { LogLevel } from "./logger.js";
