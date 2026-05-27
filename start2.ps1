<#
start2.ps1 - Robust PowerShell launcher for Ollama + Hephaestus
Usage: run this from project folder or via start3.bat
#>

Set-StrictMode -Version Latest
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

# Environment defaults (override in user/system env if desired)
$env:OLLAMA_BASE_URL = $env:OLLAMA_BASE_URL -or 'http://127.0.0.1:11434'
$env:AI_BACKEND = $env:AI_BACKEND -or 'ollama'
$env:AI_MODEL = $env:AI_MODEL -or 'codellama'
$env:DAILY_TOKEN_BUDGET = $env:DAILY_TOKEN_BUDGET -or '10.00'
$env:MAX_ITERATIONS = $env:MAX_ITERATIONS -or '50'
$env:UI_PORT = $env:UI_PORT -or '4181'

Write-Host "[start2.ps1] Working directory: $ScriptDir"
Write-Host "[start2.ps1] OLLAMA_BASE_URL=$($env:OLLAMA_BASE_URL)"

$logs = Join-Path $ScriptDir 'logs'
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }

function Start-Ollama {
    Write-Host "[start2.ps1] Locating Ollama..."
    $exe = $null
    $which = Get-Command ollama -ErrorAction SilentlyContinue
    if ($which) { $exe = $which.Source }
    else {
        $candidates = @(
            "$env:ProgramFiles\Ollama\ollama.exe",
            "$env:ProgramFiles(x86)\Ollama\ollama.exe",
            "$env:USERPROFILE\.ollama\bin\ollama.exe"
        )
        foreach ($c in $candidates) { if (Test-Path $c) { $exe = $c; break } }
    }
    if (-not $exe) { Write-Host "[start2.ps1] Ollama binary not found."; return $false }

    Write-Host "[start2.ps1] Starting Ollama: $exe"
    $out = Join-Path $logs 'ollama.out'
    $err = Join-Path $logs 'ollama.err'
    Start-Process -FilePath $exe -ArgumentList 'serve' -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden
    return $true
}

# Check if Ollama is already healthy
function Test-OllamaHealth {
    try { Invoke-RestMethod -Uri "$($env:OLLAMA_BASE_URL)/api/models" -Method Get -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-OllamaHealth)) {
    Write-Host "[start2.ps1] Ollama not reachable; attempting to start it."
    $started = Start-Ollama
    if ($started) {
        $tries = 0
        while ($tries -lt 15) {
            Start-Sleep -Seconds 2
            if (Test-OllamaHealth) { Write-Host "[start2.ps1] Ollama is reachable."; break }
            $tries++
        }
        if ($tries -ge 15) { Write-Warning "Ollama did not respond after waiting 30s." }
    } else {
        Write-Warning "Ollama not installed; Hephaestus will continue and retry later. Install: https://ollama.ai"
    }
} else { Write-Host "[start2.ps1] Ollama appears reachable." }

# Start Hephaestus daemon in a new cmd window
Write-Host "[start2.ps1] Starting Hephaestus daemon (in new window)..."
$daemonLog = Join-Path $logs 'daemon.out'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "set OLLAMA_BASE_URL=$($env:OLLAMA_BASE_URL) && set AI_BACKEND=$($env:AI_BACKEND) && set AI_MODEL=$($env:AI_MODEL) && npm run start:daemon > `"$daemonLog`" 2>&1"

# Start UI server in a new cmd window
Write-Host "[start2.ps1] Starting UI server (in new window)..."
$uiLog = Join-Path $logs 'ui.out'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "set UI_PORT=$($env:UI_PORT) && set OLLAMA_BASE_URL=$($env:OLLAMA_BASE_URL) && npx tsx src/ui-server.ts > `"$uiLog`" 2>&1"

Write-Host "[start2.ps1] Launched processes (check logs in $logs)."
