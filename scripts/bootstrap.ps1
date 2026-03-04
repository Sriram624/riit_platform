Write-Host "Starting RIIP local stack..."

Push-Location "$PSScriptRoot\..\infra\db"
docker compose up -d
Pop-Location

Push-Location "$PSScriptRoot\..\apps\api"
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm install
Pop-Location

Push-Location "$PSScriptRoot\..\apps\frontend"
npm install
Pop-Location

Write-Host "Bootstrap complete."
Write-Host "1) API: cd apps/api; npm run dev"
Write-Host "2) Frontend: cd apps/frontend; npm run dev"
Write-Host "3) Recompute scores: POST http://localhost:8080/api/v1/score/recompute"
