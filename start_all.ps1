param(
    [int]$OllamaWaitSeconds = 120,
    [int]$OllamaPort = 11434,
    [string]$UI_PORT = "4181",
    [string]$AI_BACKEND = "ollama",
    [switch]$SkipCleanupExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

function Ensure-Dir($p){ if(-not (Test-Path $p)){ New-Item -ItemType Directory -Path $p | Out-Null } }
Ensure-Dir "logs"
Ensure-Dir "run"

function Write-Log($name,$text){ $path = Join-Path "logs" $name; Add-Content -Path $path -Value $text }
function Get-EnvFlag([string]$Name, [bool]$DefaultValue) {
    $rawValue = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($rawValue)) {
        return $DefaultValue
    }

    switch ($rawValue.Trim().ToLowerInvariant()) {
        '1' { return $true }
        'true' { return $true }
        'yes' { return $true }
        'on' { return $true }
        'enabled' { return $true }
        '0' { return $false }
        'false' { return $false }
        'no' { return $false }
        'off' { return $false }
        'disabled' { return $false }
        default { return $DefaultValue }
    }
}

function Get-EnvPositiveInt([string]$Name) {
    $rawValue = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($rawValue)) {
        return $null
    }

    $parsedValue = 0
    if ([int]::TryParse($rawValue.Trim(), [ref]$parsedValue) -and $parsedValue -gt 0) {
        return $parsedValue
    }

    return $null
}

# Load .env if present (basic)
$envFile = Join-Path $root '.env'
if(Test-Path $envFile){
    Get-Content $envFile | ForEach-Object {
        if($_ -match '^\s*#' -or [string]::IsNullOrWhiteSpace($_)){
            return
        }

        if($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$'){
            $key = $matches[1]
            $value = $matches[2].Trim()
            if(($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))){
                $value = $value.Substring(1, $value.Length - 2)
            }
            Set-Item -Path ("Env:{0}" -f $key) -Value $value
        }
    }
}

# Apply CLI overrides
if($env:UI_PORT){ $UI_PORT = $env:UI_PORT }
if($env:AI_BACKEND){ $AI_BACKEND = $env:AI_BACKEND }

# Basic validation
function Validate-Config(){
    $allowed = @('ollama','openai','copilot','claude')
    if(-not ($allowed -contains $AI_BACKEND)){
        Write-Host "ERROR: AI_BACKEND '$AI_BACKEND' is not supported. Allowed: $($allowed -join ', ')" -ForegroundColor Red
        Write-Log "boot-failure.log" "Invalid AI_BACKEND: $AI_BACKEND"
        exit 2
    }
}
Validate-Config

function Convert-ToPsSingleQuotedLiteral([string]$value){
    return "'" + ($value -replace "'", "''") + "'"
}

$npmCommand = "npm.cmd"
$npxCommand = "npx.cmd"
$uiPortLiteral = Convert-ToPsSingleQuotedLiteral $UI_PORT
$aiBackendLiteral = Convert-ToPsSingleQuotedLiteral $AI_BACKEND
$dailyBudgetLiteral = Convert-ToPsSingleQuotedLiteral $env:DAILY_TOKEN_BUDGET
$maxIterationsLiteral = Convert-ToPsSingleQuotedLiteral $env:MAX_ITERATIONS
$ollamaStreamLog = Join-Path $root 'logs/ollama-stream.out'
$watchOllamaScript = Join-Path $root 'watch-ollama-stream.ps1'
$showOllamaStreamWindow = Get-EnvFlag 'SHOW_OLLAMA_STREAM_WINDOW' ($AI_BACKEND -eq 'ollama')
$tasksBoardFile = Join-Path $root 'TASKS.md'
$watchTasksBoardScript = Join-Path $root 'watch-tasks-board.ps1'
$showTasksBoardWindow = Get-EnvFlag 'SHOW_TASKS_BOARD_WINDOW' (Get-EnvFlag 'TASK_BOARD_PROJECTION_ENABLED' $true)
$autopilotOnStartup = Get-EnvFlag 'AUTOPILOT_ON_STARTUP' $true
$autopilotIncludeCancelled = Get-EnvFlag 'AUTOPILOT_INCLUDE_CANCELLED' $false
$autopilotNoSelfAudit = Get-EnvFlag 'AUTOPILOT_NO_SELF_AUDIT' $false
$autopilotSelfAuditLimit = Get-EnvPositiveInt 'AUTOPILOT_SELF_AUDIT_LIMIT'
$waitForQueueActivityOnStartup = Get-EnvFlag 'WAIT_FOR_QUEUE_ACTIVITY_ON_STARTUP' $true
$queueActivityWaitSeconds = Get-EnvPositiveInt 'QUEUE_ACTIVITY_WAIT_SECONDS'
if ($null -eq $queueActivityWaitSeconds) {
    $queueActivityWaitSeconds = 20
}
$stopAllScript = Join-Path $root 'stop_all.ps1'

if ((-not $SkipCleanupExisting) -and (Test-Path $stopAllScript)) {
    Write-Host 'Stopping any existing managed Hephaestus processes before launch...'
    & $stopAllScript -Quiet
}

