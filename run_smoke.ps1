param(
    [int]$UI_PORT = 4181,
    [int]$OllamaPort = 11434
)

try{
    Invoke-WebRequest -Uri "http://127.0.0.1:$UI_PORT/" -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Host "UI health: OK"; $u=0
}catch{ Write-Host "UI health: FAIL"; $u=1 }
try{ Invoke-RestMethod -Uri "http://127.0.0.1:$OllamaPort/api/tags" -Method Get -TimeoutSec 3; Write-Host "Ollama health: OK"; $o=0 }catch{ Write-Host "Ollama health: FAIL"; $o=1 }
exit ($u + $o)
