import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { withTransaction } from './db.js';

const orgKeywords =
  /university|institute|college|academy|hospital|polytechnic|centre|center|school|laborator|research/i;
const noisePrefix =
  /^(department|faculty|school|college|division|unit|center|centre|institute|hospital)\s+of\b/i;
const countryToken =
  /\b(afghanistan|albania|algeria|argentina|armenia|australia|austria|azerbaijan|bahrain|bangladesh|belarus|belgium|bolivia|brazil|bulgaria|canada|chile|china|colombia|croatia|cyprus|czech republic|denmark|egypt|estonia|finland|france|georgia|germany|ghana|greece|hungary|iceland|india|indonesia|iran|iraq|ireland|israel|italy|japan|jordan|kazakhstan|kenya|kuwait|latvia|lebanon|lithuania|luxembourg|malaysia|mexico|morocco|netherlands|new zealand|nigeria|norway|oman|pakistan|peru|philippines|poland|portugal|qatar|romania|russia|saudi arabia|serbia|singapore|slovakia|slovenia|south africa|south korea|spain|sweden|switzerland|taiwan|thailand|turkey|ukraine|united arab emirates|united kingdom|united states|usa|us|vietnam)\b/i;

const columnAliases = {
  doi: ['doi', 'originalpaperdoi', 'original_paper_doi'],
  journal: ['journal', 'journal_name'],
  publisher: ['publisher', 'publisher_name'],
  country: ['country', 'author_country'],
  institution: ['institution', 'university', 'affiliation', 'institute'],
  publication_date: [
    'publication_date',
    'published_date',
    'pub_date',
    'date_published',
    'originalpaperdate',
    'original_paper_date',
  ],
  retraction_date: ['retraction_date', 'date_retracted', 'retracted_date', 'retractiondate'],
  reason_text: ['reason_text', 'reason', 'retraction_reason'],
  severity_label: ['severity_label', 'severity', 'severity_index_label'],
};

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(' ')
    .map((token) => (token ? token[0].toUpperCase() + token.slice(1) : token))
    .join(' ')
    .replace(/\bUsa\b/g, 'USA')
    .replace(/\bUk\b/g, 'UK');
}

function pickField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function toIsoDate(value) {
  if (!value) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  const compact = normalized.split(' ')[0];
  const slashMatch = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeCountry(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'Unknown';
  }

  const first = raw.split(';')[0].split(',')[0].trim();
  if (!first) {
    return 'Unknown';
  }

  const lowered = first.toLowerCase();
  if (lowered === 'usa' || lowered === 'us') {
    return 'United States';
  }
  if (lowered === 'uk') {
    return 'United Kingdom';
  }

  return toTitleCase(first);
}

