param(
  [int]$RetentionDays = 7,
  [switch]$WhatIfMode
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $root 'logs'

if (-not (Test-Path $logsDir)) {
  Write-Host "logs directory not found: $logsDir"
  exit 0
}

$resetTargets = @(
  'hephaestus.log',
  'error.log',
  'ollama-stream.out'
)

$cutoff = (Get-Date).AddDays(-$RetentionDays)
$stalePatterns = @('*.out', '*.err', '*.txt')

function Get-TotalBytes([string]$dirPath) {
  $files = Get-ChildItem $dirPath -File -ErrorAction SilentlyContinue
  if (-not $files) { return 0 }
  return ($files | Measure-Object Length -Sum).Sum
}

$beforeTotal = Get-TotalBytes $logsDir
$beforeFiles = Get-ChildItem $logsDir -File -ErrorAction SilentlyContinue

$resetBytes = 0
$resetCount = 0
foreach ($name in $resetTargets) {
  $path = Join-Path $logsDir $name
  if (Test-Path $path) {
    $file = Get-Item $path
    $resetBytes += $file.Length
    $resetCount += 1
    if (-not $WhatIfMode) {
      Remove-Item $path -Force -ErrorAction SilentlyContinue
      New-Item -Path $path -ItemType File -Force | Out-Null
    }
  }
}

$staleCandidates = @()
foreach ($pattern in $stalePatterns) {
  $matches = Get-ChildItem $logsDir -File -Filter $pattern -ErrorAction SilentlyContinue |
    Where-Object {
      $_.LastWriteTime -lt $cutoff -and
      ($resetTargets -notcontains $_.Name)
    }
  if ($matches) {
    $staleCandidates += $matches
  }
}

$staleBytes = 0
$staleCount = 0
if ($staleCandidates) {
  $unique = $staleCandidates | Sort-Object FullName -Unique
  foreach ($file in $unique) {
    $staleBytes += $file.Length
    $staleCount += 1
    if (-not $WhatIfMode) {
      Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
    }
  }
}

$afterTotal = if ($WhatIfMode) { $beforeTotal - $resetBytes - $staleBytes } else { Get-TotalBytes $logsDir }
$reclaimed = $beforeTotal - $afterTotal

Write-Host "Context Cleanup Summary"
Write-Host "Root: $root"
Write-Host "Logs: $logsDir"
$modeLabel = if ($WhatIfMode) { 'what-if' } else { 'apply' }
Write-Host "Mode: $modeLabel"
Write-Host "RetentionDays: $RetentionDays"
Write-Host "BeforeTotalBytes: $beforeTotal"
Write-Host "ResetTargetsFound: $resetCount"
Write-Host "ResetTargetBytes: $resetBytes"
Write-Host "StaleDeletedCount: $staleCount"
Write-Host "StaleDeletedBytes: $staleBytes"
Write-Host "AfterTotalBytes: $afterTotal"
Write-Host "ReclaimedBytes: $reclaimed"

Get-ChildItem $logsDir -File -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending |
  Select-Object -First 10 @{Name='SizeKB';Expression={[math]::Round($_.Length / 1KB, 2)}}, Name |
  Format-Table -AutoSize
