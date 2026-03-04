import json
import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime

CATEGORY_KEYWORDS = {
    "fabrication": ["fabrication", "falsification", "data manipulation"],
    "paper_mill": ["paper mill", "third-party submission", "bought authorship"],
    "plagiarism": ["plagiarism", "duplicate", "text overlap", "self-plagiarism"],
    "peer_review_manipulation": ["peer review", "fake reviewer", "review manipulation"],
    "ethical_violation": ["ethics", "irb", "consent", "animal welfare", "human subjects"],
}

CATEGORY_SEVERITY = {
    "fabrication": 95,
    "paper_mill": 90,
    "peer_review_manipulation": 85,
    "ethical_violation": 78,
    "plagiarism": 65,
    "other": 55,
}

TIER_BANDS = [
    (15, "AAA"),
    (30, "AA"),
    (45, "A"),
    (60, "BBB"),
    (75, "BB"),
    (100, "B"),
]


def parse_date(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).split("T")[0])


def classify_reason(text):
    lowered = (text or "").lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in lowered:
                return category
    return "other"


def min_max_normalize(value, min_value, max_value):
    if max_value == min_value:
        return 50.0
    return ((value - min_value) / (max_value - min_value)) * 100


def z_score(values):
    if len(values) < 2:
        return 0.0
    mean = statistics.fmean(values)
    std_dev = statistics.pstdev(values)
    if std_dev == 0:
        return 0.0
    return (values[-1] - mean) / std_dev


def moving_average_last_3(yearly_counts):
    years = sorted(yearly_counts.keys())
    result = {}
    for idx, year in enumerate(years):
        lookback = years[max(0, idx - 2) : idx + 1]
        vals = [yearly_counts[y] for y in lookback]
        result[year] = statistics.fmean(vals)
    return result


def linear_regression_forecast(yearly_counts):
    years = sorted(yearly_counts.keys())
    if not years:
        return {
            "latest_year": datetime.utcnow().year,
            "latest_count": 0,
            "projected_next_year": 0,
            "trend_slope": 0.0,
            "confidence": 0.0,
        }

    x_values = [idx + 1 for idx, _ in enumerate(years)]
    y_values = [yearly_counts[year] for year in years]

    if len(x_values) == 1:
        slope = 0.0
        intercept = float(y_values[0])
    else:
        x_mean = statistics.fmean(x_values)
        y_mean = statistics.fmean(y_values)
        denominator = sum((x - x_mean) ** 2 for x in x_values)
        if denominator == 0:
            slope = 0.0
        else:
            numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_values, y_values))
            slope = numerator / denominator
        intercept = y_mean - slope * x_mean

    next_x = len(x_values) + 1
    projected_next_year = max(intercept + slope * next_x, 0.0)

    predictions = [intercept + slope * x for x in x_values]
    residuals = [actual - predicted for actual, predicted in zip(y_values, predictions)]
    rmse = math.sqrt(statistics.fmean([r**2 for r in residuals])) if residuals else 0.0

    mean_y = statistics.fmean(y_values) if y_values else 0.0
    nrmse = rmse / max(mean_y, 1.0)

    if len(x_values) > 1:
        y_mean = statistics.fmean(y_values)
        ss_res = sum((actual - predicted) ** 2 for actual, predicted in zip(y_values, predictions))
        ss_tot = sum((actual - y_mean) ** 2 for actual in y_values)
        r_squared = 1.0 - (ss_res / ss_tot) if ss_tot else 0.0
    else:
        r_squared = 0.0

    r_squared = max(0.0, min(1.0, r_squared))
    stability = 1.0 / (1.0 + (nrmse * 2.5))
    sample_strength = min(1.0, len(x_values) / 6.0)

    blended_core = (r_squared * 0.55) + (stability * 0.45)
    confidence = (20.0 + (blended_core * 70.0)) * (0.6 + (sample_strength * 0.4))
    confidence = max(5.0, min(97.0, confidence))

    return {
        "latest_year": years[-1],
        "latest_count": y_values[-1],
        "projected_next_year": int(round(projected_next_year)),
        "trend_slope": round(slope, 4),
        "confidence": round(confidence, 2),
    }


def trend_direction(acceleration):
    if acceleration > 8:
        return "upward"
    if acceleration < -8:
        return "downward"
    return "stable"


def tier_for_score(score):
    for upper, tier in TIER_BANDS:
        if score <= upper:
            return tier
    return "B"


