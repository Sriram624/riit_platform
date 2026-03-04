import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { ensureOperationalSchema } from './db.js';
import {
  getAnomalies,
  getBenchmark,
  getDataSourceStatus,
  getEntityContext,
  getForecasts,
  getOverview,
  getQuestionContextForInsights,
  getRawInputForEngine,
  listInstitutionRankings,
  listCountries,
  listJournals,
  listRawRecords,
  persistEngineOutput,
  retrieveEvidence,
  searchInstitutions,
} from './repository.js';
import { runRiskEngine } from './riskEngineClient.js';
import { importRetractionsFromCsv } from './csvIngest.js';
import { generateInsight } from './aiInsights.js';


import {
  getPublicationCoverageSummary,
  syncCountryPublicationsFromOpenAlex,
} from './openAlexPublications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveCsvPath(inputPath) {
  if (!inputPath) {
    return path.resolve(__dirname, config.csvSourcePath);
  }
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(__dirname, inputPath);
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(
  cors({
    origin: config.corsOrigin,
  }),
);

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toCsv(rows) {
  if (!rows.length) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(csvEscape).join(',');
  const dataLines = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

function sendCsv(res, fileName, rows) {
  const csv = toCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(csv);
}

async function recomputeAllMetrics({ forceOpenAlexRefresh = false } = {}) {
  const openAlex = await syncCountryPublicationsFromOpenAlex({ force: forceOpenAlexRefresh });
  const input = await getRawInputForEngine();
  const output = await runRiskEngine(input);
  await persistEngineOutput(output);
  const publicationCoverage = await getPublicationCoverageSummary();

  return {
    generatedAt: output.generated_at,
    journals: output.journal_metrics.length,
    countries: output.country_metrics.length,
    forecasts: (output.forecast_metrics || []).length,
    openAlex,
    publicationCoverage,
  };
}

app.get('/health', asyncHandler(async (_req, res) => {
  res.json({ status: 'ok', service: 'riip-api' });
}));

app.get('/api/v1/overview', asyncHandler(async (_req, res) => {
  const overview = await getOverview();
  res.json(overview);
}));

app.get('/api/v1/journals', asyncHandler(async (req, res) => {
  const schema = z.object({
    search: z.string().optional().default(''),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  });
  const parsed = schema.parse(req.query);
  const rows = await listJournals(parsed);
  res.json(rows);
}));

app.get('/api/v1/countries', asyncHandler(async (_req, res) => {
  const rows = await listCountries();
  res.json(rows);
}));

app.get('/api/v1/trends/anomalies', asyncHandler(async (_req, res) => {
  const rows = await getAnomalies();
  res.json(rows);
}));

app.get('/api/v1/forecasts', asyncHandler(async (req, res) => {
  const schema = z.object({
    entityType: z.enum(['journal', 'country']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(30),
  });
  const parsed = schema.parse(req.query);
  const rows = await getForecasts(parsed);
  res.json(rows);
}));

app.get('/api/v1/insights/retrieve', asyncHandler(async (req, res) => {
  const schema = z.object({
    query: z.string().optional().default(''),
    entityType: z.enum(['journal', 'country']).optional(),
    entityName: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(20).optional().default(5),
  });
  const parsed = schema.parse(req.query);
  const evidence = await retrieveEvidence(parsed);
  res.json(evidence);
}));

app.post('/api/v1/insights/explain', asyncHandler(async (req, res) => {
  const schema = z.object({
    question: z.string().min(3),
    entityType: z.enum(['journal', 'country']).optional(),
    entityName: z.string().optional(),
    evidenceLimit: z.coerce.number().int().min(1).max(20).optional().default(5),
  });
  const parsed = schema.parse(req.body || {});

  const evidence = await retrieveEvidence({
    query: parsed.question,
    entityType: parsed.entityType,
    entityName: parsed.entityName,
    limit: parsed.evidenceLimit,
  });

  const context = parsed.entityType && parsed.entityName
    ? await getEntityContext({ entityType: parsed.entityType, entityName: parsed.entityName })
    : await getQuestionContextForInsights({
        question: parsed.question,
        entityType: parsed.entityType,
        entityName: parsed.entityName,
        evidence,
      });

  const insight = await generateInsight({
    question: parsed.question,
    entityType: parsed.entityType,
    entityName: parsed.entityName,
    context,
    evidence,
  });

  res.json({
    ...insight,
    evidence,
    context,
  });
}));

app.get('/api/v1/institutions/exposure', asyncHandler(async (req, res) => {
  const schema = z.object({
    institution: z.string().optional(),
    country: z.string().optional(),
    publisher: z.string().optional(),
  });
  const parsed = schema.parse(req.query);
  const benchmark = await getBenchmark(parsed);
  res.json(benchmark);
}));

app.get('/api/v1/institutions/search', asyncHandler(async (req, res) => {
  const schema = z.object({
    query: z.string().optional().default(''),
    limit: z.coerce.number().int().min(1).max(30).optional().default(8),
  });
  const parsed = schema.parse(req.query);
  const rows = await searchInstitutions(parsed);
  res.json(rows);
}));

app.get('/api/v1/institutions/rankings', asyncHandler(async (req, res) => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(25),
    country: z.string().optional(),
    publisher: z.string().optional(),
  });
  const parsed = schema.parse(req.query);
  const rows = await listInstitutionRankings(parsed);
  res.json(rows);
}));

