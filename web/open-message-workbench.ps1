param(
  [string]$AppDir = $PSScriptRoot,
  [string]$BindHost = "0.0.0.0",
  [string]$BrowserHost = "127.0.0.1",
  [string]$ServerHost,
  [int]$Port = 3007,
  [string]$Route = "/workspace",
  [switch]$NoOpenBrowser,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"

if ($PSBoundParameters.ContainsKey("ServerHost") -and -not $PSBoundParameters.ContainsKey("BindHost")) {
  $BindHost = $ServerHost
}

if (-not $BrowserHost) {
  $BrowserHost = "127.0.0.1"
}

function Show-LauncherError {
  param([string]$Message)

  if ($NoUi) {
    [Console]::Error.WriteLine($Message)
    return
  }

  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup($Message, 0, "FlowFit", 16)
  } catch {
    Write-Error $Message
  }
}

function Test-WorkbenchReady {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-AppShellPath {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LocalAppData "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LocalAppData "Google\Chrome\Application\chrome.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates) {
    return $candidates[0]
  }

  $edgeCommand = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($edgeCommand) {
    return $edgeCommand.Source
  }

  $chromeCommand = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($chromeCommand) {
    return $chromeCommand.Source
  }

  return $null
}

function Start-WorkbenchWindow {
  param(
    [string]$Url,
    [string]$ProfileDir
  )

  $appShellPath = Get-AppShellPath
  if ($appShellPath) {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

    $arguments = @(
      "--new-window",
      ('--app="{0}"' -f $Url),
      ('--user-data-dir="{0}"' -f $ProfileDir),
      "--window-size=1480,960",
      "--disable-session-crashed-bubble",
      "--disable-features=msHubApps",
      "--no-first-run",
      "--no-default-browser-check"
    )

    Start-Process -FilePath $appShellPath -ArgumentList $arguments | Out-Null
    return
  }

  Start-Process $Url | Out-Null
}

function Sync-StandaloneAssets {
  param(
    [string]$AppDir
  )

  $standaloneRoot = Join-Path $AppDir ".next\standalone"
  $standaloneNextDir = Join-Path $standaloneRoot ".next"
  $staticDir = Join-Path $AppDir ".next\static"
  $publicDir = Join-Path $AppDir "public"

  if (Test-Path -LiteralPath $staticDir) {
    New-Item -ItemType Directory -Force -Path $standaloneNextDir | Out-Null
    Copy-Item -LiteralPath $staticDir -Destination $standaloneNextDir -Recurse -Force
  }

  if (Test-Path -LiteralPath $publicDir) {
    Copy-Item -LiteralPath $publicDir -Destination $standaloneRoot -Recurse -Force
  }
}

$AppDir = $AppDir.Trim().Trim('"')
$AppDir = [System.IO.Path]::GetFullPath($AppDir)
$TargetUrl = "http://{0}:{1}{2}" -f $BrowserHost, $Port, $Route
$LogDir = Join-Path $AppDir ".flowfit"
$StdOutLogFile = Join-Path $LogDir "message-workbench.stdout.log"
$StdErrLogFile = Join-Path $LogDir "message-workbench.stderr.log"
$AppShellProfileDir = Join-Path $LogDir "app-shell-profile"
$PackageFile = Join-Path $AppDir "package.json"
$NextConfigFile = Join-Path $AppDir "next.config.mjs"
$NextBin = Join-Path $AppDir "node_modules\next\dist\bin\next"
$DirectDevServerFile = Join-Path $AppDir "flowfit-next-dev-direct.js"
$BuildIdFile = Join-Path $AppDir ".next\BUILD_ID"
$StandaloneServerFile = Join-Path $AppDir ".next\standalone\server.js"
$BundledNodePath = Join-Path $AppDir "runtime\node.exe"
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$NodePath = if (Test-Path -LiteralPath $BundledNodePath) {
  $BundledNodePath
} elseif ($NodeCommand) {
  $NodeCommand.Source
} else {
  $null
}

if (-not (Test-Path -LiteralPath $AppDir)) {
  Show-LauncherError "App folder was not found.`n$AppDir"
  exit 1
}

if (-not $NodePath) {
  Show-LauncherError "Node.js was not found.`nInstall Node.js and run the launcher again."
  exit 1
}

if (-not (Test-Path -LiteralPath $PackageFile)) {
  Show-LauncherError "package.json was not found.`n$PackageFile"
  exit 1
}

if (-not (Test-Path -LiteralPath $NextBin)) {
  Show-LauncherError "Next.js runtime was not found.`nRun npm install once before using this launcher."
  exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-WorkbenchReady -Url $TargetUrl)) {
  $UsesStandaloneOutput = $false
  if (Test-Path -LiteralPath $NextConfigFile) {
    $UsesStandaloneOutput = (Get-Content -LiteralPath $NextConfigFile -Raw) -match 'output\s*:\s*["'']standalone["'']'
  }

  if ($UsesStandaloneOutput -and (Test-Path -LiteralPath $BuildIdFile) -and (Test-Path -LiteralPath $StandaloneServerFile)) {
    Sync-StandaloneAssets -AppDir $AppDir

    $launchCommand = 'cd /d "{0}" && set "HOSTNAME={1}" && set "PORT={2}" && set "NODE_ENV=production" && "{3}" "{4}" 1>"{5}" 2>"{6}"' -f `
      $AppDir,
      $BindHost,
      $Port,
      $NodePath,
      $StandaloneServerFile,
      $StdOutLogFile,
      $StdErrLogFile
  } else {
    if (Test-Path -LiteralPath $BuildIdFile) {
      $launchCommand = 'cd /d "{0}" && "{1}" "{2}" start --hostname {3} --port {4} 1>"{5}" 2>"{6}"' -f `
        $AppDir,
        $NodePath,
        $NextBin,
        $BindHost,
        $Port,
        $StdOutLogFile,
        $StdErrLogFile
    } elseif (Test-Path -LiteralPath $DirectDevServerFile) {
      $launchCommand = 'cd /d "{0}" && set "FLOWFIT_APP_DIR={0}" && "{1}" "{2}" --hostname {3} --port {4} 1>"{5}" 2>"{6}"' -f `
        $AppDir,
        $NodePath,
        $DirectDevServerFile,
        $BindHost,
        $Port,
        $StdOutLogFile,
        $StdErrLogFile
    } else {
      $launchCommand = 'cd /d "{0}" && "{1}" "{2}" dev --hostname {3} --port {4} 1>"{5}" 2>"{6}"' -f `
        $AppDir,
        $NodePath,
        $NextBin,
        $BindHost,
        $Port,
        $StdOutLogFile,
        $StdErrLogFile
    }
  }

  Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList "/c", $launchCommand `
    -WindowStyle Hidden | Out-Null

  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 750
    if (Test-WorkbenchReady -Url $TargetUrl) {
      break
    }
  } while ((Get-Date) -lt $deadline)
}

if (Test-WorkbenchReady -Url $TargetUrl) {
  if (-not $NoOpenBrowser) {
    Start-WorkbenchWindow -Url $TargetUrl -ProfileDir $AppShellProfileDir
  }

  exit 0
}

Show-LauncherError "FlowFit did not start.`nCheck the log files:`n$StdOutLogFile`n$StdErrLogFile"
exit 1
