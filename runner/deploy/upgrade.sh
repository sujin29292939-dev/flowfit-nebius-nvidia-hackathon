#!/usr/bin/env bash
# Git-based upgrade for the Mac mini flowfit-runner service.
# Usage: ./deploy/upgrade.sh [tag-or-branch]   (default: main)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$RUNNER_ROOT"

TARGET_REF="${1:-main}"
SERVICE_TARGET="gui/$(id -u)/com.flowfit.runner"

log()  { printf '[upgrade] %s\n' "$1"; }
fail() { printf '[upgrade][ERROR] %s\n' "$1" >&2; }

read_port() {
  if [[ -f .env ]]; then
    grep -E '^[[:space:]]*PORT[[:space:]]*=' .env | tail -1 | cut -d= -f2- | tr -d '[:space:]'
  fi
}
PORT="$(read_port)"
PORT="${PORT:-3001}"

restart_service() {
  log "Restarting com.flowfit.runner via launchctl kickstart"
  launchctl kickstart -k "$SERVICE_TARGET"
  sleep 3
}

smoke_check() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/queue" || echo "000")"
  log "GET /queue -> HTTP $code (expect 401)"
  [[ "$code" == "401" ]]
}

rollback() {
  fail "Upgrade step failed. Rolling back to previous commit ${PREVIOUS_COMMIT:0:12}"
  if ! git checkout --force "$PREVIOUS_COMMIT"; then
    fail "Rollback checkout failed. Manual intervention required."
    exit 1
  fi
  if ! npm ci; then
    fail "Rollback npm ci failed. Manual intervention required."
    exit 1
  fi
  if ! npm run build; then
    fail "Rollback build failed. Manual intervention required."
    exit 1
  fi
  restart_service
  if smoke_check; then
    fail "Rolled back to ${PREVIOUS_COMMIT:0:12} and restarted successfully. Upgrade to $TARGET_REF did NOT go live."
  else
    fail "Rollback restart did not pass the smoke check either. Manual intervention required."
  fi
  exit 1
}

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  fail "Working tree has uncommitted changes to tracked files. Resolve manually before upgrading."
  exit 1
fi

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
log "Current commit: $(git rev-parse --short HEAD)"

log "Fetching from origin"
if ! git fetch --tags origin; then rollback; fi

log "Checking out $TARGET_REF"
if git show-ref --verify --quiet "refs/tags/$TARGET_REF"; then
  if ! git checkout --force "refs/tags/$TARGET_REF"; then rollback; fi
else
  if ! git checkout --force "$TARGET_REF"; then rollback; fi
  if git symbolic-ref -q HEAD >/dev/null 2>&1; then
    if ! git merge --ff-only "origin/$TARGET_REF"; then rollback; fi
  fi
fi

log "Installing dependencies (npm ci)"
if ! npm ci; then rollback; fi

log "Building (npm run build)"
if ! npm run build; then rollback; fi

log "Running test suite"
if ! npm run test:offline-demotion; then rollback; fi
if ! npm run test:approval-resume; then rollback; fi

restart_service

log "Verifying service health"
if ! smoke_check; then rollback; fi

log "Upgrade to $(git rev-parse --short HEAD) ($TARGET_REF) succeeded."