app.get('/api/v1/data/source-status', asyncHandler(async (_req, res) => {
  const sourcePath = resolveCsvPath(config.csvSourcePath);
  const sourceExists = fs.existsSync(sourcePath);
  const [dbStatus, publicationCoverage] = await Promise.all([
    getDataSourceStatus(),
    getPublicationCoverageSummary(),
  ]);

  res.json({
    csvSourcePath: sourcePath,
    csvSourceExists: sourceExists,
    ...dbStatus,
    publicationCoverage,
    openAlexEnabled: config.openAlexEnabled,
  });
}));

app.get('/api/v1/data/raw-records', asyncHandler(async (req, res) => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    offset: z.coerce.number().int().min(0).optional().default(0),
    institution: z.string().optional(),
    country: z.string().optional(),
    publisher: z.string().optional(),
    journal: z.string().optional(),
  });
  const parsed = schema.parse(req.query);
  const rows = await listRawRecords(parsed);
  res.json(rows);
}));

app.get('/api/v1/export/raw-records.csv', asyncHandler(async (req, res) => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(5000).optional().default(1000),
    offset: z.coerce.number().int().min(0).optional().default(0),
    institution: z.string().optional(),
    country: z.string().optional(),
    publisher: z.string().optional(),
    journal: z.string().optional(),
  });
  const parsed = schema.parse(req.query);
  const rows = await listRawRecords(parsed);
  sendCsv(res, 'raw-search-results-export.csv', rows);
}));

app.get('/api/v1/export/institutions-search.csv', asyncHandler(async (req, res) => {
  const schema = z.object({
    query: z.string().optional().default(''),
    limit: z.coerce.number().int().min(1).max(1000).optional().default(200),
  });
  const parsed = schema.parse(req.query);
  const rows = await searchInstitutions(parsed);
  sendCsv(res, 'institution-search-results-export.csv', rows);
}));

app.get('/api/v1/export/journals.csv', asyncHandler(async (req, res) => {
  const schema = z.object({
    search: z.string().optional().default(''),
    limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
  });
  const parsed = schema.parse(req.query);
  const rows = await listJournals(parsed);
  sendCsv(res, 'journal-stability-export.csv', rows);
}));

app.get('/api/v1/export/countries.csv', asyncHandler(async (_req, res) => {
  const rows = await listCountries();
  sendCsv(res, 'country-risk-export.csv', rows);
}));

app.get('/api/v1/export/anomalies.csv', asyncHandler(async (_req, res) => {
  const rows = await getAnomalies();
  sendCsv(res, 'retraction-anomalies-export.csv', rows);
}));

app.get('/api/v1/export/exposure.csv', asyncHandler(async (req, res) => {
  const schema = z.object({
    institution: z.string().optional(),
    country: z.string().optional(),
    publisher: z.string().optional(),
  });
  const parsed = schema.parse(req.query);
  const benchmark = await getBenchmark(parsed);

  const row = {
    input_institution: parsed.institution || '',
    input_country: parsed.country || '',
    input_publisher: parsed.publisher || '',
    matched_institution: benchmark.institution?.institution || '',
    matched_country: benchmark.country?.country || '',
    country_integrity_score:
      benchmark.country?.risk_score || benchmark.country?.integrity_score || '',
    country_publication_risk_score: benchmark.country?.risk_score || '',
    country_denominator_quality: benchmark.country?.denominator_quality || '',
    matched_publisher: benchmark.publisher?.publisher || '',
    publisher_avg_integrity: benchmark.publisher?.avg_integrity || '',
    publisher_dominant_tier: benchmark.publisher?.dominant_tier || '',
    publisher_journal_count: benchmark.publisher?.journal_count || '',
    institution_exposure_score: benchmark.institutionExposure?.exposure_score || '',
    institution_exposure_tier: benchmark.institutionExposure?.exposure_tier || '',
    institution_exposure_rank: benchmark.institutionExposure?.exposure_rank || '',
    institution_percentile: benchmark.institutionExposure?.percentile || '',
  };

  sendCsv(res, 'institutional-exposure-export.csv', [row]);
}));

app.get('/api/v1/export/institutions.csv', asyncHandler(async (req, res) => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
    country: z.string().optional(),
    publisher: z.string().optional(),
  });
  const parsed = schema.parse(req.query);
  const rows = await listInstitutionRankings(parsed);
  sendCsv(res, 'institution-risk-rankings-export.csv', rows);
}));

