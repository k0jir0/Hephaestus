Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location "c:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus"

$raw = Get-Content "sources\sources.txt" -Raw
$matches = [regex]::Matches($raw, '\[(?<key>[^\]]+)\][\s\S]*?(?<url>https?://[^\s]+)')
$entries = @{}
foreach ($m in $matches) {
  $k = $m.Groups['key'].Value.Trim()
  $u = $m.Groups['url'].Value.Trim().TrimEnd('.')
  if (-not $entries.ContainsKey($k)) {
    $entries[$k] = $u
  }
}

function Get-Category([string]$k) {
  switch -Regex ($k) {
    'Amodei|Claessen|Leveson|Saltzer' { return '50-safety-verification' }
    'ChandyLamport|Helland|GarciaMolina|Mohan|Lamport1978|WorkflowPatterns' { return '20-event-evidence' }
    'Jimenez|Yang|Zhang|Schick|Shinn|Madaan|Xia|Tao|Bairi|Liu|Ding|Yao2023' { return '40-llm-agents' }
    'Endsley|LeeSee|Woods|Klein|Parasuraman|Bainbridge' { return '30-human-oversight' }
    'Cheng|Garlan2004|KephartChess|KramerMagee|Oreizy' { return '10-self-adaptation' }
    default { return '00-foundations' }
  }
}

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

function Try-DownloadPdf([string]$url, [string]$outFile) {
  $tmp = Join-Path $env:TEMP ("acq_" + [guid]::NewGuid().ToString() + ".bin")
  $candidates = New-Object System.Collections.Generic.List[string]
  $doi = $null
  if ($url -match '^https?://doi\.org/(?<doi>.+)$') {
    $doi = $Matches['doi']
  }
  if ($url -match 'arxiv\.org/abs/(?<id>[^\s/]+)') {
    $candidates.Add("https://arxiv.org/pdf/$($Matches['id']).pdf")
  }
  if ($url -match '^https?://doi\.org/') {
    $candidates.Add($url)
  }
  if ($url -notmatch '\.pdf(\?|$)') {
    $candidates.Add(($url.TrimEnd('/')) + "/pdf")
    $candidates.Add(($url.TrimEnd('/')) + ".pdf")
  }
  $candidates.Add($url)

  # Query OpenAlex for lawful OA URLs when a DOI is provided.
  if ($null -ne $doi) {
    try {
      $oaApi = "https://api.openalex.org/works/https://doi.org/$doi"
      $oa = Invoke-RestMethod -Uri $oaApi -TimeoutSec 30
      if ($null -ne $oa -and $null -ne $oa.open_access -and -not [string]::IsNullOrWhiteSpace($oa.open_access.oa_url)) {
        $candidates.Add([string]$oa.open_access.oa_url)
      }
      if ($null -ne $oa -and $null -ne $oa.locations) {
        foreach ($loc in $oa.locations) {
          if ($null -ne $loc -and $null -ne $loc.pdf_url -and -not [string]::IsNullOrWhiteSpace($loc.pdf_url)) {
            $candidates.Add([string]$loc.pdf_url)
          }
          if ($null -ne $loc -and $null -ne $loc.landing_page_url -and -not [string]::IsNullOrWhiteSpace($loc.landing_page_url)) {
            $candidates.Add([string]$loc.landing_page_url)
          }
        }
      }
    } catch {
      # OpenAlex lookup is best-effort.
    }
  }

  $seen = @{}
  $uniqueCandidates = New-Object System.Collections.Generic.List[string]
  foreach ($c in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($c) -and -not $seen.ContainsKey($c)) {
      $seen[$c] = $true
      $uniqueCandidates.Add($c)
    }
  }

  # Try DOI content negotiation first when applicable.
  if ($url -match '^https?://doi\.org/') {
    try {
      Invoke-WebRequest -Uri $url -OutFile $tmp -MaximumRedirection 8 -TimeoutSec 45 -UseBasicParsing -Headers @{ Accept = 'application/pdf' }
      if (Test-Pdf $tmp) {
        Move-Item -Force $tmp $outFile
        return "downloaded:$url [accept=application/pdf]"
      }
    } catch {
      # continue
    } finally {
      if (Test-Path $tmp) {
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
      }
    }
  }

  foreach ($candidate in $uniqueCandidates) {
    try {
      Invoke-WebRequest -Uri $candidate -OutFile $tmp -MaximumRedirection 8 -TimeoutSec 45 -UseBasicParsing
      if (Test-Pdf $tmp) {
        Move-Item -Force $tmp $outFile
        return "downloaded:$candidate"
      }
    } catch {
      # continue trying candidates
    } finally {
      if (Test-Path $tmp) {
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
      }
    }
  }

  # Attempt PDF discovery from landing pages by extracting likely PDF links.
  try {
    $landing = Invoke-WebRequest -Uri $url -MaximumRedirection 8 -TimeoutSec 45 -UseBasicParsing
    $pdfLinks = New-Object System.Collections.Generic.List[string]
    foreach ($l in $landing.Links) {
      if ($null -ne $l -and $null -ne $l.href) {
        $href = [string]$l.href
        if ($href -match '\.pdf(\?|$)|/pdf(\?|$)|download') {
          try {
            $abs = [System.Uri]::new($landing.BaseResponse.ResponseUri, $href).AbsoluteUri
            if (-not $pdfLinks.Contains($abs)) { $pdfLinks.Add($abs) }
          } catch {
            # ignore malformed links
          }
        }
      }
    }

    foreach ($p in $pdfLinks) {
      try {
        Invoke-WebRequest -Uri $p -OutFile $tmp -MaximumRedirection 8 -TimeoutSec 45 -UseBasicParsing
        if (Test-Pdf $tmp) {
          Move-Item -Force $tmp $outFile
          return "downloaded:$p [from-landing]"
        }
      } catch {
        # continue
      } finally {
        if (Test-Path $tmp) {
          Remove-Item -Force $tmp -ErrorAction SilentlyContinue
        }
      }
    }
  } catch {
    # landing page acquisition best-effort only
  }

  return $null
}

