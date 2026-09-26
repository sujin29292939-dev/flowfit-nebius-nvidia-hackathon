#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_PATH="$UI_ROOT/.env.local"
TEMPLATE_PATH="$SCRIPT_DIR/env.production.example"

force=false
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    *)
      printf '[ERROR] Unknown option: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  printf '[ERROR] Template not found: %s\n' "$TEMPLATE_PATH" >&2
  exit 1
fi

if [[ -f "$ENV_PATH" && "$force" != "true" ]]; then
  printf '[ERROR] .env.local already exists: %s\n' "$ENV_PATH" >&2
  printf '        Refusing to overwrite UI secrets. Use --force only after backing it up.\n' >&2
  exit 1
fi

if [[ -f "$ENV_PATH" && "$force" == "true" ]]; then
  backup="$ENV_PATH.backup.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_PATH" "$backup"
  printf '[init-ui-env] Existing .env.local backed up to %s\n' "$backup"
fi

cp "$TEMPLATE_PATH" "$ENV_PATH"
chmod 600 "$ENV_PATH" || true

runner_url="${FLOWFIT_RUNNER_URL:-http://127.0.0.1:3001}"
runner_key="${FLOWFIT_RUNNER_API_KEY:-}"

if [[ -z "$runner_key" && -f "$UI_ROOT/../flowfit-runner/.env" ]]; then
  runner_key="$(grep '^RUNNER_API_KEYS=' "$UI_ROOT/../flowfit-runner/.env" | cut -d= -f2 | cut -d, -f1 || true)"
fi

FLOWFIT_UI_ENV_PATH="$ENV_PATH" \
FLOWFIT_UI_RUNNER_URL="$runner_url" \
FLOWFIT_UI_RUNNER_KEY="$runner_key" \
node --input-type=commonjs <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(process.env.FLOWFIT_UI_ENV_PATH);
const updates = {
  FLOWFIT_RUNNER_URL: process.env.FLOWFIT_UI_RUNNER_URL,
  FLOWFIT_RUNNER_API_KEY: process.env.FLOWFIT_UI_RUNNER_KEY,
  FLOWFIT_ENGINE_BASE_URL: process.env.FLOWFIT_UI_RUNNER_URL,
  FLOWFIT_BROWSER_ENGINE_BASE_URL: process.env.FLOWFIT_UI_RUNNER_URL,
  FLOWFIT_MOBILE_ENGINE_BASE_URL: process.env.FLOWFIT_UI_RUNNER_URL,
};

let text = fs.readFileSync(envPath, "utf8");
for (const [key, rawValue] of Object.entries(updates)) {
  const value = String(rawValue ?? "").replace(/\r?\n/g, "");
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
}
fs.writeFileSync(envPath, text);
NODE

printf '[init-ui-env] Created %s\n' "$ENV_PATH"
if [[ -z "$runner_key" ]]; then
  printf '[WARN] FLOWFIT_RUNNER_API_KEY is empty. Edit .env.local before starting UI.\n' >&2
else
  printf '[init-ui-env] Runner key copied without printing it.\n'
fi
printf '[init-ui-env] Next: npm run deploy:check:mac\n'