param(
    [string]$Path = "logs/ollama-stream.out"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedPath = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
if (-not $resolvedPath) {
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent | Out-Null
    }

    if (-not (Test-Path $Path)) {
        New-Item -ItemType File -Path $Path | Out-Null
    }

    $resolvedPath = Resolve-Path -LiteralPath $Path
}

Write-Host "Watching Ollama stream at $($resolvedPath.Path)"
Write-Host "Press Ctrl+C in this window to stop watching."
Get-Content -LiteralPath $resolvedPath.Path -Wait