$papersRoot = Join-Path $PWD "sources\papers"
$results = New-Object System.Collections.Generic.List[object]

foreach ($key in ($entries.Keys | Sort-Object)) {
  $dir = Join-Path $papersRoot (Get-Category $key)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $out = Join-Path $dir ("$key.pdf")

  if (Test-Pdf $out) {
    $results.Add([pscustomobject]@{ Key = $key; Status = 'already'; Path = $out; Note = '' })
    continue
  }

  $res = Try-DownloadPdf -url $entries[$key] -outFile $out
  if ($res) {
    $results.Add([pscustomobject]@{ Key = $key; Status = 'downloaded'; Path = $out; Note = $res })
  } else {
    $results.Add([pscustomobject]@{ Key = $key; Status = 'unavailable'; Path = ''; Note = $entries[$key] })
  }
}

$report = Join-Path $PWD "sources\acquisition-run-2026-06-02.md"
$downloaded = @($results | Where-Object { $_.Status -eq 'downloaded' })
$already = @($results | Where-Object { $_.Status -eq 'already' })
$unavailable = @($results | Where-Object { $_.Status -eq 'unavailable' })

$lines = @()
$lines += '# Acquisition Run - 2026-06-02'
$lines += ''
$lines += "- Total entries: $($results.Count)"
$lines += "- Downloaded this run: $($downloaded.Count)"
$lines += "- Already present: $($already.Count)"
$lines += "- Unavailable: $($unavailable.Count)"
$lines += ''
$lines += '## Downloaded'
$lines += ''
$lines += @($downloaded | Sort-Object Key | ForEach-Object { "- $($_.Key): $($_.Path) [$($_.Note)]" })
$lines += ''
$lines += '## Already Present'
$lines += ''
$lines += @($already | Sort-Object Key | ForEach-Object { "- $($_.Key): $($_.Path)" })
$lines += ''
$lines += '## Unavailable (lawful path not auto-resolved)'
$lines += ''
$lines += @($unavailable | Sort-Object Key | ForEach-Object { "- $($_.Key): $($_.Note)" })

Set-Content -Path $report -Value ($lines -join "`r`n") -Encoding UTF8

Write-Output "REPORT=$report"
Write-Output "DOWNLOADED=$($downloaded.Count)"
Write-Output "ALREADY=$($already.Count)"
Write-Output "UNAVAILABLE=$($unavailable.Count)"
