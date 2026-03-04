# RIIP Manual: From CSV Fields to Risk Metrics

This guide explains, in simple terms, how your raw CSV data is transformed into the platform’s metrics and rankings.

## 1) What the CSV is used for

The source CSV is treated as a **retraction event log** (case records), not as a full publication census.

That means:
- It directly provides the event-level evidence (who, where, when, why).
- It does **not** directly provide denominators like total country publications.

## 2) CSV fields and how each one is handled

The ingestor accepts canonical fields and common aliases, then standardizes them.

| CSV field | Required? | How it is manipulated | Why this choice is intuitive |
|---|---:|---|---|
| `doi` | Optional | Used as the unique key when present; duplicate DOI rows are collapsed/upserted | DOI is the most reliable paper identifier |
| `journal` | Yes | Normalized text, then used for journal grouping | Journal-level risk must be grouped by publication venue |
| `publisher` | Yes | Cleaned (trim spaces, remove trailing bracketed suffixes) | Keeps `Wiley`, `Elsevier`, etc. consistent for benchmarking |
| `country` | Yes | Standardized labels (`US/USA` → `United States`, `UK` → `United Kingdom`) | Prevents fake splits caused by spelling variants |
| `institution` | Yes | Raw value preserved; canonical institution extracted from noisy affiliation strings | Keeps original evidence while enabling cleaner ranking |
| `publication_date` | Yes | Parsed into ISO date; supports multiple formats (including slash dates) | Needed to compute delay from publication to retraction |
| `retraction_date` | Yes | Parsed into ISO date | Needed for yearly trend and acceleration metrics |
| `reason_text` | Yes | Used for reason classification and evidence snippets | Powers severity logic and RAG evidence grounding |
| `severity_label` | Optional | Stored as metadata; current scoring mainly uses reason-derived severity map | Keeps source label while using consistent scoring logic |
| all extra columns | Optional | Saved into `extra_fields` JSON | Avoids losing information from wider CSV schemas |

### Row quality rules
A row is skipped if critical fields are missing/invalid:
- missing `journal`
- invalid `publication_date`
- invalid `retraction_date`

This avoids scoring on incomplete events.

## 3) Core transformations before scoring

Each valid row is converted into an enriched event with:
- `delay_days` = max(`retraction_date - publication_date`, 0)
- `category` = reason-text classification (`fabrication`, `paper_mill`, `plagiarism`, etc.)
- `severity` = numeric severity from category map
- `year` = retraction year (used for trend counts)

Then events are grouped by:
- journal
- country
- year

## 4) Journal risk: how it is computed

For each journal, the engine builds these signals:
- `retraction_rate` = total retraction events for that journal
- `severity_index` = average event severity
- `median_delay_days` = median publication-to-retraction delay
- `acceleration_score` (same as growth velocity) = how current year compares with 3-year moving average
- `volatility_index` = variation in yearly retraction counts

Each signal is min-max normalized to 0–100, then weighted:

- 30% retraction rate
- 20% severity index
- 20% acceleration
- 15% median delay
- 15% volatility

Final output:
- `risk_score` (0–100 scale)
- `tier` (`AAA`, `AA`, `A`, `BBB`, `BB`, `B`)
- `trend_direction` (`upward`, `stable`, `downward`)

## 5) Country risk: how it is computed

Country signals:
- `retractions_per_10k` = retractions / total publications × 10,000
- `acceleration_3y` = recent count vs 3-year moving average
- `severity_cluster_score` = average severity of country’s events

After normalization, weighted score:

- 45% retractions per 10k
- 30% acceleration
- 25% severity cluster

### Important denominator note
`retractions_per_10k` needs total publication volume from the `country_publications` table (separate from CSV).

If a country-year denominator is missing, fallback uses `1` to avoid divide-by-zero. This keeps computation running but can overstate raw per-10k values before normalization.

## 6) Forecast and confidence

Forecast is a linear trend on yearly retraction counts:
- outputs: `projected_next_year`, `trend_slope`

Confidence is a bounded composite using:
- model fit quality (`R²`)
- normalized error (`NRMSE`)
- sample-size strength

It is clamped to a practical range (5–97) to avoid misleading 0/100 extremes.

## 7) Institution exposure and ranking

Institution exposure score combines:
- 55% country risk
- 35% publisher average risk
- 10% publication-volume signal

Then institutions are ranked by descending exposure score.

Why this is intuitive:
- Country captures ecosystem-level risk,
- Publisher captures venue-level risk,
- Volume gives proportional operational exposure.

## 8) Why these design choices support integrity

- **Consistency:** same formulas for all entities.
- **Comparability:** normalization puts mixed units on a common scale.
- **Auditability:** every score can be traced back to raw records, trends, and reason categories.
- **Graceful degradation:** the system still runs when some data is missing, while exposing caveats.

## 9) Practical interpretation tips for users

- Use score + trend together (high score with upward trend is higher urgency).
- Treat country comparisons carefully if denominator coverage is incomplete.
- Use evidence snippets to validate whether a score increase reflects serious reason patterns.
- Use forecast confidence as a trust indicator, not as a certainty guarantee.

## 10) Quick FAQ

**Q: Is `retractions_per_10k` in the source CSV?**
No. It is derived from retraction counts plus `country_publications` denominator data.

**Q: Is journal `retraction_rate` in the CSV?**
No. It is computed from grouped event counts.

**Q: Why normalize metrics?**
Because delay (days), counts, and severity are different scales; normalization makes fair weighting possible.
