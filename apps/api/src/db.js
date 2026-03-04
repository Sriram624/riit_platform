import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

export async function ensureOperationalSchema() {
  await pool.query(`
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
    )
  `);

  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_forecast_projected ON forecast_metrics(projected_next_year DESC)',
  );

  await pool.query(
    "ALTER TABLE country_publications ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'",
  );
  await pool.query(
    'ALTER TABLE country_publications ADD COLUMN IF NOT EXISTS country_code TEXT',
  );
  await pool.query(
    'ALTER TABLE country_publications ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_country_publications_source ON country_publications(source)',
  );

  await pool.query(
    'ALTER TABLE journal_metrics ADD COLUMN IF NOT EXISTS integrity_score NUMERIC(10,2) NOT NULL DEFAULT 0',
  );
  await pool.query(
    "ALTER TABLE journal_metrics ADD COLUMN IF NOT EXISTS score_model TEXT NOT NULL DEFAULT 'signal'",
  );
  await pool.query(
    'ALTER TABLE journal_metrics ALTER COLUMN risk_score DROP NOT NULL',
  );

  await pool.query(
    'ALTER TABLE country_metrics ADD COLUMN IF NOT EXISTS integrity_score NUMERIC(10,2) NOT NULL DEFAULT 0',
  );
  await pool.query(
    'ALTER TABLE country_metrics ADD COLUMN IF NOT EXISTS denominator_publications INT',
  );
  await pool.query(
    'ALTER TABLE country_metrics ADD COLUMN IF NOT EXISTS denominator_year INT',
  );
  await pool.query(
    'ALTER TABLE country_metrics ADD COLUMN IF NOT EXISTS denominator_source TEXT',
  );
  await pool.query(
    "ALTER TABLE country_metrics ADD COLUMN IF NOT EXISTS denominator_quality TEXT NOT NULL DEFAULT 'none'",
  );
  await pool.query(
    'ALTER TABLE country_metrics ALTER COLUMN risk_score DROP NOT NULL',
  );

  await pool.query(
    "ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb",
  );
  await pool.query(
    'ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS source_file TEXT',
  );
  await pool.query(
    'ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS institution_canonical TEXT',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_retractions_institution_canonical ON retractions_raw(institution_canonical)',
  );
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
