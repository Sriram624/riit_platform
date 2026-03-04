import { pool } from './db.js';
import { appConfig as config } from './config.js';

const OPENALEX_BASE = 'https://api.openalex.org';

const COUNTRY_ALIASES = new Map([
  ['united states', 'US'],
  ['usa', 'US'],
  ['united kingdom', 'GB'],
  ['uk', 'GB'],
  ['russia', 'RU'],
  ['south korea', 'KR'],
  ['north korea', 'KP'],
  ['iran', 'IR'],
  ['vietnam', 'VN'],
  ['taiwan', 'TW'],
  ['czech republic', 'CZ'],
  ['uae', 'AE'],
]);

const COUNTRY_CODE_INDEX = (() => {
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const index = new Map();

  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = `${String.fromCharCode(first)}${String.fromCharCode(second)}`;
      const displayName = displayNames.of(code);
      if (!displayName || displayName === code) {
        continue;
      }
      index.set(normalizeCountryName(displayName), code);
    }
  }

  return index;
})();

function normalizeCountryName(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildOpenAlexUrl(path, params = {}) {
  const url = new URL(`${OPENALEX_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  if (config.openAlexEmail) {
    url.searchParams.set('mailto', config.openAlexEmail);
  }
  return url;
}

async function openAlexFetchJson(path, params = {}) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.openAlexTimeoutMs);

  try {
    const response = await fetch(buildOpenAlexUrl(path, params), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAlex request failed (${response.status}) for ${path}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function getCountryDemand() {
  const { rows } = await pool.query(`
    SELECT
      country,
      MIN(EXTRACT(YEAR FROM retraction_date))::int AS min_year,
      MAX(EXTRACT(YEAR FROM retraction_date))::int AS max_year
    FROM retractions_raw
    WHERE country IS NOT NULL AND TRIM(country) <> ''
    GROUP BY country
  `);

  return rows;
}

async function getPublicationFreshnessByCountry() {
  const { rows } = await pool.query(`
    SELECT country, MAX(refreshed_at) AS refreshed_at
    FROM country_publications
    WHERE source = 'openalex'
    GROUP BY country
  `);

  return new Map(
    rows.map((row) => [
      (row.country || '').toLowerCase(),
      row.refreshed_at ? new Date(row.refreshed_at) : null,
    ]),
  );
}

async function resolveCountryCode(countryName, cache) {
  const normalized = normalizeCountryName(countryName);
  if (!normalized) return null;
  if (normalized === 'unknown') return null;

  if (cache.has(normalized)) {
    return cache.get(normalized);
  }

  const aliased = COUNTRY_ALIASES.get(normalized);
  if (aliased) {
    cache.set(normalized, aliased);
    return aliased;
  }

  const direct = COUNTRY_CODE_INDEX.get(normalized);
  if (direct) {
    cache.set(normalized, direct);
    return direct;
  }

  let picked = null;
  for (const [name, code] of COUNTRY_CODE_INDEX.entries()) {
    if (name.includes(normalized) || normalized.includes(name)) {
      picked = code;
      break;
    }
  }

  cache.set(normalized, picked);
  return picked;
}

async function fetchCountryCountsByYear(countryCode) {
  if (!countryCode) return [];

  const payload = await openAlexFetchJson('/works', {
    filter: `institutions.country_code:${countryCode}`,
    group_by: 'publication_year',
    'per-page': 200,
  });

  const grouped = payload?.group_by || [];
  return grouped
    .map((row) => ({ year: Number(row.key), works_count: Number(row.count) }))
    .filter((row) => Number.isFinite(row.year) && row.year > 0);
}

function isStaleDate(dateValue, refreshDays) {
  if (!dateValue) {
    return true;
  }
  const ageMs = Date.now() - dateValue.getTime();
  return ageMs > refreshDays * 24 * 60 * 60 * 1000;
}

async function upsertCountryPublications(rows) {
  if (!rows.length) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(
        `
        INSERT INTO country_publications (
          country, year, publication_count, source, country_code, refreshed_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (country, year) DO UPDATE SET
          publication_count = EXCLUDED.publication_count,
          source = EXCLUDED.source,
          country_code = EXCLUDED.country_code,
          refreshed_at = NOW()
      `,
        [
          row.country,
          row.year,
          row.publication_count,
          'openalex',
          row.countryCode,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function syncCountryPublicationsFromOpenAlex({ force = false } = {}) {
  if (!config.openAlexEnabled) {
    return {
      enabled: false,
      fetchedCountries: 0,
      upsertedRows: 0,
      skippedCountries: 0,
      failedCountries: 0,
      failures: [],
    };
  }

  const demand = await getCountryDemand();
  const freshness = await getPublicationFreshnessByCountry();
  const codeCache = new Map();
  const toUpsert = [];
  const failures = [];

  let fetchedCountries = 0;
  let skippedCountries = 0;

  for (const row of demand) {
    const country = row.country;
    const minYear = Number(row.min_year);
    const maxYear = Number(row.max_year);

    const lastRefresh = freshness.get((country || '').toLowerCase()) || null;
    if (!force && !isStaleDate(lastRefresh, config.openAlexRefreshDays)) {
      skippedCountries += 1;
      continue;
    }

    try {
      const code = await resolveCountryCode(country, codeCache);
      const counts = await fetchCountryCountsByYear(code);

      const filtered = counts
        .filter((item) => Number(item.year) >= minYear && Number(item.year) <= maxYear)
        .map((item) => ({
          country,
          countryCode: code,
          year: Number(item.year),
          publication_count: Math.max(Number(item.works_count) || 0, 1),
        }));

      if (filtered.length) {
        toUpsert.push(...filtered);
      }

      fetchedCountries += 1;
    } catch (error) {
      failures.push({ country, error: error.message });
    }
  }

  await upsertCountryPublications(toUpsert);

  return {
    enabled: true,
    fetchedCountries,
    upsertedRows: toUpsert.length,
    skippedCountries,
    failedCountries: failures.length,
    failures,
  };
}

export async function getPublicationCoverageSummary() {
  const { rows } = await pool.query(`
    WITH raw_countries AS (
      SELECT DISTINCT LOWER(TRIM(country)) AS country_key
      FROM retractions_raw
      WHERE country IS NOT NULL AND TRIM(country) <> ''
    )
    SELECT
      COUNT(*)::int AS denominator_rows,
      COUNT(*) FILTER (WHERE source = 'openalex')::int AS openalex_rows,
      COUNT(DISTINCT LOWER(TRIM(country))) FILTER (
        WHERE LOWER(TRIM(country)) IN (SELECT country_key FROM raw_countries)
      )::int AS countries_with_denominator,
      MAX(refreshed_at) AS latest_openalex_refresh
    FROM country_publications
  `);

  return rows[0] || {
    denominator_rows: 0,
    openalex_rows: 0,
    countries_with_denominator: 0,
    latest_openalex_refresh: null,
  };
}
