@echo off
REM Legacy compatibility shim. start_all.bat is the canonical Windows entrypoint.
pushd "%~dp0"
echo [deprecated] start3.bat now forwards to start_all.bat.
call "%~dp0start_all.bat" %*
set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
