#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_PATH="$RUNNER_ROOT/.env"
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
  printf '[ERROR] .env already exists: %s\n' "$ENV_PATH" >&2
  printf '        Refusing to overwrite production secrets. Use --force only after backing it up.\n' >&2
  exit 1
fi

if [[ -f "$ENV_PATH" && "$force" == "true" ]]; then
  backup="$ENV_PATH.backup.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_PATH" "$backup"
  printf '[init-env] Existing .env backed up to %s\n' "$backup"
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[ERROR] %s is required but was not found in PATH.\n' "$1" >&2
    exit 1
  fi
}

require_command node
require_command openssl

prompt_default() {
  local name="$1"
  local default_value="$2"
  local value
  if [[ -t 0 ]]; then
    read -r -p "$name [$default_value]: " value
    printf '%s' "${value:-$default_value}"
  else
    printf '%s' "$default_value"
  fi
}

prompt_secret_optional() {
  local name="$1"
  local value=""
  if [[ -t 0 ]]; then
    read -r -s -p "$name (optional, input hidden): " value
    printf '\n' >&2
  fi
  printf '%s' "$value"
}

prompt_secret_required_or_placeholder() {
  local name="$1"
  local placeholder="$2"
  local value=""
  if [[ -t 0 ]]; then
    read -r -s -p "$name (required, input hidden): " value
    printf '\n' >&2
  fi
  printf '%s' "${value:-$placeholder}"
}

cp "$TEMPLATE_PATH" "$ENV_PATH"
chmod 600 "$ENV_PATH" || true

studio_origin="${STUDIO_ORIGIN:-$(prompt_default STUDIO_ORIGIN "http://127.0.0.1:3007")}"
port="${PORT:-$(prompt_default PORT "3001")}"
database_url="${DATABASE_URL:-$(prompt_secret_required_or_placeholder DATABASE_URL "postgresql://user:password@host/db?sslmode=require")}"
groq_api_key="${GROQ_API_KEY:-$(prompt_secret_optional GROQ_API_KEY)}"
anthropic_api_key="${ANTHROPIC_API_KEY:-$(prompt_secret_optional ANTHROPIC_API_KEY)}"
gemini_api_key="${GEMINI_API_KEY:-$(prompt_secret_optional GEMINI_API_KEY)}"

runner_api_key="${RUNNER_API_KEYS:-ff_$(openssl rand -hex 32)}"
session_key="$(openssl rand -base64 32)"
session_key_id="key-$(date +%Y%m%d)"
device_command_secret="${DEVICE_COMMAND_SECRET:-$(openssl rand -hex 32)}"
device_token_pepper="${DEVICE_TOKEN_PEPPER:-$(openssl rand -hex 32)}"
company_token_pepper="${COMPANY_TOKEN_PEPPER:-$(openssl rand -hex 32)}"

FLOWFIT_ENV_NODE_ENV="${NODE_ENV:-production}" \
FLOWFIT_ENV_PATH="$ENV_PATH" \
FLOWFIT_ENV_PORT="$port" \
FLOWFIT_ENV_STUDIO_ORIGIN="$studio_origin" \
FLOWFIT_ENV_RUNNER_API_KEYS="$runner_api_key" \
FLOWFIT_ENV_SESSION_ENCRYPTION_KEY_BASE64="$session_key" \
FLOWFIT_ENV_SESSION_ENCRYPTION_KEY_ID="$session_key_id" \
FLOWFIT_ENV_DEVICE_COMMAND_SECRET="$device_command_secret" \
FLOWFIT_ENV_DEVICE_TOKEN_PEPPER="$device_token_pepper" \
FLOWFIT_ENV_COMPANY_TOKEN_PEPPER="$company_token_pepper" \
FLOWFIT_ENV_DATABASE_URL="$database_url" \
FLOWFIT_ENV_GEMINI_API_KEY="$gemini_api_key" \
FLOWFIT_ENV_GROQ_API_KEY="$groq_api_key" \
FLOWFIT_ENV_ANTHROPIC_API_KEY="$anthropic_api_key" \
node --input-type=commonjs <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(process.env.FLOWFIT_ENV_PATH ?? path.join(process.cwd(), ".env"));
const updates = {
  NODE_ENV: process.env.FLOWFIT_ENV_NODE_ENV,
  PORT: process.env.FLOWFIT_ENV_PORT,
  STUDIO_ORIGIN: process.env.FLOWFIT_ENV_STUDIO_ORIGIN,
  RUNNER_API_KEYS: process.env.FLOWFIT_ENV_RUNNER_API_KEYS,
  SESSION_ENCRYPTION_KEY_BASE64: process.env.FLOWFIT_ENV_SESSION_ENCRYPTION_KEY_BASE64,
  SESSION_ENCRYPTION_KEY_ID: process.env.FLOWFIT_ENV_SESSION_ENCRYPTION_KEY_ID,
  DEVICE_COMMAND_SECRET: process.env.FLOWFIT_ENV_DEVICE_COMMAND_SECRET,
  DEVICE_TOKEN_PEPPER: process.env.FLOWFIT_ENV_DEVICE_TOKEN_PEPPER,
  COMPANY_TOKEN_PEPPER: process.env.FLOWFIT_ENV_COMPANY_TOKEN_PEPPER,
  DATABASE_URL: process.env.FLOWFIT_ENV_DATABASE_URL,
  GEMINI_API_KEY: process.env.FLOWFIT_ENV_GEMINI_API_KEY,
  GROQ_API_KEY: process.env.FLOWFIT_ENV_GROQ_API_KEY,
  ANTHROPIC_API_KEY: process.env.FLOWFIT_ENV_ANTHROPIC_API_KEY,
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

printf '[init-env] Created %s\n' "$ENV_PATH"
printf '[init-env] Generated RUNNER_API_KEYS, SESSION_ENCRYPTION_KEY_*, device secrets, and token peppers.\n'
printf '[init-env] Secret values were written to .env and were not printed.\n'

if grep -q 'postgresql://user:password@host/db' "$ENV_PATH"; then
  printf '[WARN] DATABASE_URL still has the placeholder value. Edit .env before starting the server.\n' >&2
fi

printf '[init-env] Next: npm run deploy:check:mac\n'
