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
	$stopArgs = @('stop') + $args
	Invoke-HephaestusCli @stopArgs
	if ($LASTEXITCODE -ne 0) {
		exit $LASTEXITCODE
	}

	$escapedRoot = [Regex]::Escape($root)
	$orphanedProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
		$commandLine = $_.CommandLine
		if ([string]::IsNullOrWhiteSpace($commandLine)) {
			return $false
		}

		$normalized = $commandLine -replace '/', '\\'
		$isRepoProcess = $normalized -match $escapedRoot
		$isManagedSurface = $normalized -match 'dist\\agent\.js --daemon' -or
			$normalized -match 'dist\\ui-server\.js' -or
			$normalized -match 'src\\ui-server\.ts'

		return $isRepoProcess -and $isManagedSurface
	}

	foreach ($process in $orphanedProcesses) {
		try {
			Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
			Write-Host "orphaned process: stopped ($($process.ProcessId))"
		}
		catch {
			Write-Warning "Failed to stop orphaned process $($process.ProcessId): $($_.Exception.Message)"
		}
	}

	foreach ($relativePath in @('run\\daemon.pid', 'run\\ui.pid', 'run\\hephaestus-daemon.pid')) {
		$targetPath = Join-Path $root $relativePath
		if (Test-Path $targetPath) {
			Remove-Item $targetPath -Force -ErrorAction SilentlyContinue
		}
	}

	exit 0
}
finally {
	Pop-Location
}