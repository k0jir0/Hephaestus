param(
    [switch]$ForceKill
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$stopFile = Join-Path $repoRoot 'run/stage-a-autopilot.stop'
$pidFile = Join-Path $repoRoot 'run/stage-a-autopilot-loop.pid'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stopFile) | Out-Null
New-Item -ItemType File -Force -Path $stopFile | Out-Null
Write-Host "Stop signal written: $stopFile"

if (Test-Path -Path $pidFile) {
    $pidRaw = (Get-Content -Path $pidFile -Raw).Trim()
    if ($pidRaw -match '^\d+$') {
        $loopPid = [int]$pidRaw
        if ($ForceKill.IsPresent) {
            try {
                Stop-Process -Id $loopPid -ErrorAction Stop
                Write-Host "Force-stopped loop process PID $loopPid"
            }
            catch {
                Write-Host "Loop process PID $loopPid was not running."
            }
        }
        else {
            Write-Host "Loop PID $loopPid will exit after receiving the stop signal. Use -ForceKill only if it does not stop."
        }
    }
}
else {
    Write-Host "No loop PID file found at $pidFile"
}
