Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $root

try {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($null -eq $npm) {
        $npm = Get-Command npm -ErrorAction Stop
    }

    $npmArgs = @('run', 'cli')
    if ($args.Count -gt 0) {
        $npmArgs += '--'
        $npmArgs += $args
    }

    & $npm.Source @npmArgs
}
finally {
    Pop-Location
}

exit $LASTEXITCODE