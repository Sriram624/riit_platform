const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080/api/v1';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `Request failed: ${response.status}`);
  }

  return response.json();
}

async function download(path, fileName) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `Download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export const api = {
  getOverview: () => request('/overview'),
  getJournals: (search) =>
    request(`/journals?search=${encodeURIComponent(search || '')}&limit=100`),
  getCountries: () => request('/countries'),
  getAnomalies: () => request('/trends/anomalies'),
  getForecasts: ({ entityType, limit = 20 } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (entityType) params.set('entityType', entityType);
    return request(`/forecasts?${params.toString()}`);
  },
  getEvidence: ({ query, entityType, entityName, limit = 5 } = {}) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (entityType) params.set('entityType', entityType);
    if (entityName) params.set('entityName', entityName);
    params.set('limit', String(limit));
    return request(`/insights/retrieve?${params.toString()}`);
  },
  explainInsight: ({ question, entityType, entityName, evidenceLimit = 5 }) =>
    request('/insights/explain', {
      method: 'POST',
      body: JSON.stringify({ question, entityType, entityName, evidenceLimit }),
    }),
  recompute: () => request('/score/recompute', { method: 'POST' }),
  getSourceStatus: () => request('/data/source-status'),
  syncSourceCsv: () => request('/data/sync-source', { method: 'POST' }),
  syncOpenAlex: ({ force = true, recompute = true } = {}) =>
    request('/data/sync-openalex', {
      method: 'POST',
      body: JSON.stringify({ force, recompute }),
    }),
  getRawRecords: ({ limit = 100, offset = 0, institution, country, publisher, journal } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (institution) params.set('institution', institution);
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    if (journal) params.set('journal', journal);
    return request(`/data/raw-records?${params.toString()}`);
  },
  getExposure: ({ institution, country, publisher }) => {
    const params = new URLSearchParams();
    if (institution) params.set('institution', institution);
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    return request(`/institutions/exposure?${params.toString()}`);
  },
  searchInstitutions: (query, limit = 8) =>
    request(`/institutions/search?query=${encodeURIComponent(query || '')}&limit=${limit}`),
  getInstitutionRankings: ({ limit = 10, country, publisher } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    return request(`/institutions/rankings?${params.toString()}`);
  },
  exportJournals: (search) =>
    download(
      `/export/journals.csv?search=${encodeURIComponent(search || '')}&limit=500`,
      'journal-stability-export.csv',
    ),
  exportCountries: () => download('/export/countries.csv', 'country-risk-export.csv'),
  exportAnomalies: () => download('/export/anomalies.csv', 'retraction-anomalies-export.csv'),
  exportInstitutions: ({ country, publisher } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    return download(
      `/export/institutions.csv?${params.toString()}`,
      'institution-risk-rankings-export.csv',
    );
  },
  exportExposure: ({ institution, country, publisher }) => {
    const params = new URLSearchParams();
    if (institution) params.set('institution', institution);
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    return download(
      `/export/exposure.csv?${params.toString()}`,
      'institutional-exposure-export.csv',
    );
  },
  exportSnapshot: ({ journalSearch, institution, country, publisher }) => {
    const params = new URLSearchParams();
    if (journalSearch) params.set('journalSearch', journalSearch);
    if (institution) params.set('institution', institution);
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    return download(`/export/snapshot.json?${params.toString()}`, 'riip-risk-snapshot.json');
  },
  exportRawSearch: ({ institution, country, publisher, journal, limit = 2000 } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (institution) params.set('institution', institution);
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    if (journal) params.set('journal', journal);
    return download(`/export/raw-records.csv?${params.toString()}`, 'raw-search-results-export.csv');
  },
  exportInstitutionSearch: ({ query, limit = 500 } = {}) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    params.set('limit', String(limit));
    return download(
      `/export/institutions-search.csv?${params.toString()}`,
      'institution-search-results-export.csv',
    );
  },
  exportExposureAnalysis: ({ institution, country, publisher } = {}) => {
    const params = new URLSearchParams();
    if (institution) params.set('institution', institution);
    if (country) params.set('country', country);
    if (publisher) params.set('publisher', publisher);
    return download(
      `/export/exposure-analysis.json?${params.toString()}`,
      'exposure-analysis-export.json',
    );
  },
};
