# RIIP — Research Integrity Intelligence Platform

Industry-grade risk infrastructure for scientific reliability.

## Stack

- Frontend: React + Vite
- API: Node.js + Express
- Risk Engine: Python (scoring, trend acceleration, anomaly detection)
- Database: PostgreSQL (Docker)

## Monorepo Layout

- `apps/frontend` — Risk intelligence UI
- `apps/api` — REST API and Python engine orchestration
- `services/risk-engine` — Composite risk scoring and NLP category clustering
- `infra/db` — PostgreSQL schema, seed, and Docker Compose
- `scripts/bootstrap.ps1` — Local environment bootstrap

## What This Solves

- Journal stability rating with AAA → B tiering
- Country research risk index and comparative benchmarking
- Time-to-retraction intelligence (median delay and volatility)
- Misconduct pattern clustering from reason text
- Acceleration detection using rolling windows and z-score anomalies
- Institutional exposure analysis by institution, country, and publisher
- Forecasted next-year retraction counts for journals/countries
- Evidence-grounded AI/RAG insight generation for analyst questions

## Source of Truth: CSV

- The platform uses `retraction_watch.csv` as canonical source and resolves it from `CSV_SOURCE_PATH`.
- Default path is tuned for your machine: `../../../../retraction_watch.csv` from API (`C:/Users/Sriram/Downloads/retraction_watch.csv`).
- All institutional search/rank/exposure endpoints are driven from `retractions_raw` (CSV-ingested universe), not a small static registry subset.
- Institutional search/ranking/exposure resolve from raw ingested data (not just static seed registry rows).
- Use the import endpoint or helper script to load your real dataset.

## Quick Start (Windows PowerShell)

1. Ensure Docker Desktop is running.
2. Install Node.js 20+ and Python 3.10+.
3. Run:

```powershell
cd c:\Users\Sriram\Downloads\riitpplatform
.\scripts\bootstrap.ps1
```

4. Start API:

```powershell
cd .\apps\api
Copy-Item .env.example .env -ErrorAction SilentlyContinue
npm run dev
```

5. Start frontend in another terminal:

```powershell
cd c:\Users\Sriram\Downloads\riitpplatform\apps\frontend
npm run dev
```

6. Compute risk metrics once API is live:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/api/v1/score/recompute
```

### Sync from canonical source (recommended)

```powershell
cd c:\Users\Sriram\Downloads\riitpplatform
Invoke-RestMethod -Method POST http://localhost:8080/api/v1/data/sync-source
```

### Import a custom CSV file

```powershell
cd c:\Users\Sriram\Downloads\riitpplatform
.\scripts\import-csv.ps1 -CsvFilePath "C:\path\to\your\retractions.csv"
```

Expected CSV column names (aliases supported):
- `doi`
- `journal` (`journal_name`)
- `publisher` (`publisher_name`)
- `country`
- `institution` (`university`, `affiliation`, `institute`)
- `publication_date` (`published_date`, `pub_date`)
- `retraction_date` (`date_retracted`)
- `reason_text` (`reason`, `retraction_reason`)
- optional: `severity_label`

7. Open UI at `http://localhost:5173`.

## API Endpoints

- `GET /health`
- `GET /api/v1/overview`
- `GET /api/v1/journals?search=&limit=`
- `GET /api/v1/countries`
- `GET /api/v1/trends/anomalies`
- `GET /api/v1/forecasts?entityType=&limit=`
- `GET /api/v1/insights/retrieve?query=&entityType=&entityName=&limit=`
- `POST /api/v1/insights/explain`
- `GET /api/v1/institutions/exposure?institution=&country=&publisher=`
- `GET /api/v1/institutions/search?query=&limit=`
- `GET /api/v1/institutions/rankings?limit=&country=&publisher=`
- `GET /api/v1/data/source-status`
- `GET /api/v1/data/raw-records?limit=&offset=&institution=&country=&publisher=&journal=`
- `POST /api/v1/data/sync-source`
- `POST /api/v1/data/sync-openalex`
- `POST /api/v1/data/import-csv`
- `POST /api/v1/score/recompute`

## Scoring Model

The platform is integrity-first. Publication-normalized country risk is shown only when denominator quality is available from OpenAlex.

Journal integrity signal (0–100):

```
Integrity Signal =
  (Severity Weight × 30)
+ (Acceleration Score × 25)
+ (Delay Penalty × 20)
+ (Volatility Index × 15)
+ (Misconduct Diversity × 10)
```

Tier bands:
- `AAA`: 0–15
- `AA`: 15–30
- `A`: 30–45
- `BBB`: 45–60
- `BB`: 60–75
- `B`: 75–100
