param(
    [string]$Path = "logs/ollama-stream.out",
    [int]$PollIntervalMilliseconds = 350,
    [int]$MaxSessions = 4
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-StreamFile([string]$TargetPath) {
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

function Get-StreamSignature([string]$ResolvedPath) {
    if (-not (Test-Path $ResolvedPath)) {
        return 'missing'
    }

    $item = Get-Item -LiteralPath $ResolvedPath
    return "{0}:{1}" -f $item.LastWriteTimeUtc.Ticks, $item.Length
}

function Get-StreamSessions([string]$Content) {
    $sessions = @()
    $matches = [regex]::Matches($Content, '(?ms)^===\s*(?<header>.+?)\s*===\r?\n(?<body>.*?)(?=^===\s|\z)')
    foreach ($match in $matches) {
        $sessions += [pscustomobject]@{
            Header = $match.Groups['header'].Value.Trim()
            Body = $match.Groups['body'].Value.TrimEnd()
        }
    }

    if ($sessions.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($Content)) {
        $sessions += [pscustomobject]@{
            Header = 'live'
            Body = $Content.TrimEnd()
        }
    }

    return $sessions
}

function Write-StreamBody([string]$Body) {
    if ([string]::IsNullOrWhiteSpace($Body)) {
        Write-Host 'Waiting for streamed tokens...' -ForegroundColor DarkGray
        return
    }

    $normalized = ($Body -replace "`r`n", "`n").TrimEnd()
    $paragraphs = $normalized -split "`n`n"
    foreach ($paragraph in $paragraphs) {
        Write-Host $paragraph.TrimEnd()
        Write-Host ''
    }
}

function Render-Stream([string]$ResolvedPath) {
    Clear-Host
    Write-Host "Watching Ollama stream at $ResolvedPath" -ForegroundColor Cyan
    Write-Host "Refreshed: $((Get-Date).ToString('o'))"
    Write-Host 'Press Ctrl+C in this window to stop watching.'
    Write-Host ''

    if (-not (Test-Path $ResolvedPath)) {
        Write-Host 'Stream log does not exist yet.' -ForegroundColor Yellow
        return
    }

    $content = Get-Content -LiteralPath $ResolvedPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) {
        Write-Host 'No Ollama stream output has been recorded yet.' -ForegroundColor DarkGray
        return
    }

    $sessions = Get-StreamSessions $content
    if ($sessions.Count -eq 0) {
        Write-Host 'Waiting for the first completed or in-progress stream session...' -ForegroundColor DarkGray
        return
    }

    $visibleSessions = $sessions | Select-Object -Last $MaxSessions
    foreach ($session in $visibleSessions) {
        Write-Host ('=' * 72) -ForegroundColor DarkGray
        Write-Host ("Session: {0}" -f $session.Header) -ForegroundColor Yellow
        Write-Host ('-' * 72) -ForegroundColor DarkGray
        Write-StreamBody $session.Body
    }
}

$resolvedPath = Ensure-StreamFile $Path
$lastSignature = ''

Render-Stream $resolvedPath
$lastSignature = Get-StreamSignature $resolvedPath

while ($true) {
    Start-Sleep -Milliseconds $PollIntervalMilliseconds
    $currentSignature = Get-StreamSignature $resolvedPath
    if ($currentSignature -ne $lastSignature) {
        $lastSignature = $currentSignature
        Render-Stream $resolvedPath
    }
}