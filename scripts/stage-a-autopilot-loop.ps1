param(
    [ValidateSet('checkpoint', 'baseline')]
    [string]$Mode = 'checkpoint',
    [ValidateSet('lean', 'strict')]
    [string]$GateProfile = 'lean',
    [int]$WaveSize = 5,
    [int]$MaxActive = 100,
    [int]$MaxAttempts = 3,
    [ValidateRange(10, 3600)]
    [int]$CycleIntervalSeconds = 60,
    [ValidateRange(1, 168)]
    [int]$MaxRuntimeHours = 24,
    [int]$MaxIterations = 0,
    [int]$MaxConsecutiveFailures = 10,
    [ValidateRange(0, 3600)]
    [int]$FailureCooldownSeconds = 30,
    [string]$StopFile = 'run/stage-a-autopilot.stop',
    [string]$PidFile = 'run/stage-a-autopilot-loop.pid',
    [string]$LogFile = 'logs/stage-a-autopilot-loop.log'
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

$runningPid = Resolve-PidIfRunning -PidPath $resolvedPidFile
if ($null -ne $runningPid) {
    throw "Stage A autopilot loop is already running under PID $runningPid. Use stage-a:autopilot:stop before starting another loop."
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
Write-LoopLog "Stage A autopilot loop started (PID=$PID, mode=$Mode, gateProfile=$GateProfile, maxRuntimeHours=$MaxRuntimeHours, maxIterations=$effectiveMaxIterations, cycleIntervalSeconds=$CycleIntervalSeconds)."

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
        Write-LoopLog "Starting Stage A autopilot cycle $iteration of $effectiveMaxIterations."
        $sleepAfterCycleSeconds = $CycleIntervalSeconds

        $npmArgs = @(
            'run', 'stage-a:pilot', '--',
            '-Mode', $Mode,
            '-GateProfile', $GateProfile,
            '-ApplyAutopilot',
            '-WaveSize', [string]$WaveSize,
            '-MaxActive', [string]$MaxActive,
            '-MaxAttempts', [string]$MaxAttempts
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
                    Write-LoopLog "[stage-a-pilot] $line"
                }
            }

            if ($exitCode -ne 0) {
                throw "Stage A cycle $iteration failed with exit code $exitCode."
            }

            $consecutiveFailures = 0
            Write-LoopLog "Stage A autopilot cycle $iteration completed successfully."
        }
        catch {
            $consecutiveFailures += 1
            $sleepAfterCycleSeconds = [int][math]::Max(1, $FailureCooldownSeconds)
            Write-LoopLog "Stage A autopilot cycle $iteration failed: $($_.Exception.Message)"

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
            Write-LoopLog "No remaining runtime budget. Exiting loop."
            break
        }

        if ($iteration -ge $effectiveMaxIterations) {
            Write-LoopLog "Iteration budget exhausted. Exiting loop."
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

    Write-LoopLog "Stage A autopilot loop stopped."
}
