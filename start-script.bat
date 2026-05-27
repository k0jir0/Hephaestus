@echo off
REM Robust start script for Hephaestus on Windows.
REM - Ensures Ollama is running (starts it if missing)
REM - Starts Hephaestus agent and UI in separate windows

REM Check for ollama process
tasklist /fi "imagename eq ollama.exe" | find /i "ollama.exe" >nul 2>&1
if %errorlevel% neq 0 (
	echo Ollama not running. Starting Ollama serve...
	if exist "%ProgramFiles%\Ollama\ollama.exe" (
		start "Ollama" "%ProgramFiles%\Ollama\ollama.exe" serve
	) else (
		echo Could not find ollama at %%ProgramFiles%%\Ollama\ollama.exe; try running ollama manually.
	)
	timeout /t 3 /nobreak >nul
) else (
	echo Ollama already running.
)

REM Move to Hephaestus folder if not already there
pushd "%~dp0"
if not exist "package.json" (
	if exist "McGillSoftware\Hephaestus\package.json" (
		cd /d "%~dp0\McGillSoftware\Hephaestus"
	)
)

echo Building and starting Hephaestus agent and UI...
start "Heph-Agent" cmd /c "npm run start:daemon"
start "Heph-UI" cmd /c "npm run ui"

popd
echo Done. Use the new windows to view agent and UI logs.
