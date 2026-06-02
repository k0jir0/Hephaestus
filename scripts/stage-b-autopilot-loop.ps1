param(
    [ValidateSet('checkpoint', 'baseline')]
    [string]$Mode = 'checkpoint',
    [int]$WaveSize = 5,
    [int]$MaxActive = 100,
    [int]$MaxAttempts = 3,
    [double]$MinEfficiencyScore = 24.0,
    [int]$MaxBlocked = 40,
    [double]$MaxP95Ms = 6000000,
    [double]$MaxAllowlistDenialRate = 0.08,
    [double]$MinBackendSuccessRatio = 0.45,
    [double]$MinCompletionRate = 0.25,
    [double]$MaxSupersededRate = 0.70,
    [ValidateRange(10, 3600)]
    [int]$CycleIntervalSeconds = 300,
    [ValidateRange(1, 168)]
    [int]$MaxRuntimeHours = 24,
    [int]$MaxIterations = 0,
    [int]$MaxConsecutiveFailures = 10,
    [ValidateRange(0, 3600)]
    [int]$FailureCooldownSeconds = 30,
    [string]$StopFile = 'run/stage-b-autopilot.stop',
    [string]$PidFile = 'run/stage-b-autopilot-loop.pid',
    [string]$LogFile = 'logs/stage-b-autopilot-loop.log'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedStopFile = if ([System.IO.Path]::IsPathRooted($StopFile)) { $StopFile } else { Join-Path $repoRoot $StopFile }
$resolvedPidFile = if ([System.IO.Path]::IsPathRooted($PidFile)) { $PidFile } else { Join-Path $repoRoot $PidFile }
$resolvedLogFile = if ([System.IO.Path]::IsPathRooted($LogFile)) { $LogFile } else { Join-Path $repoRoot $LogFile }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedStopFile) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedPidFile) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedLogFile) | Out-Null

function Resolve-PidIfRunning {
    param([Parameter(Mandatory = $true)][string]$PidPath)

    if (-not (Test-Path -Path $PidPath)) {
        return $null
    }

    $pidRaw = (Get-Content -Path $PidPath -Raw).Trim()
    if (-not ($pidRaw -match '^\d+$')) {
        Remove-Item -Path $PidPath -Force
        return $null
    }

    $candidatePid = [int]$pidRaw
    $process = Get-Process -Id $candidatePid -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -Path $PidPath -Force
        return $null
    }

    return $candidatePid
}

