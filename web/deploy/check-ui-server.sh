#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

required_files=(
  "package.json"
  "package-lock.json"
  "next.config.mjs"
  "tsconfig.json"
  "app"
  "components"
  "services/runnerClient.ts"
)

required_env=(
  "FLOWFIT_RUNNER_URL"
  "FLOWFIT_RUNNER_API_KEY"
)

ok() { printf '[OK] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[ERROR] %s was not found in PATH.\n' "$1" >&2
    exit 1
  fi
  ok "$1 found: $(command -v "$1")"
}

cd "$UI_ROOT"

need_command node
need_command npm

for file in "${required_files[@]}"; do
  if [[ ! -e "$UI_ROOT/$file" ]]; then
    printf '[ERROR] Required UI file missing: %s\n' "$file" >&2
    exit 1
  fi
done
ok "Required UI files are present."

env_path="$UI_ROOT/.env.local"
if [[ ! -f "$env_path" ]]; then
  warn ".env.local is missing. Copy deploy/env.production.example to .env.local and fill Runner values."
else
  for name in "${required_env[@]}"; do
    if ! grep -Eq "^[[:space:]]*${name}[[:space:]]*=" "$env_path"; then
      warn ".env.local does not define $name"
    fi
  done

  if grep -Eq "ff_[a-fA-F0-9]{32,}|sk-|gsk_|AIza" "$env_path"; then
    warn ".env.local contains secret-looking values. This is okay on the target machine, but never include .env.local in deployment zip."
  fi
  ok ".env.local check completed without printing secret values."
fi

for name in node_modules .next .next-dev .npm-cache .flowfit; do
  if [[ -e "$UI_ROOT/$name" ]]; then
    warn "$name exists locally. Exclude it from deployment zip."
  fi
done

ok "FlowFit UI deployment check completed."