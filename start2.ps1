<#
Legacy compatibility shim. start_all.ps1 is the canonical Windows orchestrator.
#>

Set-StrictMode -Version Latest
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$canonicalScript = Join-Path $scriptDir 'start_all.ps1'

if (-not (Test-Path $canonicalScript)) {
    throw "Missing canonical start script: $canonicalScript"
}

Write-Host '[deprecated] start2.ps1 now forwards to start_all.ps1.'
& $canonicalScript @args
