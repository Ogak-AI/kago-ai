// ============================================================
// Kago AI – Formatting Utilities
// Human-readable formatting for display and logging.
// ============================================================

import type { PriorityLevel, RiskLevel, ReputationTier, Severity, ViolationCategory } from '../types.js';

/**
 * Format a timestamp as relative time (e.g. "3 minutes ago").
 */
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Format a violation category for display.
 */
export function formatCategory(category: ViolationCategory): string {
  const map: Record<ViolationCategory, string> = {
    spam: 'Spam',
    toxicity: 'Toxicity',
    hate_speech: 'Hate Speech',
    rule_violation: 'Rule Violation',
    low_effort: 'Low Effort',
    scam: 'Scam',
    self_promotion: 'Self-Promotion',
    nsfw: 'NSFW',
    brigading: 'Brigading',
    manipulation: 'Manipulation',
    clean: 'Clean',
  };
  return map[category] || category;
}

/**
 * Format a severity level for display with emoji.
 */
export function formatSeverity(severity: Severity): string {
  const map: Record<Severity, string> = {
    critical: '🔴 Critical',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🟢 Low',
  };
  return map[severity] || severity;
}

/**
 * Format a priority level for display.
 */
export function formatPriority(level: PriorityLevel): string {
  const map: Record<PriorityLevel, string> = {
    critical: '⚡ Critical',
    high: '🔥 High',
    medium: '⚠️ Medium',
    low: '✓ Low',
  };
  return map[level] || level;
}

/**
 * Format a risk level for display.
 */
export function formatRiskLevel(level: RiskLevel): string {
  const map: Record<RiskLevel, string> = {
    minimal: '🟢 Minimal',
    low: '🔵 Low',
    moderate: '🟡 Moderate',
    high: '🟠 High',
    critical: '🔴 Critical',
  };
  return map[level] || level;
}

/**
 * Format a reputation tier for display.
 */
export function formatTier(tier: ReputationTier): string {
  const map: Record<ReputationTier, string> = {
    trusted: '⭐ Trusted',
    established: '✅ Established',
    neutral: '➖ Neutral',
    suspicious: '⚠️ Suspicious',
    untrusted: '🚫 Untrusted',
  };
  return map[tier] || tier;
}

/**
 * Format a number with comma separators.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format a percentage.
 */
export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format hours as "Xh Ym".
 */
export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format a cost in USD.
 */
export function formatCost(dollars: number): string {
  return `$${dollars.toFixed(4)}`;
}

/**
 * Generate a unique ID.
 */
export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a content hash for deduplication/caching.
 */
export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
