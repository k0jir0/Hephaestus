param(
    [string]$Path = "TASKS.md",
    [int]$PollIntervalMilliseconds = 750
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-BoardFile([string]$TargetPath) {
    $resolvedPath = Resolve-Path -LiteralPath $TargetPath -ErrorAction SilentlyContinue
    if ($resolvedPath) {
        return $resolvedPath.Path
    }

    $parent = Split-Path -Parent $TargetPath
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent | Out-Null
    }

    if (-not (Test-Path $TargetPath)) {
        New-Item -ItemType File -Path $TargetPath | Out-Null
    }

    return (Resolve-Path -LiteralPath $TargetPath).Path
}

function Get-BoardSignature([string]$ResolvedPath) {
    if (-not (Test-Path $ResolvedPath)) {
        return 'missing'
    }

    $item = Get-Item -LiteralPath $ResolvedPath
    return "{0}:{1}" -f $item.LastWriteTimeUtc.Ticks, $item.Length
}

function Render-Board([string]$ResolvedPath) {
    Clear-Host
    Write-Host "Watching TASKS.md at $ResolvedPath"
    Write-Host "Refreshed: $((Get-Date).ToString('o'))"
    Write-Host 'Press Ctrl+C in this window to stop watching.'
    Write-Host ''

    if (-not (Test-Path $ResolvedPath)) {
        Write-Host 'TASKS.md does not exist yet.'
        return
    }

    Get-Content -LiteralPath $ResolvedPath
}

$resolvedPath = Ensure-BoardFile $Path
$lastSignature = ''

Render-Board $resolvedPath
$lastSignature = Get-BoardSignature $resolvedPath

while ($true) {
    Start-Sleep -Milliseconds $PollIntervalMilliseconds
    $currentSignature = Get-BoardSignature $resolvedPath
    if ($currentSignature -ne $lastSignature) {
        $lastSignature = $currentSignature
        Render-Board $resolvedPath
    }
}