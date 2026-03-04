import { pool, withTransaction } from './db.js';

const STOP_WORDS = ['of', 'and', 'the', 'for', 'in', 'at', 'on', 'to', 'de', 'la', 'da'];
const QUERY_STOP_WORDS = new Set([
  ...STOP_WORDS,
  'risk',
  'score',
  'scores',
  'average',
  'avg',
  'publication',
  'publications',
  'insight',
  'copilot',
  'entity',
  'show',
  'shows',
  'what',
  'which',
]);
const acronymSql = `
  array_to_string(
    ARRAY(
      SELECT LEFT(word, 1)
      FROM regexp_split_to_table(LOWER(institution), E'[^a-z0-9]+') AS word
      WHERE word <> ''
        AND word NOT IN (${STOP_WORDS.map((word) => `'${word}'`).join(', ')})
    ),
    ''
  )
`;
const institutionBaseCte = `
  WITH raw_institutions AS (
    SELECT
      COALESCE(NULLIF(institution_canonical, ''), institution) AS institution,
      MODE() WITHIN GROUP (ORDER BY country) AS country,
      MODE() WITHIN GROUP (ORDER BY publisher) AS publisher,
      GREATEST(COUNT(*) * 100, 100)::int AS estimated_publication_count,
      COUNT(DISTINCT institution)::int AS alias_count
    FROM retractions_raw
    GROUP BY COALESCE(NULLIF(institution_canonical, ''), institution)
  ),
  registry_normalized AS (
    SELECT
      institution,
      country,
      publisher,
      publication_count,
      1::int AS alias_count
    FROM institution_registry
  ),
  institution_union AS (
    SELECT institution, country, publisher,
           estimated_publication_count AS publication_count,
           alias_count
    FROM raw_institutions
    UNION ALL
    SELECT institution, country, publisher,
           publication_count,
           alias_count
    FROM registry_normalized
  ),
  institution_base AS (
    SELECT
      MIN(institution) AS institution,
      MODE() WITHIN GROUP (ORDER BY country) AS country,
      MODE() WITHIN GROUP (ORDER BY publisher) AS publisher,
      MAX(publication_count)::int AS publication_count,
      MAX(alias_count)::int AS alias_count
    FROM institution_union
    GROUP BY LOWER(TRIM(institution))
  )
`;

function buildInstitutionSearchParams(query) {
  const institutionSearch = query?.trim() || '';
  const institutionAcronymSearch = institutionSearch
    ? institutionSearch.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';

  return {
    institutionSearch,
    institutionAcronymSearch,
  };
}

function tokenizeQuery(value) {
  return (value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token) => !QUERY_STOP_WORDS.has(token));
}

function scoreCandidate(text, tokens) {
  if (!tokens.length) {
    return 0;
  }
  const lowered = (text || '').toLowerCase();
  return tokens.reduce((score, token) => (lowered.includes(token) ? score + 1 : score), 0);
}