function Start-OllamaStreamViewer() {
    if (-not $showOllamaStreamWindow) {
        return
    }

    $viewerPidFile = Join-Path $root 'run/ollama-stream-viewer.pid'
    if (Test-Path $viewerPidFile) {
        $existingPid = Get-Content $viewerPidFile -ErrorAction SilentlyContinue
        if ($existingPid) {
            try {
                Get-Process -Id ([int]$existingPid) -ErrorAction Stop | Out-Null
                return
            } catch {
                Remove-Item $viewerPidFile -ErrorAction SilentlyContinue
            }
        }
    }

    Set-Content -Path $ollamaStreamLog -Value ''
    $viewerCommand = "title Hephaestus Ollama Stream && powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$watchOllamaScript`" -Path `"$ollamaStreamLog`""
    $viewerProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $viewerCommand -WorkingDirectory $root -PassThru
    Set-Content -Path $viewerPidFile -Value $viewerProc.Id
}

function Start-TasksBoardViewer() {
    if (-not $showTasksBoardWindow) {
        return
    }

    $viewerPidFile = Join-Path $root 'run/tasks-board-viewer.pid'
    if (Test-Path $viewerPidFile) {
        $existingPid = Get-Content $viewerPidFile -ErrorAction SilentlyContinue
        if ($existingPid) {
            try {
                Get-Process -Id ([int]$existingPid) -ErrorAction Stop | Out-Null
                return
            } catch {
                Remove-Item $viewerPidFile -ErrorAction SilentlyContinue
            }
        }
    }

    $viewerCommand = "title Hephaestus TASKS.md && powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$watchTasksBoardScript`" -Path `"$tasksBoardFile`""
    $viewerProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $viewerCommand -WorkingDirectory $root -PassThru
    Set-Content -Path $viewerPidFile -Value $viewerProc.Id
}

function Wait-ForQueueActivity([long]$InitialLogLength, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $observedOffset = [Math]::Max($InitialLogLength, 0)

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500

        if (-not (Test-Path $daemonLog)) {
            continue
        }

        $logItem = Get-Item $daemonLog -ErrorAction SilentlyContinue
        if ($null -eq $logItem -or $logItem.Length -le $observedOffset) {
            continue
        }

        $content = Get-Content $daemonLog -Raw -ErrorAction SilentlyContinue
        if ([string]::IsNullOrEmpty($content)) {
            continue
        }

        $recentContent = if ($observedOffset -ge $content.Length) {
            ''
        } else {
            $content.Substring([int]$observedOffset)
        }

        $observedOffset = $logItem.Length

        if ($recentContent -match 'Found \d+ new task\(s\) in the ticket store' -or
            $recentContent -match 'Processing task:' -or
            $recentContent -match 'Task planned successfully:' -or
            $recentContent -match 'Awaiting approval:') {
            return $true
        }
    }

    return $false
}

if ($AI_BACKEND -eq 'ollama') {
    Start-OllamaStreamViewer
}

Start-TasksBoardViewer

# Check Ollama health
$ollamaUrl = "http://127.0.0.1:$OllamaPort/api/tags"
function Test-Ollama(){
    try{ Invoke-RestMethod -Uri $ollamaUrl -Method Get -TimeoutSec 3 | Out-Null; return $true }catch{ return $false }
}

if(-not (Test-Ollama)){
    Write-Host "Ollama not responding on $ollamaUrl. Attempting to start ollama.exe if available..."
    $found = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if($found){
        $logOut = Join-Path $root 'logs/ollama.out'
        $logErr = Join-Path $root 'logs/ollama.err'
        Start-Process -FilePath "ollama.exe" -ArgumentList "serve" -NoNewWindow -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru | ForEach-Object { $_ | Out-Null }
        # Wait for health
        $start = Get-Date
        while(((Get-Date) - $start).TotalSeconds -lt $OllamaWaitSeconds){
            Start-Sleep -Seconds 2
            if(Test-Ollama){ Write-Host "Ollama is up"; break }
        }
        if(-not (Test-Ollama)){
            Write-Host "WARNING: Ollama did not respond after $OllamaWaitSeconds seconds. Continuing but agent may fail." -ForegroundColor Yellow
            Write-Log "boot-failure.log" "Ollama no response after wait"
        }
    }else{
        Write-Host "ollama.exe not found in PATH. Skipping start." -ForegroundColor Yellow
        Write-Log "boot-failure.log" "ollama.exe not found"
    }
}else{ Write-Host "Ollama already responding." }

# Start daemon
$daemonLog = Join-Path $root 'logs/daemon.out'
$daemonErr = Join-Path $root 'logs/daemon.err'
if(Test-Path $daemonLog){ Remove-Item $daemonLog -ErrorAction SilentlyContinue }
if(Test-Path $daemonErr){ Remove-Item $daemonErr -ErrorAction SilentlyContinue }

