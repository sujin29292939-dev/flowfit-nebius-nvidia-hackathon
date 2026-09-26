#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

required_files=(
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  "src/index.ts"
  "src/runner/server.ts"
  "src/db/migrate.ts"
)

required_env=(
  "DATABASE_URL"
  "PORT"
  "STUDIO_ORIGIN"
  "RUNNER_API_KEYS"
  "SESSION_ENCRYPTION_KEY_BASE64"
  "SESSION_ENCRYPTION_KEY_ID"
)

ok() {
  printf '[OK] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1"
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[ERROR] %s was not found in PATH.\n' "$1" >&2
    exit 1
  fi
  ok "$1 found: $(command -v "$1")"
}

cd "$RUNNER_ROOT"

need_command node
need_command npm

for file in "${required_files[@]}"; do
  if [[ ! -e "$RUNNER_ROOT/$file" ]]; then
    printf '[ERROR] Required server file missing: %s\n' "$file" >&2
    exit 1
  fi
done
ok "Required server files are present."

env_path="$RUNNER_ROOT/.env"
if [[ ! -f "$env_path" ]]; then
  warn ".env is missing. Copy deploy/env.production.example to .env and fill values on the target machine."
else
  for name in "${required_env[@]}"; do
    if ! grep -Eq "^[[:space:]]*${name}[[:space:]]*=" "$env_path"; then
      warn ".env does not define $name"
    fi
  done

  if grep -Eq "sk-|gsk_|postgresql://[^[:space:]]+" "$env_path"; then
    warn ".env contains secret-looking values. This is okay on the target machine, but never include .env in deployment zip."
  fi
  ok ".env check completed without printing secret values."
fi

for name in node_modules dist .npm-cache .flowfit; do
  if [[ -e "$RUNNER_ROOT/$name" ]]; then
    warn "$name exists locally. Exclude it from deployment zip."
  fi
done

ok "FlowFit Runner deployment check completed."
