param(
    [ValidateSet('baseline', 'checkpoint')]
    [string]$Mode = 'checkpoint',
    [switch]$ApplyAutopilot,
    [int]$WaveSize = 5,
    [int]$MaxActive = 100,
    [int]$MaxAttempts = 3,
    [double]$MinEfficiencyScore = 24.0,
    [int]$MaxBlocked = 40,
    [int]$BlockedWindowDays = 7,
    [double]$MaxP95Ms = 6000000,
    [double]$MaxAllowlistDenialRate = 0.08,
    [double]$MinBackendSuccessRatio = 0.45,
    [double]$MinCompletionRate = 0.25,
    [double]$MaxSupersededRate = 0.70
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$metricsRoot = Join-Path $repoRoot 'docs/metrics/stage-b'
$timestamp = Get-Date -Format 'yyyy-MM-ddTHHmmss'
$runId = "stage-b-$Mode-$timestamp"
$runDir = Join-Path $metricsRoot $runId

New-Item -ItemType Directory -Force -Path $metricsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function To-InvariantString {
    param([Parameter(Mandatory = $true)][double]$Value)
    return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function Invoke-NpmCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string[]]$NpmArgs
    )

    $logPath = Join-Path $runDir ("$Label.log")
    Write-Host "==> Running $Label"

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & npm @NpmArgs 2>&1
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $exitCode = $LASTEXITCODE

    if ($null -eq $output) {
        $output = @()
    }

    $output | Out-File -FilePath $logPath -Encoding utf8

    if ($exitCode -ne 0) {
        throw "Command failed ($Label) with exit code $exitCode. See $logPath"
    }

    return [pscustomobject]@{
        Label = $Label
        LogPath = $logPath
        Output = ($output -join [Environment]::NewLine)
    }
}

