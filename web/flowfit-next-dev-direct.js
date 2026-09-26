const { startServer } = require("next/dist/server/lib/start-server");

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

const dir = process.env.FLOWFIT_APP_DIR || process.cwd();
const hostname = readArg("--hostname", process.env.HOSTNAME || "0.0.0.0");
const port = Number.parseInt(readArg("--port", process.env.PORT || "3007"), 10);

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED || "1";

startServer({
  dir,
  hostname,
  port,
  isDev: true,
  allowRetry: false,
}).catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
