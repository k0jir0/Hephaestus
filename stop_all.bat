@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0stop_all.ps1" %*
exit /b %ERRORLEVEL%