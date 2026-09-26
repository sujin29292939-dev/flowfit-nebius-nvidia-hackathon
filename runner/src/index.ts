// src/index.ts
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const { startServer } = await import("./runner/server.js");
const { startEmailPoller } = await import("./intake/emailPoller.js");
const { startSitePollers } = await import("./intake/sitePoller.js");
const { startAutonomyGateDispatchLoop } = await import("./autonomyGate/runtime.js");
const { startDueScanner } = await import("./sla/dueScanner.js");
const { startConnectorRetryWorker } = await import("./connectors/retryWorker.js");

const server = startServer();
const stopAutonomyGateDispatchLoop = startAutonomyGateDispatchLoop();
const stopDueScanner = startDueScanner();
const stopConnectorRetryWorker = startConnectorRetryWorker();
startEmailPoller();
startSitePollers();

const keepAlive = setInterval(() => undefined, 60 * 60 * 1000);

function shutdown() {
  clearInterval(keepAlive);
  stopAutonomyGateDispatchLoop();
  stopDueScanner();
  stopConnectorRetryWorker();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
