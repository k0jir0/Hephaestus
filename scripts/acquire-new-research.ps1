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

function Sanitize-Key([string]$s) {
  return (($s -replace '[^A-Za-z0-9]+', '-') -replace '(^-+|-+$)', '')
}

function Get-ArxivEntries([string]$query, [int]$maxResults = 12) {
  $encoded = [System.Uri]::EscapeDataString($query)
  $url = "http://export.arxiv.org/api/query?search_query=all:$encoded&start=0&max_results=$maxResults&sortBy=relevance&sortOrder=descending"
  try {
    $resp = Invoke-WebRequest -Uri $url -TimeoutSec 45 -UseBasicParsing
  } catch {
    return @()
  }

  if ($null -eq $resp -or [string]::IsNullOrWhiteSpace([string]$resp.Content)) { return @() }

  try {
    [xml]$doc = $resp.Content
  } catch {
    return @()
  }

  $entries = @($doc.feed.entry)
  if ($entries.Count -eq 0) { return @() }
  return $entries
}

function Normalize-ArxivId([string]$idOrUrl) {
  if ([string]::IsNullOrWhiteSpace($idOrUrl)) { return '' }
  if ($idOrUrl -match 'arxiv\.org/(abs|pdf)/(?<id>[0-9]{4}\.[0-9]{4,5})(v[0-9]+)?') {
    return $Matches['id']
  }
  if ($idOrUrl -match '(?<id>[0-9]{4}\.[0-9]{4,5})(v[0-9]+)?$') {
    return $Matches['id']
  }
  return ''
}

function Entry-MatchesTarget([object]$entry, [string[]]$mustHave, [string[]]$mustNotHave) {
  $title = ([string]$entry.title).ToLowerInvariant()
  $summary = ([string]$entry.summary).ToLowerInvariant()
  $text = ($title + ' ' + $summary)

  foreach ($bad in $mustNotHave) {
    if ($text.Contains($bad.ToLowerInvariant())) {
      return $false
    }
  }

  if ($mustHave.Count -eq 0) { return $true }
  foreach ($good in $mustHave) {
    if ($text.Contains($good.ToLowerInvariant())) {
      return $true
    }
  }
  return $false
}

$targets = @(
  @{ Rank = 1; Name = 'Runtime Verification for Autonomous Pipelines'; Query = 'runtime verification autonomous software agents temporal logic monitor'; MustHave = @('runtime verification','monitor','temporal logic','autonomous'); MustNotHave = @('medical image','protein') },
  @{ Rank = 2; Name = 'Causal Incident Analysis for Autonomous Systems'; Query = 'causal inference incident analysis autonomous software systems reliability'; MustHave = @('causal','incident','reliability','root cause'); MustNotHave = @('genomics','climate') },
  @{ Rank = 3; Name = 'Human-on-the-Loop Intervention Timing'; Query = 'human in the loop automation trust calibration decision latency'; MustHave = @('human','automation','trust','intervention'); MustNotHave = @('mesh recovery','pose estimation') },
  @{ Rank = 4; Name = 'Constrained Autonomy and Safe Policy Optimization'; Query = 'safe policy optimization constrained reinforcement learning safety constraints'; MustHave = @('safe','constraint','policy','reinforcement learning'); MustNotHave = @('quantum chemistry') },
  @{ Rank = 5; Name = 'Modern Saga Compensation Patterns at Scale'; Query = 'saga compensation distributed transactions microservices reliability'; MustHave = @('saga','compensation','distributed','transaction'); MustNotHave = @('fpga','wireless') },
  @{ Rank = 6; Name = 'Long-Horizon Software Agent Benchmarking'; Query = 'long horizon software engineering agents benchmark reproducibility'; MustHave = @('software engineering','benchmark','agent','repository'); MustNotHave = @('biology','astronomy') },
  @{ Rank = 7; Name = 'Property-Based Testing for Stateful Distributed Workflows'; Query = 'property based testing distributed systems stateful invariants'; MustHave = @('property-based','testing','stateful','invariant'); MustNotHave = @('graph neural') },
  @{ Rank = 8; Name = 'Progressive Delivery and Automated Rollback Governance'; Query = 'progressive delivery canary rollback deployment policy reliability'; MustHave = @('progressive delivery','canary','rollback','deployment'); MustNotHave = @('food delivery','supply chain') },
  @{ Rank = 9; Name = 'Decision-Centric Explainability for Operations'; Query = 'counterfactual explainability decision support operations reliability'; MustHave = @('counterfactual','explainability','decision','operations'); MustNotHave = @('adversarial image') },
  @{ Rank = 10; Name = 'Multi-Objective Optimization for Throughput Safety Tradeoffs'; Query = 'multi objective optimization reliability safety throughput operations'; MustHave = @('multi-objective','optimization','safety','reliability'); MustNotHave = @('robot soccer') },
  @{ Rank = 11; Name = 'Socio-Technical Incident Response for Autonomous DevOps'; Query = 'socio technical incident response autonomous devops reliability'; MustHave = @('socio-technical','incident','response','devops'); MustNotHave = @('education survey') },
  @{ Rank = 12; Name = 'Cost-Risk Economics of Autonomy'; Query = 'economics risk automation autonomous systems operations software'; MustHave = @('economics','risk','automation','operations'); MustNotHave = @('qatar','agriculture') }
)

