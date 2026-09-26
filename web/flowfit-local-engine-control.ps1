param(
  [ValidateSet("start", "stop", "status")]
  [string]$Mode = "status",
  [string]$AppDir = $PSScriptRoot,
  [string]$HealthHost = "127.0.0.1",
  [int]$Port = 3001
)

$ErrorActionPreference = "Stop"

function Test-EngineReady {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-EnginePids {
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
$EngineScript = Join-Path $AppDir "flowfit-local-engine.js"
$EngineScriptName = [System.IO.Path]::GetFileName($EngineScript)
$LogDir = Join-Path $AppDir ".flowfit"
$StdOutLog = Join-Path $LogDir "local-engine.stdout.log"
$StdErrLog = Join-Path $LogDir "local-engine.stderr.log"
$HealthUrl = "http://{0}:{1}/collector/health" -f $HealthHost, $Port

if (-not (Test-Path -LiteralPath $EngineScript)) {
  throw "local_engine_script_not_found"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$BundledNodePath = Join-Path $AppDir "runtime\node.exe"
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$NodePath = if (Test-Path -LiteralPath $BundledNodePath) {
  $BundledNodePath
} elseif ($nodeCommand) {
  $nodeCommand.Source
} else {
  $null
}

if (-not $NodePath) {
  throw "node_not_found"
}

switch ($Mode) {
  "start" {
    if (Test-EngineReady -Url $HealthUrl) {
      $runningPids = @(Get-EnginePids -LocalPort $Port)
      $result = [ordered]@{
        connected = $true
        started = $false
        running = $runningPids.Count -gt 0
        pids = $runningPids
      } | ConvertTo-Json -Compress
      Write-Output $result
      exit 0
    }

    $existingPids = @(Get-EnginePids -LocalPort $Port)
    foreach ($existingPid in $existingPids) {
      Stop-Process -Id ([int]$existingPid) -Force -ErrorAction SilentlyContinue
    }

    $launchCommand = 'cmd.exe /c cd /d "{0}" && "{1}" "{2}" 1>>"{3}" 2>>"{4}"' -f `
      $AppDir,
      $NodePath,
      $EngineScriptName,
      $StdOutLog,
      $StdErrLog

    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Run($launchCommand, 0, $false)

    $deadline = (Get-Date).AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 500
      if (Test-EngineReady -Url $HealthUrl) {
        $runningPids = @(Get-EnginePids -LocalPort $Port)
        $result = [ordered]@{
          connected = $true
          started = $true
          running = $runningPids.Count -gt 0
          pids = $runningPids
        } | ConvertTo-Json -Compress
        Write-Output $result
        exit 0
      }
    } while ((Get-Date) -lt $deadline)

    throw "local_engine_start_timeout"
  }

  "stop" {
    $engineProcesses = @(Get-EnginePids -LocalPort $Port)
    $stoppedPids = @()
    foreach ($engineProcess in $engineProcesses) {
      $processId = [int]$engineProcess
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      $stoppedPids += $processId
    }

    $result = [ordered]@{
      connected = $false
      stopped = $true
      pids = @($stoppedPids | Select-Object -Unique)
    } | ConvertTo-Json -Compress
    Write-Output $result
    exit 0
  }

  "status" {
    $runningPids = @(Get-EnginePids -LocalPort $Port)
    $connected = Test-EngineReady -Url $HealthUrl
    $result = [ordered]@{
      connected = $connected
      running = $runningPids.Count -gt 0
      pids = $runningPids
      health_url = $HealthUrl
      stdout_log = $StdOutLog
      stderr_log = $StdErrLog
    } | ConvertTo-Json -Compress

    Write-Output $result
    exit 0
  }
}
