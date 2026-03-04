# RIIP Architecture

## Data Layer

- `retractions_raw`: source events
- `country_publications`: denominator for retractions per 10k
- `journal_metrics`: stable decision outputs for journals
- `country_metrics`: national risk outputs
- `trend_metrics`: rolling averages and anomaly flags

## Computation Layer

Python engine computes:

- journal composite risk
- country risk index
- misconduct category clustering
- 3-year moving average acceleration
- z-score anomaly detection

## API Layer

Express APIs provide:

- retrieval APIs for decision support
- recomputation trigger for update cycles
- exposure analyzer endpoint for institution/country/publisher benchmarking

## UI Layer

React app provides:

- top-level strategic risk view
- journal stability table
- country risk index panel
- anomaly detector feed
- institutional exposure form and benchmark outputs