$existingRaw = Get-Content "sources\sources.txt" -Raw
$existingArxivIds = New-Object System.Collections.Generic.HashSet[string]
foreach ($m in [regex]::Matches($existingRaw, 'arxiv\.org/(abs|pdf)/(?<id>[0-9]{4}\.[0-9]{4,5})', 'IgnoreCase')) {
  [void]$existingArxivIds.Add($m.Groups['id'].Value)
}

$papersRoot = Join-Path $PWD "sources\papers\60-new-research"
New-Item -ItemType Directory -Force -Path $papersRoot | Out-Null

# Regenerate this tier cleanly so results reflect current relevance filters.
Get-ChildItem -Path $papersRoot -Filter '*.pdf' -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$results = New-Object System.Collections.Generic.List[object]

foreach ($t in $targets) {
  $entries = Get-ArxivEntries -query $t.Query -maxResults 18
  $chosen = $null

  foreach ($e in $entries) {
    $entryId = [string]$e.id
    $arxivId = Normalize-ArxivId $entryId
    if ([string]::IsNullOrWhiteSpace($arxivId)) { continue }
    if ($existingArxivIds.Contains($arxivId)) { continue }
    if (-not (Entry-MatchesTarget -entry $e -mustHave $t.MustHave -mustNotHave $t.MustNotHave)) { continue }

    $publishedText = [string]$e.published
    $year = 0
    if ($publishedText.Length -ge 4) {
      [void][int]::TryParse($publishedText.Substring(0, 4), [ref]$year)
    }
    if ($year -lt 2022) { continue }

    $chosen = $e
    break
  }

  if ($null -eq $chosen) {
    $results.Add([pscustomobject]@{
      Rank = $t.Rank
      Target = $t.Name
      Query = $t.Query
      Status = 'unresolved'
      Key = ''
      Title = ''
      ArxivId = ''
      Pdf = ''
      Note = 'No non-duplicate 2022+ arXiv match found'
    })
    continue
  }

  $chosenId = Normalize-ArxivId ([string]$chosen.id)
  $title = ([string]$chosen.title).Trim() -replace '\s+', ' '
  $key = ('NewResearch{0:D2}_{1}' -f $t.Rank, (Sanitize-Key $chosenId))
  $outPath = Join-Path $papersRoot ($key + '.pdf')
  $pdfUrl = "https://arxiv.org/pdf/$chosenId.pdf"

  try {
    if (-not (Test-Pdf $outPath)) {
      $tmp = Join-Path $env:TEMP ("new_research_" + [guid]::NewGuid().ToString() + ".bin")
      try {
        Invoke-WebRequest -Uri $pdfUrl -OutFile $tmp -MaximumRedirection 8 -TimeoutSec 60 -UseBasicParsing
        if (Test-Pdf $tmp) {
          Move-Item -Force $tmp $outPath
        } else {
          if (Test-Path $tmp) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
          throw "Downloaded file is not a PDF"
        }
      } finally {
        if (Test-Path $tmp) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
      }
    }

    [void]$existingArxivIds.Add($chosenId)

    $results.Add([pscustomobject]@{
      Rank = $t.Rank
      Target = $t.Name
      Query = $t.Query
      Status = 'acquired'
      Key = $key
      Title = $title
      ArxivId = $chosenId
      Pdf = $outPath
      Note = ''
    })
  } catch {
    $results.Add([pscustomobject]@{
      Rank = $t.Rank
      Target = $t.Name
      Query = $t.Query
      Status = 'failed'
      Key = $key
      Title = $title
      ArxivId = $chosenId
      Pdf = ''
      Note = $_.Exception.Message
    })
  }
}

$report = Join-Path $PWD "sources\new-research-acquisition-run-2026-06-02.md"
$acquired = @($results | Where-Object { $_.Status -eq 'acquired' })
$failed = @($results | Where-Object { $_.Status -eq 'failed' })
$unresolved = @($results | Where-Object { $_.Status -eq 'unresolved' })

$lines = @()
$lines += '# New Research Acquisition Run - 2026-06-02'
$lines += ''
$lines += "- Targets processed: $($results.Count)"
$lines += "- Acquired: $($acquired.Count)"
$lines += "- Failed download: $($failed.Count)"
$lines += "- Unresolved (no eligible match): $($unresolved.Count)"
$lines += ''
$lines += '## Acquired'
$lines += ''
foreach ($r in ($acquired | Sort-Object Rank)) {
  $lines += "- [$($r.Key)] $($r.Title)"
  $lines += "  - Target: $($r.Target)"
  $lines += "  - arXiv: https://arxiv.org/abs/$($r.ArxivId)"
  $lines += "  - PDF: $($r.Pdf)"
}
$lines += ''
$lines += '## Failed'
$lines += ''
foreach ($r in ($failed | Sort-Object Rank)) {
  $lines += "- Target $($r.Rank): $($r.Target)"
  $lines += "  - Candidate: $($r.Title)"
  $lines += "  - arXiv: https://arxiv.org/abs/$($r.ArxivId)"
  $lines += "  - Reason: $($r.Note)"
}
$lines += ''
$lines += '## Unresolved'
$lines += ''
foreach ($r in ($unresolved | Sort-Object Rank)) {
  $lines += "- Target $($r.Rank): $($r.Target)"
  $lines += "  - Query: $($r.Query)"
  $lines += "  - Reason: $($r.Note)"
}

Set-Content -Path $report -Value ($lines -join "`r`n") -Encoding UTF8

Write-Output "REPORT=$report"
Write-Output "ACQUIRED=$($acquired.Count)"
Write-Output "FAILED=$($failed.Count)"
Write-Output "UNRESOLVED=$($unresolved.Count)"
