param(
    [ValidateSet('baseline', 'checkpoint')]
    [string]$Mode = 'baseline',
    [ValidateSet('strict', 'lean')]
    [string]$GateProfile = 'lean',
    [switch]$ApplyAutopilot,
    [int]$WaveSize = 5,
    [int]$MaxActive = 20,
    [int]$MaxAttempts = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$metricsRoot = Join-Path $repoRoot 'docs/metrics/stage-a'
$timestamp = Get-Date -Format 'yyyy-MM-ddTHHmmss'
$runId = "stage-a-$Mode-$timestamp"
$runDir = Join-Path $metricsRoot $runId

New-Item -ItemType Directory -Force -Path $metricsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

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
    } catch {
        return $null
    }
}

Push-Location $repoRoot

try {
    $efficiency = Invoke-NpmCommand -Label 'metrics-efficiency' -NpmArgs @('run', 'metrics:efficiency')
    $weekly = Invoke-NpmCommand -Label 'metrics-efficiency-weekly' -NpmArgs @('run', 'metrics:efficiency:weekly')
    $sourceGroundingReport = Invoke-NpmCommand -Label 'metrics-source-grounding' -NpmArgs @('run', 'metrics:source-grounding')
    $ticketMetrics = Invoke-NpmCommand -Label 'tickets-metrics-source-grounding' -NpmArgs @('run', 'tickets', '--', 'metrics', '--source-grounding')

    $reviewWaveArgs = @('run', 'tickets', '--', 'review-wave')

    if ($GateProfile -eq 'strict') {
        $reviewWaveArgs += @(
            '--min-efficiency-score', '70',
            '--max-blocked', '20',
            '--max-p95-ms', '5500000',
            '--max-allowlist-denial-rate', '0.08',
            '--min-backend-success-ratio', '0.7'
        )
    }
    else {
        # Lean profile keeps safety-integrity gates while making performance gates advisory.
        $reviewWaveArgs += @(
            '--min-efficiency-score', '0',
            '--max-blocked', '100000',
            '--max-p95-ms', '2147483647',
            '--max-allowlist-denial-rate', '1',
            '--min-backend-success-ratio', '0'
        )
    }

    $reviewWaveArgs += @(
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
        '--max-attempts', [string]$MaxAttempts
    )

    if ($GateProfile -eq 'strict') {
        $autopilotArgs += @(
            '--max-blocked', '20',
            '--min-completion-rate', '0.7',
            '--max-superseded-rate', '0.2',
            '--max-allowlist-denial-rate', '0.08'
        )
    }
    else {
        # Lean profile intentionally disables performance-restrictive queue gates.
        $autopilotArgs += @(
            '--max-blocked', '100000',
            '--min-completion-rate', '0',
            '--max-superseded-rate', '1',
            '--max-allowlist-denial-rate', '1'
        )
    }

    $autopilotArgs += @(
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

    $autopilot = Invoke-NpmCommand -Label 'autopilot-stage-a' -NpmArgs $autopilotArgs

    $efficiencyLatestPath = Join-Path $repoRoot 'docs/metrics/efficiency-latest.json'
    $sourceGroundingLatestPath = Join-Path $repoRoot 'docs/metrics/source-grounding-latest.json'
    $efficiencyLatest = Read-JsonIfExists -Path $efficiencyLatestPath
    $sourceGroundingLatest = Read-JsonIfExists -Path $sourceGroundingLatestPath

    $reviewDecision = if ($reviewWave.Output -match 'Decision:\s+([A-Z-]+)') { $Matches[1] } else { 'UNKNOWN' }
    $autopilotPaused = $autopilot.Output -match 'Autopilot paused by efficiency gates:'

    $summary = [ordered]@{
        runId = $runId
        mode = $Mode
        gateProfile = $GateProfile
        timestamp = (Get-Date).ToString('o')
        applyAutopilot = [bool]$ApplyAutopilot.IsPresent
        parameters = @{
            waveSize = $WaveSize
            maxActive = $MaxActive
            maxAttempts = $MaxAttempts
            cohortSize = 50
            treatmentWindowDays = 7
        }
        deferredHardGates = @(
            'efficiency-score',
            'blocked-count',
            'admission-to-complete-p95',
            'backend-success-ratio'
        )
        reviewWave = @{
            decision = $reviewDecision
            logPath = (Resolve-Path $reviewWave.LogPath).Path
        }
        autopilot = @{
            pausedByGates = [bool]$autopilotPaused
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
    $historyJsonlPath = Join-Path $metricsRoot 'stage-a-history.jsonl'

    ($summary | ConvertTo-Json -Depth 8) | Out-File -FilePath $summaryJsonPath -Encoding utf8
    ($summary | ConvertTo-Json -Depth 8 -Compress) + "`n" | Out-File -FilePath $historyJsonlPath -Encoding utf8 -Append

    $summaryMd = @(
        '# Stage A Pilot Run Summary',
        '',
        "- Run ID: $runId",
        "- Mode: $Mode",
        "- Gate profile: $GateProfile",
        "- Timestamp: $($summary.timestamp)",
        "- Autopilot apply mode: $([bool]$ApplyAutopilot.IsPresent)",
        "- Review-wave decision: $reviewDecision",
        "- Autopilot paused by gates: $autopilotPaused",
        "- Deferred hard gates: $($summary.deferredHardGates -join ', ')",
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
        '## Log Files',
        '',
        "- Metrics efficiency: $($summary.logs.metricsEfficiency)",
        "- Metrics weekly: $($summary.logs.metricsEfficiencyWeekly)",
        "- Metrics source grounding: $($summary.logs.metricsSourceGrounding)",
        "- Tickets metrics: $($summary.logs.ticketsMetrics)",
        "- Review wave: $($summary.logs.reviewWave)",
        "- Autopilot: $($summary.logs.autopilot)",
        ''
    ) -join "`r`n"

    $summaryMd | Out-File -FilePath $summaryMdPath -Encoding utf8

    Write-Host ''
    Write-Host "Stage A run complete: $runId"
    Write-Host "Summary JSON: $summaryJsonPath"
    Write-Host "Summary Markdown: $summaryMdPath"
    Write-Host "History file: $historyJsonlPath"
}
finally {
    Pop-Location
}
