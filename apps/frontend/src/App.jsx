import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import './App.css'

function App() {
  const [overview, setOverview] = useState(null)
  const [journals, setJournals] = useState([])
  const [countries, setCountries] = useState([])
  const [anomalies, setAnomalies] = useState([])
  const [forecasts, setForecasts] = useState([])
  const [sourceStatus, setSourceStatus] = useState(null)
  const [rawRecords, setRawRecords] = useState([])
  const [rawFilters, setRawFilters] = useState({
    institution: '',
    country: '',
    publisher: '',
    journal: '',
  })
  const [institutionRankings, setInstitutionRankings] = useState([])
  const [institutionSuggestions, setInstitutionSuggestions] = useState([])
  const [journalSearch, setJournalSearch] = useState('')
  const [exposureInput, setExposureInput] = useState({
    institution: '',
    country: '',
    publisher: '',
  })
  const [exposureResult, setExposureResult] = useState(null)
  const [insightInput, setInsightInput] = useState({
    question: '',
    entityType: 'journal',
    entityName: '',
  })
  const [insightResult, setInsightResult] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecomputing, setIsRecomputing] = useState(false)
  const [isSyncingCsv, setIsSyncingCsv] = useState(false)
  const [isSyncingOpenAlex, setIsSyncingOpenAlex] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false)
  const [error, setError] = useState('')
  const [activeView, setActiveView] = useState('intelligence')

  const loadData = async (searchValue = journalSearch) => {
    setError('')
    try {
      const [overviewData, journalData, countryData, anomalyData, forecastData] = await Promise.all([
        api.getOverview(),
        api.getJournals(searchValue),
        api.getCountries(),
        api.getAnomalies(),
        api.getForecasts({ limit: 14 }),
      ])
      const [rankings, source, raw] = await Promise.all([
        api.getInstitutionRankings({ limit: 10 }),
        api.getSourceStatus(),
        api.getRawRecords({ limit: 40 }),
      ])
      setOverview(overviewData)
      setJournals(journalData)
      setCountries(countryData)
      setAnomalies(anomalyData)
      setForecasts(forecastData)
      setInstitutionRankings(rankings)
      setSourceStatus(source)
      setRawRecords(raw)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData('')
  }, [])

  useEffect(() => {
    const query = exposureInput.institution?.trim()

    if (!query || query.length < 2) {
      setInstitutionSuggestions([])
      return
    }

    const timeoutId = setTimeout(async () => {
      try {
        const rows = await api.searchInstitutions(query, 8)
        setInstitutionSuggestions(rows)
      } catch {
        setInstitutionSuggestions([])
      }
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [exposureInput.institution])

  const topCountryRisk = useMemo(() => {
    if (!countries.length) return 0
    return Math.max(...countries.map((x) => Number(x.risk_score ?? x.integrity_score ?? 0)))
  }, [countries])

  const handleJournalSearch = async (event) => {
    event.preventDefault()
    await loadData(journalSearch)
  }

  const handleRecompute = async () => {
    setIsRecomputing(true)
    setError('')
    try {
      await api.recompute()
      await loadData(journalSearch)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsRecomputing(false)
    }
  }

  const handleSyncCsv = async () => {
    setIsSyncingCsv(true)
    setError('')
    try {
      await api.syncSourceCsv()
      await loadData(journalSearch)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsSyncingCsv(false)
    }
  }

  const handleSyncOpenAlex = async () => {
    setIsSyncingOpenAlex(true)
    setError('')
    try {
      await api.syncOpenAlex({ force: true, recompute: true })
      await loadData(journalSearch)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsSyncingOpenAlex(false)
    }
  }

  const handleRawSearch = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const rows = await api.getRawRecords({
        limit: 80,
        institution: rawFilters.institution,
        country: rawFilters.country,
        publisher: rawFilters.publisher,
        journal: rawFilters.journal,
      })
      setRawRecords(rows)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleExposure = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const data = await api.getExposure(exposureInput)
      setExposureResult(data)
      const rankings = await api.getInstitutionRankings({ limit: 10 })
      setInstitutionRankings(rankings)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleInsight = async (event) => {
    event.preventDefault()
    setError('')
    setIsGeneratingInsight(true)
    try {
      const response = await api.explainInsight({
        question: insightInput.question,
        entityType: insightInput.entityType,
        entityName: insightInput.entityName,
        evidenceLimit: 6,
      })
      setInsightResult(response)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsGeneratingInsight(false)
    }
  }

  const handleExport = async (action) => {
    setIsExporting(true)
    setError('')
    try {
      if (action === 'journals') {
        await api.exportJournals(journalSearch)
      } else if (action === 'countries') {
        await api.exportCountries()
      } else if (action === 'anomalies') {
        await api.exportAnomalies()
      } else if (action === 'institutions') {
        await api.exportInstitutions({
          country: exposureInput.country,
          publisher: exposureInput.publisher,
        })
      } else if (action === 'exposure') {
        await api.exportExposure(exposureInput)
      } else if (action === 'snapshot') {
        await api.exportSnapshot({
          journalSearch,
          institution: exposureInput.institution,
          country: exposureInput.country,
          publisher: exposureInput.publisher,
        })
      } else if (action === 'raw-search') {
        await api.exportRawSearch({
          institution: rawFilters.institution,
          country: rawFilters.country,
          publisher: rawFilters.publisher,
          journal: rawFilters.journal,
          limit: 4000,
        })
      } else if (action === 'institution-search') {
        await api.exportInstitutionSearch({
          query: exposureInput.institution,
          limit: 600,
        })
      } else if (action === 'exposure-analysis') {
        await api.exportExposureAnalysis({
          institution: exposureInput.institution,
          country: exposureInput.country,
          publisher: exposureInput.publisher,
        })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading) {
    return <div className="screen-message">Loading RIIP intelligence engine...</div>
  }

  return (
    <div className="riip-layout">
      <header className="topbar">
        <div>
          <h1>Research Integrity Intelligence Platform</h1>
          <p>Risk infrastructure for journal, country, and institutional reliability intelligence</p>
        </div>
        <button disabled={isRecomputing} onClick={handleRecompute} className="primary-btn">
          {isRecomputing ? 'Recomputing...' : 'Recompute Integrity Signals'}
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <nav className="workspace-tabs" aria-label="Workspace views">
        <button
          type="button"
          className={activeView === 'intelligence' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveView('intelligence')}
        >
          Intelligence
        </button>
        <button
          type="button"
          className={activeView === 'copilot' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveView('copilot')}
        >
          AI Copilot + Exposure
        </button>
        <button
          type="button"
          className={activeView === 'dataops' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveView('dataops')}
        >
          Data Ops + Exports
        </button>
      </nav>

      <section className="panel methodology-panel">
        <details className="compact-details">
          <summary>Scoring & Ranking Methodology</summary>
          <div className="methodology-grid">
            <article className="methodology-item">
              <h3>Journal Integrity Signal</h3>
              <p className="method-formula">
                0.30×Severity + 0.25×Acceleration + 0.20×Delay + 0.15×Volatility + 0.10×Misconduct Diversity
              </p>
              <small>Used as primary ranking metric because total journal publication denominators are not yet robustly available.</small>
            </article>
            <article className="methodology-item">
              <h3>Country Integrity + Risk</h3>
              <p className="method-formula">
                Integrity: 0.45×3Y Acceleration + 0.40×Severity Cluster + 0.15×Anomaly Signal
              </p>
              <small>Publication-normalized country risk is shown only when denominator quality is high/medium via OpenAlex.</small>
            </article>
            <article className="methodology-item">
              <h3>Institution Exposure Score</h3>
              <p className="method-formula">
                0.55×Country Composite + 0.35×Publisher Integrity + 0.10×Publication Volume Signal
              </p>
              <small>Tier labels map from the final exposure score.</small>
            </article>
            <article className="methodology-item">
              <h3>Forecast Confidence</h3>
              <p className="method-formula">
                Based on fit quality (R²), normalized error (NRMSE), and sample-size strength.
              </p>
              <small>Bounded to avoid unstable 0/100 extremes and remain interpretable.</small>
            </article>
          </div>
          <ul className="methodology-notes">
            <li>Exposure rank is computed by sorting exposure score in descending order.</li>
            <li>Percentile uses the ranked score distribution across institutions.</li>
            <li>Trend direction reflects acceleration thresholds: upward, stable, or downward.</li>
          </ul>
        </details>
      </section>

      {activeView === 'intelligence' ? (
        <>
          <section className="panel source-panel">
            <div className="panel-head">
              <h2>CSV Source of Truth</h2>
              <div className="source-actions">
                <button type="button" onClick={handleSyncCsv} disabled={isSyncingCsv || isSyncingOpenAlex}>
                  {isSyncingCsv ? 'Syncing...' : 'Sync from retraction_watch.csv'}
                </button>
                <button type="button" onClick={handleSyncOpenAlex} disabled={isSyncingOpenAlex || isSyncingCsv}>
                  {isSyncingOpenAlex ? 'Refreshing OpenAlex...' : 'Sync OpenAlex Denominators'}
                </button>
              </div>
            </div>
            <div className="source-grid">
              <div>
                <span>Configured Source</span>
                <p>{sourceStatus?.csvSourcePath || 'Not available'}</p>
              </div>
              <div>
                <span>Source File Found</span>
                <p>{sourceStatus?.csvSourceExists ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <span>Raw Records</span>
                <p>{sourceStatus?.rawRecordCount ?? 0}</p>
              </div>
              <div>
                <span>Institutions (Raw)</span>
                <p>{sourceStatus?.rawInstitutionCount ?? 0}</p>
              </div>
              <div>
                <span>Journals (Raw)</span>
                <p>{sourceStatus?.rawJournalCount ?? 0}</p>
              </div>
              <div>
                <span>Latest Source</span>
                <p>{sourceStatus?.latestSourceFile || 'N/A'}</p>
              </div>
              <div>
                <span>OpenAlex Rows</span>
                <p>{sourceStatus?.publicationCoverage?.openalex_rows ?? 0}</p>
              </div>
              <div>
                <span>Latest OpenAlex Refresh</span>
                <p>{sourceStatus?.publicationCoverage?.latest_openalex_refresh || 'N/A'}</p>
              </div>
            </div>
          </section>

          <section className="kpi-grid">
            <article className="kpi-card">
              <span>Journal Coverage</span>
              <strong>{overview?.journalCoverage ?? 0}</strong>
            </article>
            <article className="kpi-card">
              <span>Country Coverage</span>
              <strong>{overview?.countryCoverage ?? 0}</strong>
            </article>
            <article className="kpi-card">
              <span>Active Anomalies</span>
              <strong>{overview?.activeAnomalies ?? 0}</strong>
            </article>
            <article className="kpi-card">
              <span>Highest Integrity Signal (Journal)</span>
              <strong>{overview?.highestIntegrityJournal?.journal ?? 'N/A'}</strong>
              <small>
                Score {overview?.highestIntegrityJournal?.integrity_score ?? '-'} · Tier {overview?.highestIntegrityJournal?.tier ?? '-'}
              </small>
            </article>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Journal Stability Rating</h2>
              <form onSubmit={handleJournalSearch}>
                <input
                  value={journalSearch}
                  onChange={(e) => setJournalSearch(e.target.value)}
                  placeholder="Search journal"
                />
                <button type="submit">Search</button>
                <button type="button" disabled={isExporting} onClick={() => handleExport('journals')}>
                  Export Search Results
                </button>
              </form>
            </div>
            <div className="table-wrap table-wrap-compact">
              <table>
                <thead>
                  <tr>
                    <th>Journal</th>
                    <th>Publisher</th>
                    <th>Integrity</th>
                    <th>Tier</th>
                    <th>Severity</th>
                    <th>Delay (days)</th>
                    <th>Acceleration</th>
                  </tr>
                </thead>
                <tbody>
                  {journals.map((row) => (
                    <tr key={row.journal}>
                      <td>{row.journal}</td>
                      <td>{row.publisher}</td>
                      <td>{row.integrity_score}</td>
                      <td>
                        <span className={`tier tier-${row.tier}`}>{row.tier}</span>
                      </td>
                      <td>{row.severity_index}</td>
                      <td>{row.median_delay_days}</td>
                      <td className={row.trend_direction === 'upward' ? 'trend-up' : 'trend-stable'}>
                        {row.retraction_growth_velocity}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="split-grid">
            <article className="panel">
              <h2>Country Integrity Index</h2>
              <ul className="country-list scroll-list">
                {countries.map((row) => {
                  const countryScore = Number(row.risk_score ?? row.integrity_score ?? 0)
                  const width = topCountryRisk ? (countryScore / topCountryRisk) * 100 : 0
                  return (
                    <li key={row.country}>
                      <div className="country-row">
                        <span>{row.country}</span>
                        <span>{countryScore.toFixed(2)}</span>
                      </div>
                      <div className="risk-bar">
                        <span style={{ width: `${Math.max(width, 4)}%` }} />
                      </div>
                      <small>
                        {row.risk_score !== null && row.risk_score !== undefined
                          ? `${row.retractions_per_10k} /10k risk · `
                          : 'Integrity-only mode · '}
                        Accel {row.acceleration_3y}% · {row.trend_direction} · Denominator {row.denominator_quality || 'none'}
                      </small>
                    </li>
                  )
                })}
              </ul>
            </article>

            <article className="panel">
              <h2>Retraction Acceleration Detector</h2>
              <ul className="anomaly-list scroll-list">
                {anomalies.length ? (
                  anomalies.map((row, idx) => (
                    <li key={`${row.entity_type}-${row.entity_name}-${row.year}-${idx}`}>
                      <strong>{row.entity_name}</strong>
                      <p>
                        {row.entity_type} · {row.year} · Z-score {row.z_score} · Count {row.retraction_count}
                      </p>
                    </li>
                  ))
                ) : (
                  <li>
                    <p>No high-confidence anomalies in the current scoring cycle.</p>
                  </li>
                )}
              </ul>
            </article>
          </section>

          <section className="panel">
            <h2>ML Retraction Forecasts</h2>
            <div className="table-wrap table-wrap-compact">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Entity</th>
                    <th>Latest Year</th>
                    <th>Latest Count</th>
                    <th>Projected Next Year</th>
                    <th>Slope</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {forecasts.map((row, idx) => (
                    <tr key={`${row.entity_type}-${row.entity_name}-${idx}`}>
                      <td>{row.entity_type}</td>
                      <td>{row.entity_name}</td>
                      <td>{row.latest_year}</td>
                      <td>{row.latest_count}</td>
                      <td>{row.projected_next_year}</td>
                      <td>{row.trend_slope}</td>
                      <td>{row.confidence}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {activeView === 'copilot' ? (
        <>
          <section className="panel">
            <h2>AI / RAG Insight Copilot</h2>
            <form className="exposure-form" onSubmit={handleInsight}>
              <input
                placeholder="Ask a risk question"
                value={insightInput.question}
                onChange={(e) => setInsightInput((prev) => ({ ...prev, question: e.target.value }))}
              />
              <select
                value={insightInput.entityType}
                onChange={(e) => setInsightInput((prev) => ({ ...prev, entityType: e.target.value }))}
              >
                <option value="journal">Journal</option>
                <option value="country">Country</option>
              </select>
              <input
                placeholder="Entity name (e.g., Nature, India)"
                value={insightInput.entityName}
                onChange={(e) => setInsightInput((prev) => ({ ...prev, entityName: e.target.value }))}
              />
              <button type="submit" disabled={isGeneratingInsight || !insightInput.question.trim()}>
                {isGeneratingInsight ? 'Generating...' : 'Generate Insight'}
              </button>
            </form>

            {insightResult ? (
              <div className="insight-result">
                <div className="insight-friendly">
                  <h3>Quick Insight</h3>
                  <p className="insight-answer">{insightResult.friendly?.answer || 'No concise answer available.'}</p>
                  {insightResult.friendly?.keyMetrics?.length ? (
                    <ul className="mini-list">
                      {insightResult.friendly.keyMetrics.map((item, idx) => (
                        <li key={`metric-${idx}`}>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {insightResult.friendly?.recommendation ? (
                    <p className="insight-reco">Recommended action: {insightResult.friendly.recommendation}</p>
                  ) : null}
                </div>

                <details className="compact-details">
                  <summary>Detailed Explanation ({insightResult.mode || 'heuristic'})</summary>
                  <p>{insightResult.explanation}</p>
                </details>

                <details open className="compact-details">
                  <summary>Retrieved Evidence ({(insightResult.evidence || []).length})</summary>
                  <ul className="mini-list scroll-list">
                    {(insightResult.evidence || []).map((row) => (
                      <li key={row.sourceId}>
                        <span>{row.title || row.sourceId}</span>
                        <small>{row.summary}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <h2>Institutional Exposure Analyzer</h2>
            <form className="exposure-form" onSubmit={handleExposure}>
              <div className="institution-input-wrap">
                <input
                  placeholder="Institution"
                  value={exposureInput.institution}
                  onChange={(e) => setExposureInput((prev) => ({ ...prev, institution: e.target.value }))}
                />
                {institutionSuggestions.length ? (
                  <ul className="suggestion-list">
                    {institutionSuggestions.map((item) => (
                      <li key={item.institution}>
                        <button
                          type="button"
                          onClick={() => {
                            setExposureInput((prev) => ({
                              ...prev,
                              institution: item.institution,
                              country: prev.country || item.country,
                              publisher: prev.publisher || item.publisher,
                            }))
                            setInstitutionSuggestions([])
                          }}
                        >
                          <span>{item.institution}</span>
                          <small>
                            {item.country} · {item.publisher}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <input
                placeholder="Country"
                value={exposureInput.country}
                onChange={(e) => setExposureInput((prev) => ({ ...prev, country: e.target.value }))}
              />
              <input
                placeholder="Publisher"
                value={exposureInput.publisher}
                onChange={(e) => setExposureInput((prev) => ({ ...prev, publisher: e.target.value }))}
              />
              <button type="submit">Analyze Exposure</button>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => handleExport('institution-search')}
              >
                Export Institution Matches
              </button>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => handleExport('exposure-analysis')}
              >
                Export Analysis JSON
              </button>
            </form>

            {exposureResult ? (
              <>
                <div className="exposure-result">
                  <div>
                    <h3>Exposure Score</h3>
                    <p>
                      {exposureResult.institutionExposure?.exposure_score ?? 'N/A'}
                      {exposureResult.institutionExposure?.exposure_tier
                        ? ` · ${exposureResult.institutionExposure.exposure_tier}`
                        : ''}
                    </p>
                  </div>
                  <div>
                    <h3>Global Rank</h3>
                    <p>
                      {exposureResult.institutionExposure?.exposure_rank
                        ? `#${exposureResult.institutionExposure.exposure_rank}`
                        : 'N/A'}
                      {exposureResult.institutionExposure?.percentile
                        ? ` · ${exposureResult.institutionExposure.percentile} percentile`
                        : ''}
                    </p>
                  </div>
                  <div>
                    <h3>Alternative Matches</h3>
                    <p>{exposureResult.institutionMatches?.length || 0} candidates</p>
                  </div>
                </div>

                <div className="exposure-result">
                <div>
                  <h3>Institution</h3>
                  <p>{exposureResult.institution?.institution ?? 'No match'}</p>
                </div>
                <div>
                  <h3>Country Composite</h3>
                  <p>
                    {exposureResult.country?.country ?? 'No match'}
                    {exposureResult.country
                      ? ` · ${exposureResult.country.risk_score ?? exposureResult.country.integrity_score}`
                      : ''}
                  </p>
                </div>
                <div>
                  <h3>Publisher Benchmark</h3>
                  <p>
                    {exposureResult.publisher?.publisher ?? 'No match'}
                    {exposureResult.publisher ? ` · Avg ${exposureResult.publisher.avg_integrity}` : ''}
                  </p>
                </div>
                </div>

                <div className="exposure-extra-grid">
                  <details open className="compact-details">
                    <summary>Peer Benchmark (Same Country)</summary>
                    <ul className="mini-list scroll-list">
                      {(exposureResult.peerBenchmarks || []).map((peer) => (
                        <li key={peer.institution}>
                          <span>{peer.institution}</span>
                          <small>
                            Score {peer.exposure_score} · Rank #{peer.exposure_rank}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <details open className="compact-details">
                    <summary>Top Institutions by Exposure</summary>
                    <ul className="mini-list scroll-list">
                      {institutionRankings.slice(0, 6).map((row) => (
                        <li key={row.institution}>
                          <span>{row.institution}</span>
                          <small>
                            {row.country} · {row.exposure_score} ({row.exposure_tier}) · Aliases {row.alias_count ?? 1}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {activeView === 'dataops' ? (
        <>
          <section className="panel export-panel">
            <div className="panel-head">
              <h2>Export Intelligence Data</h2>
            </div>
            <div className="export-actions">
              <button type="button" disabled={isExporting} onClick={() => handleExport('journals')}>
                Export Journals CSV
              </button>
              <button type="button" disabled={isExporting} onClick={() => handleExport('countries')}>
                Export Countries CSV
              </button>
              <button type="button" disabled={isExporting} onClick={() => handleExport('anomalies')}>
                Export Anomalies CSV
              </button>
              <button type="button" disabled={isExporting} onClick={() => handleExport('institutions')}>
                Export Institutions CSV
              </button>
              <button type="button" disabled={isExporting} onClick={() => handleExport('exposure')}>
                Export Exposure CSV
              </button>
              <button type="button" disabled={isExporting} onClick={() => handleExport('snapshot')}>
                Export Full Snapshot JSON
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Raw Data Explorer (CSV-backed)</h2>
              <form onSubmit={handleRawSearch} className="raw-filter-form">
                <input
                  placeholder="Institution"
                  value={rawFilters.institution}
                  onChange={(e) => setRawFilters((prev) => ({ ...prev, institution: e.target.value }))}
                />
                <input
                  placeholder="Country"
                  value={rawFilters.country}
                  onChange={(e) => setRawFilters((prev) => ({ ...prev, country: e.target.value }))}
                />
                <input
                  placeholder="Publisher"
                  value={rawFilters.publisher}
                  onChange={(e) => setRawFilters((prev) => ({ ...prev, publisher: e.target.value }))}
                />
                <input
                  placeholder="Journal"
                  value={rawFilters.journal}
                  onChange={(e) => setRawFilters((prev) => ({ ...prev, journal: e.target.value }))}
                />
                <button type="submit">Filter Raw Records</button>
                <button type="button" disabled={isExporting} onClick={() => handleExport('raw-search')}>
                  Export Filtered Results
                </button>
              </form>
            </div>
            <div className="table-wrap table-wrap-compact">
              <table>
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Canonical</th>
                    <th>Country</th>
                    <th>Publisher</th>
                    <th>Journal</th>
                    <th>Retraction Date</th>
                    <th>Reason</th>
                    <th>Source File</th>
                  </tr>
                </thead>
                <tbody>
                  {rawRecords.map((row, idx) => (
                    <tr key={`${row.doi || row.institution}-${idx}`}>
                      <td>{row.institution}</td>
                      <td>{row.institution_canonical || row.institution}</td>
                      <td>{row.country}</td>
                      <td>{row.publisher}</td>
                      <td>{row.journal}</td>
                      <td>{String(row.retraction_date || '').slice(0, 10)}</td>
                      <td>{row.reason_text}</td>
                      <td>{row.source_file || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export default App
