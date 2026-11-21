@echo off
rem Sonmal (sign language fingerspelling tutor) launcher.
rem Clears ELECTRON_RUN_AS_NODE (set by some terminals such as VS Code) so Electron starts as an app,
rem then starts it with "start" so this console window closes right away.
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run "npm install" in this folder first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
endlocal
