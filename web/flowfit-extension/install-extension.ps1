param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionPath,

  [switch]$OptIn
)

$ErrorActionPreference = "Stop"

if (-not $OptIn -and $env:FLOWFIT_EXTENSION_AUTO_INSTALL -ne "1" -and $env:FLOWFIT_AUTO_INSTALL_EXTENSION -ne "1") {
  Write-Output "FlowFit extension registry policy install skipped. Re-run with -OptIn or set FLOWFIT_EXTENSION_AUTO_INSTALL=1."
  exit 0
}

$resolvedExtensionPath = [System.IO.Path]::GetFullPath($ExtensionPath)
$manifestPath = Join-Path $resolvedExtensionPath "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "manifest.json was not found: $manifestPath"
}

$extensionValue = "file:///$($resolvedExtensionPath.Replace('\','/'));https://clients2.google.com/service/update2/crx"
$policyTargets = @(
  "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist",
  "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist",
  "HKCU:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist",
  "HKCU:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
)

$installed = $false

foreach ($target in $policyTargets) {
  try {
    New-Item -Path $target -Force | Out-Null
    New-ItemProperty -Path $target -Name "9001" -Value $extensionValue -PropertyType String -Force | Out-Null
    Write-Output "Registered FlowFit extension policy: $target"
    $installed = $true
  } catch {
    Write-Output "Skipped ${target}: $($_.Exception.Message)"
  }
}

if (-not $installed) {
  throw "Could not register FlowFit extension policy in HKLM or HKCU."
}