$env:UI_PORT = $UI_PORT
$env:AI_BACKEND = $AI_BACKEND
$env:DAILY_TOKEN_BUDGET = ($env:DAILY_TOKEN_BUDGET -as [string])
if(-not $env:DAILY_TOKEN_BUDGET){ $env:DAILY_TOKEN_BUDGET = '10.00' }
if(-not $env:MAX_ITERATIONS){ $env:MAX_ITERATIONS = '50' }

Write-Host "Starting Hephaestus daemon (logs/daemon.out)"
$daemonCommand = @"
`$env:UI_PORT = $uiPortLiteral
`$env:AI_BACKEND = $aiBackendLiteral
`$env:DAILY_TOKEN_BUDGET = $dailyBudgetLiteral
`$env:MAX_ITERATIONS = $maxIterationsLiteral
& $npmCommand run start:daemon
"@
$daemonProc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-Command",$daemonCommand -WorkingDirectory $root -RedirectStandardOutput $daemonLog -RedirectStandardError $daemonErr -PassThru
Set-Content -Path run/daemon.pid -Value $daemonProc.Id

# Start UI
$uiLog = Join-Path $root 'logs/ui.out'
$uiErr = Join-Path $root 'logs/ui.err'
if(Test-Path $uiLog){ Remove-Item $uiLog -ErrorAction SilentlyContinue }
if(Test-Path $uiErr){ Remove-Item $uiErr -ErrorAction SilentlyContinue }

Write-Host "Starting UI server (logs/ui.out) on port $UI_PORT"
$uiCommand = @"
`$env:UI_PORT = $uiPortLiteral
& $npxCommand tsx src/ui-server.ts
"@
$uiProc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-Command",$uiCommand -WorkingDirectory $root -RedirectStandardOutput $uiLog -RedirectStandardError $uiErr -PassThru
Set-Content -Path run/ui.pid -Value $uiProc.Id

Start-Sleep -Seconds 3

# Smoke tests
function Smoke-Tests(){
    $results = @{}
    try{ Invoke-WebRequest -Uri "http://127.0.0.1:$UI_PORT/health" -UseBasicParsing -TimeoutSec 3 | Out-Null; $results['ui'] = $true }catch{ $results['ui'] = $false }
    try{ $results['ollama'] = Test-Ollama }catch{ $results['ollama'] = $false }
    return $results
}
$sm = Smoke-Tests

Write-Host "Startup summary:"
Write-Host " - Ollama: $($sm['ollama'])"
Write-Host " - UI: $($sm['ui']) (port $UI_PORT)"
Write-Host " - Daemon PID: $(Get-Content run/daemon.pid)"
Write-Host " - UI PID: $(Get-Content run/ui.pid)"
Write-Host " - Safety: DAILY_TOKEN_BUDGET=$($env:DAILY_TOKEN_BUDGET), MAX_ITERATIONS=$($env:MAX_ITERATIONS)"

if(-not $sm['ollama'] -or -not $sm['ui']){
    Write-Host "One or more smoke tests failed. See logs/ for details." -ForegroundColor Yellow
    exit 3
}

if ($autopilotOnStartup) {
    $queueActivityLogLength = 0
    if (Test-Path $daemonLog) {
        $queueActivityLogLength = (Get-Item $daemonLog).Length
    }

    $autopilotArgs = @('run', 'autopilot')
    $autopilotOptionArgs = @()

    if ($autopilotIncludeCancelled) {
        $autopilotOptionArgs += '--include-cancelled'
    }

    if ($autopilotNoSelfAudit) {
        $autopilotOptionArgs += '--no-self-audit'
    }

    if ($null -ne $autopilotSelfAuditLimit) {
        $autopilotOptionArgs += '--self-audit-limit'
        $autopilotOptionArgs += $autopilotSelfAuditLimit.ToString()
    }

    if ($autopilotOptionArgs.Count -gt 0) {
        $autopilotArgs += '--'
        $autopilotArgs += $autopilotOptionArgs
    }

    Write-Host 'Priming the queue with autopilot so startup produces runnable work...'
    & $npmCommand @autopilotArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'WARNING: Startup autopilot failed. The daemon is still running, but the queue may stay idle.' -ForegroundColor Yellow
        Write-Log 'boot-failure.log' "Startup autopilot failed with exit code $LASTEXITCODE"
    } elseif ($waitForQueueActivityOnStartup) {
        if (Wait-ForQueueActivity -InitialLogLength $queueActivityLogLength -TimeoutSeconds $queueActivityWaitSeconds) {
            Write-Host "Observed queue activity in logs/daemon.out. Startup handed queued work to the daemon."
        } else {
            Write-Host "WARNING: Autopilot ran, but no new queue activity was observed within $queueActivityWaitSeconds seconds. Check logs/daemon.out for planner or safety blockers." -ForegroundColor Yellow
            Write-Log 'boot-failure.log' "No queue activity observed within $queueActivityWaitSeconds seconds after startup autopilot"
        }
    }
} else {
    Write-Host 'Startup autopilot is disabled. Set AUTOPILOT_ON_STARTUP=1 to queue work automatically.'
}

Pop-Location
