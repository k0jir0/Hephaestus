@echo off
REM start_all.bat - shim to run the PowerShell orchestrator for Hephaestus stack
pushd "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0start_all.ps1" %*
popd