function To-InvariantString {
    param([Parameter(Mandatory = $true)][double]$Value)
    return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

$runningPid = Resolve-PidIfRunning -PidPath $resolvedPidFile
if ($null -ne $runningPid) {
    throw "Stage B autopilot loop is already running under PID $runningPid. Use stage-b:autopilot:stop before starting another loop."
}

if (Test-Path -Path $resolvedStopFile) {
    Remove-Item -Path $resolvedStopFile -Force
}

function Write-LoopLog {
    param([Parameter(Mandatory = $true)][string]$Message)

    $line = "[$((Get-Date).ToString('o'))] $Message"
    Write-Host $line
    $line | Out-File -FilePath $resolvedLogFile -Encoding utf8 -Append
}

Set-Content -Path $resolvedPidFile -Value $PID -Encoding ascii
$effectiveMaxIterations = $MaxIterations
if ($effectiveMaxIterations -le 0) {
    $derived = [math]::Floor(($MaxRuntimeHours * 3600) / [math]::Max(1, $CycleIntervalSeconds))
    $effectiveMaxIterations = [int][math]::Max(1, $derived)
}

$loopStartedAt = Get-Date
Write-LoopLog "Stage B autopilot loop started (PID=$PID, mode=$Mode, maxRuntimeHours=$MaxRuntimeHours, maxIterations=$effectiveMaxIterations, cycleIntervalSeconds=$CycleIntervalSeconds)."

Push-Location $repoRoot

$iteration = 0
$consecutiveFailures = 0

try {
    while ($true) {
        $elapsedHours = ((Get-Date) - $loopStartedAt).TotalHours

        if (Test-Path -Path $resolvedStopFile) {
            Write-LoopLog "Stop signal detected at $resolvedStopFile. Exiting loop."
            break
        }

        if ($elapsedHours -ge $MaxRuntimeHours) {
            Write-LoopLog "Reached MaxRuntimeHours=$MaxRuntimeHours. Exiting loop."
            break
        }

        if ($iteration -ge $effectiveMaxIterations) {
            Write-LoopLog "Reached MaxIterations=$effectiveMaxIterations. Exiting loop."
            break
        }

        $iteration += 1
        Write-LoopLog "Starting Stage B autopilot cycle $iteration of $effectiveMaxIterations."
        $sleepAfterCycleSeconds = $CycleIntervalSeconds

        $npmArgs = @(
            'run', 'stage-b:pilot', '--',
            '-Mode', $Mode,
            '-ApplyAutopilot',
            '-WaveSize', [string]$WaveSize,
            '-MaxActive', [string]$MaxActive,
            '-MaxAttempts', [string]$MaxAttempts,
            '-MinEfficiencyScore', (To-InvariantString -Value $MinEfficiencyScore),
            '-MaxBlocked', [string]$MaxBlocked,
            '-MaxP95Ms', (To-InvariantString -Value $MaxP95Ms),
            '-MaxAllowlistDenialRate', (To-InvariantString -Value $MaxAllowlistDenialRate),
            '-MinBackendSuccessRatio', (To-InvariantString -Value $MinBackendSuccessRatio),
            '-MinCompletionRate', (To-InvariantString -Value $MinCompletionRate),
            '-MaxSupersededRate', (To-InvariantString -Value $MaxSupersededRate)
        )

        try {
            $previousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                $output = & npm @npmArgs 2>&1
            }
            finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }

            $exitCode = $LASTEXITCODE

            if ($null -ne $output) {
                foreach ($line in $output) {
                    Write-LoopLog "[stage-b-pilot] $line"
                }
            }

            if ($exitCode -ne 0) {
                throw "Stage B cycle $iteration failed with exit code $exitCode."
            }

            $consecutiveFailures = 0
            Write-LoopLog "Stage B autopilot cycle $iteration completed successfully."
        }
        catch {
            $consecutiveFailures += 1
            $sleepAfterCycleSeconds = [int][math]::Max(1, $FailureCooldownSeconds)
            Write-LoopLog "Stage B autopilot cycle $iteration failed: $($_.Exception.Message)"

            if ($consecutiveFailures -ge $MaxConsecutiveFailures) {
                Write-LoopLog "Reached MaxConsecutiveFailures=$MaxConsecutiveFailures. Exiting loop."
                break
            }

            Write-LoopLog "Continuing after failure ($consecutiveFailures/$MaxConsecutiveFailures)."
        }

        if (Test-Path -Path $resolvedStopFile) {
            Write-LoopLog "Stop signal detected before sleep. Exiting loop."
            break
        }

        $elapsedSeconds = ((Get-Date) - $loopStartedAt).TotalSeconds
        $remainingSeconds = [int][math]::Floor(($MaxRuntimeHours * 3600) - $elapsedSeconds)
        if ($remainingSeconds -le 0) {
            Write-LoopLog 'No remaining runtime budget. Exiting loop.'
            break
        }

        if ($iteration -ge $effectiveMaxIterations) {
            Write-LoopLog 'Iteration budget exhausted. Exiting loop.'
            break
        }

        $sleepSeconds = [int][math]::Min($sleepAfterCycleSeconds, $remainingSeconds)
        if ($sleepSeconds -gt 0) {
            Write-LoopLog "Sleeping for $sleepSeconds seconds before next cycle."
            Start-Sleep -Seconds $sleepSeconds
        }
    }
}
finally {
    Pop-Location

    if (Test-Path -Path $resolvedPidFile) {
        Remove-Item -Path $resolvedPidFile -Force
    }

    Write-LoopLog 'Stage B autopilot loop stopped.'
}