function Read-JsonIfExists {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -Path $Path)) {
        return $null
    }

    try {
        return (Get-Content -Path $Path -Raw | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

function Get-ConsecutivePassCount {
    param([Parameter(Mandatory = $true)][string]$HistoryPath)

    if (-not (Test-Path -Path $HistoryPath)) {
        return 0
    }

    $lines = @(
        Get-Content -Path $HistoryPath | Where-Object { $_.Trim().Length -gt 0 }
    )

    if ($lines.Count -eq 0) {
        return 0
    }

    $count = 0
    for ($i = $lines.Count - 1; $i -ge 0; $i -= 1) {
        try {
            $entry = $lines[$i] | ConvertFrom-Json
        }
        catch {
            break
        }

        $entryPass = $false
        if ($null -ne $entry.hardFail) {
            $hardFailProperties = $entry.hardFail.PSObject.Properties.Name
            if ($hardFailProperties -contains 'pass') {
                $entryPass = [bool]$entry.hardFail.pass
            }
        }

        if ($entryPass) {
            $count += 1
        }
        else {
            break
        }
    }

    return $count
}

Push-Location $repoRoot

try {
    $efficiency = Invoke-NpmCommand -Label 'metrics-efficiency' -NpmArgs @('run', 'metrics:efficiency')
    $weekly = Invoke-NpmCommand -Label 'metrics-efficiency-weekly' -NpmArgs @('run', 'metrics:efficiency:weekly')
    $sourceGroundingReport = Invoke-NpmCommand -Label 'metrics-source-grounding' -NpmArgs @('run', 'metrics:source-grounding')
    $ticketMetrics = Invoke-NpmCommand -Label 'tickets-metrics-source-grounding' -NpmArgs @('run', 'tickets', '--', 'metrics', '--source-grounding')

    $reviewWaveArgs = @(
        'run', 'tickets', '--', 'review-wave',
        '--min-efficiency-score', (To-InvariantString -Value $MinEfficiencyScore),
        '--max-blocked', [string]$MaxBlocked,
        '--blocked-window-days', [string]$BlockedWindowDays,
        '--max-p95-ms', (To-InvariantString -Value $MaxP95Ms),
        '--max-allowlist-denial-rate', (To-InvariantString -Value $MaxAllowlistDenialRate),
        '--min-backend-success-ratio', (To-InvariantString -Value $MinBackendSuccessRatio),
        '--min-source-grounding-coverage', '0.9',
        '--min-source-evidence-coverage', '0.95',
        '--max-source-drifted', '0',
        '--max-source-snapshot-age-hours', '24',
        '--enforce-d2',
        '--max-d2-count-mismatches', '0',
        '--max-d2-legacy-only', '0',
        '--max-d2-domain-only', '0',
        '--max-d2-domain-deficit', '0',
        '--max-d2-missing-legacy-link', '0',
        '--min-d2-replay-correlation-coverage', '0.2'
    )

    $reviewWave = Invoke-NpmCommand -Label 'tickets-review-wave' -NpmArgs $reviewWaveArgs

    $autopilotArgs = @(
        'run', 'autopilot', '--',
        '--wave-size', [string]$WaveSize,
        '--max-active', [string]$MaxActive,
        '--max-attempts', [string]$MaxAttempts,
        '--max-blocked', [string]$MaxBlocked,
        '--blocked-window-days', [string]$BlockedWindowDays,
        '--min-completion-rate', (To-InvariantString -Value $MinCompletionRate),
        '--max-superseded-rate', (To-InvariantString -Value $MaxSupersededRate),
        '--max-allowlist-denial-rate', (To-InvariantString -Value $MaxAllowlistDenialRate),
        '--enforce-source-snapshot',
        '--max-source-snapshot-age-hours', '24',
        '--min-source-grounding-coverage', '0.9',
        '--min-source-evidence-coverage', '0.95',
        '--max-source-drifted', '0',
        '--enforce-d2',
        '--max-d2-count-mismatches', '0',
        '--max-d2-legacy-only', '0',
        '--max-d2-domain-only', '0',
        '--max-d2-domain-deficit', '0',
        '--max-d2-missing-legacy-link', '0',
        '--min-d2-replay-correlation-coverage', '0.2'
    )

    if (-not $ApplyAutopilot.IsPresent) {
        $autopilotArgs += '--dry-run'
    }

    $autopilot = Invoke-NpmCommand -Label 'autopilot-stage-b' -NpmArgs $autopilotArgs

    $efficiencyLatestPath = Join-Path $repoRoot 'docs/metrics/efficiency-latest.json'
    $sourceGroundingLatestPath = Join-Path $repoRoot 'docs/metrics/source-grounding-latest.json'
    $efficiencyLatest = Read-JsonIfExists -Path $efficiencyLatestPath
    $sourceGroundingLatest = Read-JsonIfExists -Path $sourceGroundingLatestPath

    $reviewDecision = if ($reviewWave.Output -match 'Decision:\s+([A-Z-]+)') { $Matches[1] } else { 'UNKNOWN' }
    $autopilotPaused = $autopilot.Output -match 'Autopilot paused by efficiency gates:'

    $autopilotGateFailures = @()
    foreach ($line in ($autopilot.Output -split "\r?\n")) {
        if ($line -match '^Gate fail\s+(.+)$') {
            $autopilotGateFailures += $Matches[1]
        }
    }

    $hardFailReasons = @()
    if ($reviewDecision -ne 'GO') {
        $hardFailReasons += "review-wave-$reviewDecision"
    }

    if ($autopilotPaused) {
        if ($autopilotGateFailures.Count -gt 0) {
            foreach ($failure in $autopilotGateFailures) {
                $hardFailReasons += "autopilot-gate-$failure"
            }
        }
        else {
            $hardFailReasons += 'autopilot-paused-by-gates'
        }
    }

    $hardFailPass = $hardFailReasons.Count -eq 0

    $historyJsonlPath = Join-Path $metricsRoot 'stage-b-history.jsonl'
    $previousPassStreak = Get-ConsecutivePassCount -HistoryPath $historyJsonlPath
    $consecutivePassWindows = if ($hardFailPass) { $previousPassStreak + 1 } else { 0 }
    $promotionReady = $consecutivePassWindows -ge 2

    $summary = [ordered]@{
        runId = $runId
        mode = $Mode
        stage = 'B'
        gateProfile = 'strict-calibrated'
        timestamp = (Get-Date).ToString('o')
        applyAutopilot = [bool]$ApplyAutopilot.IsPresent
        parameters = @{
            waveSize = $WaveSize
            maxActive = $MaxActive
            maxAttempts = $MaxAttempts
            cohortSize = 50
            treatmentWindowDays = 7
        }
        thresholds = @{
            minEfficiencyScore = $MinEfficiencyScore
            maxBlocked = $MaxBlocked
            blockedWindowDays = $BlockedWindowDays
            maxP95Ms = $MaxP95Ms
            maxAllowlistDenialRate = $MaxAllowlistDenialRate
            minBackendSuccessRatio = $MinBackendSuccessRatio
            minCompletionRate = $MinCompletionRate
            maxSupersededRate = $MaxSupersededRate
            minSourceGroundingCoverage = 0.9
            minSourceEvidenceCoverage = 0.95
            maxSourceDrifted = 0
            maxSourceSnapshotAgeHours = 24
            enforceD2 = $true
            minD2ReplayCorrelationCoverage = 0.2
        }
        hardFail = @{
            pass = $hardFailPass
            reasons = $hardFailReasons
            requiredConsecutiveWindows = 2
            consecutivePassWindows = $consecutivePassWindows
            promotionReady = $promotionReady
        }
        reviewWave = @{
            decision = $reviewDecision
            logPath = (Resolve-Path $reviewWave.LogPath).Path
        }
        autopilot = @{
            pausedByGates = [bool]$autopilotPaused
            gateFailures = $autopilotGateFailures
            logPath = (Resolve-Path $autopilot.LogPath).Path
        }
        efficiency = @{
            score = $efficiencyLatest.efficiencyIndex.score
            targetScore = $efficiencyLatest.efficiencyIndex.targetScore
            status = $efficiencyLatest.efficiencyIndex.status
            throughputPerDay = $efficiencyLatest.throughput.completedPerDay
            completionRate = $efficiencyLatest.quality.completionRate
            retryRate = $efficiencyLatest.quality.retryRate
            p95AdmissionToCompleteMs = $efficiencyLatest.latencyMs.admissionToComplete.p95
            allowlistDenialRate = $efficiencyLatest.policy.allowlistDenialRate
        }
        sourceGrounding = @{
            coverage = $sourceGroundingLatest.groundingCoverage
            eventEvidenceCoverage = $sourceGroundingLatest.eventEvidence.eventEvidenceCoverage
            driftedTickets = ($sourceGroundingLatest.eventEvidence.driftedTickets | Measure-Object).Count
        }
        logs = @{
            metricsEfficiency = (Resolve-Path $efficiency.LogPath).Path
            metricsEfficiencyWeekly = (Resolve-Path $weekly.LogPath).Path
            metricsSourceGrounding = (Resolve-Path $sourceGroundingReport.LogPath).Path
            ticketsMetrics = (Resolve-Path $ticketMetrics.LogPath).Path
            reviewWave = (Resolve-Path $reviewWave.LogPath).Path
            autopilot = (Resolve-Path $autopilot.LogPath).Path
        }
    }

    $summaryJsonPath = Join-Path $runDir 'summary.json'
    $summaryMdPath = Join-Path $runDir 'summary.md'

    ($summary | ConvertTo-Json -Depth 8) | Out-File -FilePath $summaryJsonPath -Encoding utf8
    ($summary | ConvertTo-Json -Depth 8 -Compress) + "`n" | Out-File -FilePath $historyJsonlPath -Encoding utf8 -Append

    $summaryMd = @(
        '# Stage B Strict Run Summary',
        '',
        "- Run ID: $runId",
        "- Mode: $Mode",
        '- Gate profile: strict-calibrated',
        "- Timestamp: $($summary.timestamp)",
        "- Autopilot apply mode: $([bool]$ApplyAutopilot.IsPresent)",
        "- Review-wave decision: $reviewDecision",
        "- Autopilot paused by gates: $autopilotPaused",
        "- Hard-fail pass: $hardFailPass",
        "- Consecutive pass windows: $consecutivePassWindows (required 2)",
        "- Stage B promotion ready: $promotionReady",
        '',
        '## Thresholds',
        '',
        "- Min efficiency score: $MinEfficiencyScore",
        "- Max blocked tickets: $MaxBlocked",
        "- Max p95 admission->complete (ms): $MaxP95Ms",
        "- Max allowlist denial rate: $MaxAllowlistDenialRate",
        "- Min backend success ratio: $MinBackendSuccessRatio",
        "- Min completion rate: $MinCompletionRate",
        "- Max superseded rate: $MaxSupersededRate",
        '',
        '## Efficiency Snapshot',
        '',
        "- Score: $($summary.efficiency.score) (target $($summary.efficiency.targetScore), status $($summary.efficiency.status))",
        "- Throughput/day: $($summary.efficiency.throughputPerDay)",
        "- Completion rate: $($summary.efficiency.completionRate)",
        "- Retry rate: $($summary.efficiency.retryRate)",
        "- p95 admission->complete (ms): $($summary.efficiency.p95AdmissionToCompleteMs)",
        "- Allowlist denial rate: $($summary.efficiency.allowlistDenialRate)",
        '',
        '## Source Grounding Snapshot',
        '',
        "- Grounding coverage: $($summary.sourceGrounding.coverage)",
        "- Event evidence coverage: $($summary.sourceGrounding.eventEvidenceCoverage)",
        "- Drifted tickets: $($summary.sourceGrounding.driftedTickets)",
        '',
        '## Hard-Fail Reasons',
        ''
    )

    if ($hardFailReasons.Count -eq 0) {
        $summaryMd += '- None'
    }
    else {
        foreach ($reason in $hardFailReasons) {
            $summaryMd += "- $reason"
        }
    }

    $summaryMd += @(
        '',
        '## Log Files',
        '',
        "- Metrics efficiency: $($summary.logs.metricsEfficiency)",
        "- Metrics weekly: $($summary.logs.metricsEfficiencyWeekly)",
        "- Metrics source grounding: $($summary.logs.metricsSourceGrounding)",
        "- Tickets metrics: $($summary.logs.ticketsMetrics)",
        "- Review wave: $($summary.logs.reviewWave)",
        "- Autopilot: $($summary.logs.autopilot)",
        ''
    )

    ($summaryMd -join "`r`n") | Out-File -FilePath $summaryMdPath -Encoding utf8

    Write-Host ''
    Write-Host "Stage B run complete: $runId"
    Write-Host "Summary JSON: $summaryJsonPath"
    Write-Host "Summary Markdown: $summaryMdPath"
    Write-Host "History file: $historyJsonlPath"

    if (-not $hardFailPass) {
        throw "Stage B hard-fail gates triggered: $($hardFailReasons -join ', '). See $summaryJsonPath"
    }
}
finally {
    Pop-Location
}