def compute(raw_records, country_publications):
    journal_groups = defaultdict(list)
    country_groups = defaultdict(list)
    journal_year_counts = defaultdict(lambda: defaultdict(int))
    country_year_counts = defaultdict(lambda: defaultdict(int))

    for record in raw_records:
        publication_date = parse_date(record.get("publication_date"))
        retraction_date = parse_date(record.get("retraction_date"))
        if not publication_date or not retraction_date:
            continue

        delay_days = max((retraction_date - publication_date).days, 0)
        category = classify_reason(record.get("reason_text"))
        severity = CATEGORY_SEVERITY.get(category, 55)

        enriched = {
            "journal": record.get("journal", "Unknown"),
            "publisher": record.get("publisher", "Unknown"),
            "country": record.get("country", "Unknown"),
            "institution": record.get("institution", "Unknown"),
            "year": retraction_date.year,
            "delay_days": delay_days,
            "severity": severity,
            "category": category,
        }

        journal_groups[enriched["journal"]].append(enriched)
        country_groups[enriched["country"]].append(enriched)
        journal_year_counts[enriched["journal"]][enriched["year"]] += 1
        country_year_counts[enriched["country"]][enriched["year"]] += 1

    publication_index = defaultdict(dict)
    publication_source_index = defaultdict(dict)
    for row in country_publications:
        country = row.get("country", "Unknown")
        year = int(row.get("year", 0))
        publication_count = int(row.get("publication_count", 0))
        publication_index[country][year] = max(publication_count, 1)
        publication_source_index[country][year] = row.get("source") or "manual"

    journal_pre = []
    for journal, items in journal_groups.items():
        delays = [x["delay_days"] for x in items]
        severities = [x["severity"] for x in items]
        categories = [x["category"] for x in items]
        year_counts = journal_year_counts[journal]
        years_sorted = sorted(year_counts.keys())

        total_retractions = len(items)
        retraction_rate = total_retractions * 1.0
        severity_index = statistics.fmean(severities) if severities else 0
        median_delay = statistics.median(delays) if delays else 0
        delay_volatility = statistics.pstdev(delays) if len(delays) > 1 else 0
        misconduct_diversity = len(set(categories)) / max(len(CATEGORY_KEYWORDS), 1) * 100

        moving = moving_average_last_3(year_counts)
        latest_year = years_sorted[-1] if years_sorted else datetime.utcnow().year
        latest_count = year_counts.get(latest_year, 0)
        latest_ma = moving.get(latest_year, latest_count)
        growth_velocity = ((latest_count - latest_ma) / max(latest_ma, 1)) * 100
        volatility = statistics.pstdev(list(year_counts.values())) if len(year_counts) > 1 else 0

        journal_pre.append(
            {
                "journal": journal,
                "publisher": items[0].get("publisher", "Unknown"),
                "retraction_rate": round(retraction_rate, 2),
                "severity_index": round(severity_index, 2),
                "median_delay_days": int(round(median_delay)),
                "delay_volatility": round(delay_volatility, 2),
                "retraction_growth_velocity": round(growth_velocity, 2),
                "misconduct_diversity_score": round(misconduct_diversity, 2),
                "volatility_index": round(volatility, 2),
                "acceleration_score": round(growth_velocity, 2),
            }
        )

    def normalize_field(rows, field):
        values = [r[field] for r in rows]
        if not values:
            return
        min_value = min(values)
        max_value = max(values)
        for row in rows:
            row[f"_{field}_norm"] = min_max_normalize(row[field], min_value, max_value)

    for field in [
        "retraction_rate",
        "severity_index",
        "acceleration_score",
        "median_delay_days",
        "volatility_index",
        "misconduct_diversity_score",
    ]:
        normalize_field(journal_pre, field)

    journal_metrics = []
    for row in journal_pre:
        integrity_score = (
            row["_severity_index_norm"] * 0.30
            + row["_acceleration_score_norm"] * 0.25
            + row["_median_delay_days_norm"] * 0.20
            + row["_volatility_index_norm"] * 0.15
            + row["_misconduct_diversity_score_norm"] * 0.10
        )

        row["integrity_score"] = round(integrity_score, 2)
        row["risk_score"] = None
        row["score_model"] = "signal"
        row["tier"] = tier_for_score(integrity_score)
        row["trend_direction"] = trend_direction(row["acceleration_score"])

        for key in list(row.keys()):
            if key.startswith("_"):
                del row[key]
        journal_metrics.append(row)

    country_pre = []
    trend_metrics = []
    forecast_metrics = []

    def select_publication_denominator(country, target_year):
        year_map = publication_index.get(country, {})
        if not year_map:
            return (None, None, None)

        exact_count = year_map.get(target_year)
        if exact_count:
            source = publication_source_index.get(country, {}).get(target_year, "manual")
            quality = "high" if source == "openalex" else "none"
            return (exact_count, target_year, quality)

        for delta in [1, 2]:
            for candidate_year in [target_year - delta, target_year + delta]:
                candidate_count = year_map.get(candidate_year)
                if candidate_count:
                    source = publication_source_index.get(country, {}).get(candidate_year, "manual")
                    quality = "medium" if source == "openalex" else "none"
                    return (candidate_count, candidate_year, quality)

        return (None, None, None)

    for country, items in country_groups.items():
        year_counts = country_year_counts[country]
        years_sorted = sorted(year_counts.keys())
        latest_year = years_sorted[-1] if years_sorted else datetime.utcnow().year

        published, denominator_year, denominator_quality = select_publication_denominator(
            country,
            latest_year,
        )
        denominator_source = (
            publication_source_index.get(country, {}).get(denominator_year, "manual")
            if denominator_year is not None
            else None
        )
        retractions_per_10k = (
            (year_counts.get(latest_year, 0) / max(published, 1)) * 10000
            if published
            else 0
        )

        moving = moving_average_last_3(year_counts)
        latest_count = year_counts.get(latest_year, 0)
        latest_ma = moving.get(latest_year, latest_count)
        acceleration = ((latest_count - latest_ma) / max(latest_ma, 1)) * 100

        severity_cluster = statistics.fmean([x["severity"] for x in items]) if items else 0

        count_series = [year_counts[y] for y in years_sorted] or [0]
        z = z_score(count_series)
        anomaly_flags = 1 if z > 2 else 0

        country_pre.append(
            {
                "country": country,
                "retractions_per_10k": round(retractions_per_10k, 2),
                "acceleration_3y": round(acceleration, 2),
                "severity_cluster_score": round(severity_cluster, 2),
                "denominator_publications": published,
                "denominator_year": denominator_year,
                "denominator_source": denominator_source,
                "denominator_quality": denominator_quality or "none",
                "trend_direction": trend_direction(acceleration),
                "anomaly_flag_count": anomaly_flags,
            }
        )

        for year in years_sorted:
            series_up_to_year = [year_counts[y] for y in years_sorted if y <= year]
            moving_by_year = moving.get(year, year_counts[year])
            z_by_year = z_score(series_up_to_year)
            trend_metrics.append(
                {
                    "entity_type": "country",
                    "entity_name": country,
                    "year": year,
                    "retraction_count": year_counts[year],
                    "moving_avg_3y": round(moving_by_year, 2),
                    "z_score": round(z_by_year, 2),
                    "is_anomaly": z_by_year > 2,
                }
            )

        forecast = linear_regression_forecast(year_counts)
        forecast_metrics.append(
            {
                "entity_type": "country",
                "entity_name": country,
                "latest_year": forecast["latest_year"],
                "latest_count": forecast["latest_count"],
                "projected_next_year": forecast["projected_next_year"],
                "trend_slope": forecast["trend_slope"],
                "confidence": forecast["confidence"],
            }
        )

    normalize_field(country_pre, "retractions_per_10k")
    normalize_field(country_pre, "acceleration_3y")
    normalize_field(country_pre, "severity_cluster_score")

    for row in country_pre:
        row["_anomaly_flag_count_norm"] = row["anomaly_flag_count"] * 100

    country_metrics = []
    for row in country_pre:
        integrity_score = (
            row["_acceleration_3y_norm"] * 0.45
            + row["_severity_cluster_score_norm"] * 0.40
            + row["_anomaly_flag_count_norm"] * 0.15
        )

        row["integrity_score"] = round(integrity_score, 2)

        denominator_is_usable = row.get("denominator_quality") in ("high", "medium")
        if denominator_is_usable:
            risk_score = (
                row["_retractions_per_10k_norm"] * 0.45
                + row["_acceleration_3y_norm"] * 0.30
                + row["_severity_cluster_score_norm"] * 0.25
            )
            row["risk_score"] = round(risk_score, 2)
        else:
            row["risk_score"] = None

        for key in list(row.keys()):
            if key.startswith("_"):
                del row[key]
        country_metrics.append(row)

    for journal, counts in journal_year_counts.items():
        years_sorted = sorted(counts.keys())
        moving = moving_average_last_3(counts)
        for year in years_sorted:
            series_up_to_year = [counts[y] for y in years_sorted if y <= year]
            z = z_score(series_up_to_year)
            trend_metrics.append(
                {
                    "entity_type": "journal",
                    "entity_name": journal,
                    "year": year,
                    "retraction_count": counts[year],
                    "moving_avg_3y": round(moving.get(year, counts[year]), 2),
                    "z_score": round(z, 2),
                    "is_anomaly": z > 2,
                }
            )

        forecast = linear_regression_forecast(counts)
        forecast_metrics.append(
            {
                "entity_type": "journal",
                "entity_name": journal,
                "latest_year": forecast["latest_year"],
                "latest_count": forecast["latest_count"],
                "projected_next_year": forecast["projected_next_year"],
                "trend_slope": forecast["trend_slope"],
                "confidence": forecast["confidence"],
            }
        )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "journal_metrics": sorted(journal_metrics, key=lambda x: x["integrity_score"], reverse=True),
        "country_metrics": sorted(
            country_metrics,
            key=lambda x: ((x["risk_score"] or -1), x["integrity_score"]),
            reverse=True,
        ),
        "trend_metrics": trend_metrics,
        "forecast_metrics": sorted(
            forecast_metrics,
            key=lambda x: (x["projected_next_year"], x["confidence"]),
            reverse=True,
        ),
    }


if __name__ == "__main__":
    payload = json.loads(input())
    output = compute(
        payload.get("rawRecords", []),
        payload.get("countryPublications", []),
    )
    print(json.dumps(output))
