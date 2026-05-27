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

rem quick health check for Ollama
echo [start2] Checking Ollama availability...
curl --silent --fail "%OLLAMA_BASE_URL%/api/models" >nul 2>&1
if %errorlevel%==0 (
  echo [start2] Ollama appears reachable at %OLLAMA_BASE_URL%.
) else (
  echo [start2] Ollama not reachable.
  echo [start2] Attempting to start Ollama (best-effort)...
  start "Ollama" cmd /c "ollama serve"
  timeout /t 3 >nul
  curl --silent --fail "%OLLAMA_BASE_URL%/api/models" >nul 2>&1
  if %errorlevel%==0 (
    echo [start2] Ollama started.
  ) else (
    echo [start2] Warning: Could not reach Ollama. Hephaestus will continue and will retry connecting.
  )
)

rem Start Hephaestus daemon in a new window so it continues running
echo [start2] Starting Hephaestus daemon (npm run start:daemon)...
start "Hephaestus - daemon" cmd /k "npm run start:daemon"

rem Start the UI server in a separate window
echo [start2] Starting Hephaestus UI (npx tsx src/ui-server.ts) on port %UI_PORT%...
start "Hephaestus - UI" cmd /k "set UI_PORT=%UI_PORT% && npx tsx src/ui-server.ts"

echo [start2] All processes launched (or attempted). Use the CLI with: npm run cli -- list

popd
exit /b 0
