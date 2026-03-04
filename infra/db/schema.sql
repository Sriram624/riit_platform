CREATE TABLE IF NOT EXISTS retractions_raw (
  id BIGSERIAL PRIMARY KEY,
  doi TEXT UNIQUE,
  journal TEXT NOT NULL,
  publisher TEXT NOT NULL,
  country TEXT NOT NULL,
  institution TEXT NOT NULL,
  publication_date DATE NOT NULL,
  retraction_date DATE NOT NULL,
  severity_label TEXT,
  reason_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS country_publications (
  country TEXT NOT NULL,
  year INT NOT NULL,
  publication_count INT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  country_code TEXT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (country, year)
);

CREATE TABLE IF NOT EXISTS institution_registry (
  institution TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  publisher TEXT NOT NULL,
  publication_count INT NOT NULL,
  linked_journals TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS journal_metrics (
  journal TEXT PRIMARY KEY,
  publisher TEXT NOT NULL,
  retraction_rate NUMERIC(10,2) NOT NULL,
  severity_index NUMERIC(10,2) NOT NULL,
  median_delay_days INT NOT NULL,
  delay_volatility NUMERIC(10,2) NOT NULL,
  retraction_growth_velocity NUMERIC(10,2) NOT NULL,
  misconduct_diversity_score NUMERIC(10,2) NOT NULL,
  volatility_index NUMERIC(10,2) NOT NULL,
  acceleration_score NUMERIC(10,2) NOT NULL,
  integrity_score NUMERIC(10,2) NOT NULL,
  risk_score NUMERIC(10,2),
  score_model TEXT NOT NULL DEFAULT 'signal',
  tier TEXT NOT NULL,
  trend_direction TEXT NOT NULL,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS country_metrics (
  country TEXT PRIMARY KEY,
  retractions_per_10k NUMERIC(10,2) NOT NULL,
  acceleration_3y NUMERIC(10,2) NOT NULL,
  severity_cluster_score NUMERIC(10,2) NOT NULL,
  integrity_score NUMERIC(10,2) NOT NULL,
  risk_score NUMERIC(10,2),
  denominator_publications INT,
  denominator_year INT,
  denominator_source TEXT,
  denominator_quality TEXT NOT NULL DEFAULT 'none',
  trend_direction TEXT NOT NULL,
  anomaly_flag_count INT NOT NULL,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trend_metrics (
  entity_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  year INT NOT NULL,
  retraction_count INT NOT NULL,
  moving_avg_3y NUMERIC(10,2) NOT NULL,
  z_score NUMERIC(10,2) NOT NULL,
  is_anomaly BOOLEAN NOT NULL,
  PRIMARY KEY (entity_type, entity_name, year)
);

CREATE TABLE IF NOT EXISTS forecast_metrics (
  entity_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  latest_year INT NOT NULL,
  latest_count INT NOT NULL,
  projected_next_year INT NOT NULL,
  trend_slope NUMERIC(10,4) NOT NULL,
  confidence NUMERIC(10,2) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_name)
);

CREATE INDEX IF NOT EXISTS idx_retractions_journal ON retractions_raw(journal);
CREATE INDEX IF NOT EXISTS idx_retractions_country ON retractions_raw(country);
CREATE INDEX IF NOT EXISTS idx_retractions_year ON retractions_raw((EXTRACT(YEAR FROM retraction_date)));
CREATE INDEX IF NOT EXISTS idx_country_publications_source ON country_publications(source);
CREATE INDEX IF NOT EXISTS idx_trend_anomaly ON trend_metrics(is_anomaly);
CREATE INDEX IF NOT EXISTS idx_forecast_projected ON forecast_metrics(projected_next_year DESC);
