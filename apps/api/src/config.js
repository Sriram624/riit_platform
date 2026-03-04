import dotenv from 'dotenv';

dotenv.config();

const defaultRiskEnginePath = '../../../services/risk-engine/src/engine.py';
const defaultCsvSourcePath = '../../../../retraction_watch.csv';

export const config = {
  port: Number(process.env.PORT || 8080),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@127.0.0.1:5432/riip',
  pythonCmd: process.env.PYTHON_CMD || 'python',
  riskEnginePath: process.env.RISK_ENGINE_PATH || defaultRiskEnginePath,
  csvSourcePath: process.env.CSV_SOURCE_PATH || defaultCsvSourcePath,
  autoSyncCsvOnStartup: process.env.AUTO_SYNC_CSV_ON_STARTUP !== 'false',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  llmApiUrl: process.env.LLM_API_URL || '',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',
  openAlexEnabled: process.env.OPENALEX_ENABLED !== 'false',
  openAlexEmail: process.env.OPENALEX_EMAIL || '',
  openAlexTimeoutMs: Number(process.env.OPENALEX_TIMEOUT_MS || 10000),
  openAlexRefreshDays: Number(process.env.OPENALEX_REFRESH_DAYS || 30),
};
