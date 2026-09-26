param(
  [string]$OutputDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")) ".flowfit-exports"),
  [string]$StageDir = (Join-Path $env:TEMP "flowfit-runner-deploy-stage")
)

$ErrorActionPreference = "Stop"

$runnerRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
[void](New-Item -ItemType Directory -Force -Path $OutputDir)
$zipPath = Join-Path $OutputDir "flowfit-runner-deploy-$timestamp.zip"

$excludeDirs = @(
  "node_modules",
  "dist",
  ".npm-cache",
  ".flowfit"
)

$excludeFiles = @(
  ".env",
  ".env.local",
  "*.log",
  "runner*.log",
  ".runner*.log",
  "migrate_log.txt"
)

function Write-Step {
  param([string]$Message)
  Write-Host "[pack] $Message"
}

if (Test-Path -LiteralPath $StageDir) {
  Remove-Item -LiteralPath $StageDir -Recurse -Force
}

Write-Step "Staging runner files from $runnerRoot"
$robocopyArgs = @(
  $runnerRoot,
  $StageDir,
  "/MIR",
  "/XD"
) + $excludeDirs + @(
  "/XF"
) + $excludeFiles + @(
  "/NFL",
  "/NDL",
  "/NJH",
  "/NJS",
  "/NP"
)

& robocopy @robocopyArgs | Out-Null
$code = $LASTEXITCODE
if ($code -ge 8) {
  throw "robocopy failed with exit code $code"
}

Write-Step "Creating zip: $zipPath"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $zipPath -Force

Write-Step "Verifying forbidden files are not inside staging folder"
$forbidden = @(
  ".env",
  ".env.local",
  "node_modules",
  "dist",
  ".npm-cache",
  ".flowfit"
)
foreach ($name in $forbidden) {
  if (Test-Path -LiteralPath (Join-Path $StageDir $name)) {
    throw "Forbidden deployment item found in staging folder: $name"
  }
}

Write-Output $zipPath