function snippet(text, maxLength = 240) {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}…`;
}

export async function getOverview() {
  const [journalCount, countryCount, anomalyCount, topIntegrity] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS value FROM journal_metrics'),
    pool.query('SELECT COUNT(*)::int AS value FROM country_metrics'),
    pool.query(
      "SELECT COUNT(*)::int AS value FROM trend_metrics WHERE is_anomaly = TRUE AND year = EXTRACT(YEAR FROM NOW())::int",
    ),
    pool.query(
      'SELECT journal, integrity_score, tier FROM journal_metrics ORDER BY integrity_score DESC LIMIT 1',
    ),
  ]);

  return {
    journalCoverage: journalCount.rows[0].value,
    countryCoverage: countryCount.rows[0].value,
    activeAnomalies: anomalyCount.rows[0].value,
    highestIntegrityJournal: topIntegrity.rows[0] || null,
  };
}

export async function listJournals({ search = '', limit = 50 }) {
  const params = [`%${search}%`, limit];
  const query = `
    SELECT journal, publisher, retraction_rate, severity_index, median_delay_days,
           retraction_growth_velocity, misconduct_diversity_score, volatility_index,
           acceleration_score, integrity_score, risk_score, score_model, tier, trend_direction
    FROM journal_metrics
    WHERE journal ILIKE $1
    ORDER BY integrity_score DESC
    LIMIT $2
  `;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function listCountries() {
  const { rows } = await pool.query(`
    SELECT country, retractions_per_10k, acceleration_3y, severity_cluster_score,
           integrity_score, risk_score, trend_direction, anomaly_flag_count,
           denominator_publications, denominator_year, denominator_source, denominator_quality
    FROM country_metrics
    ORDER BY COALESCE(risk_score, integrity_score) DESC
  `);
  return rows;
}

export async function getAnomalies() {
  const { rows } = await pool.query(`
    SELECT entity_type, entity_name, year, retraction_count, moving_avg_3y, z_score
    FROM trend_metrics
    WHERE is_anomaly = TRUE
    ORDER BY z_score DESC
    LIMIT 100
  `);
  return rows;
}

export async function getForecasts({ entityType, limit = 30 }) {
  const params = [];
  const whereConditions = [];

  if (entityType?.trim()) {
    params.push(entityType.trim().toLowerCase());
    whereConditions.push(`entity_type = $${params.length}`);
  }

  params.push(limit);
  const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `
    SELECT entity_type, entity_name, latest_year, latest_count,
           projected_next_year, trend_slope, confidence, generated_at
    FROM forecast_metrics
    ${whereClause}
    ORDER BY projected_next_year DESC, confidence DESC
    LIMIT $${params.length}
  `,
    params,
  );

  return rows;
}

export async function getEntityContext({ entityType, entityName }) {
  const normalizedType = entityType?.trim()?.toLowerCase();
  const normalizedName = entityName?.trim();

  if (!normalizedType || !normalizedName) {
    return null;
  }

  if (normalizedType === 'journal') {
    const [metrics, trend, forecast] = await Promise.all([
      pool.query(
        `
        SELECT journal AS entity_name, publisher, integrity_score, risk_score, tier,
               retraction_growth_velocity, trend_direction
        FROM journal_metrics
        WHERE journal ILIKE $1
        ORDER BY integrity_score DESC
        LIMIT 1
      `,
        [normalizedName],
      ),
      pool.query(
        `
        SELECT year, retraction_count, z_score, is_anomaly
        FROM trend_metrics
        WHERE entity_type = 'journal' AND entity_name ILIKE $1
        ORDER BY year DESC
        LIMIT 3
      `,
        [normalizedName],
      ),
      pool.query(
        `
        SELECT latest_year, latest_count, projected_next_year, trend_slope, confidence
        FROM forecast_metrics
        WHERE entity_type = 'journal' AND entity_name ILIKE $1
        LIMIT 1
      `,
        [normalizedName],
      ),
    ]);

    return {
      entityType: 'journal',
      metrics: metrics.rows[0] || null,
      trend: trend.rows,
      forecast: forecast.rows[0] || null,
    };
  }

  if (normalizedType === 'country') {
    const [metrics, trend, forecast] = await Promise.all([
      pool.query(
        `
        SELECT country AS entity_name, integrity_score, risk_score, retractions_per_10k,
               acceleration_3y, trend_direction, anomaly_flag_count,
               denominator_publications, denominator_year, denominator_source, denominator_quality
        FROM country_metrics
        WHERE country ILIKE $1
        ORDER BY COALESCE(risk_score, integrity_score) DESC
        LIMIT 1
      `,
        [normalizedName],
      ),
      pool.query(
        `
        SELECT year, retraction_count, z_score, is_anomaly
        FROM trend_metrics
        WHERE entity_type = 'country' AND entity_name ILIKE $1
        ORDER BY year DESC
        LIMIT 3
      `,
        [normalizedName],
      ),
      pool.query(
        `
        SELECT latest_year, latest_count, projected_next_year, trend_slope, confidence
        FROM forecast_metrics
        WHERE entity_type = 'country' AND entity_name ILIKE $1
        LIMIT 1
      `,
        [normalizedName],
      ),
    ]);

    return {
      entityType: 'country',
      metrics: metrics.rows[0] || null,
      trend: trend.rows,
      forecast: forecast.rows[0] || null,
    };
  }

  return null;
}

export async function getQuestionContextForInsights({ question, entityType, entityName, evidence = [] }) {
  const normalizedType = entityType?.trim()?.toLowerCase();
  const normalizedName = entityName?.trim();

  if (normalizedType !== 'journal' || normalizedName) {
    return null;
  }

  const publisherVotes = new Map();
  for (const row of evidence) {
    const publisher = row?.metadata?.publisher?.trim();
    if (!publisher) continue;
    publisherVotes.set(publisher, (publisherVotes.get(publisher) || 0) + 1);
  }

  let inferredPublisher = null;
  if (publisherVotes.size) {
    inferredPublisher = [...publisherVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  if (!inferredPublisher) {
    const tokens = tokenizeQuery(question).slice(0, 5);
    if (!tokens.length) {
      return null;
    }

    const tokenConditions = [];
    const params = [];
    for (const token of tokens) {
      params.push(`%${token}%`);
      tokenConditions.push(`publisher ILIKE $${params.length}`);
    }

    const inferred = await pool.query(
      `
      SELECT publisher, COUNT(*)::int AS hits
      FROM journal_metrics
      WHERE ${tokenConditions.join(' OR ')}
      GROUP BY publisher
      ORDER BY hits DESC, publisher ASC
      LIMIT 1
      `,
      params,
    );

    inferredPublisher = inferred.rows[0]?.publisher || null;
  }

  if (!inferredPublisher) {
    return null;
  }

  const [publisherRisk, topJournal] = await Promise.all([
    pool.query(
      `
      SELECT MIN(publisher) AS publisher,
              AVG(integrity_score)::numeric(10,2) AS avg_integrity,
             MODE() WITHIN GROUP (ORDER BY tier) AS dominant_tier,
             COUNT(*)::int AS journal_count
      FROM journal_metrics
      WHERE publisher ILIKE $1
      GROUP BY LOWER(TRIM(publisher))
            ORDER BY avg_integrity DESC
      LIMIT 1
    `,
      [inferredPublisher],
    ),
    pool.query(
      `
      SELECT journal, integrity_score, tier
      FROM journal_metrics
      WHERE publisher ILIKE $1
      ORDER BY integrity_score DESC
      LIMIT 1
    `,
      [inferredPublisher],
    ),
  ]);

  const publisherRow = publisherRisk.rows[0] || null;
  if (!publisherRow) {
    return null;
  }

  const leader = topJournal.rows[0] || null;

  return {
    entityType: 'publisher',
    inferredFrom: publisherVotes.size ? 'evidence' : 'question',
    metrics: {
      entity_name: publisherRow.publisher,
      avg_integrity: publisherRow.avg_integrity,
      dominant_tier: publisherRow.dominant_tier,
      journal_count: publisherRow.journal_count,
      top_journal: leader?.journal || null,
      top_journal_integrity: leader?.integrity_score || null,
      top_journal_tier: leader?.tier || null,
    },
    trend: [],
    forecast: null,
  };
}

export async function retrieveEvidence({ query = '', entityType, entityName, limit = 5 }) {
  const normalizedType = entityType?.trim()?.toLowerCase();
  const normalizedName = entityName?.trim();
  const tokens = tokenizeQuery(query);

  const params = [];
  const conditions = [];

  if (normalizedType === 'journal' && normalizedName) {
    params.push(normalizedName);
    conditions.push(`journal ILIKE $${params.length}`);
  }

  if (normalizedType === 'country' && normalizedName) {
    params.push(normalizedName);
    conditions.push(`country ILIKE $${params.length}`);
  }

  if (tokens.length) {
    const tokenMatchers = tokens.map((token) => {
      params.push(`%${token}%`);
      const placeholder = `$${params.length}`;
      return `(
        journal ILIKE ${placeholder}
        OR publisher ILIKE ${placeholder}
        OR country ILIKE ${placeholder}
        OR institution ILIKE ${placeholder}
        OR reason_text ILIKE ${placeholder}
      )`;
    });

    conditions.push(`(${tokenMatchers.join(' OR ')})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const candidateLimit = tokens.length ? Math.max(limit * 80, 600) : Math.max(limit * 12, 60);
  params.push(candidateLimit);

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(doi, CONCAT(journal, '-', retraction_date::text)) AS source_id,
      journal,
      country,
      publisher,
      institution,
      retraction_date,
      reason_text
    FROM retractions_raw
    ${whereClause}
    ORDER BY retraction_date DESC
    LIMIT $${params.length}
  `,
    params,
  );

  const scored = rows
    .map((row) => {
      const textBlob = `${row.reason_text || ''} ${row.journal || ''} ${row.publisher || ''} ${row.country || ''} ${row.institution || ''}`;
      const lexicalScore = scoreCandidate(textBlob, tokens);
      return {
        sourceType: 'retraction_record',
        sourceId: row.source_id,
        sourceDate: row.retraction_date,
        title: row.journal,
        summary: snippet(row.reason_text),
        metadata: {
          country: row.country,
          publisher: row.publisher,
          institution: row.institution,
          doi: row.source_id?.startsWith('10.') ? row.source_id : null,
        },
        score: lexicalScore,
      };
    })
    .filter((row) => (tokens.length ? row.score > 0 : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

export async function getDataSourceStatus() {
  await pool.query(
    "ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS source_file TEXT",
  );
  await pool.query(
    "ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb",
  );

  const [rawCount, distinctInstitutions, distinctJournals, lastSource] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS value FROM retractions_raw'),
    pool.query(
      "SELECT COUNT(DISTINCT COALESCE(NULLIF(institution_canonical, ''), institution))::int AS value FROM retractions_raw",
    ),
    pool.query('SELECT COUNT(DISTINCT journal)::int AS value FROM retractions_raw'),
    pool.query(`
      SELECT source_file, MAX(created_at) AS last_ingested_at
      FROM retractions_raw
      GROUP BY source_file
      ORDER BY last_ingested_at DESC
      LIMIT 1
    `),
  ]);

  return {
    rawRecordCount: rawCount.rows[0]?.value || 0,
    rawInstitutionCount: distinctInstitutions.rows[0]?.value || 0,
    rawJournalCount: distinctJournals.rows[0]?.value || 0,
    latestSourceFile: lastSource.rows[0]?.source_file || null,
    lastIngestedAt: lastSource.rows[0]?.last_ingested_at || null,
  };
}

export async function listRawRecords({
  limit = 100,
  offset = 0,
  institution,
  country,
  publisher,
  journal,
}) {
  const conditions = [];
  const params = [];

  if (institution?.trim()) {
    params.push(`%${institution.trim()}%`);
    conditions.push(`(institution ILIKE $${params.length} OR institution_canonical ILIKE $${params.length})`);
  }
  if (country?.trim()) {
    params.push(`%${country.trim()}%`);
    conditions.push(`country ILIKE $${params.length}`);
  }
  if (publisher?.trim()) {
    params.push(`%${publisher.trim()}%`);
    conditions.push(`publisher ILIKE $${params.length}`);
  }
  if (journal?.trim()) {
    params.push(`%${journal.trim()}%`);
    conditions.push(`journal ILIKE $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  params.push(offset);

  const { rows } = await pool.query(
    `
    SELECT doi, journal, publisher, country, institution, institution_canonical,
           publication_date, retraction_date, severity_label,
           reason_text, source_file, extra_fields
    FROM retractions_raw
    ${whereClause}
    ORDER BY retraction_date DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  return rows;
}

export async function searchInstitutions({ query = '', limit = 8 }) {
  const { institutionSearch, institutionAcronymSearch } = buildInstitutionSearchParams(query);

  if (!institutionSearch) {
    const { rows } = await pool.query(
      `
      ${institutionBaseCte}
      SELECT institution, country, publisher, publication_count
              , alias_count
      FROM institution_base
      ORDER BY publication_count DESC, institution ASC
      LIMIT $1
      `,
      [limit],
    );
    return rows;
  }

  const { rows } = await pool.query(
    `
    ${institutionBaseCte}
    SELECT institution, country, publisher, publication_count, alias_count,
           CASE
             WHEN LOWER(institution) = LOWER($1) THEN 1
             WHEN ${acronymSql} = LOWER($2) THEN 2
             WHEN institution ILIKE $3 THEN 3
             ELSE 4
           END AS match_priority
     FROM institution_base
    WHERE institution ILIKE $3
       OR ${acronymSql} ILIKE $4
    ORDER BY match_priority ASC, publication_count DESC, institution ASC
    LIMIT $5
    `,
    [institutionSearch, institutionAcronymSearch, `%${institutionSearch}%`, `%${institutionAcronymSearch}%`, limit],
  );

  return rows.map(({ match_priority: _ignored, ...row }) => row);
}

export async function listInstitutionRankings({ limit = 25, country, publisher }) {
  const countrySearch = country?.trim();
  const publisherSearch = publisher?.trim();
  const whereConditions = [];
  const params = [];

  if (countrySearch) {
    params.push(`%${countrySearch}%`);
    whereConditions.push(`ib.country ILIKE $${params.length}`);
  }

  if (publisherSearch) {
    params.push(`%${publisherSearch}%`);
    whereConditions.push(`ib.publisher ILIKE $${params.length}`);
  }

  const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';
  params.push(limit);

  const { rows } = await pool.query(
    `
    ${institutionBaseCte},
    publisher_risk AS (
      SELECT LOWER(TRIM(publisher)) AS publisher_key,
             AVG(integrity_score)::numeric(10,2) AS avg_integrity
      FROM journal_metrics
      GROUP BY LOWER(TRIM(publisher))
    ),
    scored AS (
      SELECT
        ib.institution,
        ib.country,
        ib.publisher,
        ib.publication_count,
        ib.alias_count,
        COALESCE(cm.risk_score::numeric, cm.integrity_score::numeric, 0) AS country_integrity_score,
        COALESCE(cm.denominator_quality, 'none') AS country_denominator_quality,
        COALESCE(pr.avg_integrity::numeric, 0) AS publisher_integrity_score,
        (
          COALESCE(cm.risk_score::numeric, cm.integrity_score::numeric, 0) * 0.55
          + COALESCE(pr.avg_integrity::numeric, 0) * 0.35
          + LEAST(ib.publication_count, 10000)::numeric / 10000 * 100 * 0.10
        )::numeric(10,2) AS exposure_score
      FROM institution_base ib
      LEFT JOIN country_metrics cm ON LOWER(cm.country) = LOWER(ib.country)
      LEFT JOIN publisher_risk pr ON pr.publisher_key = LOWER(TRIM(ib.publisher))
      ${whereClause}
    )
    SELECT
      institution,
      country,
      publisher,
      publication_count,
      alias_count,
      country_integrity_score,
      country_denominator_quality,
      publisher_integrity_score,
      exposure_score,
      CASE
        WHEN exposure_score >= 75 THEN 'Critical'
        WHEN exposure_score >= 60 THEN 'High'
        WHEN exposure_score >= 45 THEN 'Elevated'
        WHEN exposure_score >= 30 THEN 'Guarded'
        ELSE 'Low'
      END AS exposure_tier,
      RANK() OVER (ORDER BY exposure_score DESC) AS exposure_rank,
      ROUND(((1 - PERCENT_RANK() OVER (ORDER BY exposure_score DESC)) * 100)::numeric, 2) AS percentile
    FROM scored
    ORDER BY exposure_score DESC, publication_count DESC
    LIMIT $${params.length}
    `,
    params,
  );

  return rows;
}

export async function getBenchmark({ institution, country, publisher }) {
  const { institutionSearch, institutionAcronymSearch } = buildInstitutionSearchParams(
    institution,
  );
  const countrySearch = country?.trim();
  const publisherSearch = publisher?.trim();

  const institutionMatches = institutionSearch
    ? await searchInstitutions({ query: institutionSearch, limit: 10 })
    : [];

  const matchedInstitution = institutionMatches[0] || null;
  const effectiveCountrySearch = countrySearch || matchedInstitution?.country || null;
  const effectivePublisherSearch = publisherSearch || matchedInstitution?.publisher || null;

  const countryRisk = effectiveCountrySearch
    ? await pool.query(
        'SELECT * FROM country_metrics WHERE country ILIKE $1 ORDER BY COALESCE(risk_score, integrity_score) DESC LIMIT 1',
        [`%${effectiveCountrySearch}%`],
      )
    : { rows: [] };

  const publisherRisk = effectivePublisherSearch
    ? await pool.query(
        `
      SELECT MIN(publisher) AS publisher,
              AVG(integrity_score)::numeric(10,2) AS avg_integrity,
             MODE() WITHIN GROUP (ORDER BY tier) AS dominant_tier,
             COUNT(*)::int AS journal_count
      FROM journal_metrics
      WHERE publisher ILIKE $1
      GROUP BY LOWER(TRIM(publisher))
            ORDER BY avg_integrity DESC
      LIMIT 1
    `,
        [`%${effectivePublisherSearch}%`],
      )
    : { rows: [] };

  const [rankings, peerBenchmarks] = await Promise.all([
    listInstitutionRankings({ limit: 100 }),
    matchedInstitution
      ? listInstitutionRankings({ limit: 3, country: matchedInstitution.country })
      : Promise.resolve([]),
  ]);

  const matchedRanking = matchedInstitution
    ? rankings.find(
        (row) => row.institution.toLowerCase() === matchedInstitution.institution.toLowerCase(),
      )
    : null;

  return {
    institution: matchedInstitution,
    country: countryRisk.rows[0] || null,
    publisher: publisherRisk.rows[0] || null,
    institutionMatches,
    institutionExposure:
      matchedRanking ||
      (matchedInstitution
        ? {
            institution: matchedInstitution.institution,
            country: matchedInstitution.country,
            publisher: matchedInstitution.publisher,
            publication_count: matchedInstitution.publication_count,
            country_integrity_score:
              countryRisk.rows[0]?.risk_score || countryRisk.rows[0]?.integrity_score || null,
            publisher_integrity_score: publisherRisk.rows[0]?.avg_integrity || null,
            exposure_score: null,
            exposure_tier: 'Insufficient Data',
            exposure_rank: null,
            percentile: null,
          }
        : null),
    peerBenchmarks: peerBenchmarks.filter(
      (row) => row.institution !== matchedInstitution?.institution,
    ),
    topInstitutions: rankings.slice(0, 10),
  };
}

export async function getRawInputForEngine() {
  const [rawRows, publications] = await Promise.all([
    pool.query(`
          SELECT doi, journal, publisher, country,
            COALESCE(NULLIF(institution_canonical, ''), institution) AS institution,
             publication_date, retraction_date, reason_text, severity_label
      FROM retractions_raw
    `),
    pool.query(
      `
      SELECT country, year, publication_count,
             COALESCE(source, 'manual') AS source,
             country_code, refreshed_at
      FROM country_publications
      ORDER BY year ASC
      `,
    ),
  ]);

  return {
    rawRecords: rawRows.rows,
    countryPublications: publications.rows,
  };
}

export async function persistEngineOutput(output) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM journal_metrics');
    await client.query('DELETE FROM country_metrics');
    await client.query('DELETE FROM trend_metrics');
    await client.query('DELETE FROM forecast_metrics');

    for (const row of output.journal_metrics) {
      await client.query(
        `
        INSERT INTO journal_metrics (
          journal, publisher, retraction_rate, severity_index, median_delay_days,
          delay_volatility, retraction_growth_velocity, misconduct_diversity_score,
          volatility_index, acceleration_score, integrity_score, risk_score, score_model, tier, trend_direction,
          last_computed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()
        )
        ON CONFLICT (journal) DO UPDATE SET
          publisher = EXCLUDED.publisher,
          retraction_rate = EXCLUDED.retraction_rate,
          severity_index = EXCLUDED.severity_index,
          median_delay_days = EXCLUDED.median_delay_days,
          delay_volatility = EXCLUDED.delay_volatility,
          retraction_growth_velocity = EXCLUDED.retraction_growth_velocity,
          misconduct_diversity_score = EXCLUDED.misconduct_diversity_score,
          volatility_index = EXCLUDED.volatility_index,
          acceleration_score = EXCLUDED.acceleration_score,
          integrity_score = EXCLUDED.integrity_score,
          risk_score = EXCLUDED.risk_score,
          score_model = EXCLUDED.score_model,
          tier = EXCLUDED.tier,
          trend_direction = EXCLUDED.trend_direction,
          last_computed_at = NOW()
      `,
        [
          row.journal,
          row.publisher,
          row.retraction_rate,
          row.severity_index,
          row.median_delay_days,
          row.delay_volatility,
          row.retraction_growth_velocity,
          row.misconduct_diversity_score,
          row.volatility_index,
          row.acceleration_score,
          row.integrity_score,
          row.risk_score,
          row.score_model,
          row.tier,
          row.trend_direction,
        ],
      );
    }

    for (const row of output.country_metrics) {
      await client.query(
        `
        INSERT INTO country_metrics (
          country, retractions_per_10k, acceleration_3y, severity_cluster_score,
          integrity_score, risk_score, denominator_publications, denominator_year,
          denominator_source, denominator_quality, trend_direction, anomaly_flag_count,
          last_computed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (country) DO UPDATE SET
          retractions_per_10k = EXCLUDED.retractions_per_10k,
          acceleration_3y = EXCLUDED.acceleration_3y,
          severity_cluster_score = EXCLUDED.severity_cluster_score,
          integrity_score = EXCLUDED.integrity_score,
          risk_score = EXCLUDED.risk_score,
          denominator_publications = EXCLUDED.denominator_publications,
          denominator_year = EXCLUDED.denominator_year,
          denominator_source = EXCLUDED.denominator_source,
          denominator_quality = EXCLUDED.denominator_quality,
          trend_direction = EXCLUDED.trend_direction,
          anomaly_flag_count = EXCLUDED.anomaly_flag_count,
          last_computed_at = NOW()
      `,
        [
          row.country,
          row.retractions_per_10k,
          row.acceleration_3y,
          row.severity_cluster_score,
          row.integrity_score,
          row.risk_score,
          row.denominator_publications,
          row.denominator_year,
          row.denominator_source,
          row.denominator_quality,
          row.trend_direction,
          row.anomaly_flag_count,
        ],
      );
    }

    for (const row of output.trend_metrics) {
      await client.query(
        `
        INSERT INTO trend_metrics (
          entity_type, entity_name, year, retraction_count,
          moving_avg_3y, z_score, is_anomaly
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (entity_type, entity_name, year) DO UPDATE SET
          retraction_count = EXCLUDED.retraction_count,
          moving_avg_3y = EXCLUDED.moving_avg_3y,
          z_score = EXCLUDED.z_score,
          is_anomaly = EXCLUDED.is_anomaly
      `,
        [
          row.entity_type,
          row.entity_name,
          row.year,
          row.retraction_count,
          row.moving_avg_3y,
          row.z_score,
          row.is_anomaly,
        ],
      );
    }

    for (const row of output.forecast_metrics || []) {
      await client.query(
        `
        INSERT INTO forecast_metrics (
          entity_type, entity_name, latest_year, latest_count,
          projected_next_year, trend_slope, confidence, generated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (entity_type, entity_name) DO UPDATE SET
          latest_year = EXCLUDED.latest_year,
          latest_count = EXCLUDED.latest_count,
          projected_next_year = EXCLUDED.projected_next_year,
          trend_slope = EXCLUDED.trend_slope,
          confidence = EXCLUDED.confidence,
          generated_at = NOW()
      `,
        [
          row.entity_type,
          row.entity_name,
          row.latest_year,
          row.latest_count,
          row.projected_next_year,
          row.trend_slope,
          row.confidence,
        ],
      );
    }
  });
}
