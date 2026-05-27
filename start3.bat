@echo off
rem start3.bat - shim to run start2.ps1 with PowerShell
pushd "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0start2.ps1"
popd
exit /b %ERRORLEVEL%
