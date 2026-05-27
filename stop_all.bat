@echo off
REM stop_all.bat - shim to stop the Windows Hephaestus stack managed by start_all.ps1
pushd "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0stop_all.ps1" %*
popd