app.get('/api/v1/export/snapshot.json', asyncHandler(async (req, res) => {
  const schema = z.object({
    journalSearch: z.string().optional().default(''),
    institution: z.string().optional(),
    country: z.string().optional(),
    publisher: z.string().optional(),
  });
  const parsed = schema.parse(req.query);

  const [overview, journals, countries, anomalies, exposure] = await Promise.all([
    getOverview(),
    listJournals({ search: parsed.journalSearch, limit: 500 }),
    listCountries(),
    getAnomalies(),
    getBenchmark({
      institution: parsed.institution,
      country: parsed.country,
      publisher: parsed.publisher,
    }),
  ]);

  const snapshot = {
    exportedAt: new Date().toISOString(),
    filters: parsed,
    overview,
    journals,
    countries,
    anomalies,
    exposure,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="riip-risk-snapshot.json"');
  res.send(JSON.stringify(snapshot, null, 2));
}));

app.get('/api/v1/export/exposure-analysis.json', asyncHandler(async (req, res) => {
  const schema = z.object({
    institution: z.string().optional(),
    country: z.string().optional(),
    publisher: z.string().optional(),
  });
  const parsed = schema.parse(req.query);

  const [exposure, rankings] = await Promise.all([
    getBenchmark(parsed),
    listInstitutionRankings({ limit: 50, country: parsed.country, publisher: parsed.publisher }),
  ]);

  const analysis = {
    exportedAt: new Date().toISOString(),
    filters: parsed,
    exposure,
    rankings,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="exposure-analysis-export.json"');
  res.send(JSON.stringify(analysis, null, 2));
}));

app.post('/api/v1/score/recompute', asyncHandler(async (_req, res) => {
  const summary = await recomputeAllMetrics();
  res.json({
    status: 'recomputed',
    ...summary,
  });
}));

app.post('/api/v1/data/import-csv', asyncHandler(async (req, res) => {
  const schema = z.object({
    csvFilePath: z.string().min(1).optional(),
    truncate: z.boolean().optional().default(true),
    recompute: z.boolean().optional().default(true),
  });
  const parsed = schema.parse(req.body || {});

  const csvFilePath = resolveCsvPath(parsed.csvFilePath || config.csvSourcePath);

  const importSummary = await importRetractionsFromCsv({
    csvFilePath,
    truncate: parsed.truncate,
    sourceFileName: path.basename(csvFilePath),
  });

  let recomputeSummary = null;
  if (parsed.recompute) {
    recomputeSummary = await recomputeAllMetrics();
  }

  res.json({
    status: 'imported',
    source: csvFilePath,
    import: importSummary,
    recompute: recomputeSummary,
  });
}));

app.post('/api/v1/data/sync-source', asyncHandler(async (_req, res) => {
  const csvFilePath = resolveCsvPath(config.csvSourcePath);

  const importSummary = await importRetractionsFromCsv({
    csvFilePath,
    truncate: true,
    sourceFileName: path.basename(csvFilePath),
  });

  const recomputeSummary = await recomputeAllMetrics({ forceOpenAlexRefresh: true });

  res.json({
    status: 'synced',
    source: csvFilePath,
    import: importSummary,
    recompute: recomputeSummary,
  });
}));

app.post('/api/v1/data/sync-openalex', asyncHandler(async (req, res) => {
  const schema = z.object({
    force: z.boolean().optional().default(true),
    recompute: z.boolean().optional().default(false),
  });
  const parsed = schema.parse(req.body || {});

  const openAlex = await syncCountryPublicationsFromOpenAlex({ force: parsed.force });

  let recomputeSummary = null;
  if (parsed.recompute) {
    recomputeSummary = await recomputeAllMetrics();
  }

  const publicationCoverage = await getPublicationCoverageSummary();

  res.json({
    status: 'openalex_synced',
    openAlex,
    publicationCoverage,
    recompute: recomputeSummary,
  });
}));

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: 'validation_error',
      details: error.errors,
    });
    return;
  }

  res.status(500).json({
    error: 'internal_error',
    message: error.message,
  });
});

await ensureOperationalSchema();

app.listen(config.port, () => {
  console.log(`RIIP API listening on port ${config.port}`);

  if (!config.autoSyncCsvOnStartup) {
    return;
  }

  const sourcePath = resolveCsvPath(config.csvSourcePath);
  if (!fs.existsSync(sourcePath)) {
    console.log(`CSV source not found at startup: ${sourcePath}`);
    return;
  }

  (async () => {
    try {
      await importRetractionsFromCsv({
        csvFilePath: sourcePath,
        truncate: true,
        sourceFileName: path.basename(sourcePath),
      });
      await recomputeAllMetrics({ forceOpenAlexRefresh: true });
      console.log(`Auto-synced CSV source on startup: ${sourcePath}`);
    } catch (error) {
      console.error(`Auto-sync failed: ${error.message}`);
    }
  })();
});
