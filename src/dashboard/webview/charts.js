// ═══════════════════════════════════════════════════════════
// Sentinel AI – Charts Module
// Pure-CSS/SVG chart rendering for the Analytics tab.
// No external chart libraries — lightweight, fast, beautiful.
// ═══════════════════════════════════════════════════════════

'use strict';

/**
 * Category color map — consistent across all charts.
 */
const CHART_COLORS = {
  spam:            { fill: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  toxicity:        { fill: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  hate_speech:     { fill: '#ff6b6b', bg: 'rgba(255,107,107,0.15)' },
  scam:            { fill: '#fb923c', bg: 'rgba(251,146,60,0.15)' },
  rule_violation:  { fill: '#eab308', bg: 'rgba(234,179,8,0.15)' },
  low_effort:      { fill: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  self_promotion:  { fill: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  nsfw:            { fill: '#ec4899', bg: 'rgba(236,72,153,0.15)' },
  brigading:       { fill: '#14b8a6', bg: 'rgba(20,184,166,0.15)' },
  manipulation:    { fill: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  clean:           { fill: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
};

/**
 * Render a horizontal bar chart for violation categories.
 * @param {HTMLElement} container - Target container element
 * @param {Object} data - Map of category → count
 */
function renderCategoryChart(container, data) {
  if (!container || !data) return;

  const entries = Object.entries(data)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">No violation data yet</div>';
    return;
  }

  const maxVal = Math.max(...entries.map(([, v]) => v), 1);

  container.innerHTML = entries.map(([cat, count]) => {
    const colors = CHART_COLORS[cat] || { fill: '#6366f1', bg: 'rgba(99,102,241,0.15)' };
    const pct = Math.round((count / maxVal) * 100);
    const label = formatCatLabel(cat);

    return `
      <div class="chart-row" style="animation:fadeSlideIn 0.3s ease forwards">
        <div class="chart-label">${label}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width:${pct}%;background:${colors.fill};box-shadow:0 0 8px ${colors.fill}44"></div>
        </div>
        <div class="chart-count">${formatCompact(count)}</div>
      </div>
    `;
  }).join('');
}

/**
 * Render an SVG donut chart for category distribution.
 * @param {HTMLElement} container - Target container
 * @param {Object} data - Map of category → count
 */
function renderDonutChart(container, data) {
  if (!container || !data) return;

  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">No data</div>';
    return;
  }

  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const r = 50;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = entries.map(([cat, count]) => {
    const pct = count / total;
    const dashLen = circumference * pct;
    const dashGap = circumference - dashLen;
    const colors = CHART_COLORS[cat] || { fill: '#6366f1' };
    const arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors.fill}"
      stroke-width="${strokeWidth}" stroke-dasharray="${dashLen} ${dashGap}"
      stroke-dashoffset="${-offset}" stroke-linecap="round"
      style="transition:stroke-dashoffset 0.6s ease"/>`;
    offset += dashLen;
    return arc;
  });

  const legendHtml = entries.slice(0, 6).map(([cat, count]) => {
    const colors = CHART_COLORS[cat] || { fill: '#6366f1' };
    const pct = Math.round((count / total) * 100);
    return `<div class="donut-legend-item">
      <span class="donut-legend-dot" style="background:${colors.fill}"></span>
      <span class="donut-legend-label">${formatCatLabel(cat)}</span>
      <span class="donut-legend-pct">${pct}%</span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="donut-wrap">
      <div class="donut-svg-wrap">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="${strokeWidth}"/>
          ${arcs.join('')}
        </svg>
        <div class="donut-center">
          <div class="donut-center-val">${formatCompact(total)}</div>
          <div class="donut-center-label">total</div>
        </div>
      </div>
      <div class="donut-legend">${legendHtml}</div>
    </div>
  `;
}

/**
 * Render a mini sparkline for trend data.
 * @param {HTMLElement} container
 * @param {number[]} values - Array of numeric values (most recent last)
 * @param {string} color - Stroke color
 */
function renderSparkline(container, values, color) {
  if (!container || !values || values.length < 2) {
    if (container) container.innerHTML = '';
    return;
  }

  const w = 120;
  const h = 32;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = w / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  // Create gradient fill area
  const firstY = h - ((values[0] - min) / range) * (h - 4) - 2;
  const lastY = h - ((values[values.length - 1] - min) / range) * (h - 4) - 2;
  const areaPoints = `0,${h} ${points} ${w},${h}`;

  container.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="sparkGrad-${container.id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#sparkGrad-${container.id})" />
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${w}" cy="${lastY}" r="3" fill="${color}" stroke="none">
        <animate attributeName="r" values="3;4;3" dur="2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  `;
}

/**
 * Render a trust score distribution bar chart.
 * @param {HTMLElement} container
 * @param {Array} users - UserReputation[] from server
 */
function renderTrustDistribution(container, users) {
  if (!container || !users || users.length === 0) {
    if (container) container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:16px">No user data</div>';
    return;
  }

  const buckets = [
    { label: 'Untrusted (0–24)', min: 0, max: 24, color: '#ef4444', count: 0 },
    { label: 'Suspicious (25–39)', min: 25, max: 39, color: '#f97316', count: 0 },
    { label: 'Neutral (40–59)', min: 40, max: 59, color: '#eab308', count: 0 },
    { label: 'Established (60–79)', min: 60, max: 79, color: '#3b82f6', count: 0 },
    { label: 'Trusted (80–100)', min: 80, max: 100, color: '#22c55e', count: 0 },
  ];

  users.forEach(u => {
    const score = u.trustScore ?? 50;
    for (const b of buckets) {
      if (score >= b.min && score <= b.max) { b.count++; break; }
    }
  });

  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  container.innerHTML = buckets.map(b => {
    const pct = Math.round((b.count / maxCount) * 100);
    return `
      <div class="chart-row">
        <div class="chart-label" style="width:130px">${b.label}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width:${pct}%;background:${b.color}"></div>
        </div>
        <div class="chart-count">${b.count}</div>
      </div>
    `;
  }).join('');
}

/**
 * Render action distribution (auto-removed, auto-approved, manual, etc.).
 * @param {HTMLElement} container
 * @param {Object} metrics - SentinelMetrics from server
 */
function renderActionBreakdown(container, metrics) {
  if (!container || !metrics) return;

  const items = [
    { label: 'Auto-Removed', value: metrics.autoRemoved || 0, color: '#ef4444' },
    { label: 'Auto-Approved', value: metrics.autoApproved || 0, color: '#22c55e' },
    { label: 'Manual Approved', value: metrics.manuallyApproved || 0, color: '#3b82f6' },
    { label: 'Manual Removed', value: metrics.manuallyRemoved || 0, color: '#f97316' },
    { label: 'False Positives', value: metrics.falsePositives || 0, color: '#a855f7' },
  ];

  const total = items.reduce((s, i) => s + i.value, 0) || 1;

  container.innerHTML = items.map(item => {
    const pct = Math.round((item.value / total) * 100);
    return `
      <div class="action-breakdown-row">
        <div class="action-dot" style="background:${item.color}"></div>
        <div class="action-label">${item.label}</div>
        <div class="action-bar-wrap">
          <div class="action-bar" style="width:${pct}%;background:${item.color}"></div>
        </div>
        <div class="action-val">${item.value}</div>
        <div class="action-pct">${pct}%</div>
      </div>
    `;
  }).join('');
}

// ── Helpers ─────────────────────────────────────────────────

function formatCatLabel(cat) {
  const labels = {
    spam: 'Spam', toxicity: 'Toxicity', hate_speech: 'Hate Speech',
    scam: 'Scam', rule_violation: 'Rule Violation', low_effort: 'Low Effort',
    self_promotion: 'Self-Promo', nsfw: 'NSFW', brigading: 'Brigading',
    manipulation: 'Manipulation', clean: 'Clean',
  };
  return labels[cat] || cat;
}

function formatCompact(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// Expose to global scope for app.js
window.SentinelCharts = {
  renderCategoryChart,
  renderDonutChart,
  renderSparkline,
  renderTrustDistribution,
  renderActionBreakdown,
};
