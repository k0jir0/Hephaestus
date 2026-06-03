Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Invoke-HephaestusCli {
	param(
		[Parameter(ValueFromRemainingArguments = $true)]
		[string[]]$CliArgs
	)

	$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
	if ($null -eq $npm) {
		$npm = Get-Command npm -ErrorAction Stop
	}

	$npmArgs = @('run', 'cli', '--') + $CliArgs
	& $npm.Source @npmArgs
}

Push-Location $root

try {
	& (Join-Path $root 'stop_all.ps1')
	if ($LASTEXITCODE -ne 0) {
		exit $LASTEXITCODE
	}

	$startArgs = @('start', '--wait') + $args
	Invoke-HephaestusCli @startArgs
	if ($LASTEXITCODE -ne 0) {
		exit $LASTEXITCODE
	}

	Invoke-HephaestusCli 'status' '--strict'
	exit $LASTEXITCODE
}
finally {
	Pop-Location
}