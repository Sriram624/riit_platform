# RIIP API

Node.js Express API for Research Integrity Intelligence Platform.

## Run

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
npm install
npm run dev
```

## Key Routes

- `GET /api/v1/overview`
- `GET /api/v1/journals`
- `GET /api/v1/countries`
- `GET /api/v1/trends/anomalies`
- `GET /api/v1/forecasts`
- `GET /api/v1/institutions/exposure`
- `GET /api/v1/institutions/search`
- `GET /api/v1/institutions/rankings`
- `GET /api/v1/insights/retrieve`
- `POST /api/v1/insights/explain`
- `POST /api/v1/data/import-csv`
- `POST /api/v1/data/sync-openalex`
- `POST /api/v1/score/recompute`

`POST /api/v1/score/recompute` reads from `retractions_raw` and `country_publications`, runs the Python engine, and writes to metrics tables.

### CSV Import

```json
POST /api/v1/data/import-csv
{
	"csvFilePath": "C:/path/to/retractions.csv",
	"truncate": true,
	"recompute": true
}
```

Canonical source sync:

```http
POST /api/v1/data/sync-source
```

This syncs from `CSV_SOURCE_PATH` (defaults to `../../../../retraction_watch.csv`).

OpenAlex denominator sync:

```http
POST /api/v1/data/sync-openalex
```

Use this to refresh country/year publication totals (used for publication-normalized country risk).

Related env vars:
- `OPENALEX_ENABLED` (default `true`)
- `OPENALEX_EMAIL` (optional, recommended)
- `OPENALEX_TIMEOUT_MS` (default `10000`)
- `OPENALEX_REFRESH_DAYS` (default `30`)

### AI / RAG (optional)

Set these env vars to enable LLM-generated grounded explanations:

- `LLM_API_URL` (example: `https://api.openai.com/v1/chat/completions`)
- `LLM_API_KEY`
- `LLM_MODEL` (default `gpt-4o-mini`)

Without these vars, the API still returns deterministic, evidence-grounded heuristic explanations.
