Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location "c:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus"

function Test-Pdf([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  $fs = [System.IO.File]::OpenRead($path)
  try {
    if ($fs.Length -lt 4) { return $false }
    $b = New-Object byte[] 4
    [void]$fs.Read($b, 0, 4)
    return ([System.Text.Encoding]::ASCII.GetString($b) -eq '%PDF')
  } finally {
    $fs.Dispose()
  }
}

$targets = @(
  @{
    Key = 'Lamport1978'
    Path = 'sources/papers/20-event-evidence/Lamport1978.pdf'
    Urls = @(
      'https://lamport.azurewebsites.net/pubs/time-clocks.pdf',
      'https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/time-clocks.pdf'
    )
  },
  @{
    Key = 'GarciaMolina1987'
    Path = 'sources/papers/20-event-evidence/GarciaMolina1987.pdf'
    Urls = @(
      'https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf'
    )
  },
  @{
    Key = 'Parnas1972'
    Path = 'sources/papers/00-foundations/Parnas1972.pdf'
    Urls = @(
      'https://www.cs.umd.edu/class/spring2003/cmsc838p/Design/criteria.pdf'
    )
  },
  @{
    Key = 'SaltzerSchroeder1975'
    Path = 'sources/papers/50-safety-verification/SaltzerSchroeder1975.pdf'
    Urls = @(
      'https://web.mit.edu/Saltzer/www/publications/protection/protection.pdf'
    )
  }
)

foreach ($t in $targets) {
  $out = Join-Path $PWD $t.Path
  $dir = Split-Path -Parent $out
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  if (Test-Pdf $out) {
    Write-Output "SKIP $($t.Key) already"
    continue
  }

  $ok = $false
  foreach ($u in $t.Urls) {
    $tmp = Join-Path $env:TEMP ("known_acq_" + [guid]::NewGuid().ToString() + ".bin")
    try {
      Invoke-WebRequest -Uri $u -OutFile $tmp -MaximumRedirection 8 -TimeoutSec 45 -UseBasicParsing
      if (Test-Pdf $tmp) {
        Move-Item -Force $tmp $out
        Write-Output "DOWNLOADED $($t.Key) $u"
        $ok = $true
        break
      }
    } catch {
      # continue
    } finally {
      if (Test-Path $tmp) {
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
      }
    }
  }

  if (-not $ok) {
    Write-Output "MISS $($t.Key)"
  }
}
