param(
  [string]$CsvFilePath = "",
  [switch]$NoTruncate,
  [switch]$NoRecompute
)

$bodyObject = @{
  truncate = -not $NoTruncate
  recompute = -not $NoRecompute
}

if ($CsvFilePath -and $CsvFilePath.Trim() -ne "") {
  $bodyObject.csvFilePath = (Resolve-Path $CsvFilePath).Path
}

$body = $bodyObject | ConvertTo-Json

Invoke-RestMethod -Method POST `
  -Uri "http://localhost:8080/api/v1/data/import-csv" `
  -ContentType "application/json" `
  -Body $body
