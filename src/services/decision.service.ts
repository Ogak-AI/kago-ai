// ============================================================
// Kago AI – Decision Engine
//
// This is the core intelligence of Kago AI.
// It takes AI analysis + user context and produces a definitive,
// explainable decision — not just a flag.
//
// Decision hierarchy (evaluated in order):
//   1. Safety layer   → if confidence < 85, force mod review
//   2. Temporal ban   → if 3+ violations in 24h, auto-ban
//   3. Trust bypass   → if high trust + low confidence, auto-approve
//   4. Severity gate  → high severity + high confidence → auto-remove
//   5. Low trust gate → low trust user + spam → auto-remove
//   6. Queue routing  → route to high/medium/low review queue
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type {
  AIAnalysisResult,
  DecisionResult,
  Severity,
  UserReputation,
  KagoSettings,
} from '../types.js';
import {
  AUTO_BAN_VIOLATION_THRESHOLD,
  VIOLATION_WINDOW_MS,
  Keys,
} from '../constants.js';

// ──────────────────────────────────────────────
// Severity Classification
// ──────────────────────────────────────────────

/**
 * Map category + confidence to a severity level.
 * This makes the decision engine category-aware, not just score-aware.
 */
export function classifySeverity(
  category: AIAnalysisResult['category'],
  confidence: number,
): Severity {
  // Always high severity regardless of confidence
  if (category === 'hate_speech') return 'high';
  if (category === 'scam') return 'high';

  // Depends on confidence
  if (category === 'toxicity') {
    return confidence >= 75 ? 'high' : confidence >= 50 ? 'medium' : 'low';
  }
  if (category === 'spam') {
    return confidence >= 80 ? 'high' : confidence >= 55 ? 'medium' : 'low';
  }
  if (category === 'rule_violation') {
    return confidence >= 70 ? 'medium' : 'low';
  }
  if (category === 'low_effort') {
    return 'low';
  }

  return 'low'; // clean
}

// ──────────────────────────────────────────────
// Temporal Violation Window
// ──────────────────────────────────────────────

/**
 * Record a violation in the rolling 24h window for a user.
 * Uses a Redis sorted set with score=epochMs, member=unique entry.
 */
export async function recordTemporalViolation(
  redis: RedisClient,
  subredditId: string,
  userId: string,
  itemId: string,
): Promise<void> {
  const key = Keys.userViolationWindow(subredditId, userId);
  const now = Date.now();

  // Add the violation with score = timestamp
  await redis.zAdd(key, { score: now, member: `${now}_${itemId}` });

  // Prune entries older than 24h to keep the set bounded
  const cutoff = now - VIOLATION_WINDOW_MS;
  await redis.zRemRangeByScore(key, 0, cutoff);
}

/**
 * Count violations in the last 24 hours for a user.
 */
export async function countRecentViolations(
  redis: RedisClient,
  subredditId: string,
  userId: string,
): Promise<number> {
  const key = Keys.userViolationWindow(subredditId, userId);
  const cutoff = Date.now() - VIOLATION_WINDOW_MS;

  // Count members with score > cutoff (i.e. within last 24h)
  const members = await redis.zRange(key, 0, -1, { by: 'rank' });
  if (!members) return 0;
  let count = 0;
  for (const m of members) {
    const entry = m as { member: string; score: number };
    const score = typeof entry === 'string' ? 0 : entry.score;
    if (score > cutoff) count++;
  }
  return count;
}

// ──────────────────────────────────────────────
// The Decision Engine
// ──────────────────────────────────────────────

export interface DecisionContext {
  analysis: AIAnalysisResult;
  user: UserReputation;
  settings: KagoSettings;
  recentViolations24h: number;
  reportCount?: number;
  /** Optional adaptive threshold override (from adaptive learning) */
  adaptiveThreshold?: number;
}

/**
 * Make a definitive, explainable decision about what to do with a piece of content.
 *
 * The decision is deterministic and layered — each rule has a clear priority.
 * Every decision includes a human-readable `reason` for transparency.
 */
