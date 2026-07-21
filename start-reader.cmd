@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-reader.ps1" %*
if errorlevel 1 (
  echo.
  echo Reader failed to start. Please copy the error above when reporting the problem.
  pause
)
endlocal
