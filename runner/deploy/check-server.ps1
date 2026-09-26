$ErrorActionPreference = "Stop"

$runnerRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$requiredFiles = @(
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "src\index.ts",
  "src\runner\server.ts",
  "src\db\migrate.ts"
)

$requiredEnv = @(
  "DATABASE_URL",
  "PORT",
  "STUDIO_ORIGIN",
  "RUNNER_API_KEYS",
  "SESSION_ENCRYPTION_KEY_BASE64",
  "SESSION_ENCRYPTION_KEY_ID"
)

function Write-Ok {
  param([string]$Message)
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Assert-Command {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "$Name was not found in PATH."
  }
  Write-Ok "$Name found: $($cmd.Source)"
}

Push-Location $runnerRoot
try {
  Assert-Command "node"
  Assert-Command "npm"

  foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $runnerRoot $file))) {
      throw "Required server file missing: $file"
    }
  }
  Write-Ok "Required server files are present."

  $envPath = Join-Path $runnerRoot ".env"
  if (-not (Test-Path -LiteralPath $envPath)) {
    Write-Warn ".env is missing. Copy deploy\env.production.example to .env and fill values on the target machine."
  } else {
    $envText = Get-Content -LiteralPath $envPath -Raw
    foreach ($name in $requiredEnv) {
      if ($envText -notmatch "(?m)^\s*$([regex]::Escape($name))\s*=") {
        Write-Warn ".env does not define $name"
      }
    }

    if ($envText -match "sk-|gsk_|postgresql://[^`r`n]+") {
      Write-Warn ".env contains secret-looking values. This is okay on the target machine, but never include .env in deployment zip."
    }
    Write-Ok ".env check completed without printing secret values."
  }

  $forbiddenInPackage = @("node_modules", "dist", ".npm-cache", ".flowfit")
  foreach ($name in $forbiddenInPackage) {
    if (Test-Path -LiteralPath (Join-Path $runnerRoot $name)) {
      Write-Warn "$name exists locally. Exclude it from deployment zip."
    }
  }

  Write-Ok "FlowFit Runner deployment check completed."
} finally {
  Pop-Location
}