function normalizePublisher(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'Unknown Publisher';
  }

  return raw
    .replace(/\s*\(.*?\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInstitution(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'Unknown Institution';
  }

  const affiliations = raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  const bestAffiliation =
    affiliations.find((part) => orgKeywords.test(part)) || affiliations[0] || raw;

  const chunks = bestAffiliation
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const preferredChunk =
    chunks.find((part) => orgKeywords.test(part) && !noisePrefix.test(part)) ||
    chunks.find((part) => orgKeywords.test(part)) ||
    chunks.find((part) => !noisePrefix.test(part)) ||
    chunks[0] ||
    bestAffiliation;

  let normalized = preferredChunk
    .replace(/\((.*?)\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();

  if (!orgKeywords.test(normalized)) {
    const longer = chunks.find((part) => orgKeywords.test(part));
    if (longer) {
      normalized = longer.replace(/\((.*?)\)/g, '').replace(/\s+/g, ' ').trim();
    }
  }

  normalized = normalized.replace(/\b(P\.R\.|PR)\s*China\b/gi, 'China').trim();
  normalized = normalized.replace(/\bU\.S\.A\b/gi, 'USA').trim();

  if (countryToken.test(normalized) && chunks.length > 1) {
    const withoutCountry = normalized
      .split(' ')
      .filter((token) => !countryToken.test(token))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (withoutCountry.length > 8) {
      normalized = withoutCountry;
    }
  }

  return normalized
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

function buildNormalizedRows(records) {
  const normalized = [];
  const byDoi = new Map();
  let skipped = 0;

  for (const rawRow of records) {
    const row = {};
    for (const [rawKey, rawValue] of Object.entries(rawRow)) {
      row[normalizeKey(rawKey)] = rawValue;
    }

    const publicationDate = toIsoDate(pickField(row, columnAliases.publication_date));
    const retractionDate = toIsoDate(pickField(row, columnAliases.retraction_date));

    const mapped = {
      doi: pickField(row, columnAliases.doi) || null,
      journal: pickField(row, columnAliases.journal),
      publisher: normalizePublisher(pickField(row, columnAliases.publisher)),
      country: normalizeCountry(pickField(row, columnAliases.country)),
      institution: pickField(row, columnAliases.institution) || 'Unknown Institution',
      institution_canonical: normalizeInstitution(pickField(row, columnAliases.institution)),
      publication_date: publicationDate,
      retraction_date: retractionDate,
      reason_text: pickField(row, columnAliases.reason_text) || 'Unspecified integrity reason',
      severity_label: pickField(row, columnAliases.severity_label) || null,
      extra_fields: {},
    };

    const knownKeys = new Set(Object.values(columnAliases).flat());
    for (const [key, value] of Object.entries(row)) {
      if (!knownKeys.has(key) && value !== null && value !== undefined && String(value).trim()) {
        mapped.extra_fields[key] = value;
      }
    }

    if (!mapped.journal || !mapped.publication_date || !mapped.retraction_date) {
      skipped += 1;
      continue;
    }

    if (mapped.doi) {
      byDoi.set(mapped.doi, mapped);
    } else {
      normalized.push(mapped);
    }
  }

  normalized.push(...byDoi.values());

  return { normalized, skipped };
}

function buildBatchInsertQuery(batchSize) {
  const columnsPerRow = 12;
  const placeholders = [];
  for (let rowIndex = 0; rowIndex < batchSize; rowIndex += 1) {
    const offset = rowIndex * columnsPerRow;
    placeholders.push(
      `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12})`,
    );
  }

  return `
    INSERT INTO retractions_raw (
      doi, journal, publisher, country, institution,
      institution_canonical,
      publication_date, retraction_date, severity_label, reason_text,
      extra_fields, source_file
    ) VALUES ${placeholders.join(',')}
    ON CONFLICT (doi) DO UPDATE SET
      journal = EXCLUDED.journal,
      publisher = EXCLUDED.publisher,
      country = EXCLUDED.country,
      institution = EXCLUDED.institution,
      institution_canonical = EXCLUDED.institution_canonical,
      publication_date = EXCLUDED.publication_date,
      retraction_date = EXCLUDED.retraction_date,
      severity_label = EXCLUDED.severity_label,
      reason_text = EXCLUDED.reason_text,
      extra_fields = EXCLUDED.extra_fields,
      source_file = EXCLUDED.source_file
  `;
}

export async function importRetractionsFromCsv({ csvFilePath, truncate = true, sourceFileName }) {
  const absolutePath = path.resolve(csvFilePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`CSV file not found at: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const { normalized, skipped } = buildNormalizedRows(rows);
  const resolvedSourceFile = sourceFileName || path.basename(absolutePath);

  await withTransaction(async (client) => {
    await client.query(
      "ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb",
    );
    await client.query(
      "ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS source_file TEXT",
    );
    await client.query(
      "ALTER TABLE retractions_raw ADD COLUMN IF NOT EXISTS institution_canonical TEXT",
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_retractions_institution_canonical ON retractions_raw(institution_canonical)',
    );

    if (truncate) {
      await client.query('TRUNCATE TABLE retractions_raw RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE institution_registry RESTART IDENTITY CASCADE');
    }

    const batchSize = 1000;
    for (let start = 0; start < normalized.length; start += batchSize) {
      const batch = normalized.slice(start, start + batchSize);
      const values = [];

      for (const row of batch) {
        values.push(
          row.doi,
          row.journal,
          row.publisher,
          row.country,
          row.institution,
          row.institution_canonical,
          row.publication_date,
          row.retraction_date,
          row.severity_label,
          row.reason_text,
          JSON.stringify(row.extra_fields || {}),
          resolvedSourceFile,
        );
      }

      await client.query(buildBatchInsertQuery(batch.length), values);
    }

    await client.query(`
      INSERT INTO institution_registry (institution, country, publisher, publication_count, linked_journals)
      SELECT
        COALESCE(NULLIF(institution_canonical, ''), institution) AS institution,
        MODE() WITHIN GROUP (ORDER BY country) AS country,
        MODE() WITHIN GROUP (ORDER BY publisher) AS publisher,
        GREATEST(COUNT(*) * 100, 100)::int AS publication_count,
        ARRAY_AGG(DISTINCT journal)
      FROM retractions_raw
      GROUP BY COALESCE(NULLIF(institution_canonical, ''), institution)
      ON CONFLICT (institution) DO UPDATE SET
        country = EXCLUDED.country,
        publisher = EXCLUDED.publisher,
        publication_count = EXCLUDED.publication_count,
        linked_journals = EXCLUDED.linked_journals
    `);

    await client.query(`
      INSERT INTO country_publications (country, year, publication_count)
      SELECT
        country,
        EXTRACT(YEAR FROM publication_date)::int AS year,
        GREATEST(COUNT(*) * 2000, 1000)::int AS publication_count
      FROM retractions_raw
      GROUP BY country, EXTRACT(YEAR FROM publication_date)
      ON CONFLICT (country, year) DO UPDATE SET
        publication_count = GREATEST(country_publications.publication_count, EXCLUDED.publication_count)
    `);
  });

  return {
    filePath: absolutePath,
    sourceFileName: resolvedSourceFile,
    recordsRead: rows.length,
    recordsImported: normalized.length,
    recordsSkipped: skipped,
  };
}
