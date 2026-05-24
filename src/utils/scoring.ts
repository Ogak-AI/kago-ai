// ============================================================
// Sentinel AI – Scoring Utilities
// Centralized score computation for priority, trust, and risk.
// ============================================================

import type { PriorityLevel, RiskLevel, ReputationTier, Severity } from '../types.js';
import {
  CRITICAL_PRIORITY_THRESHOLD,
  HIGH_PRIORITY_THRESHOLD,
  MEDIUM_PRIORITY_THRESHOLD,
  PRIORITY_WEIGHTS,
  SEVERITY_SCORES,
  TRUST,
} from '../constants.js';
import { clamp } from './validation.js';

/**
 * Compute composite priority score (0–100) using the spec formula:
 *   (AI confidence × 0.35) + (severity × 0.25) + (report count × 0.15)
 *   + (user risk × 0.15) + (recency × 0.10)
 *
 * @param confidence AI confidence 0–100
 * @param severity Severity level
 * @param reportCount Number of user reports
 * @param trustScore User trust score 0–100
 * @param createdAt Content creation timestamp (epoch ms)
 */
export function computePriorityScore(
  confidence: number,
  severity: Severity,
  reportCount: number,
  trustScore: number,
  createdAt: number,
): number {
  const severityScore = SEVERITY_SCORES[severity] ?? 30;

  // AI confidence component (0–100 → 0–35)
  const confidenceComponent = confidence * PRIORITY_WEIGHTS.AI_CONFIDENCE;

  // Severity component (0–100 → 0–25)
  const severityComponent = severityScore * PRIORITY_WEIGHTS.SEVERITY;

  // Report count component: each report adds 10 points, capped at 100 (0–100 → 0–15)
  const reportScore = clamp(reportCount * 10, 0, 100);
  const reportComponent = reportScore * PRIORITY_WEIGHTS.REPORT_COUNT;

  // User risk component: inverse of trust (0–100 → 0–15)
  const userRisk = 100 - trustScore;
  const riskComponent = userRisk * PRIORITY_WEIGHTS.USER_RISK;

  // Recency component: newer content gets higher priority
  // Max score for content created in the last hour, decays over 24 hours
  const ageMs = Date.now() - createdAt;
  const ageHours = ageMs / 3600000;
  const recencyScore = clamp(100 - (ageHours * (100 / 24)), 0, 100);
  const recencyComponent = recencyScore * PRIORITY_WEIGHTS.RECENCY;

  const raw = confidenceComponent + severityComponent + reportComponent + riskComponent + recencyComponent;
  return clamp(Math.round(raw), 0, 100);
}

/**
 * Determine priority level from a composite score.
 */
export function getPriorityLevel(score: number): PriorityLevel {
  if (score >= CRITICAL_PRIORITY_THRESHOLD) return 'critical';
  if (score >= HIGH_PRIORITY_THRESHOLD) return 'high';
  if (score >= MEDIUM_PRIORITY_THRESHOLD) return 'medium';
  return 'low';
}

/**
 * Compute a trust score from 0–100 based on reputation data.
 * Higher = more trusted.
 */
export function computeTrustScore(data: {
  violations: number;
  approvals: number;
  bans: number;
  spamCount: number;
  accountAgeDays: number;
  karma: number;
  overrideCount: number;
}): number {
  let score = TRUST.INITIAL_SCORE;

  // Violations are heavily penalised
  score += data.violations * TRUST.VIOLATION_PENALTY;

  // Bans are severe
  score += data.bans * TRUST.BAN_PENALTY;

  // Spam incidents
  score += data.spamCount * TRUST.SPAM_PENALTY;

  // Approvals slowly build trust
  score += data.approvals * TRUST.APPROVAL_BONUS;

  // False positive forgiveness (mods overrode AI decisions about this user)
  score += data.overrideCount * TRUST.FALSE_POSITIVE_RECOVERY;

  // Karma bonus (0–20 points, gains from positive karma)
  const karmaBonus = clamp((data.karma / 1000) * TRUST.KARMA_BONUS_PER_1K, 0, 20);
  score += karmaBonus;

  // Account age bonus (0–15 points, older = more trusted)
  const ageDays = Math.max(0, data.accountAgeDays);
  const ageBonus = clamp(Math.floor(ageDays / 30) * TRUST.ACCOUNT_AGE_BONUS_PER_30D, 0, 15);
  score += ageBonus;

  return clamp(Math.round(score), TRUST.MIN_SCORE, TRUST.MAX_SCORE);
}

/**
 * Determine risk level from trust score.
 */
export function getRiskLevel(trustScore: number): RiskLevel {
  if (trustScore >= 80) return 'minimal';
  if (trustScore >= 60) return 'low';
  if (trustScore >= 40) return 'moderate';
  if (trustScore >= 25) return 'high';
  return 'critical';
}

/**
 * Determine reputation tier from trust score.
 */
export function getReputationTier(trustScore: number): ReputationTier {
  if (trustScore >= 80) return 'trusted';
  if (trustScore >= 60) return 'established';
  if (trustScore >= 40) return 'neutral';
  if (trustScore >= 25) return 'suspicious';
  return 'untrusted';
}

/**
 * Compute approval ratio (0–1).
 */
export function computeApprovalRatio(approvals: number, violations: number): number {
  const total = approvals + violations;
  if (total === 0) return 1;
  return parseFloat((approvals / total).toFixed(3));
}
