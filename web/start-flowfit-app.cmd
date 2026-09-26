@echo off
setlocal

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "BIND_HOST=0.0.0.0"
set "BROWSER_HOST=127.0.0.1"
set "PORT=%~1"
set "ROUTE=%~2"
set "LAUNCHER=%APP_DIR%\open-message-workbench.ps1"
set "RUNNER_LAUNCHER=%APP_DIR%\start-flowfit-runner.ps1"
set "DETECTOR_LAUNCHER=%APP_DIR%\flowfit-desktop-detector-control.ps1"
set "LOG_DIR=%APP_DIR%\.flowfit"
set "RUN_ID=%RANDOM%-%RANDOM%"

if not defined PORT set "PORT=3007"
if not defined ROUTE set "ROUTE=/workspace"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%LAUNCHER%" (
  echo [FlowFit] Launcher file was not found.
  echo %LAUNCHER%
  pause
  exit /b 1
)

if exist "%RUNNER_LAUNCHER%" (
  powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%RUNNER_LAUNCHER%" -AppDir "%APP_DIR%" -Port 3001 1>>"%LOG_DIR%\launcher-runner-%RUN_ID%.stdout.log" 2>>"%LOG_DIR%\launcher-runner-%RUN_ID%.stderr.log"
)

if exist "%DETECTOR_LAUNCHER%" (
  powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DETECTOR_LAUNCHER%" -Mode start 1>>"%LOG_DIR%\launcher-detector-%RUN_ID%.stdout.log" 2>>"%LOG_DIR%\launcher-detector-%RUN_ID%.stderr.log"
)

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LAUNCHER%" -AppDir "%APP_DIR%" -BindHost "%BIND_HOST%" -BrowserHost "%BROWSER_HOST%" -Port %PORT% -Route "%ROUTE%" -NoOpenBrowser 1>>"%LOG_DIR%\launcher-workbench-%RUN_ID%.stdout.log" 2>>"%LOG_DIR%\launcher-workbench-%RUN_ID%.stderr.log"
set "WORKBENCH_EXIT=%errorlevel%"

if "%WORKBENCH_EXIT%"=="0" (
  start "" "http://%BROWSER_HOST%:%PORT%%ROUTE%"
)

exit /b %WORKBENCH_EXIT%
