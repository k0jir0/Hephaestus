@echo off
rem start2.bat - start Ollama (if available), Hephaestus daemon, and UI

pushd "%~dp0"

rem --- environment defaults (override in system or CI if desired) ---
set OLLAMA_BASE_URL=http://127.0.0.1:11434
set AI_BACKEND=ollama
set AI_MODEL=codellama
set DAILY_TOKEN_BUDGET=10.00
set MAX_ITERATIONS=50
set UI_PORT=4181

echo [start2] Working directory: %CD%
echo [start2] OLLAMA_BASE_URL=%OLLAMA_BASE_URL%

rem normalize env vars that contain parentheses to avoid parsing issues in IF blocks
set PF=%ProgramFiles%
set PF86=%ProgramFiles(x86)%
set UP=%USERPROFILE%

rem quick health check for Ollama with robust start + retry
echo [start2] Checking Ollama availability...

rem ensure logs directory exists
if not exist "%~dp0logs" mkdir "%~dp0logs"

curl --silent --fail "%OLLAMA_BASE_URL%/api/models" >nul 2>&1
if errorlevel 1 (
  echo [start2] Ollama not reachable. Attempting to start Ollama (best-effort)...

  rem check if ollama is on PATH
  where /q ollama
  if errorlevel 1 (
    rem not on PATH — check common install locations
    if exist "%PF%\Ollama\ollama.exe" (
      set OLLAMA_EXE=%PF%\Ollama\ollama.exe
    ) else if exist "%PF86%\Ollama\ollama.exe" (
      set OLLAMA_EXE=%PF86%\Ollama\ollama.exe
    ) else if exist "%UP%\\.ollama\\bin\\ollama.exe" (
      set OLLAMA_EXE=%UP%\\.ollama\\bin\\ollama.exe
    ) else (
      set OLLAMA_EXE=
    )
  ) else (
    set OLLAMA_EXE=ollama
  )

  if "%OLLAMA_EXE%"=="" (
    echo [start2] Ollama binary not found. Please install Ollama from https://ollama.ai and add it to PATH.
  ) else (
    echo [start2] Starting Ollama using: %OLLAMA_EXE%
    start "Ollama" cmd /c ""%OLLAMA_EXE%" serve > "%~dp0logs\ollama.out" 2>&1"
  )

  rem wait up to 30 seconds for Ollama to become healthy
  set RETRIES=15
  set COUNT=0
  :wait_ollama
  curl --silent --fail "%OLLAMA_BASE_URL%/api/models" >nul 2>&1
  if errorlevel 1 (
    if %COUNT% GEQ %RETRIES% goto ollama_giveup
    set /a COUNT+=1
    timeout /t 2 >nul
    goto wait_ollama
  ) else (
    echo [start2] Ollama is reachable.
    goto ollama_done
  )
  :ollama_giveup
  echo [start2] Warning: Ollama did not become reachable after waiting. Hephaestus will continue and will retry connecting.
  goto ollama_done
  :ollama_done
) else (
  echo [start2] Ollama appears reachable at %OLLAMA_BASE_URL%.
)

rem Start Hephaestus daemon in a new window so it continues running
echo [start2] Starting Hephaestus daemon (npm run start:daemon)...
start "Hephaestus - daemon" cmd /k "set OLLAMA_BASE_URL=%OLLAMA_BASE_URL% && set AI_BACKEND=%AI_BACKEND% && set AI_MODEL=%AI_MODEL% && npm run start:daemon > "%~dp0logs\daemon.out" 2>&1"

rem Start the UI server in a separate window
echo [start2] Starting Hephaestus UI (npx tsx src/ui-server.ts) on port %UI_PORT%...
start "Hephaestus - UI" cmd /k "set UI_PORT=%UI_PORT% && set OLLAMA_BASE_URL=%OLLAMA_BASE_URL% && npx tsx src/ui-server.ts > "%~dp0logs\ui.out" 2>&1"

echo [start2] All processes launched (or attempted). Use the CLI with: npm run cli -- list

popd
exit /b 0
