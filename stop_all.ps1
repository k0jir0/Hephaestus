param(
    [switch]$Quiet,
    [switch]$SkipPatternScan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

function Write-Status([string]$Message) {
    if (-not $Quiet) {
        Write-Host $Message
    }
}

function Parse-ProcessId([string]$RawValue) {
    if ([string]::IsNullOrWhiteSpace($RawValue)) {
        return $null
    }

    $parsedValue = 0
    if ([int]::TryParse($RawValue.Trim(), [ref]$parsedValue)) {
        return $parsedValue
    }

    return $null
}

function Get-ActiveProcess([int]$ManagedProcessId) {
    try {
        return Get-Process -Id $ManagedProcessId -ErrorAction Stop
    } catch {
        return $null
    }
}

function Stop-ManagedProcessTree([int]$ManagedProcessId, [string]$Label, $StoppedProcessIds) {
    if ($StoppedProcessIds.Contains($ManagedProcessId)) {
        return $false
    }

    $existingProcess = Get-ActiveProcess $ManagedProcessId
    if ($null -eq $existingProcess) {
        Write-Status " - $Label is already stopped ($ManagedProcessId)"
        $null = $StoppedProcessIds.Add($ManagedProcessId)
        return $false
    }

    $taskkillProcess = Start-Process -FilePath 'taskkill.exe' -ArgumentList '/PID', $ManagedProcessId, '/T', '/F' -WindowStyle Hidden -PassThru -Wait
    if ($taskkillProcess.ExitCode -ne 0) {
        $existingProcess = Get-ActiveProcess $ManagedProcessId
        if ($null -eq $existingProcess) {
            Write-Status " - $Label is already stopped ($ManagedProcessId)"
            $null = $StoppedProcessIds.Add($ManagedProcessId)
            return $false
        }

        throw "taskkill.exe exited with code $($taskkillProcess.ExitCode) while stopping $Label ($ManagedProcessId)."
    }

    $null = $StoppedProcessIds.Add($ManagedProcessId)
    Write-Status " - Stopped $Label ($ManagedProcessId)"
    return $true
}

function Stop-ManagedPidFile([string]$PidFilePath, [string]$Label, $StoppedProcessIds) {
    if (-not (Test-Path $PidFilePath)) {
        return $false
    }

    $rawValue = Get-Content $PidFilePath -Raw -ErrorAction SilentlyContinue
    $managedProcessId = Parse-ProcessId $rawValue
    if ($null -ne $managedProcessId) {
        $null = Stop-ManagedProcessTree $managedProcessId $Label $StoppedProcessIds
    } else {
        Write-Status " - Removed stale PID file for $Label"
    }

    Remove-Item $PidFilePath -ErrorAction SilentlyContinue
    return $true
}

function Stop-ManagedProcessesByPattern([string]$Pattern, [string]$Label, $StoppedProcessIds) {
    $matches = @(
        Get-CimInstance Win32_Process |
            Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern } |
            Sort-Object ProcessId -Unique
    )

    foreach ($match in $matches) {
        $null = Stop-ManagedProcessTree ([int]$match.ProcessId) $Label $StoppedProcessIds
    }
}

$stoppedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'

Write-Status 'Stopping managed Hephaestus processes...'
$null = Stop-ManagedPidFile (Join-Path $root 'run/daemon.pid') 'daemon' $stoppedProcessIds
$null = Stop-ManagedPidFile (Join-Path $root 'run/ui.pid') 'UI server' $stoppedProcessIds
$null = Stop-ManagedPidFile (Join-Path $root 'run/ollama-stream-viewer.pid') 'Ollama stream viewer' $stoppedProcessIds
$null = Stop-ManagedPidFile (Join-Path $root 'run/tasks-board-viewer.pid') 'TASKS.md viewer' $stoppedProcessIds

if (-not $SkipPatternScan) {
    Stop-ManagedProcessesByPattern 'dist/agent\.js --daemon|src/agent\.ts --daemon|npm(?:\.cmd)? run start:daemon' 'daemon' $stoppedProcessIds
    Stop-ManagedProcessesByPattern 'src/ui-server\.ts|npm(?:\.cmd)? run ui|npx(?:\.cmd)? tsx src/ui-server\.ts' 'UI server' $stoppedProcessIds
    Stop-ManagedProcessesByPattern 'watch-ollama-stream\.ps1' 'Ollama stream viewer' $stoppedProcessIds
    Stop-ManagedProcessesByPattern 'watch-tasks-board\.ps1' 'TASKS.md viewer' $stoppedProcessIds
}

Write-Status 'Managed Hephaestus stop sequence complete.'
Pop-Location