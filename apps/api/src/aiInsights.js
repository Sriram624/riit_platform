import { appConfig as config } from './config.js';

function compactReason(text, maxLength = 140) {
  const compact = (text || '').replace(/\s+/g, ' ').replace(/;+$/g, '').trim();
  if (!compact) return 'No reason text available';
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function buildFriendlyInsight({ question, context, evidence }) {
  const metrics = context?.metrics || {};
  const contextType = context?.entityType || 'general';

  let answer = 'No direct metric answer is available yet from the current context.';
  const keyMetrics = [];

  if (contextType === 'publisher' && metrics.avg_integrity !== undefined) {
    answer = `${metrics.entity_name || 'Publisher'} average integrity score is ${metrics.avg_integrity}.`;
    keyMetrics.push(`Journal coverage: ${metrics.journal_count ?? 'N/A'}`);
    keyMetrics.push(`Dominant tier: ${metrics.dominant_tier ?? 'N/A'}`);
    if (metrics.top_journal) {
      keyMetrics.push(`Top journal by integrity signal: ${metrics.top_journal} (${metrics.top_journal_integrity ?? 'N/A'})`);
    }
  } else if (metrics.integrity_score !== undefined) {
    answer = `Current integrity score is ${metrics.integrity_score}${metrics.tier ? ` (${metrics.tier})` : ''}.`;
    if (metrics.risk_score !== undefined && metrics.risk_score !== null) {
      keyMetrics.push(`Publication-normalized country risk: ${metrics.risk_score}`);
    }
    if (metrics.denominator_quality) {
      keyMetrics.push(`Publication denominator quality: ${metrics.denominator_quality}`);
    }
    if (metrics.trend_direction) {
      keyMetrics.push(`Trend: ${metrics.trend_direction}`);
    }
  }

  if (context?.forecast?.projected_next_year !== undefined) {
    keyMetrics.push(
      `Projected next-year retractions: ${context.forecast.projected_next_year} (confidence ${context.forecast.confidence ?? 0}%)`,
    );
  }

  const evidenceHighlights = (evidence || []).slice(0, 3).map((item) => ({
    title: item.title || item.sourceId,
    detail: compactReason(item.summary),
    date: String(item.sourceDate || '').slice(0, 10),
  }));

  return {
    question,
    answer,
    keyMetrics,
    evidenceHighlights,
    recommendation:
      'Prioritize entities with high integrity signals, upward trends, and repeated high-severity reasons for immediate review.',
  };
}

function buildFallbackNarrative({ question, context, evidence, entityType, entityName }) {
  const evidenceSummary = evidence.length
    ? evidence
        .slice(0, 3)
        .map((item) => `${item.title} (${String(item.sourceDate || '').slice(0, 10)}): ${item.summary}`)
        .join(' ')
    : 'No direct evidence matched the prompt in current records.';

  const metrics = context?.metrics || {};
  const forecast = context?.forecast || {};
  const trend = (context?.trend || []).slice(0, 2);
  const trendSummary = trend.length
    ? trend
        .map((row) => `${row.year}: count ${row.retraction_count}, z ${row.z_score}${row.is_anomaly ? ' (anomaly)' : ''}`)
        .join(' | ')
    : 'No recent trend rows found.';

  const metricBits = [];
  if (metrics.integrity_score !== undefined) metricBits.push(`integrity score ${metrics.integrity_score}`);
  if (metrics.risk_score !== undefined && metrics.risk_score !== null) {
    metricBits.push(`publication-normalized risk ${metrics.risk_score}`);
  }
  if (metrics.tier) metricBits.push(`tier ${metrics.tier}`);
  if (metrics.trend_direction) metricBits.push(`trend ${metrics.trend_direction}`);
  if (metrics.avg_integrity !== undefined) metricBits.push(`average integrity ${metrics.avg_integrity}`);
  if (metrics.journal_count !== undefined) metricBits.push(`journal coverage ${metrics.journal_count}`);
  if (metrics.dominant_tier) metricBits.push(`dominant tier ${metrics.dominant_tier}`);
  if (metrics.top_journal && metrics.top_journal_integrity !== undefined) {
    metricBits.push(`top journal by integrity ${metrics.top_journal} (${metrics.top_journal_integrity})`);
  }
  if (metrics.denominator_quality) {
    metricBits.push(`denominator quality ${metrics.denominator_quality}`);
  }

  const contextLabel = context?.entityType === 'publisher' ? 'Publisher benchmark' : 'Current metrics';

  const forecastBits = forecast.projected_next_year !== undefined
    ? `Projected next-year retractions: ${forecast.projected_next_year} (confidence ${forecast.confidence ?? 0}%).`
    : 'No forecast available yet.';

  return [
    `Question: ${question}`,
    `Entity: ${entityType || 'general'}${entityName ? ` / ${entityName}` : ''}.`,
    metricBits.length ? `${contextLabel}: ${metricBits.join(', ')}.` : 'Current metrics are unavailable for this entity.',
    `Trend evidence: ${trendSummary}`,
    forecastBits,
    `Retrieved evidence: ${evidenceSummary}`,
    'Interpretation: prioritize entities with high current integrity signal, upward trend direction, and rising projected next-year counts for immediate review.',
  ].join(' ');
}

function buildPrompt({ question, context, evidence, entityType, entityName }) {
  return [
    'You are an integrity-risk analyst. Produce a concise, evidence-grounded answer.',
    'Use only the supplied evidence and metrics. Do not invent facts.',
    'Return plain text with: summary, risk interpretation, and recommended next action.',
    `Question: ${question}`,
    `Entity Type: ${entityType || 'general'}`,
    `Entity Name: ${entityName || 'N/A'}`,
    `Metrics Context: ${JSON.stringify(context || {}, null, 2)}`,
    `Evidence: ${JSON.stringify(evidence || [], null, 2)}`,
  ].join('\n\n');
}

async function generateWithLlm(prompt) {
  if (!config.llmApiUrl || !config.llmApiKey) {
    return null;
  }

  const response = await fetch(config.llmApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        {
          role: 'system',
          content:
            'You are a research integrity copilot. Be concise, factual, and grounded in provided evidence only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${payload.slice(0, 200)}`);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content?.trim() || null;
}

export async function generateInsight({ question, context, evidence, entityType, entityName }) {
  const prompt = buildPrompt({ question, context, evidence, entityType, entityName });
  const friendly = buildFriendlyInsight({ question, context, evidence });

  try {
    const llmText = await generateWithLlm(prompt);
    if (llmText) {
      return {
        mode: 'llm',
        explanation: llmText,
        friendly,
      };
    }
  } catch {
    return {
      mode: 'heuristic',
      explanation: buildFallbackNarrative({ question, context, evidence, entityType, entityName }),
      friendly,
    };
  }

  return {
    mode: 'heuristic',
    explanation: buildFallbackNarrative({ question, context, evidence, entityType, entityName }),
    friendly,
  };
}
