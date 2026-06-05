param(
    [ValidateSet('baseline', 'checkpoint', 'strict')]
    [string]$Mode = 'checkpoint',
    [switch]$ApplyAutopilot,
    [ValidateRange(5, 8)]
    [int]$WaveSize = 5,
    [ValidateRange(20, 35)]
    [int]$MaxActive = 35,
    [int]$MaxAttempts = 3,
    [ValidateRange(1, 30)]
    [int]$BlockedWindowDays = 7,
    [double]$StopRetryRate = 0.18,
    [double]$StopAllowlistDenialRate = 0.12,
    [switch]$RunIntegrityAudits
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$metricsRoot = Join-Path $repoRoot 'docs/metrics/efficiency-test22'
$timestamp = Get-Date -Format 'yyyy-MM-ddTHHmmss'
$runId = "test22-$Mode-$timestamp"
$runDir = Join-Path $metricsRoot $runId
$reportPath = Join-Path $repoRoot 'notes/report.txt'

if ($Mode -eq 'strict') {
    $RunIntegrityAudits = $true
}

New-Item -ItemType Directory -Force -Path $metricsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function To-InvariantString {
    param([Parameter(Mandatory = $true)][double]$Value)
    return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function Invoke-NpmCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string[]]$NpmArgs,
        [switch]$IgnoreExitCode
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

    if ($exitCode -ne 0 -and -not $IgnoreExitCode.IsPresent) {
        throw "Command failed ($Label) with exit code $exitCode. See $logPath"
    }

    return [pscustomobject]@{
        Label = $Label
        LogPath = $logPath
        Output = ($output -join [Environment]::NewLine)
        ExitCode = $exitCode
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

function Get-ConsecutiveBandPassCount {
    param(
        [Parameter(Mandatory = $true)][string]$HistoryPath,
        [Parameter(Mandatory = $true)][string]$BandName
    )

    if (-not (Test-Path -Path $HistoryPath)) {
        return 0
    }

    $lines = @(Get-Content -Path $HistoryPath | Where-Object { $_.Trim().Length -gt 0 })
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

        if ($null -eq $entry.bands) {
            break
        }

        $band = $entry.bands.$BandName
        if ($null -eq $band) {
            break
        }

        if ([bool]$band.pass) {
            $count += 1
        }
        else {
            break
        }
    }

    return $count
}

function Parse-BlockedCountFromReviewWave {
    param([Parameter(Mandatory = $true)][string]$ReviewOutput)

    $match = [regex]::Match($ReviewOutput, 'Blocked tickets(?: within \d+d)?:\s*(\d+)')
    if ($match.Success) {
        return [int]$match.Groups[1].Value
    }

    return 0
}

Push-Location $repoRoot

try {
    $metricsEfficiency = Invoke-NpmCommand -Label 'metrics-efficiency' -NpmArgs @('run', 'metrics:efficiency')
    $metricsWeekly = Invoke-NpmCommand -Label 'metrics-efficiency-weekly' -NpmArgs @('run', 'metrics:efficiency:weekly')
    $upgradeTelemetry = Invoke-NpmCommand -Label 'metrics-upgrade-telemetry' -NpmArgs @('run', 'metrics:upgrade-telemetry')
    $ticketsMetrics = Invoke-NpmCommand -Label 'tickets-metrics-source-grounding' -NpmArgs @('run', 'tickets', '--', 'metrics', '--source-grounding')

    $reviewWaveArgs = @(
        'run', 'tickets', '--', 'review-wave',
        '--min-efficiency-score', '0',
        '--max-blocked', '999999',
        '--blocked-window-days', [string]$BlockedWindowDays,
        '--max-p95-ms', '2147483647',
        '--max-allowlist-denial-rate', '1',
        '--min-backend-success-ratio', '0'
    )

    $reviewWave = Invoke-NpmCommand -Label 'tickets-review-wave' -NpmArgs $reviewWaveArgs

    $autopilotArgs = @(
        'run', 'autopilot', '--',
        '--wave-size', [string]$WaveSize,
        '--max-active', [string]$MaxActive,
        '--max-attempts', [string]$MaxAttempts,
        '--max-blocked', [string]$MaxActive,
        '--blocked-window-days', [string]$BlockedWindowDays,
        '--min-completion-rate', '0',
        '--max-superseded-rate', '1',
        '--max-allowlist-denial-rate', (To-InvariantString -Value $StopAllowlistDenialRate),
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

    $autopilot = Invoke-NpmCommand -Label 'autopilot-test22' -NpmArgs $autopilotArgs

    $strictChecks = @()
    if ($Mode -eq 'strict') {
        $strictChecks += Invoke-NpmCommand -Label 'strict-test' -NpmArgs @('run', 'test') -IgnoreExitCode
        $strictChecks += Invoke-NpmCommand -Label 'strict-lint' -NpmArgs @('run', 'lint') -IgnoreExitCode
        $strictChecks += Invoke-NpmCommand -Label 'strict-build' -NpmArgs @('run', 'build') -IgnoreExitCode
    }

    $auditChecks = @()
    if ($RunIntegrityAudits.IsPresent) {
        $auditChecks += Invoke-NpmCommand -Label 'strict-source-grounding-audit' -NpmArgs @('run', 'metrics:source-grounding:audit') -IgnoreExitCode
        $auditChecks += Invoke-NpmCommand -Label 'strict-d2-closure' -NpmArgs @('run', 'metrics:d2:closure') -IgnoreExitCode
    }

    $efficiencyLatestPath = Join-Path $repoRoot 'docs/metrics/efficiency-latest.json'
    $upgradeLatestPath = Join-Path $repoRoot 'docs/metrics/upgrade-telemetry-latest.json'
    $efficiencyLatest = Read-JsonIfExists -Path $efficiencyLatestPath
    $upgradeLatest = Read-JsonIfExists -Path $upgradeLatestPath

    if ($null -eq $efficiencyLatest) {
        throw "Could not parse $efficiencyLatestPath"
    }

    if ($null -eq $upgradeLatest) {
        throw "Could not parse $upgradeLatestPath"
    }

    $score = [double]($efficiencyLatest.efficiencyIndex.score)
    $completedLast24h = [int]($efficiencyLatest.throughput.completedLast24h)
    $completionRate = [double]($efficiencyLatest.quality.completionRate)
    $retryRate = [double]($efficiencyLatest.quality.retryRate)
    $allowlistDenialRate = [double]($efficiencyLatest.policy.allowlistDenialRate)
    $p95AdmissionToCompleteMs = [double]($efficiencyLatest.latencyMs.admissionToComplete.p95)
    $actionableBlocked = Parse-BlockedCountFromReviewWave -ReviewOutput $reviewWave.Output
    $staleCount = [int]($upgradeLatest.queue.stale)

    $bandA = ($score -ge 40.0 -and $completedLast24h -ge 8 -and $retryRate -le 0.14)
    $bandB = ($score -ge 50.0 -and $completedLast24h -ge 10 -and $completionRate -ge 0.60 -and $allowlistDenialRate -le 0.10)
    $bandC = ($score -ge 58.0 -and $completedLast24h -ge 12 -and $retryRate -le 0.10 -and $p95AdmissionToCompleteMs -le 12600000)

    $historyJsonlPath = Join-Path $metricsRoot 'efficiency-test22-history.jsonl'
    $previousEntry = $null
    if (Test-Path -Path $historyJsonlPath) {
        $lines = @(Get-Content -Path $historyJsonlPath | Where-Object { $_.Trim().Length -gt 0 })
        if ($lines.Count -gt 0) {
            try {
                $previousEntry = $lines[$lines.Count - 1] | ConvertFrom-Json
            }
            catch {
                $previousEntry = $null
            }
        }
    }

    $blockedNoGrowth = $true
    $staleNoGrowth = $true
    if ($null -ne $previousEntry -and $null -ne $previousEntry.metrics) {
        $blockedNoGrowth = $actionableBlocked -le [int]($previousEntry.metrics.actionableBlocked)
        $staleNoGrowth = $staleCount -le [int]($previousEntry.metrics.staleCount)
    }

    $strictPass = $true
    foreach ($check in $strictChecks) {
        if ([int]$check.ExitCode -ne 0) {
            $strictPass = $false
        }
    }

    $integrityPass = $true
    foreach ($check in $auditChecks) {
        if ([int]$check.ExitCode -ne 0) {
            $integrityPass = $false
        }
    }

    $bandD = ($score -ge 60.0 -and $blockedNoGrowth -and $staleNoGrowth -and $integrityPass)

    $bandAStreak = if ($bandA) { (Get-ConsecutiveBandPassCount -HistoryPath $historyJsonlPath -BandName 'bandA') + 1 } else { 0 }
    $bandBStreak = if ($bandB) { (Get-ConsecutiveBandPassCount -HistoryPath $historyJsonlPath -BandName 'bandB') + 1 } else { 0 }
    $bandCStreak = if ($bandC) { (Get-ConsecutiveBandPassCount -HistoryPath $historyJsonlPath -BandName 'bandC') + 1 } else { 0 }
    $bandDStreak = if ($bandD) { (Get-ConsecutiveBandPassCount -HistoryPath $historyJsonlPath -BandName 'bandD') + 1 } else { 0 }

    $stopConditions = @(
        [pscustomobject]@{ name = 'retry-rate-high'; pass = ($retryRate -le $StopRetryRate); observed = $retryRate; threshold = $StopRetryRate },
        [pscustomobject]@{ name = 'allowlist-denial-rate-high'; pass = ($allowlistDenialRate -le $StopAllowlistDenialRate); observed = $allowlistDenialRate; threshold = $StopAllowlistDenialRate }
    )

    $stopReasons = @()
    foreach ($condition in $stopConditions) {
        if (-not [bool]$condition.pass) {
            $stopReasons += ("{0}:{1}>{2}" -f $condition.name, ([double]$condition.observed).ToString('0.###'), ([double]$condition.threshold).ToString('0.###'))
        }
    }

    $autopilotPaused = $autopilot.Output -match 'Autopilot paused by efficiency gates:'
    $reviewDecision = if ($reviewWave.Output -match 'Decision:\s+([A-Z-]+)') { $Matches[1] } else { 'UNKNOWN' }

    $summary = [ordered]@{
        runId = $runId
        mode = $Mode
        timestamp = (Get-Date).ToString('o')
        applyAutopilot = [bool]$ApplyAutopilot.IsPresent
        parameters = @{
            waveSize = $WaveSize
            maxActive = $MaxActive
            maxAttempts = $MaxAttempts
            blockedWindowDays = $BlockedWindowDays
            stopRetryRate = $StopRetryRate
            stopAllowlistDenialRate = $StopAllowlistDenialRate
            runIntegrityAudits = [bool]$RunIntegrityAudits.IsPresent
        }
        metrics = @{
            score = $score
            completedLast24h = $completedLast24h
            completionRate = $completionRate
            retryRate = $retryRate
            allowlistDenialRate = $allowlistDenialRate
            p95AdmissionToCompleteMs = $p95AdmissionToCompleteMs
            actionableBlocked = $actionableBlocked
            staleCount = $staleCount
        }
        bands = @{
            bandA = @{ pass = $bandA; streak = $bandAStreak; required = 3 }
            bandB = @{ pass = $bandB; streak = $bandBStreak; required = 5 }
            bandC = @{ pass = $bandC; streak = $bandCStreak; required = 3 }
            bandD = @{ pass = $bandD; streak = $bandDStreak; required = 2 }
        }
        integrity = @{
            strictChecksPass = $strictPass
            auditChecksPass = $integrityPass
        }
        controlSignals = @{
            reviewDecision = $reviewDecision
            autopilotPausedByGates = [bool]$autopilotPaused
            stopReasons = $stopReasons
        }
        rootCauses = @{
            topDenyReasons = $upgradeLatest.rootCauses.topDenyReasons
            topRetryReasons = $upgradeLatest.rootCauses.topRetryReasons
            topSupersedeReasons = $upgradeLatest.rootCauses.topSupersedeReasons
        }
        logs = @{
            metricsEfficiency = (Resolve-Path $metricsEfficiency.LogPath).Path
            metricsEfficiencyWeekly = (Resolve-Path $metricsWeekly.LogPath).Path
            metricsUpgradeTelemetry = (Resolve-Path $upgradeTelemetry.LogPath).Path
            ticketsMetrics = (Resolve-Path $ticketsMetrics.LogPath).Path
            reviewWave = (Resolve-Path $reviewWave.LogPath).Path
            autopilot = (Resolve-Path $autopilot.LogPath).Path
            strictChecks = ($strictChecks | ForEach-Object { (Resolve-Path $_.LogPath).Path })
            audits = ($auditChecks | ForEach-Object { (Resolve-Path $_.LogPath).Path })
        }
    }

    $summaryJsonPath = Join-Path $runDir 'summary.json'
    $summaryMdPath = Join-Path $runDir 'summary.md'

    ($summary | ConvertTo-Json -Depth 10) | Out-File -FilePath $summaryJsonPath -Encoding utf8
    ($summary | ConvertTo-Json -Depth 10 -Compress) + "`n" | Out-File -FilePath $historyJsonlPath -Encoding utf8 -Append

    $reportLines = @(
        '',
        "Test22 Snapshot - $($summary.timestamp)",
        "- Run ID: $runId",
        "- Mode: $Mode",
        "- Score: $score",
        "- Throughput (last 24h): $completedLast24h",
        "- Completion rate: $completionRate",
        "- Retry rate: $retryRate",
        "- Allowlist denial rate: $allowlistDenialRate",
        "- Actionable blocked ($BlockedWindowDays d): $actionableBlocked",
        "- Stale count: $staleCount",
        "- Band A: pass=$bandA streak=$bandAStreak/3",
        "- Band B: pass=$bandB streak=$bandBStreak/5",
        "- Band C: pass=$bandC streak=$bandCStreak/3",
        "- Band D: pass=$bandD streak=$bandDStreak/2",
        "- Review decision: $reviewDecision",
        "- Autopilot paused by gates: $autopilotPaused",
        "- Stop reasons: $(if ($stopReasons.Count -gt 0) { $stopReasons -join '; ' } else { 'none' })"
    )

    if ($upgradeLatest.rootCauses.topDenyReasons.Count -gt 0) {
        $reportLines += "- Top deny reason: $($upgradeLatest.rootCauses.topDenyReasons[0].bucket) ($($upgradeLatest.rootCauses.topDenyReasons[0].count))"
    }
    if ($upgradeLatest.rootCauses.topRetryReasons.Count -gt 0) {
        $reportLines += "- Top retry reason: $($upgradeLatest.rootCauses.topRetryReasons[0].bucket) ($($upgradeLatest.rootCauses.topRetryReasons[0].count))"
    }
    if ($upgradeLatest.rootCauses.topSupersedeReasons.Count -gt 0) {
        $reportLines += "- Top supersede reason: $($upgradeLatest.rootCauses.topSupersedeReasons[0].bucket) ($($upgradeLatest.rootCauses.topSupersedeReasons[0].count))"
    }

    $reportLines | Out-File -FilePath $reportPath -Encoding utf8 -Append

    $summaryMd = @(
        '# Efficiency Test22 Summary',
        '',
        "- Run ID: $runId",
        "- Mode: $Mode",
        "- Timestamp: $($summary.timestamp)",
        "- Autopilot apply mode: $([bool]$ApplyAutopilot.IsPresent)",
        '',
        '## Metrics',
        '',
        "- Score: $score",
        "- Completed last 24h: $completedLast24h",
        "- Completion rate: $completionRate",
        "- Retry rate: $retryRate",
        "- Allowlist denial rate: $allowlistDenialRate",
        "- p95 admission->complete (ms): $p95AdmissionToCompleteMs",
        "- Actionable blocked ($BlockedWindowDays d): $actionableBlocked",
        "- Stale count: $staleCount",
        '',
        '## Bands',
        '',
        "- Band A (>=40, throughput>=8, retry<=0.14): pass=$bandA streak=$bandAStreak/3",
        "- Band B (>=50, throughput>=10, completion>=0.60, denial<=0.10): pass=$bandB streak=$bandBStreak/5",
        "- Band C (>=58, throughput>=12, retry<=0.10, p95<=3.5h): pass=$bandC streak=$bandCStreak/3",
        "- Band D (>=60, blocked/stale no-growth, audits pass): pass=$bandD streak=$bandDStreak/2",
        '',
        '## Controls',
        '',
        "- Review-wave decision: $reviewDecision",
        "- Autopilot paused by gates: $autopilotPaused",
        "- Stop reasons: $(if ($stopReasons.Count -gt 0) { $stopReasons -join '; ' } else { 'none' })",
        "- Strict checks pass: $strictPass",
        "- Audit checks pass: $integrityPass",
        '',
        '## Top Root Causes',
        ''
    )

    if ($upgradeLatest.rootCauses.topDenyReasons.Count -gt 0) {
        foreach ($entry in $upgradeLatest.rootCauses.topDenyReasons) {
            $summaryMd += "- Deny: $($entry.bucket) ($($entry.count))"
        }
    }
    else {
        $summaryMd += '- Deny: none observed'
    }

    if ($upgradeLatest.rootCauses.topRetryReasons.Count -gt 0) {
        foreach ($entry in $upgradeLatest.rootCauses.topRetryReasons) {
            $summaryMd += "- Retry: $($entry.bucket) ($($entry.count))"
        }
    }
    else {
        $summaryMd += '- Retry: none observed'
    }

    if ($upgradeLatest.rootCauses.topSupersedeReasons.Count -gt 0) {
        foreach ($entry in $upgradeLatest.rootCauses.topSupersedeReasons) {
            $summaryMd += "- Supersede: $($entry.bucket) ($($entry.count))"
        }
    }
    else {
        $summaryMd += '- Supersede: none observed'
    }

    $summaryMd += @(
        '',
        '## Log Files',
        '',
        "- Metrics efficiency: $($summary.logs.metricsEfficiency)",
        "- Metrics weekly: $($summary.logs.metricsEfficiencyWeekly)",
        "- Upgrade telemetry: $($summary.logs.metricsUpgradeTelemetry)",
        "- Tickets metrics: $($summary.logs.ticketsMetrics)",
        "- Review wave: $($summary.logs.reviewWave)",
        "- Autopilot: $($summary.logs.autopilot)",
        ''
    )

    $summaryMd -join "`r`n" | Out-File -FilePath $summaryMdPath -Encoding utf8

    Write-Host ''
    Write-Host "Efficiency Test22 run complete: $runId"
    Write-Host "Summary JSON: $summaryJsonPath"
    Write-Host "Summary Markdown: $summaryMdPath"
    Write-Host "History file: $historyJsonlPath"
    Write-Host "Report updated: $reportPath"
}
finally {
    Pop-Location
}
