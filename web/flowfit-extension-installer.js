const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EXTENSION_DIR = path.join(__dirname, "flowfit-extension");
const MANIFEST_FILE = path.join(EXTENSION_DIR, "manifest.json");
const INSTALL_SCRIPT = path.join(EXTENSION_DIR, "install-extension.ps1");
const INSTALL_FLAG = path.join(__dirname, ".flowfit", "extension-installed.json");
const OPT_IN_ENV_VARS = ["FLOWFIT_EXTENSION_AUTO_INSTALL", "FLOWFIT_AUTO_INSTALL_EXTENSION"];

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isAutoInstallEnabled(options = {}) {
  if (options.optIn) {
    return true;
  }

  if (process.argv.includes("--install-extension")) {
    return true;
  }

  return OPT_IN_ENV_VARS.some((name) => isTruthy(process.env[name]));
}

function readManifestVersion() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readInstallFlag() {
  try {
    return JSON.parse(fs.readFileSync(INSTALL_FLAG, "utf8"));
  } catch {
    return null;
  }
}

function writeInstallFlag(data) {
  fs.mkdirSync(path.dirname(INSTALL_FLAG), { recursive: true });
  fs.writeFileSync(INSTALL_FLAG, JSON.stringify(data, null, 2), "utf8");
}

function ensureExtension(options = {}) {
  if (!isAutoInstallEnabled(options)) {
    console.log(
      "[FlowFit Extension] registry policy install skipped. Set FLOWFIT_EXTENSION_AUTO_INSTALL=1 to opt in.",
    );
    return { ok: true, skipped: true, reason: "opt_in_required" };
  }

  if (os.platform() !== "win32") {
    console.log("[FlowFit Extension] registry policy install is only supported on Windows.");
    return { ok: false, skipped: true, reason: "unsupported_platform" };
  }

  const version = readManifestVersion();
  const previous = readInstallFlag();
  if (previous?.version === version && previous?.installed) {
    console.log(`[FlowFit Extension] v${version} already registered.`);
    return { ok: true, skipped: true, version };
  }

  if (!fs.existsSync(INSTALL_SCRIPT)) {
    return { ok: false, reason: "install_script_missing" };
  }

  const result = spawnSync(
    "powershell.exe",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-NonInteractive",
      "-File",
      INSTALL_SCRIPT,
      "-ExtensionPath",
      EXTENSION_DIR,
      "-OptIn",
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    return { ok: false, reason: "install_script_failed", status: result.status };
  }

  writeInstallFlag({ installed: true, version, installedAt: new Date().toISOString() });
  console.log(`[FlowFit Extension] v${version} registered.`);
  return { ok: true, version };
}

module.exports = { ensureExtension, isAutoInstallEnabled };
