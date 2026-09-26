param(
  [string]$AppDir = $PSScriptRoot,
  [int]$Port = 3001
)

$ErrorActionPreference = "Stop"

function Get-PortPids {
  param([int]$LocalPort)

  try {
    return @(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    $pattern = ":{0}\s+.+LISTENING\s+(\d+)$" -f $LocalPort
    $matches = @(netstat -ano -p tcp | Select-String -Pattern $pattern)
    return @($matches | ForEach-Object { $_.Matches[0].Groups[1].Value } | Where-Object { $_ } | Select-Object -Unique)
  }
}

$AppDir = [System.IO.Path]::GetFullPath($AppDir.Trim().Trim('"'))
$RunnerDir = [System.IO.Path]::GetFullPath((Join-Path $AppDir "..\runner"))
$RunnerEntry = Join-Path $RunnerDir "dist\index.js"

if (-not (Test-Path -LiteralPath $RunnerEntry)) {
  throw "flowfit_runner_build_not_found"
}

$LogDir = Join-Path $RunnerDir ".flowfit"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$StdOutLog = Join-Path $LogDir "runner.stdout.log"
$StdErrLog = Join-Path $LogDir "runner.stderr.log"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "node_not_found"
}

foreach ($pidValue in @(Get-PortPids -LocalPort $Port)) {
  Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
}

$launchCommand = 'cmd.exe /c cd /d "{0}" && set "PORT={1}" && "{2}" dist\index.js 1>>"{3}" 2>>"{4}"' -f `
  $RunnerDir,
  $Port,
  $nodeCommand.Source,
  $StdOutLog,
  $StdErrLog

$shell = New-Object -ComObject WScript.Shell
$null = $shell.Run($launchCommand, 0, $false)

$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 500
  if (@(Get-PortPids -LocalPort $Port).Count -gt 0) {
    Write-Output (@{
      running = $true
      port = $Port
      runner_dir = $RunnerDir
      stdout_log = $StdOutLog
      stderr_log = $StdErrLog
    } | ConvertTo-Json -Compress)
    exit 0
  }
} while ((Get-Date) -lt $deadline)

throw "flowfit_runner_start_timeout"