export function decide(ctx: DecisionContext): DecisionResult {
  const { analysis, user, settings, recentViolations24h } = ctx;
  const { category, confidence } = analysis;
  const severity = classifySeverity(category, confidence);
  const effectiveThreshold = ctx.adaptiveThreshold ?? settings.autoRemoveThreshold;

  // ── LAYER 0: Content is clean → skip ──────────────────────
  if (category === 'clean') {
    if (confidence >= 70) {
      return {
        action: 'skip',
        reason: `Content appears clean (confidence: ${confidence}%). No action needed.`,
        requiresModReview: false,
        severity: 'low',
      };
    }
    // Low confidence clean → still review if borderline
    return {
      action: 'enqueue_low',
      reason: `Content classified as clean but with low confidence (${confidence}%). Queued for low-priority review.`,
      requiresModReview: true,
      severity: 'low',
    };
  }

  // ── LAYER 1: Safety gate ──────────────────────────────────
  // If confidence is below 85%, never auto-remove — always require mod review.
  // This is the most important trust-building rule.
  if (confidence < 85 && severity !== 'high') {
    const queueTier = confidence >= 60 ? 'enqueue_medium' : 'enqueue_low';
    return {
      action: queueTier,
      reason: `AI confidence too low to act automatically (${confidence}% < 85%). Queued for ${confidence >= 60 ? 'medium' : 'low'}-priority mod review.`,
      requiresModReview: true,
      severity,
    };
  }

  // ── LAYER 2: Temporal escalation ─────────────────────────
  // 3+ violations in 24h = pattern, not accident → auto-ban.
  if (recentViolations24h >= AUTO_BAN_VIOLATION_THRESHOLD) {
    return {
      action: 'auto_ban_temp',
      reason: `Repeat offender: ${recentViolations24h} violations in the last 24 hours (threshold: ${AUTO_BAN_VIOLATION_THRESHOLD}). Automatically banned.`,
      requiresModReview: false,
      severity: 'high',
    };
  }

  // ── LAYER 3: Trusted user bypass ─────────────────────────
  // High-trust users with moderate-confidence violations get benefit of the doubt.
  if (
    settings.autoApproveTrustedUsers &&
    user.trustScore >= settings.trustedUserThreshold &&
    confidence < 90
  ) {
    return {
      action: 'auto_approve',
      reason: `Trusted user (score: ${user.trustScore}/100) with borderline content (${confidence}% confidence). Auto-approved to reduce false positives.`,
      requiresModReview: false,
      severity,
    };
  }

  // ── LAYER 4: High severity, high confidence → auto-remove ─
  if (severity === 'high' && confidence >= effectiveThreshold) {
    return {
      action: 'auto_remove',
      reason: `High severity ${category} detected with ${confidence}% confidence (threshold: ${effectiveThreshold}%${ctx.adaptiveThreshold ? ' [adaptive]' : ''}). Auto-removed.`,
      requiresModReview: false,
      severity: 'high',
    };
  }

  // ── LAYER 5: Low trust user + known violation type ────────
  if (
    user.trustScore < settings.lowTrustThreshold &&
    (category === 'spam' || category === 'scam') &&
    confidence >= 70
  ) {
    return {
      action: 'auto_remove',
      reason: `Low-trust user (score: ${user.trustScore}/100) posting ${category} with ${confidence}% confidence. Auto-removed due to combined risk.`,
      requiresModReview: false,
      severity: 'high',
    };
  }

  // ── LAYER 6: Medium severity, high confidence ──────────────
  if (severity === 'medium' && confidence >= effectiveThreshold) {
    return {
      action: 'auto_remove',
      reason: `${category} detected with ${confidence}% confidence (threshold: ${effectiveThreshold}%${ctx.adaptiveThreshold ? ' [adaptive]' : ''}). Auto-removed.`,
      requiresModReview: false,
      severity: 'medium',
    };
  }

  // ── LAYER 7: Queue routing ────────────────────────────────
  // Anything that didn't auto-resolve goes to the queue, ranked by severity.
  if (severity === 'high') {
    return {
      action: 'enqueue_high',
      reason: `High severity ${category} (${confidence}% confidence) queued for urgent mod review.`,
      requiresModReview: true,
      severity: 'high',
    };
  }

  if (severity === 'medium') {
    return {
      action: 'enqueue_medium',
      reason: `${category} detected (${confidence}% confidence) queued for mod review.`,
      requiresModReview: true,
      severity: 'medium',
    };
  }

  return {
    action: 'enqueue_low',
    reason: `Low severity ${category} (${confidence}% confidence) queued for low-priority review.`,
    requiresModReview: true,
    severity: 'low',
  };
}
