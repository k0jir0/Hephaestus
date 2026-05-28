Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

function Load-DotEnv([string]$RootPath) {
    $envFile = Join-Path $RootPath '.env'
    if (-not (Test-Path $envFile)) {
        return
    }

    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or [string]::IsNullOrWhiteSpace($_)) {
            return
        }

        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $key = $matches[1]
            $value = $matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }

            if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) {
                Set-Item -Path ("Env:{0}" -f $key) -Value $value
            }
        }
    }
}

function Pause-Menu() {
    [void](Read-Host 'Press Enter to return to the menu')
}

function Read-PidFile([string]$RelativePath) {
    $path = Join-Path $root $RelativePath
    if (-not (Test-Path $path)) {
        return $null
    }

    $rawValue = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($rawValue)) {
        return $null
    }

    $parsedValue = 0
    if ([int]::TryParse($rawValue.Trim(), [ref]$parsedValue)) {
        return $parsedValue
    }

    return $null
}

function Test-ManagedProcess([string]$RelativePidPath) {
    $pid = Read-PidFile $RelativePidPath
    if ($null -eq $pid) {
        return $null
    }

    try {
        return Get-Process -Id $pid -ErrorAction Stop
    } catch {
        return $null
    }
}

function Test-Endpoint([string]$Uri) {
    try {
        Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Show-Status([string]$UiPort, [string]$AiBackend) {
    Clear-Host
    Write-Host 'Hephaestus Status' -ForegroundColor Cyan
    Write-Host ''

    $daemonProcess = Test-ManagedProcess 'run/daemon.pid'
    $uiProcess = Test-ManagedProcess 'run/ui.pid'
    $streamViewer = Test-ManagedProcess 'run/ollama-stream-viewer.pid'
    $boardViewer = Test-ManagedProcess 'run/tasks-board-viewer.pid'

    $uiHealthy = Test-Endpoint "http://127.0.0.1:$UiPort/health"
    $ollamaHealthy = if ($AiBackend -eq 'ollama') {
        Test-Endpoint 'http://127.0.0.1:11434/api/tags'
    } else {
        $null
    }

    Write-Host ("UI health:       {0}" -f ($(if ($uiHealthy) { 'OK' } else { 'DOWN' })))
    if ($null -ne $ollamaHealthy) {
        Write-Host ("Ollama health:   {0}" -f ($(if ($ollamaHealthy) { 'OK' } else { 'DOWN' })))
    }
    Write-Host ("Daemon process:  {0}" -f ($(if ($daemonProcess) { $daemonProcess.Id } else { 'not running' })))
    Write-Host ("UI process:      {0}" -f ($(if ($uiProcess) { $uiProcess.Id } else { 'not running' })))
    Write-Host ("Stream viewer:   {0}" -f ($(if ($streamViewer) { $streamViewer.Id } else { 'not running' })))
    Write-Host ("TASKS viewer:    {0}" -f ($(if ($boardViewer) { $boardViewer.Id } else { 'not running' })))
    Write-Host ''
    Write-Host "Control menu PID: $PID"
    Write-Host "Project root:     $root"
}

function Invoke-Npm([string[]]$Arguments) {
    & 'npm.cmd' @Arguments
    return $LASTEXITCODE
}

function Show-TicketSummary() {
    Clear-Host
    Write-Host 'Ticket Summary' -ForegroundColor Cyan
    Write-Host ''

    foreach ($status in @('pending', 'in_progress', 'blocked')) {
        Write-Host ("[{0}]" -f $status) -ForegroundColor Yellow
        $exitCode = Invoke-Npm @('run', 'tickets', '--', 'list', '--status', $status)
        if ($exitCode -ne 0) {
            Write-Host "Ticket listing failed for status '$status' with exit code $exitCode" -ForegroundColor Red
        }
        Write-Host ''
    }
}

function Show-RecentDaemonLog() {
    Clear-Host
    Write-Host 'Recent Daemon Log' -ForegroundColor Cyan
    Write-Host ''

    $daemonLog = Join-Path $root 'logs/daemon.out'
    if (-not (Test-Path $daemonLog)) {
        Write-Host 'logs/daemon.out does not exist yet.' -ForegroundColor Yellow
        return
    }

    Get-Content $daemonLog -Tail 60
}

function Ensure-ViewerWindow([string]$PidFileRelativePath, [string]$WindowTitle, [string]$PowerShellScriptPath, [string]$TargetPath) {
    $existingProcess = Test-ManagedProcess $PidFileRelativePath
    if ($existingProcess) {
        Write-Host "$WindowTitle is already running (PID $($existingProcess.Id))." -ForegroundColor Yellow
        return
    }

    $pidFilePath = Join-Path $root $PidFileRelativePath
    $command = "title $WindowTitle && powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PowerShellScriptPath`" -Path `"$TargetPath`""
    $viewerProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $command -WorkingDirectory $root -PassThru
    Set-Content -Path $pidFilePath -Value $viewerProcess.Id
    Write-Host "Started $WindowTitle (PID $($viewerProcess.Id))." -ForegroundColor Green
}

function Stop-StackAndExit() {
    & (Join-Path $root 'stop_all.ps1')
    exit 0
}

Load-DotEnv $root

$uiPort = [Environment]::GetEnvironmentVariable('UI_PORT')
if ([string]::IsNullOrWhiteSpace($uiPort)) {
    $uiPort = '4181'
}

$aiBackend = [Environment]::GetEnvironmentVariable('AI_BACKEND')
if ([string]::IsNullOrWhiteSpace($aiBackend)) {
    $aiBackend = 'ollama'
}

$Host.UI.RawUI.WindowTitle = 'Hephaestus Control Menu'

while ($true) {
    Clear-Host
    Write-Host 'Hephaestus Control Menu' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '1. Show stack status'
    Write-Host '2. Open the UI in a browser'
    Write-Host '3. Show ticket summary'
    Write-Host '4. Run autopilot now'
    Write-Host '5. Show recent daemon log'
    Write-Host '6. Open Ollama stream window'
    Write-Host '7. Open TASKS.md window'
    Write-Host '8. Stop the stack and close this menu'
    Write-Host '0. Close this menu only'
    Write-Host ''

    $selection = (Read-Host 'Select an option').Trim()

    switch ($selection) {
        '1' {
            Show-Status -UiPort $uiPort -AiBackend $aiBackend
            Pause-Menu
        }
        '2' {
            Start-Process "http://127.0.0.1:$uiPort/"
        }
        '3' {
            Show-TicketSummary
            Pause-Menu
        }
        '4' {
            Clear-Host
            Write-Host 'Running autopilot...' -ForegroundColor Cyan
            $exitCode = Invoke-Npm @('run', 'autopilot')
            if ($exitCode -ne 0) {
                Write-Host "Autopilot failed with exit code $exitCode" -ForegroundColor Red
            }
            Pause-Menu
        }
        '5' {
            Show-RecentDaemonLog
            Pause-Menu
        }
        '6' {
            Ensure-ViewerWindow -PidFileRelativePath 'run/ollama-stream-viewer.pid' -WindowTitle 'Hephaestus Ollama Stream' -PowerShellScriptPath (Join-Path $root 'watch-ollama-stream.ps1') -TargetPath (Join-Path $root 'logs/ollama-stream.out')
            Pause-Menu
        }
        '7' {
            Ensure-ViewerWindow -PidFileRelativePath 'run/tasks-board-viewer.pid' -WindowTitle 'Hephaestus TASKS.md' -PowerShellScriptPath (Join-Path $root 'watch-tasks-board.ps1') -TargetPath (Join-Path $root 'TASKS.md')
            Pause-Menu
        }
        '8' {
            Stop-StackAndExit
        }
        '0' {
            exit 0
        }
        default {
            Write-Host "Unknown option: $selection" -ForegroundColor Yellow
            Pause-Menu
        }
    }
}